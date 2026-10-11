"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProducts = getProducts;
exports.createProduct = createProduct;
exports.updateProduct = updateProduct;
exports.deleteProduct = deleteProduct;
exports.getCategories = getCategories;
exports.createCategory = createCategory;
const uuid_1 = require("uuid");
const connection_js_1 = require("../../db/connection.js");
function getProducts(req, res) {
    const businessId = req.businessId;
    const { search, categoryId, barcode, lowStockOnly, limit = 100, page = 1 } = req.query;
    const conditions = ['p.business_id = ?', 'p.is_active = 1'];
    const params = [businessId];
    if (barcode) {
        conditions.push('p.barcode = ?');
        params.push(barcode);
    }
    if (categoryId) {
        conditions.push('p.category_id = ?');
        params.push(categoryId);
    }
    if (search) {
        conditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.hsn_code LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (lowStockOnly === 'true') {
        conditions.push('p.stock_quantity <= p.low_stock_threshold');
    }
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(limit);
    const total = connection_js_1.db.prepare(`SELECT COUNT(*) as count FROM products p WHERE ${whereClause}`).get(...params);
    const products = connection_js_1.db.prepare(`
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE ${whereClause}
    ORDER BY p.name ASC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), offset);
    res.json({
        data: products.map((prod) => ({
            ...prod,
            extra_attributes: prod.extra_attributes_json ? JSON.parse(prod.extra_attributes_json) : {},
        })),
        pagination: {
            total: total.count,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total.count / Number(limit)),
        },
    });
}
function createProduct(req, res) {
    const businessId = req.businessId;
    const { categoryId, name, sku, barcode, unit = 'pcs', hsnCode = '', purchasePricePaise = 0, salePricePaise = 0, mrpPaise = 0, taxRate = 18, stockQuantity = 0, lowStockThreshold = 5, extraAttributes = {}, } = req.body;
    if (!name || !sku) {
        res.status(400).json({ code: 'BAD_REQUEST', message: 'Product name and SKU are required' });
        return;
    }
    // Check unique SKU within tenant
    const existingSku = connection_js_1.db.prepare('SELECT id FROM products WHERE business_id = ? AND sku = ?').get(businessId, sku);
    if (existingSku) {
        res.status(409).json({ code: 'DUPLICATE_SKU', message: 'A product with this SKU already exists' });
        return;
    }
    const id = (0, uuid_1.v4)();
    connection_js_1.db.prepare(`
    INSERT INTO products (
      id, business_id, category_id, name, sku, barcode, unit, hsn_code,
      purchase_price_paise, sale_price_paise, mrp_paise, tax_rate,
      stock_quantity, low_stock_threshold, is_active, extra_attributes_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
  `).run(id, businessId, categoryId || null, name, sku, barcode || null, unit, hsnCode, Math.round(purchasePricePaise), Math.round(salePricePaise), Math.round(mrpPaise), Number(taxRate), Number(stockQuantity), Number(lowStockThreshold), JSON.stringify(extraAttributes));
    const created = connection_js_1.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    res.status(201).json({ message: 'Product created successfully', product: created });
}
function updateProduct(req, res) {
    const businessId = req.businessId;
    const { id } = req.params;
    const { categoryId, name, sku, barcode, unit, hsnCode, purchasePricePaise, salePricePaise, mrpPaise, taxRate, stockQuantity, lowStockThreshold, extraAttributes, } = req.body;
    const existing = connection_js_1.db.prepare('SELECT id FROM products WHERE id = ? AND business_id = ?').get(id, businessId);
    if (!existing) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Product not found' });
        return;
    }
    connection_js_1.db.prepare(`
    UPDATE products SET
      category_id = COALESCE(?, category_id),
      name = COALESCE(?, name),
      sku = COALESCE(?, sku),
      barcode = COALESCE(?, barcode),
      unit = COALESCE(?, unit),
      hsn_code = COALESCE(?, hsn_code),
      purchase_price_paise = COALESCE(?, purchase_price_paise),
      sale_price_paise = COALESCE(?, sale_price_paise),
      mrp_paise = COALESCE(?, mrp_paise),
      tax_rate = COALESCE(?, tax_rate),
      stock_quantity = COALESCE(?, stock_quantity),
      low_stock_threshold = COALESCE(?, low_stock_threshold),
      extra_attributes_json = COALESCE(?, extra_attributes_json),
      updated_at = datetime('now')
    WHERE id = ? AND business_id = ?
  `).run(categoryId !== undefined ? categoryId : null, name, sku, barcode, unit, hsnCode, purchasePricePaise !== undefined ? Math.round(purchasePricePaise) : null, salePricePaise !== undefined ? Math.round(salePricePaise) : null, mrpPaise !== undefined ? Math.round(mrpPaise) : null, taxRate !== undefined ? Number(taxRate) : null, stockQuantity !== undefined ? Number(stockQuantity) : null, lowStockThreshold !== undefined ? Number(lowStockThreshold) : null, extraAttributes !== undefined ? JSON.stringify(extraAttributes) : null, id, businessId);
    const updated = connection_js_1.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    res.json({ message: 'Product updated successfully', product: updated });
}
function deleteProduct(req, res) {
    const businessId = req.businessId;
    const { id } = req.params;
    // Soft delete by deactivating so historical invoices remain valid
    connection_js_1.db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND business_id = ?").run(id, businessId);
    res.json({ message: 'Product removed successfully' });
}
function getCategories(req, res) {
    const businessId = req.businessId;
    const categories = connection_js_1.db.prepare('SELECT * FROM categories WHERE business_id = ? ORDER BY name ASC').all(businessId);
    res.json({ data: categories });
}
function createCategory(req, res) {
    const businessId = req.businessId;
    const { name, description = '' } = req.body;
    if (!name) {
        res.status(400).json({ code: 'BAD_REQUEST', message: 'Category name is required' });
        return;
    }
    const id = (0, uuid_1.v4)();
    connection_js_1.db.prepare('INSERT INTO categories (id, business_id, name, description) VALUES (?, ?, ?, ?)').run(id, businessId, name, description);
    res.status(201).json({ message: 'Category created', category: { id, business_id: businessId, name, description } });
}
