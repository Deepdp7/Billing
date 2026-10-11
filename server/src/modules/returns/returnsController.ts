import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

// ============================================================================
// 1. SALES RETURNS (CREDIT NOTES / বিক্রয় ফেরত)
// ============================================================================

export function getSalesReturns(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { search, customerId } = req.query as { search?: string; customerId?: string };

  let query = `
    SELECT cn.*,
           (SELECT COUNT(*) FROM credit_note_items WHERE credit_note_id = cn.id) as item_count
    FROM credit_notes cn
    WHERE cn.business_id = ?
  `;
  const params: any[] = [businessId];

  if (customerId) {
    query += ' AND cn.customer_id = ?';
    params.push(customerId);
  }

  if (search) {
    query += ' AND (cn.credit_note_number LIKE ? OR cn.invoice_number LIKE ? OR cn.customer_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY cn.return_date DESC, cn.created_at DESC';

  const returns = db.prepare(query).all(...params);
  res.json({ data: returns });
}

export function lookupInvoiceForReturn(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const invoiceNumber = req.params.invoiceNumber;

  const invoice = db.prepare(`
    SELECT * FROM invoices 
    WHERE business_id = ? AND (invoice_number = ? OR id = ?)
  `).get(businessId, invoiceNumber, invoiceNumber) as any;

  if (!invoice) {
    res.status(404).json({ code: 'INVOICE_NOT_FOUND', message: `Invoice "${invoiceNumber}" not found` });
    return;
  }

  if (invoice.status === 'CANCELLED') {
    res.status(400).json({ code: 'INVOICE_CANCELLED', message: 'Cancelled invoice cannot be returned' });
    return;
  }

  const items = db.prepare(`
    SELECT ii.*,
           COALESCE((
             SELECT SUM(cni.quantity) 
             FROM credit_note_items cni 
             JOIN credit_notes cn ON cn.id = cni.credit_note_id 
             WHERE cn.invoice_id = ii.invoice_id 
               AND (cni.product_id = ii.product_id OR cni.product_name = ii.product_name)
           ), 0) as already_returned_qty
    FROM invoice_items ii
    WHERE ii.invoice_id = ?
  `).all(invoice.id) as any[];

  res.json({
    data: {
      invoice,
      items: items.map(item => ({
        ...item,
        alreadyReturnedQty: Number(item.already_returned_qty) || 0,
        availableQty: Math.max(0, (Number(item.quantity) || 0) - (Number(item.already_returned_qty) || 0)),
      })),
    }
  });
}

export function createSalesReturn(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const userId = req.user?.userId;

  const {
    invoiceId,
    invoiceNumber,
    customerId,
    customerName = 'Walk-in Customer',
    customerPhone = '',
    items = [],
    refundMode = 'CASH', // CASH, UPI, BANK_TRANSFER, STORE_CREDIT
    reason = 'CUSTOMER_CHANGE_MIND',
    notes = '',
    returnDate,
  } = req.body;

  if (!items.length) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'At least one return item is required' });
    return;
  }

  // Calculate next Credit Note number (e.g. CN-1001, CN-1002)
  const existingCount = db.prepare('SELECT COUNT(*) as count FROM credit_notes WHERE business_id = ?').get(businessId) as any;
  const creditNoteNumber = `CN-${1000 + (existingCount?.count || 0) + 1}`;
  const creditNoteId = uuidv4();
  const dateStr = returnDate || new Date().toISOString().split('T')[0];

  let subtotalPaise = 0;
  let taxPaise = 0;

  const processedItems = items.map((it: any) => {
    const qty = Math.max(0.01, Number(it.quantity) || 1);
    const unitPrice = Math.max(0, Math.round(Number(it.unitPricePaise) || 0));
    const taxRate = Number(it.taxRate) || 0;
    const lineSubtotal = Math.round(qty * unitPrice);
    const lineTax = Math.round((lineSubtotal * taxRate) / 100);
    const lineTotal = lineSubtotal + lineTax;

    subtotalPaise += lineSubtotal;
    taxPaise += lineTax;

    return {
      id: uuidv4(),
      productId: it.productId || null,
      productName: it.productName,
      sku: it.sku || '',
      quantity: qty,
      unitPricePaise: unitPrice,
      taxRate,
      taxPaise: lineTax,
      totalPaise: lineTotal,
    };
  });

  const totalRefundPaise = subtotalPaise + taxPaise;

  const transaction = db.transaction(() => {
    // 1. Insert Credit Note Header
    db.prepare(`
      INSERT INTO credit_notes (
        id, business_id, credit_note_number, invoice_id, invoice_number,
        customer_id, customer_name, customer_phone, return_date,
        subtotal_paise, tax_paise, total_refund_paise, refund_mode,
        reason, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      creditNoteId, businessId, creditNoteNumber, invoiceId || null, invoiceNumber || 'MANUAL',
      customerId || null, customerName, customerPhone, dateStr,
      subtotalPaise, taxPaise, totalRefundPaise, refundMode,
      reason, notes, userId || null
    );

    // 2. Insert Credit Note Items & Restock Products
    const insertItem = db.prepare(`
      INSERT INTO credit_note_items (
        id, business_id, credit_note_id, product_id, product_name, sku,
        quantity, unit_price_paise, tax_rate, tax_paise, total_paise
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const restockProduct = db.prepare(`
      UPDATE products 
      SET stock_quantity = stock_quantity + ?, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `);

    const recordMovement = db.prepare(`
      INSERT INTO stock_movements (
        id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at
      ) VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'RETURN', ?, ?, datetime('now'))
    `);

    for (const item of processedItems) {
      insertItem.run(
        item.id, businessId, creditNoteId, item.productId, item.productName, item.sku,
        item.quantity, item.unitPricePaise, item.taxRate, item.taxPaise, item.totalPaise
      );

      if (item.productId) {
        restockProduct.run(item.quantity, item.productId, businessId);
        recordMovement.run(
          uuidv4(), businessId, item.productId, item.quantity, item.productId,
          creditNoteId, `Sales Return Credit Note ${creditNoteNumber} (Inv: ${invoiceNumber})`
        );
      }
    }

    // 3. Customer Ledger Reversal / Store Credit
    if (customerId && (refundMode === 'STORE_CREDIT' || refundMode === 'ADJUST_BALANCE')) {
      db.prepare(`
        UPDATE customers 
        SET outstanding_balance_paise = MAX(0, outstanding_balance_paise - ?), updated_at = datetime('now')
        WHERE id = ? AND business_id = ?
      `).run(totalRefundPaise, customerId, businessId);
    }

    // 4. Audit Trail
    db.prepare(`
      INSERT INTO audit_logs (id, business_id, user_id, action, entity_type, entity_id, details_json, created_at)
      VALUES (?, ?, ?, 'CREATE_SALES_RETURN', 'CREDIT_NOTE', ?, ?, datetime('now'))
    `).run(
      uuidv4(), businessId, userId || null, creditNoteId,
      JSON.stringify({ creditNoteNumber, invoiceNumber, totalRefundPaise, refundMode, itemsCount: processedItems.length })
    );
  });

  try {
    transaction();
    const createdNote = db.prepare('SELECT * FROM credit_notes WHERE id = ?').get(creditNoteId);
    res.status(201).json({
      message: `Sales return ${creditNoteNumber} processed successfully and inventory restocked`,
      data: createdNote,
    });
  } catch (err: any) {
    res.status(500).json({ code: 'TRANSACTION_FAILED', message: err.message });
  }
}

export function getSalesReturnById(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const id = req.params.id;

  const creditNote = db.prepare(`
    SELECT * FROM credit_notes 
    WHERE id = ? AND business_id = ?
  `).get(id, businessId) as any;

  if (!creditNote) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Credit Note not found' });
    return;
  }

  const items = db.prepare(`
    SELECT * FROM credit_note_items 
    WHERE credit_note_id = ? AND business_id = ?
  `).all(id, businessId);

  const business = db.prepare(`
    SELECT name, gstin, phone, address, city, state, invoice_prefix 
    FROM businesses 
    WHERE id = ?
  `).get(businessId);

  res.json({
    data: {
      ...creditNote,
      items,
      business,
    }
  });
}

