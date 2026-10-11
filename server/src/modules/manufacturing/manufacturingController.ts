import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

// ============================================================================
// MANUFACTURING & BILL OF MATERIALS (BOM) CONTROLLER (PRD §5)
// ============================================================================

// ----------------------------------------------------------------------------
// 1. BILL OF MATERIALS (BOM) MASTER
// ----------------------------------------------------------------------------

export function getBoms(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { search } = req.query as { search?: string };

  let query = `
    SELECT br.*,
           p.sku as finished_product_sku,
           p.stock_quantity as finished_product_stock,
           p.sale_price_paise as finished_product_sale_price,
           (SELECT COUNT(*) FROM bom_items WHERE bom_id = br.id) as component_count
    FROM bom_recipes br
    JOIN products p ON p.id = br.finished_product_id
    WHERE br.business_id = ?
  `;
  const params: any[] = [businessId];

  if (search) {
    query += ' AND (br.bom_code LIKE ? OR br.finished_product_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY br.created_at DESC';

  const boms = db.prepare(query).all(...params) as any[];

  // Attach items and compute estimated material cost
  const getItemsStmt = db.prepare(`
    SELECT bi.*, p.purchase_price_paise, p.stock_quantity as current_stock, p.sku as raw_material_sku
    FROM bom_items bi
    JOIN products p ON p.id = bi.raw_material_id
    WHERE bi.bom_id = ?
  `);

  const enrichedBoms = boms.map((bom) => {
    const items = getItemsStmt.all(bom.id) as any[];
    const materialCostPaise = items.reduce((sum, itm) => {
      const grossQty = itm.quantity_required * (1 + (itm.wastage_percent || 0) / 100);
      return sum + Math.round(grossQty * (itm.purchase_price_paise || 0));
    }, 0);

    const totalEstimatedCostPaise = materialCostPaise + bom.estimated_labor_cost_paise + bom.estimated_overhead_cost_paise;
    const estimatedCostPerUnitPaise = bom.output_quantity > 0 ? Math.round(totalEstimatedCostPaise / bom.output_quantity) : 0;

    return {
      ...bom,
      items,
      estimated_material_cost_paise: materialCostPaise,
      total_estimated_cost_paise: totalEstimatedCostPaise,
      estimated_cost_per_unit_paise: estimatedCostPerUnitPaise
    };
  });

  res.json({ boms: enrichedBoms });
}

export function getBomById(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;

  const bom = db.prepare(`
    SELECT br.*, p.sku as finished_product_sku, p.stock_quantity as finished_product_stock
    FROM bom_recipes br
    JOIN products p ON p.id = br.finished_product_id
    WHERE br.id = ? AND br.business_id = ?
  `).get(id, businessId) as any;

  if (!bom) {
    res.status(404).json({ error: 'BOM recipe not found' });
    return;
  }

  const items = db.prepare(`
    SELECT bi.*, p.purchase_price_paise, p.stock_quantity as current_stock, p.sku as raw_material_sku
    FROM bom_items bi
    JOIN products p ON p.id = bi.raw_material_id
    WHERE bi.bom_id = ?
  `).all(id);

  res.json({ bom, items });
}

export function createBom(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const {
    finished_product_id,
    output_quantity = 1,
    output_unit = 'Pcs',
    estimated_labor_cost_paise = 0,
    estimated_overhead_cost_paise = 0,
    notes,
    items
  } = req.body;

  if (!finished_product_id || !items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Finished product and at least one raw material component are required' });
    return;
  }

  const finishedProd = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(finished_product_id, businessId) as any;
  if (!finishedProd) {
    res.status(404).json({ error: 'Finished product not found' });
    return;
  }

  // Generate unique BOM code
  const countRow = db.prepare('SELECT COUNT(*) as count FROM bom_recipes WHERE business_id = ?').get(businessId) as { count: number };
  const bomCode = `BOM-${String(countRow.count + 1).padStart(3, '0')}`;
  const bomId = uuidv4();

  const createBomTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO bom_recipes (
        id, business_id, bom_code, finished_product_id, finished_product_name,
        output_quantity, output_unit, estimated_labor_cost_paise,
        estimated_overhead_cost_paise, notes, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      bomId, businessId, bomCode, finished_product_id, finishedProd.name,
      Number(output_quantity) || 1, output_unit || 'Pcs',
      Number(estimated_labor_cost_paise) || 0,
      Number(estimated_overhead_cost_paise) || 0,
      notes || null
    );

    const insertItemStmt = db.prepare(`
      INSERT INTO bom_items (
        id, business_id, bom_id, raw_material_id, raw_material_name,
        quantity_required, unit, wastage_percent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const itm of items) {
      const rawProd = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(itm.raw_material_id, businessId) as any;
      if (!rawProd) {
        throw new Error(`Raw material product ${itm.raw_material_id} not found`);
      }

      insertItemStmt.run(
        uuidv4(), businessId, bomId, rawProd.id, rawProd.name,
        Number(itm.quantity_required) || 1, itm.unit || rawProd.unit || 'Kg',
        Number(itm.wastage_percent) || 0
      );
    }

    return bomId;
  });

  try {
    const createdId = createBomTx();
    res.status(201).json({ message: 'BOM recipe created successfully', bomId: createdId, bomCode });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to create BOM' });
  }
}

export function deleteBom(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;

  // Check if any in-progress production order is using this BOM
  const activeOrder = db.prepare(`
    SELECT id FROM production_orders WHERE bom_id = ? AND business_id = ? AND status IN ('PLANNED', 'IN_PROGRESS')
  `).get(id, businessId);

  if (activeOrder) {
    res.status(400).json({ error: 'Cannot delete BOM while active or planned production orders exist' });
    return;
  }

  const result = db.prepare('DELETE FROM bom_recipes WHERE id = ? AND business_id = ?').run(id, businessId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'BOM recipe not found' });
    return;
  }

  res.json({ message: 'BOM recipe deleted successfully' });
}

// ----------------------------------------------------------------------------
// 2. PRODUCTION WORK ORDERS (Manufacturing Runs)
// ----------------------------------------------------------------------------

export function getProductionOrders(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { status, search } = req.query as { status?: string; search?: string };

  let query = `
    SELECT po.*, br.bom_code, br.output_quantity as standard_batch_yield,
           p.sku as finished_product_sku
    FROM production_orders po
    JOIN bom_recipes br ON br.id = po.bom_id
    JOIN products p ON p.id = po.finished_product_id
    WHERE po.business_id = ?
  `;
  const params: any[] = [businessId];

  if (status) {
    query += ' AND po.status = ?';
    params.push(status);
  }

  if (search) {
    query += ' AND (po.order_number LIKE ? OR po.finished_product_name LIKE ? OR po.batch_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY po.created_at DESC';

  const orders = db.prepare(query).all(...params);
  res.json({ orders });
}

export function getProductionOrderById(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;

  const order = db.prepare(`
    SELECT po.*, br.bom_code, br.estimated_labor_cost_paise, br.estimated_overhead_cost_paise,
           p.sku as finished_product_sku, p.stock_quantity as finished_current_stock
    FROM production_orders po
    JOIN bom_recipes br ON br.id = po.bom_id
    JOIN products p ON p.id = po.finished_product_id
    WHERE po.id = ? AND po.business_id = ?
  `).get(id, businessId) as any;

  if (!order) {
    res.status(404).json({ error: 'Production order not found' });
    return;
  }

  // Fetch component requirements & inventory availability
  const bomItems = db.prepare(`
    SELECT bi.*, p.stock_quantity as current_stock, p.purchase_price_paise, p.sku
    FROM bom_items bi
    JOIN products p ON p.id = bi.raw_material_id
    WHERE bi.bom_id = ?
  `).all(order.bom_id) as any[];

  // Scale requirements by target quantity / standard yield
  const standardYield = order.standard_batch_yield || 1;
  const multiplier = order.target_quantity / standardYield;

  const componentsWithReq = bomItems.map((itm) => {
    const requiredQty = itm.quantity_required * multiplier * (1 + (itm.wastage_percent || 0) / 100);
    const hasEnoughStock = itm.current_stock >= requiredQty;
    return {
      ...itm,
      required_quantity: Number(requiredQty.toFixed(2)),
      has_enough_stock: hasEnoughStock,
      shortage_quantity: hasEnoughStock ? 0 : Number((requiredQty - itm.current_stock).toFixed(2))
    };
  });

  const materialLogs = db.prepare(`
    SELECT * FROM production_material_logs WHERE production_order_id = ?
  `).all(id);

  res.json({
    order,
    components: componentsWithReq,
    materialLogs
  });
}

export function createProductionOrder(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const userId = req.user?.userId;
  const {
    bom_id,
    target_quantity,
    batch_number,
    notes
  } = req.body;

  if (!bom_id || !target_quantity || Number(target_quantity) <= 0) {
    res.status(400).json({ error: 'BOM recipe and valid target quantity are required' });
    return;
  }

  const bom = db.prepare('SELECT * FROM bom_recipes WHERE id = ? AND business_id = ?').get(bom_id, businessId) as any;
  if (!bom) {
    res.status(404).json({ error: 'BOM recipe not found' });
    return;
  }

  // Generate order number
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const countRow = db.prepare(`
    SELECT COUNT(*) as count FROM production_orders WHERE business_id = ? AND date(created_at) = date('now')
  `).get(businessId) as { count: number };
  const seq = String((countRow?.count || 0) + 1).padStart(3, '0');
  const orderNumber = `MFG-${dateStr}-${seq}`;

  const generatedBatch = batch_number || `BATCH-${dateStr}-${String(countRow?.count || 1).padStart(2, '0')}`;
  const orderId = uuidv4();

  db.prepare(`
    INSERT INTO production_orders (
      id, business_id, order_number, bom_id, finished_product_id, finished_product_name,
      target_quantity, batch_number, status, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', ?, ?)
  `).run(
    orderId, businessId, orderNumber, bom_id, bom.finished_product_id, bom.finished_product_name,
    Number(target_quantity), generatedBatch, notes || null, userId || null
  );

  res.status(201).json({
    message: 'Production work order created successfully',
    orderId,
    orderNumber,
    batchNumber: generatedBatch
  });
}

export function startProductionOrder(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;

  const result = db.prepare(`
    UPDATE production_orders SET status = 'IN_PROGRESS', updated_at = datetime('now')
    WHERE id = ? AND business_id = ? AND status = 'PLANNED'
  `).run(id, businessId);

  if (result.changes === 0) {
    res.status(400).json({ error: 'Order not found or not in PLANNED status' });
    return;
  }

  res.json({ message: 'Production order started (IN_PROGRESS)' });
}

// ATOMIC EXECUTION: Converts Raw Materials into Finished Goods
export function executeProductionRun(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;
  const { completed_quantity, labor_cost_paise = 0, overhead_cost_paise = 0 } = req.body;

  const order = db.prepare(`
    SELECT po.*, br.output_quantity as standard_yield, br.estimated_labor_cost_paise, br.estimated_overhead_cost_paise
    FROM production_orders po
    JOIN bom_recipes br ON br.id = po.bom_id
    WHERE po.id = ? AND po.business_id = ?
  `).get(id, businessId) as any;

  if (!order) {
    res.status(404).json({ error: 'Production order not found' });
    return;
  }

  if (order.status === 'COMPLETED') {
    res.status(400).json({ error: 'This production order has already been executed and completed' });
    return;
  }

  if (order.status === 'CANCELLED') {
    res.status(400).json({ error: 'Cannot execute a cancelled production order' });
    return;
  }

  const finalYield = Number(completed_quantity) || order.target_quantity;
  if (finalYield <= 0) {
    res.status(400).json({ error: 'Completed yield quantity must be greater than 0' });
    return;
  }

  // Component items from BOM
  const bomItems = db.prepare(`
    SELECT bi.*, p.purchase_price_paise, p.stock_quantity as current_stock
    FROM bom_items bi
    JOIN products p ON p.id = bi.raw_material_id
    WHERE bi.bom_id = ?
  `).all(order.bom_id) as any[];

  const standardYield = order.standard_yield || 1;
  const multiplier = finalYield / standardYield;

  const executeTx = db.transaction(() => {
    let totalRawMaterialCostPaise = 0;

    // 1. Validate stock & deduct raw materials
    const deductStockStmt = db.prepare(`
      UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND business_id = ?
    `);

    const insertMovementStmt = db.prepare(`
      INSERT INTO stock_movements (id, business_id, product_id, movement_type, quantity, reference_id, notes)
      VALUES (?, ?, ?, 'MANUFACTURING_CONSUMPTION', ?, ?, ?)
    `);

    const insertMaterialLogStmt = db.prepare(`
      INSERT INTO production_material_logs (id, business_id, production_order_id, raw_material_id, raw_material_name, quantity_consumed, unit_cost_paise, total_cost_paise)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const itm of bomItems) {
      const consumedQty = Number((itm.quantity_required * multiplier * (1 + (itm.wastage_percent || 0) / 100)).toFixed(2));
      
      // Stock check
      if (itm.current_stock < consumedQty) {
        throw new Error(`Insufficient stock for raw material "${itm.raw_material_name}". Required: ${consumedQty}, Available: ${itm.current_stock}`);
      }

      const unitCost = itm.purchase_price_paise || 0;
      const totalItemCost = Math.round(consumedQty * unitCost);
      totalRawMaterialCostPaise += totalItemCost;

      // Deduct from stock
      deductStockStmt.run(consumedQty, itm.raw_material_id, businessId);

      // Audit movement
      insertMovementStmt.run(
        uuidv4(), businessId, itm.raw_material_id, -consumedQty, order.id,
        `Consumed in Production Order ${order.order_number} (${order.finished_product_name})`
      );

      // Log material consumption
      insertMaterialLogStmt.run(
        uuidv4(), businessId, order.id, itm.raw_material_id, itm.raw_material_name,
        consumedQty, unitCost, totalItemCost
      );
    }

    // 2. Add Finished Product stock
    const addFinishedStockStmt = db.prepare(`
      UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ? AND business_id = ?
    `);

    addFinishedStockStmt.run(finalYield, order.finished_product_id, businessId);

    // Audit movement for finished goods
    insertMovementStmt.run(
      uuidv4(), businessId, order.finished_product_id, finalYield, order.id,
      `Manufactured via Production Order ${order.order_number} (Batch ${order.batch_number})`
    );

    // 3. Cost calculation
    const totalLaborPaise = Number(labor_cost_paise) || order.estimated_labor_cost_paise || 0;
    const totalOverheadPaise = Number(overhead_cost_paise) || order.estimated_overhead_cost_paise || 0;
    const totalCostPaise = totalRawMaterialCostPaise + totalLaborPaise + totalOverheadPaise;
    const costPerUnitPaise = finalYield > 0 ? Math.round(totalCostPaise / finalYield) : 0;

    // 4. Update production order status
    db.prepare(`
      UPDATE production_orders SET
        status = 'COMPLETED',
        completed_quantity = ?,
        completed_date = date('now'),
        total_raw_material_cost_paise = ?,
        total_labor_cost_paise = ?,
        total_overhead_cost_paise = ?,
        total_cost_paise = ?,
        cost_per_unit_paise = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      finalYield, totalRawMaterialCostPaise, totalLaborPaise, totalOverheadPaise,
      totalCostPaise, costPerUnitPaise, order.id
    );

    return {
      finalYield,
      totalCostPaise,
      costPerUnitPaise,
      rawMaterialCostPaise: totalRawMaterialCostPaise
    };
  });

  try {
    const result = executeTx();
    res.json({
      message: `Production run completed successfully! Added ${result.finalYield} units of ${order.finished_product_name} to inventory.`,
      productionSummary: result
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to execute production run' });
  }
}

export function cancelProductionOrder(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;

  const result = db.prepare(`
    UPDATE production_orders SET status = 'CANCELLED', updated_at = datetime('now')
    WHERE id = ? AND business_id = ? AND status IN ('PLANNED', 'IN_PROGRESS')
  `).run(id, businessId);

  if (result.changes === 0) {
    res.status(400).json({ error: 'Order not found or cannot be cancelled' });
    return;
  }

  res.json({ message: 'Production order cancelled' });
}

export function getManufacturingStats(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;

  const bomCount = db.prepare('SELECT COUNT(*) as count FROM bom_recipes WHERE business_id = ? AND is_active = 1').get(businessId) as { count: number };
  
  const orderStats = db.prepare(`
    SELECT
      COUNT(*) as total_orders,
      SUM(CASE WHEN status = 'PLANNED' THEN 1 ELSE 0 END) as planned_orders,
      SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress_orders,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_orders,
      SUM(CASE WHEN status = 'COMPLETED' THEN completed_quantity ELSE 0 END) as total_units_produced,
      SUM(CASE WHEN status = 'COMPLETED' THEN total_cost_paise ELSE 0 END) as total_production_cost_paise
    FROM production_orders
    WHERE business_id = ?
  `).get(businessId) as any;

  res.json({
    active_boms: bomCount?.count || 0,
    total_orders: orderStats?.total_orders || 0,
    planned_orders: orderStats?.planned_orders || 0,
    in_progress_orders: orderStats?.in_progress_orders || 0,
    completed_orders: orderStats?.completed_orders || 0,
    total_units_produced: orderStats?.total_units_produced || 0,
    total_production_cost_paise: orderStats?.total_production_cost_paise || 0
  });
}
