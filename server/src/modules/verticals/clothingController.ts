import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

// ============================================================================
// CLOTHING & FASHION VARIANT MATRIX & EXCHANGES CONTROLLER (PRD §5)
// ============================================================================

export function getClothingProducts(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;

  // Fetch all products that have variants or belong to clothing
  const products = db.prepare(`
    SELECT p.*,
           (SELECT COUNT(*) FROM clothing_variants cv WHERE cv.parent_product_id = p.id) as variant_count,
           (SELECT COALESCE(SUM(cv.stock_quantity), 0) FROM clothing_variants cv WHERE cv.parent_product_id = p.id) as total_variant_stock
    FROM products p
    WHERE p.business_id = ?
    ORDER BY p.name ASC
  `).all(businessId) as any[];

  // Attach variants to each product
  const getVariants = db.prepare(`
    SELECT * FROM clothing_variants 
    WHERE business_id = ? AND parent_product_id = ? 
    ORDER BY size ASC, color ASC
  `);

  const enriched = products.map(prod => ({
    ...prod,
    variants: getVariants.all(businessId, prod.id),
  }));

  res.json({ data: enriched });
}

export function createClothingProduct(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const {
    name,
    baseSku,
    categoryId,
    unit = 'Pcs',
    hsnCode = '6109',
    purchasePricePaise = 0,
    salePricePaise = 0,
    mrpPaise = 0,
    taxRate = 5,
    sizes = ['M', 'L', 'XL'],
    colors = ['Navy Blue', 'Black'],
    fabric = '100% Cotton',
    initialStockPerVariant = 10,
  } = req.body;

  if (!name || !baseSku || !sizes.length || !colors.length) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Name, SKU, sizes, and colors are required' });
    return;
  }

  const parentProductId = uuidv4();
  const totalVariants = sizes.length * colors.length;
  const totalInitialStock = totalVariants * Number(initialStockPerVariant || 0);

  const transaction = db.transaction(() => {
    // 1. Insert parent product
    db.prepare(`
      INSERT INTO products (
        id, business_id, category_id, name, sku, barcode, unit, hsn_code,
        purchase_price_paise, sale_price_paise, mrp_paise, tax_rate,
        stock_quantity, low_stock_threshold, is_active, extra_attributes_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10, 1, ?, datetime('now'), datetime('now'))
    `).run(
      parentProductId, businessId, categoryId || null, name, baseSku,
      `${baseSku}-BASE`, unit, hsnCode, purchasePricePaise, salePricePaise, mrpPaise,
      taxRate, totalInitialStock, JSON.stringify({ fabric, sizes, colors })
    );

    // 2. Generate variant matrix (Size x Color)
    const insertVariant = db.prepare(`
      INSERT INTO clothing_variants (
        id, business_id, parent_product_id, variant_sku, barcode,
        size, color, fabric, stock_quantity, sale_price_paise, mrp_paise, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const recordMovement = db.prepare(`
      INSERT INTO stock_movements (
        id, business_id, product_id, change_quantity, resulting_quantity,
        movement_type, reference_id, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, 'MANUAL_ADJUSTMENT', ?, ?, datetime('now'))
    `);

    for (const color of colors) {
      for (const size of sizes) {
        const variantId = uuidv4();
        const cleanColor = color.replace(/\s+/g, '').toUpperCase().slice(0, 4);
        const variantSku = `${baseSku}-${cleanColor}-${size}`;
        const barcode = `890${Math.floor(1000000000 + Math.random() * 9000000000)}`;
        const stockQty = Number(initialStockPerVariant) || 0;

        insertVariant.run(
          variantId, businessId, parentProductId, variantSku, barcode,
          size, color, fabric, stockQty, salePricePaise, mrpPaise
        );

        if (stockQty > 0) {
          recordMovement.run(
            uuidv4(), businessId, parentProductId, stockQty, totalInitialStock,
            variantId, `Initial variant stock ${size} / ${color}`
          );
        }
      }
    }
  });

  try {
    transaction();
    res.status(201).json({
      message: `Apparel style created with ${totalVariants} size-color matrix variants!`,
      productId: parentProductId,
    });
  } catch (err: any) {
    res.status(500).json({ code: 'TRANSACTION_FAILED', message: err.message });
  }
}

export function updateVariantStock(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const variantId = req.params.id;
  const { newQuantity } = req.body;

  const variant = db.prepare(`
    SELECT * FROM clothing_variants WHERE id = ? AND business_id = ?
  `).get(variantId, businessId) as any;

  if (!variant) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Variant not found' });
    return;
  }

  const qty = Math.max(0, Number(newQuantity) || 0);

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE clothing_variants SET stock_quantity = ? WHERE id = ? AND business_id = ?
    `).run(qty, variantId, businessId);

    // Sync parent product total stock
    const sum = db.prepare(`
      SELECT SUM(stock_quantity) as total FROM clothing_variants WHERE parent_product_id = ? AND business_id = ?
    `).get(variant.parent_product_id, businessId) as any;

    db.prepare(`
      UPDATE products SET stock_quantity = ?, updated_at = datetime('now') WHERE id = ? AND business_id = ?
    `).run(sum?.total || 0, variant.parent_product_id, businessId);
  });

  transaction();
  res.json({ message: 'Variant stock updated successfully' });
}

