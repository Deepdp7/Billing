import { Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { parse, HttpError } from '../../lib/http.js';
import { DATE_RE, localDate } from '../../lib/dates.js';
import { PAYMENT_MODES } from '../../services/invoiceService.js';
import { logAudit } from '../../services/auditService.js';

const text = (max: number) => z.string().trim().max(max).optional().nullable();

const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Supplier name is required').max(150),
  phone: text(20),
  email: z.string().trim().max(150).email('Invalid email').optional().nullable().or(z.literal('')),
  gstin: z.string().trim().toUpperCase().max(15).regex(/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN format').optional().nullable(),
  address: text(500),
  state: text(80),
  openingBalancePaise: z.coerce.number().int().optional(),
});

const lineSchema = z.object({
  productId: z.string().max(64).optional().nullable(),
  productName: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unitPricePaise: z.coerce.number().int().nonnegative(),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});

function computeLines(lines: z.infer<typeof lineSchema>[]) {
  let subtotal = 0;
  let tax = 0;
  const items = lines.map((it) => {
    const lineSubtotal = Math.round(it.quantity * it.unitPricePaise);
    const lineTax = Math.round((lineSubtotal * it.taxRate) / 100);
    subtotal += lineSubtotal;
    tax += lineTax;
    return { ...it, id: crypto.randomUUID(), taxPaise: lineTax, totalPaise: lineSubtotal + lineTax };
  });
  return { items, subtotal, tax, total: subtotal + tax };
}

// ---------------- Suppliers ----------------

export function getSuppliers(req: AuthenticatedRequest, res: Response): void {
  const includeInactive = req.query.includeInactive === 'true';
  const suppliers = db.prepare(`SELECT * FROM suppliers WHERE business_id = ? ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY name COLLATE NOCASE ASC`)
    .all(req.businessId);
  res.json({ data: suppliers });
}

export function createSupplier(req: AuthenticatedRequest, res: Response): void {
  const s = parse(supplierSchema, req.body);
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO suppliers (id, business_id, name, phone, email, gstin, address, state, outstanding_balance_paise, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
    .run(id, req.businessId, s.name, s.phone || '', s.email || '', s.gstin || '', s.address || '', s.state || null, s.openingBalancePaise || 0);
  logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'SUPPLIER_CREATED', entityType: 'SUPPLIER', entityId: id, details: { name: s.name } });
  res.status(201).json({ message: 'Supplier added successfully', supplier: db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) });
}

