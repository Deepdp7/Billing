import { Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../db/connection.js';
import { cappedCount, pageOf } from '../../lib/paging.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { parse, HttpError, asyncHandler } from '../../lib/http.js';
import { logAudit } from '../../services/auditService.js';
import { sendTable } from '../../services/exportService.js';
import { mapRows, readSheet } from '../../services/productImport.js';
import { suggestionsFor } from './categorySuggestions.js';

const money = z.coerce.number().int('Amount must be in whole paise').nonnegative();

const productSchema = z.object({
  categoryId: z.string().max(64).optional().nullable(),
  name: z.string().trim().min(1, 'Product name is required').max(200),
  sku: z.string().trim().min(1, 'SKU is required').max(64),
  barcode: z.string().trim().max(64).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  unit: z.string().trim().min(1).max(20).default('pcs'),
  hsnCode: z.string().trim().max(16).regex(/^[0-9]*$/, 'HSN/SAC must be numeric').optional().nullable(),
  purchasePricePaise: money.default(0),
  salePricePaise: money.default(0),
  mrpPaise: money.default(0),
  taxRate: z.coerce.number().min(0).max(100).default(18),
  stockQuantity: z.coerce.number().min(-1_000_000).max(1_000_000).default(0),
  lowStockThreshold: z.coerce.number().min(0).default(5),
  trackStock: z.boolean().optional(),
  extraAttributes: z.record(z.any()).optional(),
});

function assertCategory(businessId: string, categoryId?: string | null) {
  if (!categoryId) return;
  const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND business_id = ?').get(categoryId, businessId);
  if (!cat) throw new HttpError(400, 'CATEGORY_NOT_FOUND', 'Selected category does not exist');
}

function assertUniqueSku(businessId: string, sku: string, exceptId?: string) {
  const dup = db.prepare('SELECT id FROM products WHERE business_id = ? AND sku = ? AND is_active = 1 AND id != ?').get(businessId, sku, exceptId || '');
  if (dup) throw new HttpError(409, 'DUPLICATE_SKU', 'A product with this SKU already exists');
}

function assertUniqueBarcode(businessId: string, barcode?: string | null, exceptId?: string) {
  if (!barcode) return;
  const dup = db.prepare('SELECT id FROM products WHERE business_id = ? AND barcode = ? AND is_active = 1 AND id != ?').get(businessId, barcode, exceptId || '');
  if (dup) throw new HttpError(409, 'DUPLICATE_BARCODE', 'Another product already uses this barcode');
}

function withExtras(prod: any) {
  return { ...prod, extra_attributes: prod.extra_attributes_json ? JSON.parse(prod.extra_attributes_json) : {} };
}

export function getProducts(req: AuthenticatedRequest, res: Response): void {
  const { search, categoryId, barcode, code, lowStockOnly } = req.query as Record<string, string>;
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
  const page = Math.max(1, Number(req.query.page) || 1);
  const conditions = ['p.business_id = ?', 'p.is_active = 1'];
  const params: any[] = [req.businessId];
  if (barcode) { conditions.push('p.barcode = ?'); params.push(barcode); }
  // A scanned code: the product's barcode, or its SKU (stickers print the SKU when there is no barcode)
  if (code) {
    // The barcode first, then the SKU: each through its own index (asked together, SQLite read every product)
    const byBarcode = db.prepare('SELECT 1 FROM products WHERE business_id = ? AND is_active = 1 AND barcode = ? LIMIT 1').get(req.businessId, code);
    if (byBarcode) { conditions.push('p.barcode = ?'); params.push(code); }
    else { conditions.push('p.sku = ? COLLATE NOCASE'); params.push(code); }
  }
  if (categoryId) { conditions.push('p.category_id = ?'); params.push(categoryId); }
  if (search) {
    conditions.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.hsn_code LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (lowStockOnly === 'true') conditions.push('p.track_stock = 1 AND p.stock_quantity <= p.low_stock_threshold');
  const where = conditions.join(' AND ');
  // A search or a scanned code is not counted (see lib/paging.ts); a plain list up to COUNT_CAP
  const counted = search || code || barcode ? undefined : cappedCount(db, `FROM products p WHERE ${where}`, params);
  // A scanned or typed code finds one or two products through the barcode / code indexes; walking the A-Z index for it
  // (what SQLite does when asked for name order) reads every product. "+" keeps the name index out of it.
  const order = code || barcode ? '+p.name COLLATE NOCASE' : 'p.name COLLATE NOCASE';
  const products = db.prepare(`
    SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id
    WHERE ${where} ORDER BY ${order} ASC LIMIT ? OFFSET ?`).all(...params, limit + 1, (page - 1) * limit);
  const out = pageOf(products, page, limit, counted);
  res.json({ data: out.data.map(withExtras), pagination: out.pagination });
}

export function createProduct(req: AuthenticatedRequest, res: Response): void {
  const p = parse(productSchema, req.body);
  const biz = req.businessId!;
  assertCategory(biz, p.categoryId);
  assertUniqueSku(biz, p.sku);
  assertUniqueBarcode(biz, p.barcode);

  const id = crypto.randomUUID();
  const extras = { ...(p.extraAttributes || {}), ...(p.description ? { description: p.description } : {}) };
  db.transaction(() => {
    db.prepare(`
      INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, hsn_code, purchase_price_paise, sale_price_paise, mrp_paise,
                            tax_rate, stock_quantity, low_stock_threshold, track_stock, is_active, extra_attributes_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
    `).run(id, biz, p.categoryId || null, p.name, p.sku, p.barcode || null, p.unit, p.hsnCode || '', p.purchasePricePaise, p.salePricePaise,
      p.mrpPaise, p.taxRate, p.stockQuantity, p.lowStockThreshold, p.trackStock === false ? 0 : 1, JSON.stringify(extras));
    if (p.stockQuantity !== 0) {
      db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes)
                  VALUES (?, ?, ?, ?, ?, 'OPENING_STOCK', NULL, 'Opening stock')`).run(crypto.randomUUID(), biz, id, p.stockQuantity, p.stockQuantity);
    }
  })();
  logAudit({ businessId: biz, userId: req.user?.userId, action: 'PRODUCT_CREATED', entityType: 'PRODUCT', entityId: id, details: { name: p.name, sku: p.sku } });
  res.status(201).json({ message: 'Product created successfully', product: withExtras(db.prepare('SELECT * FROM products WHERE id = ?').get(id)) });
}

export function updateProduct(req: AuthenticatedRequest, res: Response): void {
  const biz = req.businessId!;
  const existing = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(req.params.id, biz) as any;
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Product not found');
  const p = parse(productSchema.partial(), req.body);
  if (p.categoryId !== undefined) assertCategory(biz, p.categoryId);
  if (p.sku !== undefined) assertUniqueSku(biz, p.sku, existing.id);
  if (p.barcode !== undefined) assertUniqueBarcode(biz, p.barcode, existing.id);

  const pick = <T>(v: T | undefined, cur: T) => (v === undefined ? cur : v);
  const curExtras = existing.extra_attributes_json ? JSON.parse(existing.extra_attributes_json) : {};
  const extras = { ...(p.extraAttributes !== undefined ? p.extraAttributes : curExtras), ...(p.description !== undefined ? { description: p.description } : {}) };

  db.transaction(() => {
    db.prepare(`
      UPDATE products SET category_id = ?, name = ?, sku = ?, barcode = ?, unit = ?, hsn_code = ?, purchase_price_paise = ?, sale_price_paise = ?,
        mrp_paise = ?, tax_rate = ?, low_stock_threshold = ?, track_stock = ?, extra_attributes_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(pick(p.categoryId, existing.category_id), pick(p.name, existing.name), pick(p.sku, existing.sku), pick(p.barcode, existing.barcode),
      pick(p.unit, existing.unit), pick(p.hsnCode, existing.hsn_code), pick(p.purchasePricePaise, existing.purchase_price_paise),
      pick(p.salePricePaise, existing.sale_price_paise), pick(p.mrpPaise, existing.mrp_paise), pick(p.taxRate, existing.tax_rate),
      pick(p.lowStockThreshold, existing.low_stock_threshold), p.trackStock === undefined ? existing.track_stock : (p.trackStock ? 1 : 0),
      JSON.stringify(extras), existing.id);

    // Stock edits from the product form go through the movement ledger, never a silent overwrite.
    if (p.stockQuantity !== undefined && p.stockQuantity !== existing.stock_quantity) {
      const delta = p.stockQuantity - existing.stock_quantity;
      db.prepare('UPDATE products SET stock_quantity = ? WHERE id = ?').run(p.stockQuantity, existing.id);
      db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes)
                  VALUES (?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', 'PRODUCT_EDIT', 'Stock corrected from product form')`)
        .run(crypto.randomUUID(), biz, existing.id, delta, p.stockQuantity);
    }
  })();

  const priceChanged = ['salePricePaise', 'purchasePricePaise', 'mrpPaise', 'taxRate'].some((k) => (p as any)[k] !== undefined);
  logAudit({ businessId: biz, userId: req.user?.userId, action: priceChanged ? 'PRODUCT_PRICE_UPDATED' : 'PRODUCT_UPDATED', entityType: 'PRODUCT',
    entityId: existing.id, details: { name: existing.name, fields: Object.keys(p),
      before: priceChanged ? { sale: existing.sale_price_paise, purchase: existing.purchase_price_paise, mrp: existing.mrp_paise, tax: existing.tax_rate } : undefined } });
  res.json({ message: 'Product updated successfully', product: withExtras(db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id)) });
}

/** Soft delete so historical invoices keep their product references. */
export function deleteProduct(req: AuthenticatedRequest, res: Response): void {
  const prod = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ? AND is_active = 1').get(req.params.id, req.businessId) as any;
  if (!prod) throw new HttpError(404, 'NOT_FOUND', 'Product not found');
  const inBom = db.prepare('SELECT COUNT(*) AS c FROM bom_items bi JOIN bom_recipes b ON b.id = bi.bom_id WHERE bi.raw_material_id = ? AND b.is_active = 1').get(prod.id) as any;
  if (inBom.c > 0) throw new HttpError(409, 'IN_USE', 'Product is used in an active Bill of Materials. Remove it from the BOM first.');
  db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(prod.id);
  logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'PRODUCT_DELETED', entityType: 'PRODUCT', entityId: prod.id,
    details: { name: prod.name, sku: prod.sku, stockAtDeletion: prod.stock_quantity } });
  res.json({ message: 'Product removed successfully' });
}