// ============================================================================
// 2. PURCHASE RETURNS (DEBIT NOTES / ক্রয় ফেরত)
// ============================================================================

export function getPurchaseReturns(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { search, supplierId } = req.query as { search?: string; supplierId?: string };

  let query = `
    SELECT dn.*,
           (SELECT COUNT(*) FROM debit_note_items WHERE debit_note_id = dn.id) as item_count
    FROM debit_notes dn
    WHERE dn.business_id = ?
  `;
  const params: any[] = [businessId];

  if (supplierId) {
    query += ' AND dn.supplier_id = ?';
    params.push(supplierId);
  }

  if (search) {
    query += ' AND (dn.debit_note_number LIKE ? OR dn.purchase_number LIKE ? OR dn.supplier_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY dn.return_date DESC, dn.created_at DESC';

  const debitNotes = db.prepare(query).all(...params);
  res.json({ data: debitNotes });
}

export function lookupPurchaseForReturn(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const purchaseNumber = req.params.purchaseNumber;

  const purchase = db.prepare(`
    SELECT * FROM purchase_invoices 
    WHERE business_id = ? AND (purchase_number = ? OR id = ?)
  `).get(businessId, purchaseNumber, purchaseNumber) as any;

  if (!purchase) {
    res.status(404).json({ code: 'PURCHASE_NOT_FOUND', message: `Purchase invoice "${purchaseNumber}" not found` });
    return;
  }

  const items = db.prepare(`
    SELECT pi.*,
           COALESCE((
             SELECT SUM(dni.quantity) 
             FROM debit_note_items dni 
             JOIN debit_notes dn ON dn.id = dni.debit_note_id 
             WHERE dn.purchase_id = pi.purchase_id 
               AND (dni.product_id = pi.product_id OR dni.product_name = pi.product_name)
           ), 0) as already_returned_qty
    FROM purchase_items pi
    WHERE pi.purchase_id = ?
  `).all(purchase.id) as any[];

  res.json({
    data: {
      purchase,
      items: items.map(item => ({
        ...item,
        alreadyReturnedQty: Number(item.already_returned_qty) || 0,
        availableQty: Math.max(0, (Number(item.quantity) || 0) - (Number(item.already_returned_qty) || 0)),
      })),
    }
  });
}

export function createPurchaseReturn(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const userId = req.user?.userId;

  const {
    purchaseId,
    purchaseNumber,
    supplierId,
    supplierName,
    supplierPhone = '',
    items = [],
    refundMode = 'ADJUST_PAYABLE', // ADJUST_PAYABLE, CASH, BANK_TRANSFER
    reason = 'DAMAGED_GOODS',
    notes = '',
    returnDate,
  } = req.body;

  if (!supplierName || !items.length) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Supplier name and return items are required' });
    return;
  }

  // Calculate next Debit Note number (e.g. DN-1001)
  const existingCount = db.prepare('SELECT COUNT(*) as count FROM debit_notes WHERE business_id = ?').get(businessId) as any;
  const debitNoteNumber = `DN-${1000 + (existingCount?.count || 0) + 1}`;
  const debitNoteId = uuidv4();
  const dateStr = returnDate || new Date().toISOString().split('T')[0];

  let subtotalPaise = 0;
  let taxPaise = 0;

  const processedItems = items.map((it: any) => {
    const qty = Math.max(0.01, Number(it.quantity) || 1);
    const unitPrice = Math.max(0, Math.round(Number(it.unitPricePaise) || 0));
    const taxRate = Number(it.taxRate) || 0;
    const lineSubtotal = Math.round(qty * unitPrice);
    const lineTax = Math.round((lineSubtotal * taxRate) / 100);
    const lineTotal = lineSubtotal + lineTax;

    subtotalPaise += lineSubtotal;
    taxPaise += lineTax;

    return {
      id: uuidv4(),
      productId: it.productId || null,
      productName: it.productName,
      quantity: qty,
      unitPricePaise: unitPrice,
      taxRate,
      taxPaise: lineTax,
      totalPaise: lineTotal,
    };
  });

  const totalPaise = subtotalPaise + taxPaise;

  const transaction = db.transaction(() => {
    // 1. Insert Debit Note
    db.prepare(`
      INSERT INTO debit_notes (
        id, business_id, debit_note_number, purchase_id, purchase_number,
        supplier_id, supplier_name, supplier_phone, return_date,
        subtotal_paise, tax_paise, total_paise, refund_mode,
        reason, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      debitNoteId, businessId, debitNoteNumber, purchaseId || null, purchaseNumber || 'MANUAL',
      supplierId || null, supplierName, supplierPhone, dateStr,
      subtotalPaise, taxPaise, totalPaise, refundMode,
      reason, notes, userId || null
    );

    // 2. Insert Debit Note Items & Deduct Stock from Warehouse
    const insertItem = db.prepare(`
      INSERT INTO debit_note_items (
        id, business_id, debit_note_id, product_id, product_name,
        quantity, unit_price_paise, tax_rate, tax_paise, total_paise
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deductProduct = db.prepare(`
      UPDATE products 
      SET stock_quantity = stock_quantity - ?, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `);

    const recordMovement = db.prepare(`
      INSERT INTO stock_movements (
        id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at
      ) VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'PURCHASE_RETURN', ?, ?, datetime('now'))
    `);

    for (const item of processedItems) {
      insertItem.run(
        item.id, businessId, debitNoteId, item.productId, item.productName,
        item.quantity, item.unitPricePaise, item.taxRate, item.taxPaise, item.totalPaise
      );

      if (item.productId) {
        deductProduct.run(item.quantity, item.productId, businessId);
        recordMovement.run(
          uuidv4(), businessId, item.productId, -item.quantity, item.productId,
          debitNoteId, `Purchase Return Debit Note ${debitNoteNumber} to ${supplierName} (Pur: ${purchaseNumber})`
        );
      }
    }

    // 3. Adjust Supplier Payable
    if (supplierId && refundMode === 'ADJUST_PAYABLE') {
      db.prepare(`
        UPDATE suppliers 
        SET outstanding_balance_paise = MAX(0, outstanding_balance_paise - ?), updated_at = datetime('now')
        WHERE id = ? AND business_id = ?
      `).run(totalPaise, supplierId, businessId);
    }

    // 4. Audit Trail
    db.prepare(`
      INSERT INTO audit_logs (id, business_id, user_id, action, entity_type, entity_id, details_json, created_at)
      VALUES (?, ?, ?, 'CREATE_PURCHASE_RETURN', 'DEBIT_NOTE', ?, ?, datetime('now'))
    `).run(
      uuidv4(), businessId, userId || null, debitNoteId,
      JSON.stringify({ debitNoteNumber, purchaseNumber, totalPaise, refundMode, itemsCount: processedItems.length })
    );
  });

  try {
    transaction();
    const createdNote = db.prepare('SELECT * FROM debit_notes WHERE id = ?').get(debitNoteId);
    res.status(201).json({
      message: `Purchase return ${debitNoteNumber} recorded and inventory deducted successfully`,
      data: createdNote,
    });
  } catch (err: any) {
    res.status(500).json({ code: 'TRANSACTION_FAILED', message: err.message });
  }
}

export function getPurchaseReturnById(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const id = req.params.id;

  const debitNote = db.prepare(`
    SELECT * FROM debit_notes 
    WHERE id = ? AND business_id = ?
  `).get(id, businessId) as any;

  if (!debitNote) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Debit Note not found' });
    return;
  }

  const items = db.prepare(`
    SELECT * FROM debit_note_items 
    WHERE debit_note_id = ? AND business_id = ?
  `).all(id, businessId);

  const business = db.prepare(`
    SELECT name, gstin, phone, address, city, state, invoice_prefix 
    FROM businesses 
    WHERE id = ?
  `).get(businessId);

  res.json({
    data: {
      ...debitNote,
      items,
      business,
    }
  });
}