export function updateSupplier(req: AuthenticatedRequest, res: Response): void {
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId) as any;
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Supplier not found');
  const s = parse(supplierSchema.omit({ openingBalancePaise: true }).partial(), req.body);
  const pick = <T>(v: T | undefined, cur: T) => (v === undefined ? cur : v);
  db.prepare(`UPDATE suppliers SET name = ?, phone = ?, email = ?, gstin = ?, address = ?, state = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(pick(s.name, existing.name), pick(s.phone, existing.phone) || '', pick(s.email, existing.email) || '', pick(s.gstin, existing.gstin) || '',
      pick(s.address, existing.address) || '', pick(s.state, existing.state), existing.id);
  res.json({ message: 'Supplier updated', supplier: db.prepare('SELECT * FROM suppliers WHERE id = ?').get(existing.id) });
}

export function deleteSupplier(req: AuthenticatedRequest, res: Response): void {
  const sup = db.prepare('SELECT * FROM suppliers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId) as any;
  if (!sup) throw new HttpError(404, 'NOT_FOUND', 'Supplier not found');
  if (sup.outstanding_balance_paise !== 0) throw new HttpError(409, 'HAS_BALANCE', 'Supplier has an outstanding balance. Settle it first.');
  const history = (db.prepare('SELECT (SELECT COUNT(*) FROM purchase_invoices WHERE supplier_id = ?) + (SELECT COUNT(*) FROM payments WHERE supplier_id = ?) AS c')
    .get(sup.id, sup.id) as any).c;
  if (history > 0) {
    db.prepare("UPDATE suppliers SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(sup.id);
    res.json({ message: 'Supplier has purchase history and was deactivated instead of deleted', deactivated: true });
    return;
  }
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(sup.id);
  res.json({ message: 'Supplier deleted', deleted: true });
}

const supplierPaymentSchema = z.object({
  amountPaise: z.coerce.number().int().positive(),
  mode: z.enum(PAYMENT_MODES),
  purchaseId: z.string().max(64).optional().nullable(),
  reference: text(100),
  paymentDate: z.string().regex(DATE_RE).optional(),
  notes: text(300),
});

/** Pay a supplier, optionally against a specific purchase bill; otherwise oldest unpaid bills are settled first. */
export function paySupplier(req: AuthenticatedRequest, res: Response): void {
  const input = parse(supplierPaymentSchema, req.body);
  const allocations: Array<{ purchaseNumber: string; amountPaise: number }> = [];
  db.transaction(() => {
    const sup = db.prepare('SELECT * FROM suppliers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId) as any;
    if (!sup) throw new HttpError(404, 'NOT_FOUND', 'Supplier not found');
    const bills = input.purchaseId
      ? db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND supplier_id = ? AND business_id = ?').all(input.purchaseId, sup.id, req.businessId) as any[]
      : db.prepare(`SELECT * FROM purchase_invoices WHERE supplier_id = ? AND business_id = ? AND amount_paid_paise < total_paise
                    ORDER BY invoice_date ASC, created_at ASC`).all(sup.id, req.businessId) as any[];
    if (input.purchaseId && bills.length === 0) throw new HttpError(404, 'NOT_FOUND', 'Purchase bill not found for this supplier');
    if (input.purchaseId && input.amountPaise > bills[0].total_paise - bills[0].amount_paid_paise) {
      throw new HttpError(400, 'OVERPAYMENT', 'Amount exceeds the balance on this bill');
    }
    let remaining = input.amountPaise;
    const insert = db.prepare(`INSERT INTO payments (id, business_id, supplier_id, purchase_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_by)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OUT', ?, 'ACTIVE', ?)`);
    for (const b of bills) {
      if (remaining <= 0) break;
      const portion = Math.min(remaining, b.total_paise - b.amount_paid_paise);
      if (portion <= 0) continue;
      const paid = b.amount_paid_paise + portion;
      db.prepare('UPDATE purchase_invoices SET amount_paid_paise = ?, payment_status = ? WHERE id = ?')
        .run(paid, paid >= b.total_paise ? 'PAID' : 'PARTIAL', b.id);
      insert.run(crypto.randomUUID(), req.businessId, sup.id, b.id, portion, input.mode, input.reference || b.purchase_number,
        input.notes || `Payment for ${b.purchase_number}`, input.paymentDate || localDate(), req.user?.userId || null);
      allocations.push({ purchaseNumber: b.purchase_number, amountPaise: portion });
      remaining -= portion;
    }
    if (remaining > 0) {
      insert.run(crypto.randomUUID(), req.businessId, sup.id, null, remaining, input.mode, input.reference || null,
        input.notes || 'Advance / on-account payment to supplier', input.paymentDate || localDate(), req.user?.userId || null);
    }
    db.prepare("UPDATE suppliers SET outstanding_balance_paise = outstanding_balance_paise - ?, updated_at = datetime('now') WHERE id = ?")
      .run(input.amountPaise, sup.id);
  })();
  logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'SUPPLIER_PAYMENT', entityType: 'SUPPLIER', entityId: req.params.id,
    details: { amountPaise: input.amountPaise, mode: input.mode, allocations } });
  res.status(201).json({ message: 'Supplier payment recorded', allocations, supplier: db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id) });
}