export function exportProducts(req: AuthenticatedRequest, res: Response): void {
  const rows = db.prepare(`SELECT p.*, c.name AS category_name, p.stock_quantity * p.purchase_price_paise AS stock_value_paise
                           FROM products p LEFT JOIN categories c ON c.id = p.category_id
                           WHERE p.business_id = ? AND p.is_active = 1 ORDER BY p.name COLLATE NOCASE`).all(req.businessId) as any[];
  sendTable(res, (req.query.format as string) || 'csv', 'products', [
    { key: 'name', label: 'Name' }, { key: 'sku', label: 'SKU' }, { key: 'barcode', label: 'Barcode' }, { key: 'category_name', label: 'Category' },
    { key: 'unit', label: 'Unit' }, { key: 'hsn_code', label: 'HSN/SAC' }, { key: 'tax_rate', label: 'GST %' },
    { key: 'purchase_price_paise', label: 'Purchase Price (₹)', money: true }, { key: 'sale_price_paise', label: 'Selling Price (₹)', money: true },
    { key: 'mrp_paise', label: 'MRP (₹)', money: true }, { key: 'stock_quantity', label: 'Stock' }, { key: 'low_stock_threshold', label: 'Low Stock Level' },
    { key: 'stock_value_paise', label: 'Stock Value at Cost (₹)', money: true },
  ], rows);
}

