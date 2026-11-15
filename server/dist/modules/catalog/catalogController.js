"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.importProducts = exports.DEFAULT_GST_RATES = exports.DEFAULT_UNITS = void 0;
exports.getProducts = getProducts;
exports.createProduct = createProduct;
exports.updateProduct = updateProduct;
exports.deleteProduct = deleteProduct;
exports.exportProducts = exportProducts;
exports.getInventoryValuation = getInventoryValuation;
exports.getCategories = getCategories;
exports.getProductOptions = getProductOptions;
exports.updateProductOptions = updateProductOptions;
exports.createCategory = createCategory;
exports.updateCategory = updateCategory;
exports.deleteCategory = deleteCategory;
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const connection_js_1 = require("../../db/connection.js");
const http_js_1 = require("../../lib/http.js");
const auditService_js_1 = require("../../services/auditService.js");
const exportService_js_1 = require("../../services/exportService.js");
const productImport_js_1 = require("../../services/productImport.js");
const categorySuggestions_js_1 = require("./categorySuggestions.js");
const money = zod_1.z.coerce.number().int('Amount must be in whole paise').nonnegative();
const productSchema = zod_1.z.object({
    categoryId: zod_1.z.string().max(64).optional().nullable(),
    name: zod_1.z.string().trim().min(1, 'Product name is required').max(200),
    sku: zod_1.z.string().trim().min(1, 'SKU is required').max(64),
    barcode: zod_1.z.string().trim().max(64).optional().nullable(),
    description: zod_1.z.string().trim().max(2000).optional().nullable(),
    unit: zod_1.z.string().trim().min(1).max(20).default('pcs'),
    hsnCode: zod_1.z.string().trim().max(16).regex(/^[0-9]*$/, 'HSN/SAC must be numeric').optional().nullable(),
    purchasePricePaise: money.default(0),
    salePricePaise: money.default(0),
    mrpPaise: money.default(0),
    taxRate: zod_1.z.coerce.number().min(0).max(100).default(18),
    stockQuantity: zod_1.z.coerce.number().min(-1_000_000).max(1_000_000).default(0),
    lowStockThreshold: zod_1.z.coerce.number().min(0).default(5),
    trackStock: zod_1.z.boolean().optional(),
    extraAttributes: zod_1.z.record(zod_1.z.any()).optional(),
});
function assertCategory(businessId, categoryId) {
    if (!categoryId)
        return;
    const cat = connection_js_1.db.prepare('SELECT id FROM categories WHERE id = ? AND business_id = ?').get(categoryId, businessId);
    if (!cat)
        throw new http_js_1.HttpError(400, 'CATEGORY_NOT_FOUND', 'Selected category does not exist');
}
function assertUniqueSku(businessId, sku, exceptId) {
    const dup = connection_js_1.db.prepare('SELECT id FROM products WHERE business_id = ? AND sku = ? AND is_active = 1 AND id != ?').get(businessId, sku, exceptId || '');
    if (dup)
        throw new http_js_1.HttpError(409, 'DUPLICATE_SKU', 'A product with this SKU already exists');
}
function assertUniqueBarcode(businessId, barcode, exceptId) {
    if (!barcode)
        return;
    const dup = connection_js_1.db.prepare('SELECT id FROM products WHERE business_id = ? AND barcode = ? AND is_active = 1 AND id != ?').get(businessId, barcode, exceptId || '');
    if (dup)
        throw new http_js_1.HttpError(409, 'DUPLICATE_BARCODE', 'Another product already uses this barcode');
}
function withExtras(prod) {
    return { ...prod, extra_attributes: prod.extra_attributes_json ? JSON.parse(prod.extra_attributes_json) : {} };
}
function getProducts(req, res) {
    const { search, categoryId, barcode, code, lowStockOnly } = req.query;
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
    const page = Math.max(1, Number(req.query.page) || 1);
    const conditions = ['p.business_id = ?', 'p.is_active = 1'];
    const params = [req.businessId];
    if (barcode) {
        conditions.push('p.barcode = ?');
        params.push(barcode);
    }
    // A scanned code: the product's barcode, or its SKU (stickers print the SKU when there is no barcode)
    if (code) {
        conditions.push('(p.barcode = ? OR p.sku = ? COLLATE NOCASE)');
        params.push(code, code);
    }
    if (categoryId) {
        conditions.push('p.category_id = ?');
        params.push(categoryId);
    }
    if (search) {
        conditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.hsn_code LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (lowStockOnly === 'true')
        conditions.push('p.track_stock = 1 AND p.stock_quantity <= p.low_stock_threshold');
    const where = conditions.join(' AND ');
    const total = connection_js_1.db.prepare(`SELECT COUNT(*) AS c FROM products p WHERE ${where}`).get(...params).c;
    const products = connection_js_1.db.prepare(`
    SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id
    WHERE ${where} ORDER BY p.name COLLATE NOCASE ASC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit);
    res.json({ data: products.map(withExtras), pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } });
}
function createProduct(req, res) {
    const p = (0, http_js_1.parse)(productSchema, req.body);
    const biz = req.businessId;
    assertCategory(biz, p.categoryId);
    assertUniqueSku(biz, p.sku);
    assertUniqueBarcode(biz, p.barcode);
    const id = crypto_1.default.randomUUID();
    const extras = { ...(p.extraAttributes || {}), ...(p.description ? { description: p.description } : {}) };
    connection_js_1.db.transaction(() => {
        connection_js_1.db.prepare(`
      INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, hsn_code, purchase_price_paise, sale_price_paise, mrp_paise,
                            tax_rate, stock_quantity, low_stock_threshold, track_stock, is_active, extra_attributes_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
    `).run(id, biz, p.categoryId || null, p.name, p.sku, p.barcode || null, p.unit, p.hsnCode || '', p.purchasePricePaise, p.salePricePaise, p.mrpPaise, p.taxRate, p.stockQuantity, p.lowStockThreshold, p.trackStock === false ? 0 : 1, JSON.stringify(extras));
        if (p.stockQuantity !== 0) {
            connection_js_1.db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes)
                  VALUES (?, ?, ?, ?, ?, 'OPENING_STOCK', NULL, 'Opening stock')`).run(crypto_1.default.randomUUID(), biz, id, p.stockQuantity, p.stockQuantity);
        }
    })();
    (0, auditService_js_1.logAudit)({ businessId: biz, userId: req.user?.userId, action: 'PRODUCT_CREATED', entityType: 'PRODUCT', entityId: id, details: { name: p.name, sku: p.sku } });
    res.status(201).json({ message: 'Product created successfully', product: withExtras(connection_js_1.db.prepare('SELECT * FROM products WHERE id = ?').get(id)) });
}
function updateProduct(req, res) {
    const biz = req.businessId;
    const existing = connection_js_1.db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(req.params.id, biz);
    if (!existing)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Product not found');
    const p = (0, http_js_1.parse)(productSchema.partial(), req.body);
    if (p.categoryId !== undefined)
        assertCategory(biz, p.categoryId);
    if (p.sku !== undefined)
        assertUniqueSku(biz, p.sku, existing.id);
    if (p.barcode !== undefined)
        assertUniqueBarcode(biz, p.barcode, existing.id);
    const pick = (v, cur) => (v === undefined ? cur : v);
    const curExtras = existing.extra_attributes_json ? JSON.parse(existing.extra_attributes_json) : {};
    const extras = { ...(p.extraAttributes !== undefined ? p.extraAttributes : curExtras), ...(p.description !== undefined ? { description: p.description } : {}) };
    connection_js_1.db.transaction(() => {
        connection_js_1.db.prepare(`
      UPDATE products SET category_id = ?, name = ?, sku = ?, barcode = ?, unit = ?, hsn_code = ?, purchase_price_paise = ?, sale_price_paise = ?,
        mrp_paise = ?, tax_rate = ?, low_stock_threshold = ?, track_stock = ?, extra_attributes_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(pick(p.categoryId, existing.category_id), pick(p.name, existing.name), pick(p.sku, existing.sku), pick(p.barcode, existing.barcode), pick(p.unit, existing.unit), pick(p.hsnCode, existing.hsn_code), pick(p.purchasePricePaise, existing.purchase_price_paise), pick(p.salePricePaise, existing.sale_price_paise), pick(p.mrpPaise, existing.mrp_paise), pick(p.taxRate, existing.tax_rate), pick(p.lowStockThreshold, existing.low_stock_threshold), p.trackStock === undefined ? existing.track_stock : (p.trackStock ? 1 : 0), JSON.stringify(extras), existing.id);
        // Stock edits from the product form go through the movement ledger, never a silent overwrite.
        if (p.stockQuantity !== undefined && p.stockQuantity !== existing.stock_quantity) {
            const delta = p.stockQuantity - existing.stock_quantity;
            connection_js_1.db.prepare('UPDATE products SET stock_quantity = ? WHERE id = ?').run(p.stockQuantity, existing.id);
            connection_js_1.db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes)
                  VALUES (?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', 'PRODUCT_EDIT', 'Stock corrected from product form')`)
                .run(crypto_1.default.randomUUID(), biz, existing.id, delta, p.stockQuantity);
        }
    })();
    const priceChanged = ['salePricePaise', 'purchasePricePaise', 'mrpPaise', 'taxRate'].some((k) => p[k] !== undefined);
    (0, auditService_js_1.logAudit)({ businessId: biz, userId: req.user?.userId, action: priceChanged ? 'PRODUCT_PRICE_UPDATED' : 'PRODUCT_UPDATED', entityType: 'PRODUCT',
        entityId: existing.id, details: { name: existing.name, fields: Object.keys(p),
            before: priceChanged ? { sale: existing.sale_price_paise, purchase: existing.purchase_price_paise, mrp: existing.mrp_paise, tax: existing.tax_rate } : undefined } });
    res.json({ message: 'Product updated successfully', product: withExtras(connection_js_1.db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id)) });
}
/** Soft delete so historical invoices keep their product references. */
function deleteProduct(req, res) {
    const prod = connection_js_1.db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ? AND is_active = 1').get(req.params.id, req.businessId);
    if (!prod)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Product not found');
    const inBom = connection_js_1.db.prepare('SELECT COUNT(*) AS c FROM bom_items bi JOIN bom_recipes b ON b.id = bi.bom_id WHERE bi.raw_material_id = ? AND b.is_active = 1').get(prod.id);
    if (inBom.c > 0)
        throw new http_js_1.HttpError(409, 'IN_USE', 'Product is used in an active Bill of Materials. Remove it from the BOM first.');
    connection_js_1.db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(prod.id);
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'PRODUCT_DELETED', entityType: 'PRODUCT', entityId: prod.id,
        details: { name: prod.name, sku: prod.sku, stockAtDeletion: prod.stock_quantity } });
    res.json({ message: 'Product removed successfully' });
}
function exportProducts(req, res) {
    const rows = connection_js_1.db.prepare(`SELECT p.*, c.name AS category_name, p.stock_quantity * p.purchase_price_paise AS stock_value_paise
                           FROM products p LEFT JOIN categories c ON c.id = p.category_id
                           WHERE p.business_id = ? AND p.is_active = 1 ORDER BY p.name COLLATE NOCASE`).all(req.businessId);
    (0, exportService_js_1.sendTable)(res, req.query.format || 'csv', 'products', [
        { key: 'name', label: 'Name' }, { key: 'sku', label: 'SKU' }, { key: 'barcode', label: 'Barcode' }, { key: 'category_name', label: 'Category' },
        { key: 'unit', label: 'Unit' }, { key: 'hsn_code', label: 'HSN/SAC' }, { key: 'tax_rate', label: 'GST %' },
        { key: 'purchase_price_paise', label: 'Purchase Price (₹)', money: true }, { key: 'sale_price_paise', label: 'Selling Price (₹)', money: true },
        { key: 'mrp_paise', label: 'MRP (₹)', money: true }, { key: 'stock_quantity', label: 'Stock' }, { key: 'low_stock_threshold', label: 'Low Stock Level' },
        { key: 'stock_value_paise', label: 'Stock Value at Cost (₹)', money: true },
    ], rows);
}
function getInventoryValuation(req, res) {
    const totals = connection_js_1.db.prepare(`
    SELECT COUNT(*) AS product_count,
           COALESCE(SUM(CASE WHEN stock_quantity > 0 THEN stock_quantity * purchase_price_paise ELSE 0 END), 0) AS value_at_cost_paise,
           COALESCE(SUM(CASE WHEN stock_quantity > 0 THEN stock_quantity * sale_price_paise ELSE 0 END), 0) AS value_at_sale_paise,
           COALESCE(SUM(CASE WHEN stock_quantity > 0 THEN stock_quantity * mrp_paise ELSE 0 END), 0) AS value_at_mrp_paise,
           SUM(CASE WHEN stock_quantity <= low_stock_threshold THEN 1 ELSE 0 END) AS low_stock_count,
           SUM(CASE WHEN stock_quantity < 0 THEN 1 ELSE 0 END) AS negative_stock_count
    FROM products WHERE business_id = ? AND is_active = 1 AND track_stock = 1`).get(req.businessId);
    const byCategory = connection_js_1.db.prepare(`
    SELECT COALESCE(c.name, 'Uncategorised') AS category, COUNT(p.id) AS product_count, COALESCE(SUM(p.stock_quantity), 0) AS quantity,
           COALESCE(SUM(CASE WHEN p.stock_quantity > 0 THEN p.stock_quantity * p.purchase_price_paise ELSE 0 END), 0) AS value_at_cost_paise
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.business_id = ? AND p.is_active = 1 AND p.track_stock = 1
    GROUP BY c.name ORDER BY value_at_cost_paise DESC`).all(req.businessId);
    const totalsRounded = { ...totals,
        value_at_cost_paise: Math.round(totals.value_at_cost_paise), value_at_sale_paise: Math.round(totals.value_at_sale_paise),
        value_at_mrp_paise: Math.round(totals.value_at_mrp_paise) };
    res.json({ totals: totalsRounded, byCategory: byCategory.map((r) => ({ ...r, value_at_cost_paise: Math.round(r.value_at_cost_paise) })) });
}
// ---------------- Categories ----------------
const categorySchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1, 'Category name is required').max(100),
    description: zod_1.z.string().trim().max(500).optional().nullable(),
});
function getCategories(req, res) {
    const categories = connection_js_1.db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) AS product_count
    FROM categories c WHERE c.business_id = ? ORDER BY c.name COLLATE NOCASE ASC`).all(req.businessId);
    // Categories that fit this kind of business and the shop does not have yet (offered in the product form)
    const business = connection_js_1.db.prepare('SELECT category FROM businesses WHERE id = ?').get(req.businessId);
    const have = new Set(categories.map((c) => String(c.name).toLowerCase()));
    res.json({ data: categories, suggestions: (0, categorySuggestions_js_1.suggestionsFor)(business?.category).filter((n) => !have.has(n.toLowerCase())) });
}
// ---- Units and GST rates offered in the product form: each shop's own lists (Products → Manage lists)
exports.DEFAULT_UNITS = [
    { value: 'pcs', label: 'Pieces (pcs)' }, { value: 'kg', label: 'Kilograms (kg)' }, { value: 'gm', label: 'Grams (gm)' },
    { value: 'ltr', label: 'Litres (ltr)' }, { value: 'ml', label: 'Millilitres (ml)' }, { value: 'mtr', label: 'Metres (mtr)' },
    { value: 'pkt', label: 'Packet (pkt)' }, { value: 'box', label: 'Box' }, { value: 'dozen', label: 'Dozen' }, { value: 'pair', label: 'Pair' },
    { value: 'set', label: 'Set' }, { value: 'strip', label: 'Strip' }, { value: 'bottle', label: 'Bottle' }, { value: 'bag', label: 'Bag' },
    { value: 'portion', label: 'Portion' }, { value: 'plate', label: 'Plate' }, { value: 'hour', label: 'Hour' }, { value: 'job', label: 'Job / Service' },
];
exports.DEFAULT_GST_RATES = ['0', '0.25', '3', '5', '12', '18', '28'];
function readList(businessId, key, fallback) {
    const row = connection_js_1.db.prepare('SELECT value FROM app_settings WHERE business_id = ? AND key = ?').get(businessId, key);
    if (!row)
        return fallback;
    try {
        return JSON.parse(row.value);
    }
    catch {
        return fallback;
    }
}
function writeList(businessId, key, value) {
    connection_js_1.db.prepare(`INSERT INTO app_settings (business_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
              ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(businessId, key, JSON.stringify(value));
}
function productOptions(businessId) {
    const units = readList(businessId, 'productUnits', exports.DEFAULT_UNITS);
    const rates = readList(businessId, 'gstRates', exports.DEFAULT_GST_RATES);
    const unitUse = new Map(connection_js_1.db.prepare('SELECT unit, COUNT(*) AS c FROM products WHERE business_id = ? AND is_active = 1 GROUP BY unit').all(businessId)
        .map((r) => [String(r.unit), Number(r.c)]));
    const rateUse = new Map(connection_js_1.db.prepare('SELECT tax_rate, COUNT(*) AS c FROM products WHERE business_id = ? AND is_active = 1 GROUP BY tax_rate').all(businessId)
        .map((r) => [String(Number(r.tax_rate)), Number(r.c)]));
    return {
        units: units.map((u) => ({ ...u, products: unitUse.get(u.value) || 0 })),
        gstRates: rates.map((r) => ({ rate: r, products: rateUse.get(r) || 0 })),
    };
}
const optionsSchema = zod_1.z.object({
    units: zod_1.z.array(zod_1.z.object({ value: zod_1.z.string().trim().min(1, 'A unit needs a short name').max(20), label: zod_1.z.string().trim().min(1).max(40) })).max(100).optional(),
    gstRates: zod_1.z.array(zod_1.z.coerce.number().min(0, 'GST is 0% or more').max(100, 'GST is at most 100%')).max(30).optional(),
    /** A unit renamed in the list: the products that use it change with it */
    renameUnit: zod_1.z.object({ from: zod_1.z.string().trim().min(1).max(20), to: zod_1.z.string().trim().min(1).max(20) }).optional(),
});
function getProductOptions(req, res) {
    res.json(productOptions(req.businessId));
}
function updateProductOptions(req, res) {
    const input = (0, http_js_1.parse)(optionsSchema, req.body);
    const biz = req.businessId;
    connection_js_1.db.transaction(() => {
        if (input.units) {
            const seen = new Set();
            const units = input.units.filter((u) => !seen.has(u.value.toLowerCase()) && seen.add(u.value.toLowerCase()));
            writeList(biz, 'productUnits', units);
        }
        if (input.gstRates) {
            const rates = [...new Set(input.gstRates.map((r) => String(Number(r))))].sort((a, b) => Number(a) - Number(b));
            writeList(biz, 'gstRates', rates);
        }
        if (input.renameUnit && input.renameUnit.from !== input.renameUnit.to) {
            connection_js_1.db.prepare("UPDATE products SET unit = ?, updated_at = datetime('now') WHERE business_id = ? AND unit = ?").run(input.renameUnit.to, biz, input.renameUnit.from);
        }
    })();
    res.json(productOptions(biz));
}
// ---- Products → Import Excel
const importSchema = zod_1.z.object({ fileName: zod_1.z.string().trim().max(200), data: zod_1.z.string().min(1).max(7_000_000) });
/**
 * Adds or updates products from an Excel / CSV file (the Export's columns, or common names for them). A row whose SKU
 * exists updates that product; others become new products (a missing SKU is made up). Categories are found by name or
 * created. Stock changes go through the stock ledger. Rows with problems are skipped and listed; the rest are saved.
 */