export function getSupplierLedger(req: AuthenticatedRequest, res: Response): void {
  const sup = db.prepare('SELECT * FROM suppliers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId) as any;
  if (!sup) throw new HttpError(404, 'NOT_FOUND', 'Supplier not found');
  const entries = db.prepare(`
    SELECT invoice_date AS date, created_at, 'PURCHASE' AS type, purchase_number AS reference, 0 AS debit, total_paise AS credit, 'Purchase bill' AS description
      FROM purchase_invoices WHERE supplier_id = ? AND business_id = ?
    UNION ALL
    SELECT payment_date, created_at, 'PAYMENT', reference_number, amount_paise, 0, payment_mode || COALESCE(' — ' || notes, '')
      FROM payments WHERE supplier_id = ? AND business_id = ? AND direction = 'OUT' AND status = 'ACTIVE'
    UNION ALL
    SELECT return_date, created_at, 'DEBIT_NOTE', debit_note_number, total_paise, 0, 'Purchase return (' || refund_mode || ')'
      FROM debit_notes WHERE supplier_id = ? AND business_id = ? AND refund_mode = 'ADJUST_PAYABLE'
    ORDER BY 1 ASC, 2 ASC`).all(sup.id, req.businessId, sup.id, req.businessId, sup.id, req.businessId) as any[];
  let running = 0;
  // Positive balance = amount we owe the supplier.
  const ledger = entries.map((e) => { running += e.credit - e.debit; return { ...e, balance: running }; });
  res.json({ supplier: sup, entries: ledger, closingBalancePaise: running, recordedOutstandingPaise: sup.outstanding_balance_paise });
}

// ---------------- Purchase bills ----------------

const purchaseSchema = z.object({
  supplierId: z.string().max(64).optional().nullable(),
  supplierName: z.string().trim().min(1, 'Supplier name is required').max(150),
  purchaseNumber: z.string().trim().min(1, 'Supplier bill number is required').max(64),
  invoiceDate: z.string().regex(DATE_RE).optional(),
  items: z.array(lineSchema).min(1, 'Add at least one item').max(500),
  amountPaidPaise: z.coerce.number().int().nonnegative().default(0),
  paymentMode: z.enum(PAYMENT_MODES).default('CASH'),
  notes: text(1000),
  purchaseOrderId: z.string().max(64).optional().nullable(),
});

export function getPurchases(req: AuthenticatedRequest, res: Response): void {
  const { supplierId, fromDate, toDate, paymentStatus } = req.query as Record<string, string>;
  const cond = ['business_id = ?'];
  const params: any[] = [req.businessId];
  if (supplierId) { cond.push('supplier_id = ?'); params.push(supplierId); }
  if (fromDate) { cond.push('invoice_date >= ?'); params.push(fromDate); }
  if (toDate) { cond.push('invoice_date <= ?'); params.push(toDate); }
  if (paymentStatus) { cond.push('payment_status = ?'); params.push(paymentStatus); }
  const purchases = db.prepare(`SELECT * FROM purchase_invoices WHERE ${cond.join(' AND ')} ORDER BY invoice_date DESC, created_at DESC`).all(...params);
  res.json({ data: purchases });
}

export function getPurchaseById(req: AuthenticatedRequest, res: Response): void {
  const purchase = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
  if (!purchase) throw new HttpError(404, 'NOT_FOUND', 'Purchase not found');
  const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(req.params.id);
  const payments = db.prepare("SELECT * FROM payments WHERE purchase_id = ? AND status = 'ACTIVE' ORDER BY payment_date").all(req.params.id);
  res.json({ purchase, items, payments });
}

function recordPurchase(businessId: string, userId: string | null, input: z.infer<typeof purchaseSchema>) {
  if (input.supplierId) {
    const sup = db.prepare('SELECT id FROM suppliers WHERE id = ? AND business_id = ?').get(input.supplierId, businessId);
    if (!sup) throw new HttpError(400, 'SUPPLIER_NOT_FOUND', 'Selected supplier does not exist');
    const dup = db.prepare('SELECT id FROM purchase_invoices WHERE business_id = ? AND supplier_id = ? AND purchase_number = ?')
      .get(businessId, input.supplierId, input.purchaseNumber);
    if (dup) throw new HttpError(409, 'DUPLICATE_PURCHASE', 'This supplier bill number has already been recorded');
  }
  const { items, subtotal, tax, total } = computeLines(input.items);
  const paid = input.amountPaidPaise;
  if (paid > total) throw new HttpError(400, 'OVERPAYMENT', 'Amount paid exceeds the bill total');
  if (paid < total && !input.supplierId) throw new HttpError(400, 'SUPPLIER_REQUIRED', 'Select a saved supplier for unpaid or partly paid bills');
  const status = paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
  const id = crypto.randomUUID();
  const date = input.invoiceDate || localDate();

  db.prepare(`INSERT INTO purchase_invoices (id, business_id, supplier_id, supplier_name, purchase_number, invoice_date, subtotal_paise, tax_paise,
                total_paise, payment_status, amount_paid_paise, notes, purchase_order_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(id, businessId, input.supplierId || null, input.supplierName, input.purchaseNumber, date, subtotal, tax, total, status, paid,
      input.notes || '', input.purchaseOrderId || null);

  const insertItem = db.prepare(`INSERT INTO purchase_items (id, business_id, purchase_id, product_id, product_name, quantity, unit_price_paise, tax_rate, tax_paise, total_paise)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const it of items) {
    let productId = it.productId || null;
    if (productId && !db.prepare('SELECT 1 FROM products WHERE id = ? AND business_id = ?').get(productId, businessId)) productId = null;
    insertItem.run(it.id, businessId, id, productId, it.productName, it.quantity, it.unitPricePaise, it.taxRate, it.taxPaise, it.totalPaise);
    if (productId) {
      db.prepare("UPDATE products SET stock_quantity = stock_quantity + ?, purchase_price_paise = ?, updated_at = datetime('now') WHERE id = ?")
        .run(it.quantity, it.unitPricePaise, productId);
      db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes)
                  VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'PURCHASE', ?, ?)`)
        .run(crypto.randomUUID(), businessId, productId, it.quantity, productId, id, `Purchase from ${input.supplierName} (${input.purchaseNumber})`);
    }
  }
  if (paid > 0) {
    db.prepare(`INSERT INTO payments (id, business_id, supplier_id, purchase_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OUT', ?, 'ACTIVE', ?)`)
      .run(crypto.randomUUID(), businessId, input.supplierId || null, id, paid, input.paymentMode, input.purchaseNumber,
        `Payment for purchase ${input.purchaseNumber}`, date, userId);
  }
  if (input.supplierId && total > paid) {
    db.prepare("UPDATE suppliers SET outstanding_balance_paise = outstanding_balance_paise + ?, updated_at = datetime('now') WHERE id = ?")
      .run(total - paid, input.supplierId);
  }
  return { id, total };
}

export function createPurchase(req: AuthenticatedRequest, res: Response): void {
  const input = parse(purchaseSchema, req.body);
  const result = db.transaction(() => recordPurchase(req.businessId!, req.user?.userId || null, input))();
  logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'PURCHASE_RECORDED', entityType: 'PURCHASE', entityId: result.id,
    details: { supplier: input.supplierName, number: input.purchaseNumber, totalPaise: result.total } });
  res.status(201).json({ message: 'Purchase recorded and stock updated successfully', purchaseId: result.id });
}