export function getInventoryValuation(req: AuthenticatedRequest, res: Response): void {
  const totals = db.prepare(`
    SELECT COUNT(*) AS product_count,
           COALESCE(SUM(CASE WHEN stock_quantity > 0 THEN stock_quantity * purchase_price_paise ELSE 0 END), 0) AS value_at_cost_paise,
           COALESCE(SUM(CASE WHEN stock_quantity > 0 THEN stock_quantity * sale_price_paise ELSE 0 END), 0) AS value_at_sale_paise,
           COALESCE(SUM(CASE WHEN stock_quantity > 0 THEN stock_quantity * mrp_paise ELSE 0 END), 0) AS value_at_mrp_paise,
           SUM(CASE WHEN stock_quantity <= low_stock_threshold THEN 1 ELSE 0 END) AS low_stock_count,
           SUM(CASE WHEN stock_quantity < 0 THEN 1 ELSE 0 END) AS negative_stock_count
    FROM products WHERE business_id = ? AND is_active = 1 AND track_stock = 1`).get(req.businessId) as any;
  const byCategory = db.prepare(`
    SELECT COALESCE(c.name, 'Uncategorised') AS category, COUNT(p.id) AS product_count, COALESCE(SUM(p.stock_quantity), 0) AS quantity,
           COALESCE(SUM(CASE WHEN p.stock_quantity > 0 THEN p.stock_quantity * p.purchase_price_paise ELSE 0 END), 0) AS value_at_cost_paise
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.business_id = ? AND p.is_active = 1 AND p.track_stock = 1
    GROUP BY c.name ORDER BY value_at_cost_paise DESC`).all(req.businessId);
  const totalsRounded = { ...totals,
    value_at_cost_paise: Math.round(totals.value_at_cost_paise), value_at_sale_paise: Math.round(totals.value_at_sale_paise),
    value_at_mrp_paise: Math.round(totals.value_at_mrp_paise) };
  res.json({ totals: totalsRounded, byCategory: (byCategory as any[]).map((r) => ({ ...r, value_at_cost_paise: Math.round(r.value_at_cost_paise) })) });
}