exports.importProducts = (0, http_js_1.asyncHandler)(async (req, res) => {
    const input = (0, http_js_1.parse)(importSchema, req.body);
    const biz = req.businessId;
    let table;
    try {
        table = await (0, productImport_js_1.readSheet)(Buffer.from(input.data, 'base64'));
    }
    catch {
        throw new http_js_1.HttpError(400, 'IMPORT_UNREADABLE', 'This file could not be read. Use an Excel file (.xlsx) or a CSV file.');
    }
    const { rows, missing } = (0, productImport_js_1.mapRows)(table);
    if (missing.length) {
        throw new http_js_1.HttpError(400, 'IMPORT_COLUMNS', `The file needs a header row with at least these columns: Name, ${missing.join(', ')}. Tip: use Export Excel as the template.`);
    }
    if (rows.length === 0)
        throw new http_js_1.HttpError(400, 'IMPORT_EMPTY', 'The file has no products under its header row.');
    if (rows.length > 10000)
        throw new http_js_1.HttpError(400, 'IMPORT_TOO_LARGE', 'Import at most 10,000 products at a time.');
    const categories = new Map();
    for (const c of connection_js_1.db.prepare('SELECT id, name FROM categories WHERE business_id = ?').all(biz))
        categories.set(String(c.name).toLowerCase(), c.id);
    const categoryId = (name) => {
        if (!name)
            return null;
        const key = name.toLowerCase();
        if (!categories.has(key)) {
            const id = crypto_1.default.randomUUID();
            connection_js_1.db.prepare("INSERT INTO categories (id, business_id, name, description, updated_at) VALUES (?, ?, ?, '', datetime('now'))").run(id, biz, name.slice(0, 100));
            categories.set(key, id);
        }
        return categories.get(key);
    };
    const number = (s, label) => {
        if (s === undefined || s === '')
            return undefined;
        const n = Number(s.replace(/[₹,%\s]/g, ''));
        if (!Number.isFinite(n))
            throw new Error(`${label} "${s}" is not a number`);
        return n;
    };
    const paise = (rupees) => (rupees === undefined ? undefined : Math.round(rupees * 100));
    let created = 0;
    let updated = 0;
    const errors = [];
    connection_js_1.db.transaction(() => {
        for (const { row, values: v } of rows) {
            try {
                if (!v.name)
                    throw new Error('Name is empty');
                const fields = {
                    name: v.name,
                    sku: v.sku || undefined,
                    barcode: v.barcode || undefined,
                    categoryId: v.category ? categoryId(v.category) : undefined,
                    unit: v.unit || undefined,
                    hsnCode: v.hsn ? v.hsn.replace(/\.0+$/, '') : undefined,
                    taxRate: number(v.gst, 'GST %'),
                    purchasePricePaise: paise(number(v.purchase, 'Purchase price')),
                    salePricePaise: paise(number(v.sale, 'Selling price')),
                    mrpPaise: paise(number(v.mrp, 'MRP')),
                    stockQuantity: number(v.stock, 'Stock'),
                    lowStockThreshold: number(v.low, 'Low stock level'),
                };
                const existing = fields.sku
                    ? connection_js_1.db.prepare('SELECT * FROM products WHERE business_id = ? AND sku = ? AND is_active = 1').get(biz, fields.sku)
                    : undefined;
                if (existing) {
                    const p = (0, http_js_1.parse)(productSchema.partial(), Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== undefined)));
                    assertUniqueBarcode(biz, p.barcode, existing.id);
                    const pick = (x, cur) => (x === undefined ? cur : x);
                    connection_js_1.db.prepare(`UPDATE products SET category_id = ?, name = ?, barcode = ?, unit = ?, hsn_code = ?, purchase_price_paise = ?, sale_price_paise = ?,
                        mrp_paise = ?, tax_rate = ?, low_stock_threshold = ?, updated_at = datetime('now') WHERE id = ?`)
                        .run(pick(p.categoryId, existing.category_id), pick(p.name, existing.name), pick(p.barcode, existing.barcode), pick(p.unit, existing.unit), pick(p.hsnCode, existing.hsn_code), pick(p.purchasePricePaise, existing.purchase_price_paise), pick(p.salePricePaise, existing.sale_price_paise), pick(p.mrpPaise, existing.mrp_paise), pick(p.taxRate, existing.tax_rate), pick(p.lowStockThreshold, existing.low_stock_threshold), existing.id);
                    if (p.stockQuantity !== undefined && p.stockQuantity !== existing.stock_quantity) {
                        connection_js_1.db.prepare('UPDATE products SET stock_quantity = ? WHERE id = ?').run(p.stockQuantity, existing.id);
                        connection_js_1.db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes)
                        VALUES (?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', 'IMPORT', 'Stock set by Excel import')`)
                            .run(crypto_1.default.randomUUID(), biz, existing.id, p.stockQuantity - existing.stock_quantity, p.stockQuantity);
                    }
                    updated++;
                }
                else {
                    if (!v.sale)
                        throw new Error('Selling price is empty');
                    const sku = fields.sku || `SKU-${crypto_1.default.randomBytes(3).toString('hex').toUpperCase()}`;
                    const p = (0, http_js_1.parse)(productSchema, { ...Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== undefined)), sku });
                    assertUniqueBarcode(biz, p.barcode);
                    const id = crypto_1.default.randomUUID();
                    connection_js_1.db.prepare(`INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, hsn_code, purchase_price_paise, sale_price_paise, mrp_paise,
                        tax_rate, stock_quantity, low_stock_threshold, track_stock, is_active, extra_attributes_json, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, '{}', datetime('now'), datetime('now'))`)
                        .run(id, biz, p.categoryId || null, p.name, p.sku, p.barcode || null, p.unit, p.hsnCode || '', p.purchasePricePaise, p.salePricePaise, p.mrpPaise, p.taxRate, p.stockQuantity, p.lowStockThreshold);
                    if (p.stockQuantity !== 0) {
                        connection_js_1.db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes)
                        VALUES (?, ?, ?, ?, ?, 'OPENING_STOCK', 'IMPORT', 'Opening stock (Excel import)')`).run(crypto_1.default.randomUUID(), biz, id, p.stockQuantity, p.stockQuantity);
                    }
                    created++;
                }
            }
            catch (err) {
                errors.push({ row, message: err?.message || 'Could not be saved' });
            }
        }
    })();
    (0, auditService_js_1.logAudit)({ businessId: biz, userId: req.user?.userId, action: 'PRODUCTS_IMPORTED', entityType: 'PRODUCT',
        details: { file: input.fileName, created, updated, skipped: errors.length } });
    res.json({ created, updated, skipped: errors.length, errors: errors.slice(0, 50) });
});
function createCategory(req, res) {
    const c = (0, http_js_1.parse)(categorySchema, req.body);
    const dup = connection_js_1.db.prepare('SELECT id FROM categories WHERE business_id = ? AND LOWER(name) = LOWER(?)').get(req.businessId, c.name);
    if (dup)
        throw new http_js_1.HttpError(409, 'DUPLICATE_CATEGORY', 'A category with this name already exists');
    const id = crypto_1.default.randomUUID();
    connection_js_1.db.prepare("INSERT INTO categories (id, business_id, name, description, updated_at) VALUES (?, ?, ?, ?, datetime('now'))")
        .run(id, req.businessId, c.name, c.description || '');
    res.status(201).json({ message: 'Category created', category: connection_js_1.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) });
}
function updateCategory(req, res) {
    const existing = connection_js_1.db.prepare('SELECT * FROM categories WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!existing)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Category not found');
    const c = (0, http_js_1.parse)(categorySchema.partial(), req.body);
    if (c.name) {
        const dup = connection_js_1.db.prepare('SELECT id FROM categories WHERE business_id = ? AND LOWER(name) = LOWER(?) AND id != ?').get(req.businessId, c.name, existing.id);
        if (dup)
            throw new http_js_1.HttpError(409, 'DUPLICATE_CATEGORY', 'A category with this name already exists');
    }
    connection_js_1.db.prepare("UPDATE categories SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?")
        .run(c.name ?? existing.name, c.description !== undefined ? c.description : existing.description, existing.id);
    res.json({ message: 'Category updated', category: connection_js_1.db.prepare('SELECT * FROM categories WHERE id = ?').get(existing.id) });
}
/** Products in a deleted category become uncategorised (FK ON DELETE SET NULL). */
function deleteCategory(req, res) {
    const existing = connection_js_1.db.prepare('SELECT * FROM categories WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!existing)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Category not found');
    const used = connection_js_1.db.prepare('SELECT COUNT(*) AS c FROM products WHERE category_id = ? AND is_active = 1').get(existing.id).c;
    connection_js_1.db.prepare('DELETE FROM categories WHERE id = ?').run(existing.id);
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'CATEGORY_DELETED', entityType: 'CATEGORY', entityId: existing.id,
        details: { name: existing.name, productsUncategorised: used } });
    res.json({ message: used > 0 ? `Category deleted; ${used} products are now uncategorised` : 'Category deleted' });
}
