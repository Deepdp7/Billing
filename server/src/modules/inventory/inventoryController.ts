import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

export function getLowStockAlerts(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;

  const lowStockItems = db.prepare(`
    SELECT p.id, p.name, p.sku, p.barcode, p.unit, p.stock_quantity, p.low_stock_threshold, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.business_id = ? AND p.is_active = 1 AND p.stock_quantity <= p.low_stock_threshold
    ORDER BY p.stock_quantity ASC
  `).all(businessId);

  res.json({ data: lowStockItems, count: lowStockItems.length });
}

export function adjustStock(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { productId, changeQuantity, reason, notes } = req.body;

  if (!productId || changeQuantity === undefined || changeQuantity === 0) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Product ID and non-zero change quantity required' });
    return;
  }

  const product = db.prepare('SELECT id, stock_quantity, name FROM products WHERE id = ? AND business_id = ?').get(productId, businessId) as any;
  if (!product) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Product not found' });
    return;
  }

  const newQty = product.stock_quantity + Number(changeQuantity);

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE products 
      SET stock_quantity = ?, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `).run(newQty, productId, businessId);

    db.prepare(`
      INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at)
      VALUES (?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', ?, ?, datetime('now'))
    `).run(
      uuidv4(),
      businessId,
      productId,
      Number(changeQuantity),
      newQty,
      reason || 'MANUAL',
      notes || `Stock adjusted by ${changeQuantity}`
    );
  });

  try {
    transaction();
    res.json({
      message: 'Stock updated successfully',
      product: { id: productId, name: product.name, previousQuantity: product.stock_quantity, newQuantity: newQty },
    });
  } catch (err: any) {
    res.status(500).json({ code: 'TRANSACTION_FAILED', message: err.message });
  }
}

export function getStockMovements(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { productId, limit = 50 } = req.query;

  const conditions = ['sm.business_id = ?'];
  const params: any[] = [businessId];

  if (productId) {
    conditions.push('sm.product_id = ?');
    params.push(productId);
  }

  const movements = db.prepare(`
    SELECT sm.*, p.name as product_name, p.sku
    FROM stock_movements sm
    JOIN products p ON sm.product_id = p.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY sm.created_at DESC
    LIMIT ?
  `).all(...params, Number(limit));

  res.json({ data: movements });
}
