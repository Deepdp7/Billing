import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

// ============================================================================
// INTER-BRANCH STOCK TRANSFERS CONTROLLER (PRD §4.4 & §4.19)
// ============================================================================

export function getTransfers(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { status, search } = req.query as { status?: string; search?: string };

  let query = `
    SELECT st.*,
           (SELECT COUNT(*) FROM stock_transfer_items WHERE transfer_id = st.id) as item_count
    FROM stock_transfers st
    WHERE st.business_id = ?
  `;
  const params: any[] = [businessId];

  if (status) {
    query += ' AND st.status = ?';
    params.push(status);
  }

  if (search) {
    query += ' AND (st.transfer_number LIKE ? OR st.source_branch_name LIKE ? OR st.dest_branch_name LIKE ? OR st.tracking_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY st.transfer_date DESC, st.created_at DESC';

  const transfers = db.prepare(query).all(...params);
  res.json({ data: transfers });
}

export function getTransferById(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const id = req.params.id;

  const transfer = db.prepare(`
    SELECT * FROM stock_transfers 
    WHERE id = ? AND business_id = ?
  `).get(id, businessId) as any;

  if (!transfer) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Stock transfer challan not found' });
    return;
  }

  const items = db.prepare(`
    SELECT * FROM stock_transfer_items 
    WHERE transfer_id = ? AND business_id = ?
  `).all(id, businessId);

  const business = db.prepare(`
    SELECT name, gstin, phone, address, city, state, invoice_prefix 
    FROM businesses 
    WHERE id = ?
  `).get(businessId);

  res.json({
    data: {
      ...transfer,
      items,
      business,
    }
  });
}

export function createTransfer(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const userId = req.user?.userId;

  const {
    sourceBranchId,
    sourceBranchName,
    destBranchId,
    destBranchName,
    items = [],
    trackingNumber = '',
    notes = '',
    transferDate,
  } = req.body;

  if (!sourceBranchId || !destBranchId || sourceBranchId === destBranchId) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Valid source and distinct destination branches are required' });
    return;
  }

  if (!items.length) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'At least one item must be included in the transfer dispatch' });
    return;
  }

  // Check product availability
  for (const item of items) {
    const prod = db.prepare('SELECT id, name, stock_quantity FROM products WHERE id = ? AND business_id = ?').get(item.productId, businessId) as any;
    if (!prod) {
      res.status(400).json({ code: 'INVALID_PRODUCT', message: `Product ${item.productName || item.productId} not found` });
      return;
    }
    const requestedQty = Number(item.quantity) || 1;
    if (prod.stock_quantity < requestedQty) {
      res.status(400).json({
        code: 'INSUFFICIENT_STOCK',
        message: `Insufficient stock for "${prod.name}". Available: ${prod.stock_quantity}, Requested: ${requestedQty}`,
      });
      return;
    }
  }

  const existingCount = db.prepare('SELECT COUNT(*) as count FROM stock_transfers WHERE business_id = ?').get(businessId) as any;
  const transferNumber = `TRF-${1000 + (existingCount?.count || 0) + 1}`;
  const transferId = uuidv4();
  const dateStr = transferDate || new Date().toISOString().split('T')[0];

  const totalQuantity = items.reduce((sum: number, it: any) => sum + (Number(it.quantity) || 1), 0);

  const transaction = db.transaction(() => {
    // 1. Insert Transfer Record
    db.prepare(`
      INSERT INTO stock_transfers (
        id, business_id, transfer_number, source_branch_id, source_branch_name,
        dest_branch_id, dest_branch_name, transfer_date, status,
        total_items_count, total_quantity, tracking_number, notes, dispatched_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN_TRANSIT', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      transferId, businessId, transferNumber, sourceBranchId, sourceBranchName,
      destBranchId, destBranchName, dateStr,
      items.length, totalQuantity, trackingNumber, notes, userId || null
    );

    // 2. Insert items and deduct source stock
    const insertItem = db.prepare(`
      INSERT INTO stock_transfer_items (
        id, business_id, transfer_id, product_id, product_name, sku,
        dispatched_quantity, received_quantity, unit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);

    const deductStock = db.prepare(`
      UPDATE products 
      SET stock_quantity = stock_quantity - ?, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `);

    const recordMovement = db.prepare(`
      INSERT INTO stock_movements (
        id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at
      ) VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'TRANSFER_OUT', ?, ?, datetime('now'))
    `);

    for (const item of items) {
      const qty = Number(item.quantity) || 1;
      insertItem.run(
        uuidv4(), businessId, transferId, item.productId, item.productName, item.sku || '',
        qty, item.unit || 'Pcs'
      );

      deductStock.run(qty, item.productId, businessId);

      recordMovement.run(
        uuidv4(), businessId, item.productId, -qty, item.productId,
        transferId, `Stock Transfer Dispatch ${transferNumber} to ${destBranchName}`
      );
    }

    // 3. Audit log
    db.prepare(`
      INSERT INTO audit_logs (id, business_id, user_id, action, entity_type, entity_id, details_json, created_at)
      VALUES (?, ?, ?, 'CREATE_STOCK_TRANSFER', 'TRANSFER', ?, ?, datetime('now'))
    `).run(
      uuidv4(), businessId, userId || null, transferId,
      JSON.stringify({ transferNumber, sourceBranchName, destBranchName, itemsCount: items.length, totalQuantity })
    );
  });

  try {
    transaction();
    const created = db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(transferId);
    res.status(201).json({
      message: `Stock transfer challan ${transferNumber} created and goods dispatched!`,
      data: created,
    });
  } catch (err: any) {
    res.status(500).json({ code: 'TRANSACTION_FAILED', message: err.message });
  }
}

