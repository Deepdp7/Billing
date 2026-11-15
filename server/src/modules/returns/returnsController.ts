import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { z } from 'zod';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { parse, HttpError } from '../../lib/http.js';
import { DATE_RE, localDate } from '../../lib/dates.js';
import { nextDocumentNumber } from '../../lib/numbering.js';
import { logAudit } from '../../services/auditService.js';
import { applyCustomerAdvance } from '../../services/invoiceService.js';

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

const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const returnItemSchema = z.object({
  productId: z.string().max(64).optional().nullable(),
  productName: z.string().trim().min(1, 'Item name is required').max(200),
  sku: optText(64),
  quantity: z.coerce.number().positive('Return quantity must be greater than zero').max(1_000_000),
  unitPricePaise: z.coerce.number().int().nonnegative().default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});
const CASH_REFUND_MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'] as const;

const salesReturnSchema = z.object({
  invoiceId: z.string().max(64).optional().nullable(),
  invoiceNumber: optText(64),
  customerId: z.string().max(64).optional().nullable(),
  customerName: optText(150),
  customerPhone: optText(20),
  items: z.array(returnItemSchema).min(1, 'At least one return item is required').max(500),
  refundMode: z.enum([...CASH_REFUND_MODES, 'STORE_CREDIT', 'ADJUST_BALANCE']).default('CASH'),
  reason: optText(100),
  notes: optText(1000),
  returnDate: z.string().regex(DATE_RE, 'Date must be YYYY-MM-DD').optional().nullable(),
});

const purchaseReturnSchema = z.object({
  purchaseId: z.string().max(64).optional().nullable(),
  purchaseNumber: optText(64),
  supplierId: z.string().max(64).optional().nullable(),
  supplierName: z.string().trim().min(1, 'Supplier name is required').max(150),
  supplierPhone: optText(20),
  items: z.array(returnItemSchema).min(1, 'At least one return item is required').max(500),
  refundMode: z.enum(['ADJUST_PAYABLE', ...CASH_REFUND_MODES]).default('ADJUST_PAYABLE'),
  reason: optText(100),
  notes: optText(1000),
  returnDate: z.string().regex(DATE_RE, 'Date must be YYYY-MM-DD').optional().nullable(),
});

interface ReturnLine {
  productId: string | null; productName: string; sku: string; quantity: number;
  unitPricePaise: number; taxRate: number; subtotalPaise: number; taxPaise: number; totalPaise: number; restock: boolean;
}

/** Lines typed by hand (no bill to return against): priced as entered, tax added on top. */
function manualLines(businessId: string, items: z.infer<typeof returnItemSchema>[]): ReturnLine[] {
  return items.map((it) => {
    const product = it.productId
      ? db.prepare('SELECT id, track_stock FROM products WHERE id = ? AND business_id = ?').get(it.productId, businessId) as any
      : null;
    const subtotal = Math.round(it.quantity * it.unitPricePaise);
    const tax = Math.round((subtotal * it.taxRate) / 100);
    return {
      productId: product?.id ?? null, productName: it.productName, sku: it.sku || '', quantity: it.quantity,
      unitPricePaise: it.unitPricePaise, taxRate: it.taxRate, subtotalPaise: subtotal, taxPaise: tax, totalPaise: subtotal + tax,
      restock: product?.track_stock === 1,
    };
  });
}

/**
 * Lines returned against a bill: each one is matched to the bill's line and valued at what was actually charged for it
 * (after discounts, with tax-inclusive prices split correctly), and never more than is left to return.
 */
function linesFromBill(
  businessId: string, items: z.infer<typeof returnItemSchema>[],
  billLines: Array<{ id: string; product_id: string | null; product_name: string; sku?: string; quantity: number; taxable: number; tax: number; tax_rate: number; returned: number }>,
): ReturnLine[] {
  const left = new Map(billLines.map((l) => [l.id, l.quantity - l.returned]));
  return items.map((it) => {
    const candidates = billLines.filter((l) => (it.productId && l.product_id === it.productId) || (!it.productId && l.product_name === it.productName));
    const line = candidates.find((l) => (left.get(l.id) || 0) >= it.quantity - 1e-9) || candidates[0];
    if (!line) throw new HttpError(400, 'NOT_ON_BILL', `${it.productName} is not on this bill`);
    const remaining = left.get(line.id) || 0;
    if (it.quantity > remaining + 1e-9) {
      throw new HttpError(400, 'RETURN_TOO_MANY', `Only ${Number(remaining.toFixed(3))} of ${line.product_name} can still be returned`);
    }
    left.set(line.id, remaining - it.quantity);
    const share = it.quantity / line.quantity;
    const subtotal = Math.round(line.taxable * share);
    const tax = Math.round(line.tax * share);
    const product = line.product_id
      ? db.prepare('SELECT id, track_stock FROM products WHERE id = ? AND business_id = ?').get(line.product_id, businessId) as any
      : null;
    return {
      productId: product?.id ?? null, productName: line.product_name, sku: line.sku || it.sku || '', quantity: it.quantity,
      unitPricePaise: Math.round(line.taxable / line.quantity), taxRate: line.tax_rate, subtotalPaise: subtotal, taxPaise: tax,
      totalPaise: subtotal + tax, restock: product?.track_stock === 1,
    };
  });
}