// ---------------- Categories ----------------

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(100),
  description: z.string().trim().max(500).optional().nullable(),
});

export function getCategories(req: AuthenticatedRequest, res: Response): void {
  const categories = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) AS product_count
    FROM categories c WHERE c.business_id = ? ORDER BY c.name COLLATE NOCASE ASC`).all(req.businessId) as any[];
  // Categories that fit this kind of business and the shop does not have yet (offered in the product form)
  const business = db.prepare('SELECT category FROM businesses WHERE id = ?').get(req.businessId) as { category?: string } | undefined;
  const have = new Set(categories.map((c) => String(c.name).toLowerCase()));
  res.json({ data: categories, suggestions: suggestionsFor(business?.category).filter((n) => !have.has(n.toLowerCase())) });
}

// ---- Units and GST rates offered in the product form: each shop's own lists (Products → Manage lists)

export const DEFAULT_UNITS: { value: string; label: string }[] = [
  { value: 'pcs', label: 'Pieces (pcs)' }, { value: 'kg', label: 'Kilograms (kg)' }, { value: 'gm', label: 'Grams (gm)' },
  { value: 'ltr', label: 'Litres (ltr)' }, { value: 'ml', label: 'Millilitres (ml)' }, { value: 'mtr', label: 'Metres (mtr)' },
  { value: 'pkt', label: 'Packet (pkt)' }, { value: 'box', label: 'Box' }, { value: 'dozen', label: 'Dozen' }, { value: 'pair', label: 'Pair' },
  { value: 'set', label: 'Set' }, { value: 'strip', label: 'Strip' }, { value: 'bottle', label: 'Bottle' }, { value: 'bag', label: 'Bag' },
  { value: 'portion', label: 'Portion' }, { value: 'plate', label: 'Plate' }, { value: 'hour', label: 'Hour' }, { value: 'job', label: 'Job / Service' },
];
export const DEFAULT_GST_RATES = ['0', '0.25', '3', '5', '12', '18', '28'];

function readList<T>(businessId: string, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM app_settings WHERE business_id = ? AND key = ?').get(businessId, key) as { value: string } | undefined;
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}

function writeList(businessId: string, key: string, value: unknown) {
  db.prepare(`INSERT INTO app_settings (business_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
              ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(businessId, key, JSON.stringify(value));
}

function productOptions(businessId: string) {
  const units = readList(businessId, 'productUnits', DEFAULT_UNITS);
  const rates = readList(businessId, 'gstRates', DEFAULT_GST_RATES);
  const unitUse = new Map((db.prepare('SELECT unit, COUNT(*) AS c FROM products WHERE business_id = ? AND is_active = 1 GROUP BY unit').all(businessId) as any[])
    .map((r) => [String(r.unit), Number(r.c)]));
  const rateUse = new Map((db.prepare('SELECT tax_rate, COUNT(*) AS c FROM products WHERE business_id = ? AND is_active = 1 GROUP BY tax_rate').all(businessId) as any[])
    .map((r) => [String(Number(r.tax_rate)), Number(r.c)]));
  return {
    units: units.map((u) => ({ ...u, products: unitUse.get(u.value) || 0 })),
    gstRates: rates.map((r) => ({ rate: r, products: rateUse.get(r) || 0 })),
  };
}

const optionsSchema = z.object({
  units: z.array(z.object({ value: z.string().trim().min(1, 'A unit needs a short name').max(20), label: z.string().trim().min(1).max(40) })).max(100).optional(),
  gstRates: z.array(z.coerce.number().min(0, 'GST is 0% or more').max(100, 'GST is at most 100%')).max(30).optional(),
  /** A unit renamed in the list: the products that use it change with it */
  renameUnit: z.object({ from: z.string().trim().min(1).max(20), to: z.string().trim().min(1).max(20) }).optional(),
});