// ============================================================================
// PRODUCT SIZE / COLOR EXCHANGE DESK (PRD §5)
// ============================================================================

export function getGarmentExchanges(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const exchanges = db.prepare(`
    SELECT * FROM garment_exchanges 
    WHERE business_id = ? 
    ORDER BY created_at DESC 
    LIMIT 100
  `).all(businessId);

  res.json({ data: exchanges });
}

export function createGarmentExchange(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const userId = req.user?.userId;

  const {
    originalInvoiceNumber,
    customerName = 'Walk-in Customer',
    customerPhone = '',
    returnedVariantId,
    returnedProductName,
    returnedSize,
    returnedColor,
    returnedQuantity = 1,
    issuedVariantId,
    issuedProductName,
    issuedSize,
    issuedColor,
    issuedQuantity = 1,
    priceDifferencePaise = 0,
    paymentMode = 'CASH',
    reason = 'WRONG_SIZE',
    notes = '',
  } = req.body;

  if (!originalInvoiceNumber || !returnedProductName || !issuedProductName) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Original invoice, returned and issued details required' });
    return;
  }

  const existingCount = db.prepare('SELECT COUNT(*) as count FROM garment_exchanges WHERE business_id = ?').get(businessId) as any;
  const exchangeNumber = `EX-${2000 + (existingCount?.count || 0) + 1}`;
  const exchangeId = uuidv4();

  const transaction = db.transaction(() => {
    // 1. Insert Exchange Record
    db.prepare(`
      INSERT INTO garment_exchanges (
        id, business_id, exchange_number, original_invoice_number,
        customer_name, customer_phone,
        returned_variant_id, returned_product_name, returned_size, returned_color, returned_quantity,
        issued_variant_id, issued_product_name, issued_size, issued_color, issued_quantity,
        price_difference_paise, payment_mode, reason, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      exchangeId, businessId, exchangeNumber, originalInvoiceNumber,
      customerName, customerPhone,
      returnedVariantId || null, returnedProductName, returnedSize, returnedColor, returnedQuantity,
      issuedVariantId || null, issuedProductName, issuedSize, issuedColor, issuedQuantity,
      priceDifferencePaise, paymentMode, reason, notes, userId || null
    );

    // 2. Restock Returned Variant
    if (returnedVariantId) {
      db.prepare(`
        UPDATE clothing_variants 
        SET stock_quantity = stock_quantity + ? 
        WHERE id = ? AND business_id = ?
      `).run(returnedQuantity, returnedVariantId, businessId);
    }

    // 3. Deduct Issued Variant
    if (issuedVariantId) {
      db.prepare(`
        UPDATE clothing_variants 
        SET stock_quantity = MAX(0, stock_quantity - ?) 
        WHERE id = ? AND business_id = ?
      `).run(issuedQuantity, issuedVariantId, businessId);
    }

    // 4. Audit Log
    db.prepare(`
      INSERT INTO audit_logs (id, business_id, user_id, action, entity_type, entity_id, details_json, created_at)
      VALUES (?, ?, ?, 'GARMENT_EXCHANGE', 'EXCHANGE', ?, ?, datetime('now'))
    `).run(
      uuidv4(), businessId, userId || null, exchangeId,
      JSON.stringify({ exchangeNumber, originalInvoiceNumber, returnedSize, issuedSize, priceDifferencePaise })
    );
  });

  try {
    transaction();
    res.status(201).json({
      message: `Garment exchange ${exchangeNumber} completed and stock rebalanced successfully!`,
      exchangeNumber,
    });
  } catch (err: any) {
    res.status(500).json({ code: 'TRANSACTION_FAILED', message: err.message });
  }
}

export function getClothingSummary(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;

  const styleCount = db.prepare(`
    SELECT COUNT(*) as count FROM products WHERE business_id = ? AND (extra_attributes_json LIKE '%sizes%' OR id IN (SELECT parent_product_id FROM clothing_variants))
  `).get(businessId) as any;

  const variantCount = db.prepare(`
    SELECT COUNT(*) as total_variants, COALESCE(SUM(stock_quantity), 0) as total_stock 
    FROM clothing_variants WHERE business_id = ?
  `).get(businessId) as any;

  const exchangeCount = db.prepare(`
    SELECT COUNT(*) as count FROM garment_exchanges WHERE business_id = ?
  `).get(businessId) as any;

  res.json({
    data: {
      totalStyles: styleCount?.count || 0,
      totalVariants: variantCount?.total_variants || 0,
      totalStock: variantCount?.total_stock || 0,
      totalExchanges: exchangeCount?.count || 0,
    }
  });
}