export function createSalesReturn(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const userId = req.user?.userId || null;
  const input = parse(salesReturnSchema, req.body);
  const dateStr = input.returnDate || localDate();

  const result = db.transaction(() => {
    let invoice: any = null;
    let lines: ReturnLine[];
    if (input.invoiceId) {
      invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?').get(input.invoiceId, businessId);
      if (!invoice) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Bill not found');
      if (invoice.status !== 'ISSUED') throw new HttpError(409, 'NOT_RETURNABLE', 'Only issued bills can be returned (this one is cancelled or a draft)');
      const billLines = (db.prepare(`
        SELECT ii.id, ii.product_id, ii.product_name, ii.sku, ii.quantity, ii.tax_rate, ii.tax_paise AS tax,
               CASE WHEN ii.taxable_paise > 0 THEN ii.taxable_paise ELSE ii.total_paise - ii.tax_paise END AS taxable,
               COALESCE((SELECT SUM(cni.quantity) FROM credit_note_items cni JOIN credit_notes cn ON cn.id = cni.credit_note_id
                         WHERE cn.invoice_id = ii.invoice_id AND cn.business_id = ii.business_id
                           AND (cni.product_id = ii.product_id OR (cni.product_id IS NULL AND cni.product_name = ii.product_name))), 0) AS returned
        FROM invoice_items ii WHERE ii.invoice_id = ? ORDER BY ii.rowid`).all(invoice.id)) as any[];
      lines = linesFromBill(businessId, input.items, billLines);
    } else {
      lines = manualLines(businessId, input.items);
    }

    const customerId = invoice ? invoice.customer_id : input.customerId || null;
    if (customerId && !db.prepare('SELECT 1 FROM customers WHERE id = ? AND business_id = ?').get(customerId, businessId)) {
      throw new HttpError(400, 'CUSTOMER_NOT_FOUND', 'Selected customer does not exist');
    }
    const keepAsCredit = input.refundMode === 'STORE_CREDIT' || input.refundMode === 'ADJUST_BALANCE';
    if (keepAsCredit && !customerId) {
      throw new HttpError(400, 'CUSTOMER_REQUIRED', 'Store credit needs a saved customer. For a walk-in bill, give the refund in cash, UPI or card.');
    }

    const subtotal = lines.reduce((a, l) => a + l.subtotalPaise, 0);
    const tax = lines.reduce((a, l) => a + l.taxPaise, 0);
    const total = subtotal + tax;
    const number = nextDocumentNumber('credit_notes', 'credit_note_number', businessId, 'CN-', 1001);
    const id = uuidv4();
    db.prepare(`
      INSERT INTO credit_notes (id, business_id, credit_note_number, invoice_id, invoice_number, customer_id, customer_name, customer_phone,
                                return_date, subtotal_paise, tax_paise, total_refund_paise, refund_mode, reason, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, businessId, number, invoice?.id ?? null, invoice?.invoice_number ?? (input.invoiceNumber || 'MANUAL'), customerId,
      invoice?.customer_name ?? (input.customerName || 'Walk-in Customer'), invoice?.customer_phone ?? (input.customerPhone || ''),
      dateStr, subtotal, tax, total, input.refundMode, input.reason || 'CUSTOMER_CHANGE_MIND', input.notes || '', userId);

    const insertItem = db.prepare(`INSERT INTO credit_note_items (id, business_id, credit_note_id, product_id, product_name, sku, quantity,
                                     unit_price_paise, tax_rate, tax_paise, total_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const l of lines) {
      insertItem.run(uuidv4(), businessId, id, l.productId, l.productName, l.sku, l.quantity, l.unitPricePaise, l.taxRate, l.taxPaise, l.totalPaise);
      if (!l.restock || !l.productId) continue;
      db.prepare("UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = datetime('now') WHERE id = ? AND business_id = ?")
        .run(l.quantity, l.productId, businessId);
      db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at)
                  VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'RETURN', ?, ?, datetime('now'))`)
        .run(uuidv4(), businessId, l.productId, l.quantity, l.productId, id, `Sales return ${number}${invoice ? ` (bill ${invoice.invoice_number})` : ''}`);
    }

    // What the bill still owes is settled first; only the rest is given back (or kept as the customer's credit)
    let settled = 0;
    if (invoice) {
      settled = Math.min(total, Math.max(0, invoice.total_paise - invoice.amount_paid_paise));
      if (settled > 0) {
        const paid = invoice.amount_paid_paise + settled;
        db.prepare("UPDATE invoices SET amount_paid_paise = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?")
          .run(paid, paid >= invoice.total_paise ? 'PAID' : 'PARTIAL', invoice.id);
      }
    }
    const rest = total - settled;
    const lowerBalance = settled + (keepAsCredit ? rest : 0);
    if (customerId && lowerBalance > 0) {
      db.prepare("UPDATE customers SET outstanding_balance_paise = outstanding_balance_paise - ?, updated_at = datetime('now') WHERE id = ? AND business_id = ?")
        .run(lowerBalance, customerId, businessId);
    }
    if (!keepAsCredit && rest > 0) {
      db.prepare(`INSERT INTO payments (id, business_id, invoice_id, customer_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_by, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OUT', ?, 'ACTIVE', ?, datetime('now'))`)
        .run(uuidv4(), businessId, invoice?.id ?? null, customerId, rest, input.refundMode, number, `Refund for sales return ${number}`, dateStr, userId);
    }
    if (keepAsCredit) applyCustomerAdvance(businessId, customerId);
    return { id, number, total, settled, refunded: keepAsCredit ? 0 : rest };
  })();

  logAudit({ businessId, userId, action: 'CREATE_SALES_RETURN', entityType: 'CREDIT_NOTE', entityId: result.id,
    details: { creditNoteNumber: result.number, invoiceNumber: input.invoiceNumber, totalRefundPaise: result.total, refundMode: input.refundMode,
      settledOnBillPaise: result.settled, refundedPaise: result.refunded } });
  const parts = [`Sales return ${result.number} saved and stock updated`];
  if (result.settled > 0) parts.push(`₹${(result.settled / 100).toFixed(2)} taken off what the bill still owed`);
  if (result.refunded > 0) parts.push(`refund ₹${(result.refunded / 100).toFixed(2)} by ${input.refundMode.replace('_', ' ')}`);
  res.status(201).json({ message: parts.join('; '), data: db.prepare('SELECT * FROM credit_notes WHERE id = ?').get(result.id) });
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
  const businessId = req.businessId!;
  const userId = req.user?.userId || null;
  const input = parse(purchaseReturnSchema, req.body);
  const dateStr = input.returnDate || localDate();

  const result = db.transaction(() => {
    let purchase: any = null;
    let lines: ReturnLine[];
    if (input.purchaseId) {
      purchase = db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND business_id = ?').get(input.purchaseId, businessId);
      if (!purchase) throw new HttpError(404, 'PURCHASE_NOT_FOUND', 'Purchase bill not found');
      const billLines = (db.prepare(`
        SELECT pi.id, pi.product_id, pi.product_name, pi.quantity, pi.tax_rate, pi.tax_paise AS tax, pi.total_paise - pi.tax_paise AS taxable,
               COALESCE((SELECT SUM(dni.quantity) FROM debit_note_items dni JOIN debit_notes dn ON dn.id = dni.debit_note_id
                         WHERE dn.purchase_id = pi.purchase_id AND dn.business_id = pi.business_id
                           AND (dni.product_id = pi.product_id OR (dni.product_id IS NULL AND dni.product_name = pi.product_name))), 0) AS returned
        FROM purchase_items pi WHERE pi.purchase_id = ? ORDER BY pi.rowid`).all(purchase.id)) as any[];
      lines = linesFromBill(businessId, input.items, billLines);
    } else {
      lines = manualLines(businessId, input.items);
    }

    const supplierId = purchase ? purchase.supplier_id : input.supplierId || null;
    if (supplierId && !db.prepare('SELECT 1 FROM suppliers WHERE id = ? AND business_id = ?').get(supplierId, businessId)) {
      throw new HttpError(400, 'SUPPLIER_NOT_FOUND', 'Selected supplier does not exist');
    }
    const adjust = input.refundMode === 'ADJUST_PAYABLE';
    const subtotal = lines.reduce((a, l) => a + l.subtotalPaise, 0);
    const tax = lines.reduce((a, l) => a + l.taxPaise, 0);
    const total = subtotal + tax;
    // What the bill still owes the supplier is reduced first; the rest is money the supplier gives back (or owes us)
    const settled = purchase ? Math.min(total, Math.max(0, purchase.total_paise - purchase.amount_paid_paise)) : 0;
    const rest = total - settled;
    if (adjust && rest > 0 && !supplierId) {
      throw new HttpError(400, 'SUPPLIER_REQUIRED', 'To adjust the payable, pick a saved supplier, or record the money as received back');
    }

    const number = nextDocumentNumber('debit_notes', 'debit_note_number', businessId, 'DN-', 1001);
    const id = uuidv4();
    db.prepare(`
      INSERT INTO debit_notes (id, business_id, debit_note_number, purchase_id, purchase_number, supplier_id, supplier_name, supplier_phone,
                               return_date, subtotal_paise, tax_paise, total_paise, refund_mode, reason, notes, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, businessId, number, purchase?.id ?? null, purchase?.purchase_number ?? (input.purchaseNumber || 'MANUAL'), supplierId,
      purchase?.supplier_name ?? input.supplierName, input.supplierPhone || '', dateStr, subtotal, tax, total, input.refundMode,
      input.reason || 'DAMAGED_GOODS', input.notes || '', userId);

    const insertItem = db.prepare(`INSERT INTO debit_note_items (id, business_id, debit_note_id, product_id, product_name, quantity,
                                     unit_price_paise, tax_rate, tax_paise, total_paise) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const l of lines) {
      insertItem.run(uuidv4(), businessId, id, l.productId, l.productName, l.quantity, l.unitPricePaise, l.taxRate, l.taxPaise, l.totalPaise);
      if (!l.restock || !l.productId) continue;
      db.prepare("UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = datetime('now') WHERE id = ? AND business_id = ?")
        .run(l.quantity, l.productId, businessId);
      db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at)
                  VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'PURCHASE_RETURN', ?, ?, datetime('now'))`)
        .run(uuidv4(), businessId, l.productId, -l.quantity, l.productId, id,
          `Purchase return ${number} to ${purchase?.supplier_name ?? input.supplierName}${purchase ? ` (bill ${purchase.purchase_number})` : ''}`);
    }

    if (settled > 0) {
      const paid = purchase.amount_paid_paise + settled;
      db.prepare('UPDATE purchase_invoices SET amount_paid_paise = ?, payment_status = ? WHERE id = ?')
        .run(paid, paid >= purchase.total_paise ? 'PAID' : 'PARTIAL', purchase.id);
    }
    const lowerPayable = settled + (adjust ? rest : 0);
    if (supplierId && lowerPayable > 0) {
      db.prepare("UPDATE suppliers SET outstanding_balance_paise = outstanding_balance_paise - ?, updated_at = datetime('now') WHERE id = ? AND business_id = ?")
        .run(lowerPayable, supplierId, businessId);
    }
    if (!adjust && rest > 0) {
      db.prepare(`INSERT INTO payments (id, business_id, supplier_id, purchase_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_by, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN', ?, 'ACTIVE', ?, datetime('now'))`)
        .run(uuidv4(), businessId, supplierId, purchase?.id ?? null, rest, input.refundMode, number, `Money back for purchase return ${number}`, dateStr, userId);
    }
    return { id, number, total, settled, received: adjust ? 0 : rest };
  })();

  logAudit({ businessId, userId, action: 'CREATE_PURCHASE_RETURN', entityType: 'DEBIT_NOTE', entityId: result.id,
    details: { debitNoteNumber: result.number, purchaseNumber: input.purchaseNumber, totalPaise: result.total, refundMode: input.refundMode,
      settledOnBillPaise: result.settled, receivedPaise: result.received } });
  const parts = [`Purchase return ${result.number} saved and stock updated`];
  if (result.settled > 0) parts.push(`₹${(result.settled / 100).toFixed(2)} taken off what you owed on the bill`);
  if (result.received > 0) parts.push(`₹${(result.received / 100).toFixed(2)} to receive back by ${input.refundMode.replace('_', ' ')}`);
  res.status(201).json({ message: parts.join('; '), data: db.prepare('SELECT * FROM debit_notes WHERE id = ?').get(result.id) });
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