export function getProductOptions(req: AuthenticatedRequest, res: Response): void {
  res.json(productOptions(req.businessId!));
}

export function updateProductOptions(req: AuthenticatedRequest, res: Response): void {
  const input = parse(optionsSchema, req.body);
  const biz = req.businessId!;
  db.transaction(() => {
    if (input.units) {
      const seen = new Set<string>();
      const units = input.units.filter((u) => !seen.has(u.value.toLowerCase()) && seen.add(u.value.toLowerCase()));
      writeList(biz, 'productUnits', units);
    }
    if (input.gstRates) {
      const rates = [...new Set(input.gstRates.map((r) => String(Number(r))))].sort((a, b) => Number(a) - Number(b));
      writeList(biz, 'gstRates', rates);
    }
    if (input.renameUnit && input.renameUnit.from !== input.renameUnit.to) {
      db.prepare("UPDATE products SET unit = ?, updated_at = datetime('now') WHERE business_id = ? AND unit = ?").run(input.renameUnit.to, biz, input.renameUnit.from);
    }
  })();
  res.json(productOptions(biz));
}

// ---- Products → Import Excel

const importSchema = z.object({ fileName: z.string().trim().max(200), data: z.string().min(1).max(7_000_000) });

/**
 * Adds or updates products from an Excel / CSV file (the Export's columns, or common names for them). A row whose SKU
 * exists updates that product; others become new products (a missing SKU is made up). Categories are found by name or
 * created. Stock changes go through the stock ledger. Rows with problems are skipped and listed; the rest are saved.
 */
export const importProducts = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const input = parse(importSchema, req.body);
  const biz = req.businessId!;
  let table: string[][];
  try {
    table = await readSheet(Buffer.from(input.data, 'base64'));
  } catch {
    throw new HttpError(400, 'IMPORT_UNREADABLE', 'This file could not be read. Use an Excel file (.xlsx) or a CSV file.');
  }
  const { rows, missing } = mapRows(table);
  if (missing.length) {
    throw new HttpError(400, 'IMPORT_COLUMNS', `The file needs a header row with at least these columns: Name, ${missing.join(', ')}. Tip: use Export Excel as the template.`);
  }
  if (rows.length === 0) throw new HttpError(400, 'IMPORT_EMPTY', 'The file has no products under its header row.');
  if (rows.length > 10000) throw new HttpError(400, 'IMPORT_TOO_LARGE', 'Import at most 10,000 products at a time.');

  const categories = new Map<string, string>();
  for (const c of db.prepare('SELECT id, name FROM categories WHERE business_id = ?').all(biz) as any[]) categories.set(String(c.name).toLowerCase(), c.id);
  const categoryId = (name: string) => {
    if (!name) return null;
    const key = name.toLowerCase();
    if (!categories.has(key)) {
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO categories (id, business_id, name, description, updated_at) VALUES (?, ?, ?, '', datetime('now'))").run(id, biz, name.slice(0, 100));
      categories.set(key, id);
    }
    return categories.get(key)!;
  };
  const number = (s: string | undefined, label: string) => {
    if (s === undefined || s === '') return undefined;
    const n = Number(s.replace(/[₹,%\s]/g, ''));
    if (!Number.isFinite(n)) throw new Error(`${label} "${s}" is not a number`);
    return n;
  };
  const paise = (rupees?: number) => (rupees === undefined ? undefined : Math.round(rupees * 100));

  let created = 0;
  let updated = 0;
  const errors: { row: number; message: string }[] = [];
  db.transaction(() => {
    for (const { row, values: v } of rows) {
      try {
        if (!v.name) throw new Error('Name is empty');
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
          ? db.prepare('SELECT * FROM products WHERE business_id = ? AND sku = ? AND is_active = 1').get(biz, fields.sku) as any
          : undefined;
        if (existing) {
          const p = parse(productSchema.partial(), Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== undefined)));
          assertUniqueBarcode(biz, p.barcode, existing.id);
          const pick = <T>(x: T | undefined, cur: T) => (x === undefined ? cur : x);
          db.prepare(`UPDATE products SET category_id = ?, name = ?, barcode = ?, unit = ?, hsn_code = ?, purchase_price_paise = ?, sale_price_paise = ?,
                        mrp_paise = ?, tax_rate = ?, low_stock_threshold = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(pick(p.categoryId, existing.category_id), pick(p.name, existing.name), pick(p.barcode, existing.barcode), pick(p.unit, existing.unit),
              pick(p.hsnCode, existing.hsn_code), pick(p.purchasePricePaise, existing.purchase_price_paise), pick(p.salePricePaise, existing.sale_price_paise),
              pick(p.mrpPaise, existing.mrp_paise), pick(p.taxRate, existing.tax_rate), pick(p.lowStockThreshold, existing.low_stock_threshold), existing.id);
          if (p.stockQuantity !== undefined && p.stockQuantity !== existing.stock_quantity) {
            db.prepare('UPDATE products SET stock_quantity = ? WHERE id = ?').run(p.stockQuantity, existing.id);
            db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes)
                        VALUES (?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', 'IMPORT', 'Stock set by Excel import')`)
              .run(crypto.randomUUID(), biz, existing.id, p.stockQuantity - existing.stock_quantity, p.stockQuantity);
          }
          updated++;
        } else {
          if (!v.sale) throw new Error('Selling price is empty');
          const sku = fields.sku || `SKU-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
          const p = parse(productSchema, { ...Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== undefined)), sku });
          assertUniqueBarcode(biz, p.barcode);
          const id = crypto.randomUUID();
          db.prepare(`INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, hsn_code, purchase_price_paise, sale_price_paise, mrp_paise,
                        tax_rate, stock_quantity, low_stock_threshold, track_stock, is_active, extra_attributes_json, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, '{}', datetime('now'), datetime('now'))`)
            .run(id, biz, p.categoryId || null, p.name, p.sku, p.barcode || null, p.unit, p.hsnCode || '', p.purchasePricePaise, p.salePricePaise,
              p.mrpPaise, p.taxRate, p.stockQuantity, p.lowStockThreshold);
          if (p.stockQuantity !== 0) {
            db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes)
                        VALUES (?, ?, ?, ?, ?, 'OPENING_STOCK', 'IMPORT', 'Opening stock (Excel import)')`).run(crypto.randomUUID(), biz, id, p.stockQuantity, p.stockQuantity);
          }
          created++;
        }
      } catch (err: any) {
        errors.push({ row, message: err?.message || 'Could not be saved' });
      }
    }
  })();

  logAudit({ businessId: biz, userId: req.user?.userId, action: 'PRODUCTS_IMPORTED', entityType: 'PRODUCT',
    details: { file: input.fileName, created, updated, skipped: errors.length } });
  res.json({ created, updated, skipped: errors.length, errors: errors.slice(0, 50) });
});