/** Delete a purchase bill: reverse stock, undo supplier dues, remove payment rows. */
export function deletePurchase(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const purchase = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND business_id = ?').get(req.params.id, businessId) as any;
  if (!purchase) throw new HttpError(404, 'NOT_FOUND', 'Purchase not found');
  const returns = db.prepare('SELECT COUNT(*) AS c FROM debit_notes WHERE purchase_id = ? AND business_id = ?').get(purchase.id, businessId) as any;
  if (returns.c > 0) throw new HttpError(409, 'HAS_RETURNS', 'This purchase has returns recorded. Remove those first.');

  db.transaction(() => {
    const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ? AND business_id = ?').all(purchase.id, businessId) as any[];
    for (const it of items) {
      if (!it.product_id) continue;
      db.prepare("UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = datetime('now') WHERE id = ?")
        .run(it.quantity, it.product_id);
      db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes)
                  VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'PURCHASE_DELETE', ?, ?)`)
        .run(crypto.randomUUID(), businessId, it.product_id, -it.quantity, it.product_id, purchase.id,
          `Deleted purchase ${purchase.purchase_number}`);
    }
    if (purchase.supplier_id) {
      const unpaid = purchase.total_paise - purchase.amount_paid_paise;
      if (unpaid > 0) {
        db.prepare("UPDATE suppliers SET outstanding_balance_paise = outstanding_balance_paise - ?, updated_at = datetime('now') WHERE id = ?")
          .run(unpaid, purchase.supplier_id);
      }
    }
    db.prepare("DELETE FROM payments WHERE purchase_id = ? AND business_id = ?").run(purchase.id, businessId);
    db.prepare('DELETE FROM purchase_invoices WHERE id = ? AND business_id = ?').run(purchase.id, businessId);
  })();

  logAudit({ businessId, userId: req.user?.userId, action: 'PURCHASE_DELETED', entityType: 'PURCHASE', entityId: purchase.id,
    details: { number: purchase.purchase_number, supplier: purchase.supplier_name, totalPaise: purchase.total_paise } });
  res.json({ message: `Purchase ${purchase.purchase_number} deleted`, id: purchase.id });
}

// ---------------- Purchase orders ----------------

const poSchema = z.object({
  supplierId: z.string().max(64).optional().nullable(),
  supplierName: z.string().trim().min(1).max(150),
  expectedDate: z.string().regex(DATE_RE).optional().nullable(),
  items: z.array(lineSchema).min(1).max(500),
  notes: text(1000),
});

export function getPurchaseOrders(req: AuthenticatedRequest, res: Response): void {
  const status = req.query.status as string | undefined;
  const rows = db.prepare(`SELECT po.*, (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) AS item_count
                           FROM purchase_orders po WHERE po.business_id = ? ${status ? 'AND po.status = ?' : ''}
                           ORDER BY po.created_at DESC`).all(...(status ? [req.businessId, status] : [req.businessId]));
  res.json({ data: rows });
}

export function getPurchaseOrderById(req: AuthenticatedRequest, res: Response): void {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
  if (!po) throw new HttpError(404, 'NOT_FOUND', 'Purchase order not found');
  res.json({ order: po, items: db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(req.params.id) });
}

export function createPurchaseOrder(req: AuthenticatedRequest, res: Response): void {
  const input = parse(poSchema, req.body);
  const { items, subtotal, tax, total } = computeLines(input.items);
  const id = crypto.randomUUID();
  db.transaction(() => {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM purchase_orders WHERE business_id = ?').get(req.businessId) as any).c;
    let n = count + 1;
    while (db.prepare('SELECT 1 FROM purchase_orders WHERE business_id = ? AND po_number = ?').get(req.businessId, `PO-${1000 + n}`)) n++;
    db.prepare(`INSERT INTO purchase_orders (id, business_id, po_number, supplier_id, supplier_name, expected_date, subtotal_paise, tax_paise, total_paise, notes, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, req.businessId, `PO-${1000 + n}`, input.supplierId || null, input.supplierName, input.expectedDate || null, subtotal, tax, total,
        input.notes || '', req.user?.userId || null);
    const ins = db.prepare(`INSERT INTO purchase_order_items (id, business_id, purchase_order_id, product_id, product_name, quantity, unit_price_paise, tax_rate, tax_paise, total_paise)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const it of items) ins.run(it.id, req.businessId, id, it.productId || null, it.productName, it.quantity, it.unitPricePaise, it.taxRate, it.taxPaise, it.totalPaise);
  })();
  res.status(201).json({ message: 'Purchase order created', order: db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) });
}

/** Convert an open purchase order into a received purchase bill (stock in, payable updated). */
export function receivePurchaseOrder(req: AuthenticatedRequest, res: Response): void {
  const body = parse(z.object({
    purchaseNumber: z.string().trim().min(1).max(64),
    invoiceDate: z.string().regex(DATE_RE).optional(),
    amountPaidPaise: z.coerce.number().int().nonnegative().default(0),
    paymentMode: z.enum(PAYMENT_MODES).default('CASH'),
  }), req.body);
  const result = db.transaction(() => {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId) as any;
    if (!po) throw new HttpError(404, 'NOT_FOUND', 'Purchase order not found');
    if (po.status !== 'OPEN') throw new HttpError(409, 'PO_NOT_OPEN', `Purchase order is ${po.status.toLowerCase()}`);
    const items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(po.id) as any[];
    const r = recordPurchase(req.businessId!, req.user?.userId || null, {
      supplierId: po.supplier_id, supplierName: po.supplier_name, purchaseNumber: body.purchaseNumber, invoiceDate: body.invoiceDate,
      amountPaidPaise: body.amountPaidPaise, paymentMode: body.paymentMode, notes: `Received against ${po.po_number}`, purchaseOrderId: po.id,
      items: items.map((i) => ({ productId: i.product_id, productName: i.product_name, quantity: i.quantity, unitPricePaise: i.unit_price_paise, taxRate: i.tax_rate })),
    });
    db.prepare("UPDATE purchase_orders SET status = 'RECEIVED', received_purchase_id = ?, updated_at = datetime('now') WHERE id = ?").run(r.id, po.id);
    return r;
  })();
  res.status(201).json({ message: 'Goods received and purchase recorded', purchaseId: result.id });
}

export function cancelPurchaseOrder(req: AuthenticatedRequest, res: Response): void {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId) as any;
  if (!po) throw new HttpError(404, 'NOT_FOUND', 'Purchase order not found');
  if (po.status !== 'OPEN') throw new HttpError(409, 'PO_NOT_OPEN', 'Only open purchase orders can be cancelled');
  db.prepare("UPDATE purchase_orders SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?").run(po.id);
  res.json({ message: 'Purchase order cancelled' });
}
