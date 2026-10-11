"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLowStockAlerts = getLowStockAlerts;
exports.adjustStock = adjustStock;
exports.getStockMovements = getStockMovements;
const uuid_1 = require("uuid");
const connection_js_1 = require("../../db/connection.js");
function getLowStockAlerts(req, res) {
    const businessId = req.businessId;
    const lowStockItems = connection_js_1.db.prepare(`
    SELECT p.id, p.name, p.sku, p.barcode, p.unit, p.stock_quantity, p.low_stock_threshold, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.business_id = ? AND p.is_active = 1 AND p.stock_quantity <= p.low_stock_threshold
    ORDER BY p.stock_quantity ASC
  `).all(businessId);
    res.json({ data: lowStockItems, count: lowStockItems.length });
}
function adjustStock(req, res) {
    const businessId = req.businessId;
    const { productId, changeQuantity, reason, notes } = req.body;
    if (!productId || changeQuantity === undefined || changeQuantity === 0) {
        res.status(400).json({ code: 'BAD_REQUEST', message: 'Product ID and non-zero change quantity required' });
        return;
    }
    const product = connection_js_1.db.prepare('SELECT id, stock_quantity, name FROM products WHERE id = ? AND business_id = ?').get(productId, businessId);
    if (!product) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Product not found' });
        return;
    }
    const newQty = product.stock_quantity + Number(changeQuantity);
    const transaction = connection_js_1.db.transaction(() => {
        connection_js_1.db.prepare(`
      UPDATE products 
      SET stock_quantity = ?, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `).run(newQty, productId, businessId);
        connection_js_1.db.prepare(`
      INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at)
      VALUES (?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', ?, ?, datetime('now'))
    `).run((0, uuid_1.v4)(), businessId, productId, Number(changeQuantity), newQty, reason || 'MANUAL', notes || `Stock adjusted by ${changeQuantity}`);
    });
    try {
        transaction();
        res.json({
            message: 'Stock updated successfully',
            product: { id: productId, name: product.name, previousQuantity: product.stock_quantity, newQuantity: newQty },
        });
    }
    catch (err) {
        res.status(500).json({ code: 'TRANSACTION_FAILED', message: err.message });
    }
}
function getStockMovements(req, res) {
    const businessId = req.businessId;
    const { productId, limit = 50 } = req.query;
    const conditions = ['sm.business_id = ?'];
    const params = [businessId];
    if (productId) {
        conditions.push('sm.product_id = ?');
        params.push(productId);
    }
    const movements = connection_js_1.db.prepare(`
    SELECT sm.*, p.name as product_name, p.sku
    FROM stock_movements sm
    JOIN products p ON sm.product_id = p.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY sm.created_at DESC
    LIMIT ?
  `).all(...params, Number(limit));
    res.json({ data: movements });
}