export function createCategory(req: AuthenticatedRequest, res: Response): void {
  const c = parse(categorySchema, req.body);
  const dup = db.prepare('SELECT id FROM categories WHERE business_id = ? AND LOWER(name) = LOWER(?)').get(req.businessId, c.name);
  if (dup) throw new HttpError(409, 'DUPLICATE_CATEGORY', 'A category with this name already exists');
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO categories (id, business_id, name, description, updated_at) VALUES (?, ?, ?, ?, datetime('now'))")
    .run(id, req.businessId, c.name, c.description || '');
  res.status(201).json({ message: 'Category created', category: db.prepare('SELECT * FROM categories WHERE id = ?').get(id) });
}

export function updateCategory(req: AuthenticatedRequest, res: Response): void {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId) as any;
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Category not found');
  const c = parse(categorySchema.partial(), req.body);
  if (c.name) {
    const dup = db.prepare('SELECT id FROM categories WHERE business_id = ? AND LOWER(name) = LOWER(?) AND id != ?').get(req.businessId, c.name, existing.id);
    if (dup) throw new HttpError(409, 'DUPLICATE_CATEGORY', 'A category with this name already exists');
  }
  db.prepare("UPDATE categories SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?")
    .run(c.name ?? existing.name, c.description !== undefined ? c.description : existing.description, existing.id);
  res.json({ message: 'Category updated', category: db.prepare('SELECT * FROM categories WHERE id = ?').get(existing.id) });
}

/** Products in a deleted category become uncategorised (FK ON DELETE SET NULL). */
export function deleteCategory(req: AuthenticatedRequest, res: Response): void {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId) as any;
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Category not found');
  const used = (db.prepare('SELECT COUNT(*) AS c FROM products WHERE category_id = ? AND is_active = 1').get(existing.id) as any).c;
  db.prepare('DELETE FROM categories WHERE id = ?').run(existing.id);
  logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'CATEGORY_DELETED', entityType: 'CATEGORY', entityId: existing.id,
    details: { name: existing.name, productsUncategorised: used } });
  res.json({ message: used > 0 ? `Category deleted; ${used} products are now uncategorised` : 'Category deleted' });
}
