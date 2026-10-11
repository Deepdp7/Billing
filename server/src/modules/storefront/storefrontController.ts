import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

// ============================================================================
// ONLINE STOREFRONT & ORDER MANAGEMENT CONTROLLER (PRD §4.20)
// ============================================================================

// ----------------------------------------------------------------------------
// 1. PUBLIC STOREFRONT ENDPOINTS (No Merchant Login Required)
// ----------------------------------------------------------------------------

export function getPublicStore(req: Request, res: Response): void {
  const { slug } = req.params;

  // Find store by slug or business id
  let store = db.prepare(`
    SELECT os.*, b.name as business_name, b.city as business_city, b.address as business_address, b.logo_url
    FROM online_stores os
    JOIN businesses b ON b.id = os.business_id
    WHERE os.slug = ? OR os.business_id = ?
  `).get(slug, slug) as any;

  // If no explicit store configuration exists, check if business exists and provide default
  if (!store) {
    const biz = db.prepare('SELECT * FROM businesses WHERE id = ?').get(slug) as any;
    if (biz) {
      const defaultStoreId = uuidv4();
      const defaultSlug = biz.id.replace('biz_', '');
      try {
        db.prepare(`
          INSERT INTO online_stores (id, business_id, slug, store_name, tagline, banner_message, is_active, min_order_amount_paise, delivery_fee_paise, contact_phone)
          VALUES (?, ?, ?, ?, ?, ?, 1, 0, 4000, ?)
        `).run(defaultStoreId, biz.id, defaultSlug, biz.name, 'Quality Products Delivered to Your Doorstep', 'Flat ₹40 delivery across city · Free pickup available', biz.phone || '9876543210');
        
        store = db.prepare(`
          SELECT os.*, b.name as business_name, b.city as business_city, b.address as business_address, b.logo_url
          FROM online_stores os
          JOIN businesses b ON b.id = os.business_id
          WHERE os.id = ?
        `).get(defaultStoreId);
      } catch {
        // Fallback if insertion conflict
      }
    }
  }

  if (!store) {
    res.status(404).json({ error: 'Store not found or currently offline' });
    return;
  }

  // Fetch active products with category
  const products = db.prepare(`
    SELECT p.id, p.name, p.sku, p.sale_price_paise, p.mrp_paise, p.unit, p.stock_quantity,
           c.name as category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.business_id = ? AND p.is_active = 1
    ORDER BY c.name ASC, p.name ASC
  `).all(store.business_id);

  // Fetch distinct categories
  const categories = db.prepare(`
    SELECT id, name FROM categories WHERE business_id = ? ORDER BY name ASC
  `).all(store.business_id);

  res.json({
    store,
    categories,
    products
  });
}