export function receiveTransfer(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const userId = req.user?.userId;
  const id = req.params.id;

  const transfer = db.prepare(`
    SELECT * FROM stock_transfers WHERE id = ? AND business_id = ?
  `).get(id, businessId) as any;

  if (!transfer) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Transfer record not found' });
    return;
  }

  if (transfer.status !== 'IN_TRANSIT') {
    res.status(400).json({ code: 'INVALID_STATUS', message: `Cannot receive transfer with status "${transfer.status}"` });
    return;
  }

  const items = db.prepare(`
    SELECT * FROM stock_transfer_items WHERE transfer_id = ? AND business_id = ?
  `).all(id, businessId) as any[];

  const transaction = db.transaction(() => {
    // 1. Mark status COMPLETED
    db.prepare(`
      UPDATE stock_transfers 
      SET status = 'COMPLETED', received_by = ?, received_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `).run(userId || null, id, businessId);

    // 2. Update received quantities & log inbound movement
    db.prepare(`
      UPDATE stock_transfer_items 
      SET received_quantity = dispatched_quantity 
      WHERE transfer_id = ? AND business_id = ?
    `).run(id, businessId);

    const recordMovement = db.prepare(`
      INSERT INTO stock_movements (
        id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at
      ) VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'TRANSFER_IN', ?, ?, datetime('now'))
    `);

    for (const item of items) {
      recordMovement.run(
        uuidv4(), businessId, item.product_id, item.dispatched_quantity, item.product_id,
        id, `Stock Transfer Received at ${transfer.dest_branch_name} (${transfer.transfer_number})`
      );
    }

    // 3. Audit
    db.prepare(`
      INSERT INTO audit_logs (id, business_id, user_id, action, entity_type, entity_id, details_json, created_at)
      VALUES (?, ?, ?, 'RECEIVE_STOCK_TRANSFER', 'TRANSFER', ?, ?, datetime('now'))
    `).run(
      uuidv4(), businessId, userId || null, id,
      JSON.stringify({ transferNumber: transfer.transfer_number, status: 'COMPLETED' })
    );
  });

  try {
    transaction();
    res.json({ message: `Challan ${transfer.transfer_number} marked as COMPLETED and received at ${transfer.dest_branch_name}!` });
  } catch (err: any) {
    res.status(500).json({ code: 'TRANSACTION_FAILED', message: err.message });
  }
}

export function cancelTransfer(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const userId = req.user?.userId;
  const id = req.params.id;

  const transfer = db.prepare(`
    SELECT * FROM stock_transfers WHERE id = ? AND business_id = ?
  `).get(id, businessId) as any;

  if (!transfer) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Transfer record not found' });
    return;
  }

  if (transfer.status !== 'IN_TRANSIT') {
    res.status(400).json({ code: 'INVALID_STATUS', message: `Only IN_TRANSIT transfers can be cancelled` });
    return;
  }

  const items = db.prepare(`
    SELECT * FROM stock_transfer_items WHERE transfer_id = ? AND business_id = ?
  `).all(id, businessId) as any[];

  const transaction = db.transaction(() => {
    // 1. Mark CANCELLED
    db.prepare(`
      UPDATE stock_transfers 
      SET status = 'CANCELLED', updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `).run(id, businessId);

    // 2. Restore goods back to warehouse stock
    const restoreStock = db.prepare(`
      UPDATE products 
      SET stock_quantity = stock_quantity + ?, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `);

    const recordMovement = db.prepare(`
      INSERT INTO stock_movements (
        id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at
      ) VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'TRANSFER_CANCEL', ?, ?, datetime('now'))
    `);

    for (const item of items) {
      restoreStock.run(item.dispatched_quantity, item.product_id, businessId);
      recordMovement.run(
        uuidv4(), businessId, item.product_id, item.dispatched_quantity, item.product_id,
        id, `Cancelled Transfer ${transfer.transfer_number} - Stock Restored`
      );
    }

    // 3. Audit
    db.prepare(`
      INSERT INTO audit_logs (id, business_id, user_id, action, entity_type, entity_id, details_json, created_at)
      VALUES (?, ?, ?, 'CANCEL_STOCK_TRANSFER', 'TRANSFER', ?, ?, datetime('now'))
    `).run(
      uuidv4(), businessId, userId || null, id,
      JSON.stringify({ transferNumber: transfer.transfer_number, status: 'CANCELLED' })
    );
  });

  try {
    transaction();
    res.json({ message: `Challan ${transfer.transfer_number} cancelled and goods safely restored back to inventory.` });
  } catch (err: any) {
    res.status(500).json({ code: 'TRANSACTION_FAILED', message: err.message });
  }
}