export function createPublicOrder(req: Request, res: Response): void {
  const { slug } = req.params;
  const {
    customer_name,
    customer_phone,
    customer_email,
    delivery_address,
    delivery_city,
    delivery_pincode,
    notes,
    payment_mode = 'COD',
    items
  } = req.body;

  if (!customer_name || !customer_phone || !delivery_address || !items || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Customer name, phone, address, and at least one item are required' });
    return;
  }

  const store = db.prepare('SELECT * FROM online_stores WHERE slug = ? OR business_id = ?').get(slug, slug) as any;
  if (!store || !store.is_active) {
    res.status(400).json({ error: 'Store is currently not accepting online orders' });
    return;
  }

  const businessId = store.business_id;

  // Generate order number
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const countRow = db.prepare(`
    SELECT COUNT(*) as count FROM online_orders WHERE business_id = ? AND date(created_at) = date('now')
  `).get(businessId) as { count: number };
  const seq = String((countRow?.count || 0) + 1).padStart(3, '0');
  const orderNumber = `ORD-${dateStr}-${seq}`;

  const orderId = uuidv4();

  const insertOrderTx = db.transaction(() => {
    let subtotalPaise = 0;
    const validatedItems: any[] = [];

    for (const item of items) {
      const prod = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(item.product_id, businessId) as any;
      if (!prod) {
        throw new Error(`Product ${item.product_id} not found in this store`);
      }

      const qty = Math.max(1, Number(item.quantity) || 1);
      const unitPrice = prod.sale_price_paise;
      const itemTotal = unitPrice * qty;
      subtotalPaise += itemTotal;

      validatedItems.push({
        id: uuidv4(),
        order_id: orderId,
        business_id: businessId,
        product_id: prod.id,
        product_name: prod.name,
        sku: prod.sku,
        quantity: qty,
        unit_price_paise: unitPrice,
        total_paise: itemTotal
      });
    }

    const deliveryFeePaise = store.delivery_fee_paise || 0;
    const totalPaise = subtotalPaise + deliveryFeePaise;

    // Check min order amount
    if (store.min_order_amount_paise > 0 && subtotalPaise < store.min_order_amount_paise) {
      throw new Error(`Minimum order amount is ₹${(store.min_order_amount_paise / 100).toFixed(2)}`);
    }

    db.prepare(`
      INSERT INTO online_orders (
        id, business_id, order_number, customer_name, customer_phone, customer_email,
        delivery_address, delivery_city, delivery_pincode, notes, subtotal_paise,
        delivery_fee_paise, total_paise, status, payment_mode, payment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 'UNPAID')
    `).run(
      orderId, businessId, orderNumber, customer_name, customer_phone, customer_email || null,
      delivery_address, delivery_city || null, delivery_pincode || null, notes || null,
      subtotalPaise, deliveryFeePaise, totalPaise, payment_mode
    );

    const insertItemStmt = db.prepare(`
      INSERT INTO online_order_items (id, business_id, order_id, product_id, product_name, sku, quantity, unit_price_paise, total_paise)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const vItem of validatedItems) {
      insertItemStmt.run(
        vItem.id, vItem.business_id, vItem.order_id, vItem.product_id,
        vItem.product_name, vItem.sku, vItem.quantity, vItem.unit_price_paise, vItem.total_paise
      );
    }

    return { orderId, orderNumber, totalPaise, itemCount: validatedItems.length };
  });

  try {
    const result = insertOrderTx();
    res.status(201).json({
      message: 'Order placed successfully!',
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      totalAmountPaise: result.totalPaise,
      itemCount: result.itemCount
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Failed to place order' });
  }
}

export function getPublicOrderStatus(req: Request, res: Response): void {
  const { order_number } = req.params;

  const order = db.prepare(`
    SELECT oo.*, os.store_name, os.contact_phone, os.contact_whatsapp
    FROM online_orders oo
    LEFT JOIN online_stores os ON os.business_id = oo.business_id
    WHERE oo.order_number = ?
  `).get(order_number) as any;

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  const items = db.prepare(`
    SELECT * FROM online_order_items WHERE order_id = ?
  `).all(order.id);

  res.json({
    order,
    items
  });
}

// ----------------------------------------------------------------------------
// 2. MERCHANT PROTECTED ENDPOINTS (/api/v1/app/store/*)
// ----------------------------------------------------------------------------

export function getStoreConfig(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;

  let store = db.prepare('SELECT * FROM online_stores WHERE business_id = ?').get(businessId) as any;

  if (!store) {
    const biz = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId) as any;
    const defaultStoreId = uuidv4();
    const defaultSlug = (biz?.name || 'store').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    
    db.prepare(`
      INSERT INTO online_stores (id, business_id, slug, store_name, tagline, banner_message, is_active, min_order_amount_paise, delivery_fee_paise, contact_phone)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0, 4000, ?)
    `).run(
      defaultStoreId, businessId, defaultSlug, biz?.name || 'Online Store',
      'Quality Products Delivered to Your Doorstep',
      'Free store pickup & quick home delivery available',
      biz?.phone || '9876543210'
    );

    store = db.prepare('SELECT * FROM online_stores WHERE id = ?').get(defaultStoreId);
  }

  // Online orders statistics
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_orders,
      SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_orders,
      SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted_orders,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_orders,
      SUM(CASE WHEN status = 'COMPLETED' THEN total_paise ELSE 0 END) as total_revenue_paise
    FROM online_orders
    WHERE business_id = ?
  `).get(businessId) as any;

  res.json({
    store,
    stats: {
      total_orders: stats?.total_orders || 0,
      pending_orders: stats?.pending_orders || 0,
      accepted_orders: stats?.accepted_orders || 0,
      completed_orders: stats?.completed_orders || 0,
      total_revenue_paise: stats?.total_revenue_paise || 0
    }
  });
}

export function updateStoreConfig(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const {
    slug,
    store_name,
    tagline,
    banner_message,
    is_active,
    min_order_amount_paise,
    delivery_fee_paise,
    accept_cod,
    accept_online,
    contact_phone,
    contact_whatsapp
  } = req.body;

  if (!slug || !store_name) {
    res.status(400).json({ error: 'Store slug and store name are required' });
    return;
  }

  // Check unique slug across other businesses
  const existing = db.prepare('SELECT id FROM online_stores WHERE slug = ? AND business_id != ?').get(slug, businessId);
  if (existing) {
    res.status(400).json({ error: 'This URL slug is already taken. Please pick another one.' });
    return;
  }

  db.prepare(`
    UPDATE online_stores SET
      slug = ?,
      store_name = ?,
      tagline = ?,
      banner_message = ?,
      is_active = ?,
      min_order_amount_paise = ?,
      delivery_fee_paise = ?,
      accept_cod = ?,
      accept_online = ?,
      contact_phone = ?,
      contact_whatsapp = ?,
      updated_at = datetime('now')
    WHERE business_id = ?
  `).run(
    slug, store_name, tagline || null, banner_message || null,
    is_active !== undefined ? (is_active ? 1 : 0) : 1,
    Number(min_order_amount_paise) || 0,
    Number(delivery_fee_paise) || 0,
    accept_cod !== undefined ? (accept_cod ? 1 : 0) : 1,
    accept_online !== undefined ? (accept_online ? 1 : 0) : 1,
    contact_phone || null,
    contact_whatsapp || null,
    businessId
  );

  const updated = db.prepare('SELECT * FROM online_stores WHERE business_id = ?').get(businessId);
  res.json({ message: 'Storefront updated successfully', store: updated });
}

export function getStoreOrders(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { status, search } = req.query as { status?: string; search?: string };

  let query = `
    SELECT oo.*,
           (SELECT COUNT(*) FROM online_order_items WHERE order_id = oo.id) as item_count
    FROM online_orders oo
    WHERE oo.business_id = ?
  `;
  const params: any[] = [businessId];

  if (status) {
    query += ' AND oo.status = ?';
    params.push(status);
  }

  if (search) {
    query += ' AND (oo.order_number LIKE ? OR oo.customer_name LIKE ? OR oo.customer_phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY oo.created_at DESC';

  const orders = db.prepare(query).all(...params);
  res.json({ orders });
}

export function getStoreOrderById(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;

  const order = db.prepare('SELECT * FROM online_orders WHERE id = ? AND business_id = ?').get(id, businessId) as any;
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  const items = db.prepare('SELECT * FROM online_order_items WHERE order_id = ?').all(id);
  res.json({ order, items });
}

export function updateOrderStatus(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['PENDING', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    return;
  }

  const result = db.prepare(`
    UPDATE online_orders SET status = ?, updated_at = datetime('now')
    WHERE id = ? AND business_id = ?
  `).run(status, id, businessId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  res.json({ message: `Order status updated to ${status}` });
}

export function convertOrderToInvoice(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;

  const order = db.prepare('SELECT * FROM online_orders WHERE id = ? AND business_id = ?').get(id, businessId) as any;
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  if (order.converted_invoice_id) {
    res.status(400).json({ error: 'This order has already been converted to an invoice' });
    return;
  }

  const items = db.prepare('SELECT * FROM online_order_items WHERE order_id = ?').all(id) as any[];
  if (!items || items.length === 0) {
    res.status(400).json({ error: 'Order has no items' });
    return;
  }

  const convertTx = db.transaction(() => {
    // 1. Get next invoice number
    const biz = db.prepare('SELECT invoice_prefix, next_invoice_number FROM businesses WHERE id = ?').get(businessId) as any;
    const prefix = biz?.invoice_prefix || 'INV-';
    const num = biz?.next_invoice_number || 1001;
    const invoiceNumber = `${prefix}${num}`;

    db.prepare('UPDATE businesses SET next_invoice_number = next_invoice_number + 1 WHERE id = ?').run(businessId);

    const invoiceId = uuidv4();

    // 2. Insert Invoice
    db.prepare(`
      INSERT INTO invoices (
        id, business_id, invoice_number, customer_name, customer_phone,
        subtotal_paise, tax_paise, total_amount_paise, discount_paise,
        payment_mode, payment_status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, 'PAID', ?)
    `).run(
      invoiceId, businessId, invoiceNumber, order.customer_name, order.customer_phone,
      order.subtotal_paise, order.total_paise, order.payment_mode || 'COD',
      `Auto-generated from Online Order ${order.order_number}`
    );

    // 3. Insert Invoice Items and deduct inventory stock
    const insertInvItem = db.prepare(`
      INSERT INTO invoice_items (id, business_id, invoice_id, product_id, product_name, quantity, unit_price_paise, tax_rate, tax_paise, total_paise)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `);

    const deductStock = db.prepare(`
      UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND business_id = ?
    `);

    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (id, business_id, product_id, movement_type, quantity, reference_id, notes)
      VALUES (?, ?, ?, 'INVOICE', ?, ?, ?)
    `);

    for (const itm of items) {
      insertInvItem.run(
        uuidv4(), businessId, invoiceId, itm.product_id, itm.product_name,
        itm.quantity, itm.unit_price_paise, itm.total_paise
      );

      deductStock.run(itm.quantity, itm.product_id, businessId);

      insertMovement.run(
        uuidv4(), businessId, itm.product_id, -itm.quantity, invoiceId,
        `POS Invoice ${invoiceNumber} (Converted from Online Order ${order.order_number})`
      );
    }

    // 4. Update online order
    db.prepare(`
      UPDATE online_orders SET
        status = 'COMPLETED',
        payment_status = 'PAID',
        converted_invoice_id = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(invoiceId, id);

    return { invoiceId, invoiceNumber };
  });

  try {
    const result = convertTx();
    res.json({
      message: 'Online order converted to POS invoice and inventory deducted successfully!',
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to convert order to invoice' });
  }
}
