import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../db/connection.js';
import { HttpError, parse } from '../lib/http.js';
import { DATE_RE, localDate, addDays } from '../lib/dates.js';
import { calculateInvoice, CalculationError } from './invoiceCalculator.js';
import { getBusinessSettings } from './settingsService.js';
import { logAudit } from './auditService.js';

export const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'WALLET'] as const;
export type PaymentMode = typeof PAYMENT_MODES[number];

const money = z.coerce.number().int('Amount must be in whole paise').nonnegative();
const optText = (max: number) => z.string().trim().max(max).optional().nullable();

export const invoiceItemSchema = z.object({
  productId: z.string().max(64).optional().nullable(),
  productName: optText(200),
  sku: optText(64),
  hsnCode: optText(16),
  unit: optText(20),
  quantity: z.coerce.number().positive('Quantity must be greater than zero').max(1_000_000),
  unitPricePaise: money,
  discountPaise: money.optional().default(0),
  taxRate: z.coerce.number().min(0).max(100).optional(),
});

export const paymentLineSchema = z.object({
  mode: z.enum(PAYMENT_MODES),
  amountPaise: z.coerce.number().int().positive('Payment amount must be greater than zero'),
  reference: optText(100),
});

export const createInvoiceSchema = z.object({
  status: z.enum(['ISSUED', 'DRAFT']).default('ISSUED'),
  clientRequestId: z.string().trim().min(8).max(100).optional(),
  invoiceDate: z.string().regex(DATE_RE, 'Date must be YYYY-MM-DD').optional(),
  dueDate: z.string().regex(DATE_RE).optional().nullable(),
  customerId: z.string().max(64).optional().nullable(),
  customerName: optText(150),
  customerPhone: optText(20),
  customerGstin: optText(15),
  billingAddress: optText(500),
  shippingAddress: optText(500),
  items: z.array(invoiceItemSchema).min(1, 'Invoice must contain at least one item').max(500),
  billDiscountPaise: money.optional().default(0),
  pricesIncludeTax: z.boolean().optional(),
  isInterState: z.boolean().optional(),
  roundOff: z.boolean().optional(),
  paymentMode: z.enum([...PAYMENT_MODES, 'CREDIT', 'SPLIT'] as [string, ...string[]]).optional(),
  amountPaidPaise: money.optional(),
  payments: z.array(paymentLineSchema).max(10).optional(),
  redeemPoints: z.coerce.number().int().nonnegative().optional().default(0),
  notes: optText(1000),
  sourceInvoiceId: z.string().max(64).optional().nullable(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

function gstStateCode(gstin?: string | null): string | null {
  return gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
}

function normState(s?: string | null) {
  return (s || '').trim().toLowerCase();
}

function resolvePayments(input: CreateInvoiceInput, totalPaise: number) {
  let lines: Array<{ mode: PaymentMode; amountPaise: number; reference?: string | null }>;
  if (input.payments && input.payments.length > 0) {
    lines = input.payments;
  } else {
    const mode = input.paymentMode || 'CASH';
    if (mode === 'SPLIT') throw new HttpError(400, 'PAYMENTS_REQUIRED', 'Split payment requires the individual payment lines');
    if (mode === 'CREDIT') {
      const advance = input.amountPaidPaise ?? 0;
      lines = advance > 0 ? [{ mode: 'CASH', amountPaise: advance }] : [];
    } else {
      const amount = input.amountPaidPaise ?? totalPaise;
      lines = amount > 0 ? [{ mode: mode as PaymentMode, amountPaise: amount }] : [];
    }
  }
  const paid = lines.reduce((a, l) => a + l.amountPaise, 0);
  if (paid > totalPaise) {
    throw new HttpError(400, 'OVERPAYMENT', 'Payments exceed the invoice total. Record only the amount applied to this bill (give change separately).');
  }
  const modes = new Set(lines.map((l) => l.mode));
  const headerMode = modes.size === 0 ? 'CREDIT' : modes.size === 1 ? [...modes][0] : 'SPLIT';
  const status = paid >= totalPaise ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
  return { lines, paid, headerMode, status };
}

/**
 * Resolve products/customer and compute all amounts. Runs inside the caller's transaction so
 * reads and writes see the same snapshot.
 */
function prepare(businessId: string, input: CreateInvoiceInput) {
  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId) as any;
  if (!business) throw new HttpError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  const settings = getBusinessSettings(businessId);

  let customer: any = null;
  if (input.customerId) {
    customer = db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(input.customerId, businessId);
    if (!customer) throw new HttpError(400, 'CUSTOMER_NOT_FOUND', 'Selected customer does not exist');
  }

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?');
  const lines = input.items.map((item, i) => {
    let product: any = null;
    if (item.productId) {
      product = getProduct.get(item.productId, businessId);
      if (!product) throw new HttpError(400, 'PRODUCT_NOT_FOUND', `Line ${i + 1}: product no longer exists`);
    } else if (!item.productName) {
      throw new HttpError(400, 'VALIDATION_ERROR', `Line ${i + 1}: product name is required for custom items`);
    }
    return {
      productId: product?.id ?? null,
      productName: product?.name ?? item.productName!,
      sku: item.sku ?? product?.sku ?? '',
      hsnCode: item.hsnCode ?? product?.hsn_code ?? '',
      unit: item.unit ?? product?.unit ?? 'pcs',
      quantity: item.quantity,
      unitPricePaise: item.unitPricePaise,
      discountPaise: item.discountPaise ?? 0,
      taxRate: item.taxRate ?? product?.tax_rate ?? 0,
      costPricePaise: product?.purchase_price_paise ?? 0,
      mrpPaise: product?.mrp_paise ?? 0,
      trackStock: product ? product.track_stock === 1 : false,
    };
  });

  // Loyalty redemption is applied as an additional bill-level discount.
  let loyaltyRule: any = null;
  let redeemDiscountPaise = 0;
  if (input.redeemPoints > 0) {
    if (!customer) throw new HttpError(400, 'CUSTOMER_REQUIRED', 'Select a customer to redeem loyalty points');
    loyaltyRule = db.prepare('SELECT * FROM loyalty_rules WHERE business_id = ? AND is_active = 1').get(businessId);
    if (!loyaltyRule) throw new HttpError(400, 'LOYALTY_DISABLED', 'Loyalty programme is not active');
    if (input.redeemPoints < loyaltyRule.min_redeem_points) {
      throw new HttpError(400, 'LOYALTY_MIN_REDEEM', `Minimum ${loyaltyRule.min_redeem_points} points required to redeem`);
    }
    if (input.redeemPoints > (customer.loyalty_points || 0)) {
      throw new HttpError(400, 'LOYALTY_INSUFFICIENT', `Customer has only ${customer.loyalty_points || 0} points`);
    }
    redeemDiscountPaise = input.redeemPoints * loyaltyRule.point_value_paise;
  }

  const isInterState = input.isInterState ?? (() => {
    if (!customer) return false;
    const bizCode = gstStateCode(business.gstin);
    const custCode = gstStateCode(customer.gstin);
    if (bizCode && custCode) return bizCode !== custCode;
    if (customer.state && business.state) return normState(customer.state) !== normState(business.state);
    return false;
  })();

  const pricesIncludeTax = input.pricesIncludeTax ?? settings.pricesIncludeTaxDefault;
  const roundOff = input.roundOff ?? settings.roundOffEnabled;

  let calc;
  try {
    calc = calculateInvoice(lines, {
      billDiscountPaise: input.billDiscountPaise + redeemDiscountPaise,
      pricesIncludeTax,
      isInterState,
      roundOff,
    });
  } catch (err) {
    if (err instanceof CalculationError) throw new HttpError(400, 'INVALID_INVOICE', err.message);
    throw err;
  }

  return { business, settings, customer, lines, calc, isInterState, pricesIncludeTax, redeemDiscountPaise, loyaltyRule };
}

function nextInvoiceNumber(businessId: string): string {
  const exists = db.prepare('SELECT 1 FROM invoices WHERE business_id = ? AND invoice_number = ?');
  const bump = db.prepare("UPDATE businesses SET next_invoice_number = next_invoice_number + 1, updated_at = datetime('now') WHERE id = ?");
  // Skip numbers already used (e.g. after the prefix was changed back), never reuse one.
  for (let guard = 0; guard < 10000; guard++) {
    const b = db.prepare('SELECT invoice_prefix, next_invoice_number FROM businesses WHERE id = ?').get(businessId) as any;
    const candidate = `${b.invoice_prefix}${b.next_invoice_number}`;
    bump.run(businessId);
    if (!exists.get(businessId, candidate)) return candidate;
  }
  throw new HttpError(500, 'NUMBERING_FAILED', 'Could not allocate an invoice number');
}

function createInternal(businessId: string, userId: string | null, input: CreateInvoiceInput, fixedId?: string) {
  const p = prepare(businessId, input);
  const id = fixedId || crypto.randomUUID();
  const isDraft = input.status === 'DRAFT';
  const invoiceDate = input.invoiceDate || localDate();

  let pay = { lines: [] as Array<{ mode: PaymentMode; amountPaise: number; reference?: string | null }>, paid: 0, headerMode: 'CREDIT', status: 'UNPAID' };
  let invoiceNumber: string;
  let dueDate = input.dueDate || null;

  if (isDraft) {
    invoiceNumber = `DRAFT-${id.slice(0, 8).toUpperCase()}`;
  } else {
    pay = resolvePayments(input, p.calc.totalPaise);
    const balanceDue = p.calc.totalPaise - pay.paid;

    if (balanceDue > 0 && !p.customer) {
      throw new HttpError(400, 'CUSTOMER_REQUIRED_FOR_CREDIT', 'Select or create a customer for credit or partially paid bills');
    }
    if (balanceDue > 0 && p.settings.enforceCreditLimit && p.customer.credit_limit_paise > 0) {
      const exposure = p.customer.outstanding_balance_paise + balanceDue;
      if (exposure > p.customer.credit_limit_paise) {
        throw new HttpError(409, 'CREDIT_LIMIT_EXCEEDED',
          `Credit limit exceeded: limit ₹${(p.customer.credit_limit_paise / 100).toFixed(2)}, would owe ₹${(exposure / 100).toFixed(2)}`);
      }
    }
    if (balanceDue > 0 && !dueDate) {
      dueDate = addDays(invoiceDate, p.customer?.credit_days ?? p.settings.defaultCreditDays);
    }

    if (!p.settings.allowNegativeStock) {
      const needed = new Map<string, { name: string; qty: number }>();
      for (const l of p.lines) {
        if (!l.productId || !l.trackStock) continue;
        const cur = needed.get(l.productId) || { name: l.productName, qty: 0 };
        cur.qty += l.quantity;
        needed.set(l.productId, cur);
      }
      const short: Array<{ productId: string; name: string; available: number; requested: number }> = [];
      for (const [productId, n] of needed) {
        const row = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId) as any;
        if (row.stock_quantity + 1e-9 < n.qty) short.push({ productId, name: n.name, available: row.stock_quantity, requested: n.qty });
      }
      if (short.length > 0) {
        throw new HttpError(409, 'INSUFFICIENT_STOCK',
          `Insufficient stock: ${short.map((s) => `${s.name} (available ${s.available}, requested ${s.requested})`).join('; ')}`, short);
      }
    }
    invoiceNumber = nextInvoiceNumber(businessId);
  }

  const c = p.calc;
  db.prepare(`
    INSERT INTO invoices (
      id, business_id, invoice_number, customer_id, customer_name, customer_phone, customer_gstin,
      billing_address, shipping_address, invoice_date, due_date,
      subtotal_paise, discount_paise, tax_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise,
      is_inter_state, place_of_supply, prices_include_tax,
      payment_mode, payment_status, amount_paid_paise, notes, created_by, status,
      client_request_id, source_invoice_id, draft_payload_json, loyalty_points_redeemed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    id, businessId, invoiceNumber, p.customer?.id ?? null,
    input.customerName || p.customer?.name || 'Walk-in Customer',
    input.customerPhone ?? p.customer?.phone ?? '',
    input.customerGstin ?? p.customer?.gstin ?? '',
    input.billingAddress ?? p.customer?.billing_address ?? p.customer?.address ?? null,
    input.shippingAddress ?? p.customer?.shipping_address ?? null,
    invoiceDate, dueDate,
    c.subtotalPaise, c.discountPaise, c.taxPaise, c.cgstPaise, c.sgstPaise, c.igstPaise, c.roundOffPaise, c.totalPaise,
    p.isInterState ? 1 : 0, p.customer?.state || p.business.state || null, p.pricesIncludeTax ? 1 : 0,
    isDraft ? (input.paymentMode || 'CASH') : pay.headerMode, isDraft ? 'UNPAID' : pay.status, pay.paid,
    input.notes ?? '', userId, isDraft ? 'DRAFT' : 'ISSUED',
    input.clientRequestId ?? null, input.sourceInvoiceId ?? null,
    isDraft ? JSON.stringify(input) : null,
    isDraft ? 0 : input.redeemPoints
  );

  const insertItem = db.prepare(`
    INSERT INTO invoice_items (
      id, business_id, invoice_id, product_id, product_name, sku, hsn_code, unit, quantity, unit_price_paise,
      discount_paise, tax_rate, taxable_paise, tax_paise, cgst_paise, sgst_paise, igst_paise, total_paise,
      cost_price_paise, mrp_paise
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  p.lines.forEach((l, i) => {
    const cl = c.lines[i];
    insertItem.run(crypto.randomUUID(), businessId, id, l.productId, l.productName, l.sku, l.hsnCode, l.unit,
      l.quantity, l.unitPricePaise, cl.discountPaise, l.taxRate, cl.taxablePaise, cl.taxPaise,
      cl.cgstPaise, cl.sgstPaise, cl.igstPaise, cl.totalPaise, l.costPricePaise, l.mrpPaise);
  });

  if (isDraft) return id;

  // ---- Effects of issuing: stock, payments, receivables, loyalty ----
  const deduct = db.prepare("UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = datetime('now') WHERE id = ? AND business_id = ?");
  const movement = db.prepare(`
    INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at)
    VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'INVOICE', ?, ?, datetime('now'))
  `);
  for (const l of p.lines) {
    if (!l.productId || !l.trackStock) continue;
    deduct.run(l.quantity, l.productId, businessId);
    movement.run(crypto.randomUUID(), businessId, l.productId, -l.quantity, l.productId, id, `Sale Invoice ${invoiceNumber}`);
  }

  const insertPayment = db.prepare(`
    INSERT INTO payments (id, business_id, invoice_id, customer_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN', ?, 'ACTIVE', ?, datetime('now'))
  `);
  for (const pl of pay.lines) {
    insertPayment.run(crypto.randomUUID(), businessId, id, p.customer?.id ?? null, pl.amountPaise, pl.mode,
      pl.reference || invoiceNumber, `Payment for ${invoiceNumber}`, invoiceDate, userId);
  }

  const balanceDue = c.totalPaise - pay.paid;
  if (p.customer && balanceDue > 0) {
    db.prepare("UPDATE customers SET outstanding_balance_paise = outstanding_balance_paise + ?, updated_at = datetime('now') WHERE id = ?")
      .run(balanceDue, p.customer.id);
  }

  if (p.customer) {
    const rule = p.loyaltyRule || db.prepare('SELECT * FROM loyalty_rules WHERE business_id = ? AND is_active = 1').get(businessId);
    const addLoyalty = (type: string, points: number, note: string) => {
      db.prepare('UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + ? WHERE id = ?').run(points, p.customer.id);
      const bal = (db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(p.customer.id) as any).loyalty_points;
      db.prepare(`INSERT INTO loyalty_transactions (id, business_id, customer_id, transaction_type, points, balance_after, invoice_id, notes)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(crypto.randomUUID(), businessId, p.customer.id, type, points, bal, id, note);
    };
    if (input.redeemPoints > 0) addLoyalty('REDEEMED', -input.redeemPoints, `Redeemed on ${invoiceNumber}`);
    if (rule && rule.earn_points_per_rupees > 0) {
      const earned = Math.floor(c.totalPaise / 100 / rule.earn_points_per_rupees);
      if (earned > 0) {
        addLoyalty('EARNED', earned, `Earned on ${invoiceNumber}`);
        db.prepare('UPDATE invoices SET loyalty_points_earned = ? WHERE id = ?').run(earned, id);
      }
    }
  }

  return id;
}

export function getInvoiceFull(businessId: string, id: string) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?').get(id, businessId) as any;
  if (!invoice) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found');
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY rowid').all(id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? AND business_id = ? ORDER BY created_at').all(id, businessId);
  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
  const settings = getBusinessSettings(businessId);
  const { draft_payload_json, ...rest } = invoice;
  return {
    ...rest,
    draft: draft_payload_json ? JSON.parse(draft_payload_json) : undefined,
    balance_due_paise: invoice.status === 'ISSUED' ? invoice.total_paise - invoice.amount_paid_paise : 0,
    items,
    payments,
    business,
    terms: settings.invoiceTerms,
    footer: settings.invoiceFooter,
  };
}

export function createInvoice(businessId: string, userId: string | null, body: unknown) {
  const input = parse(createInvoiceSchema, body);

  if (input.clientRequestId) {
    const existing = db.prepare('SELECT id FROM invoices WHERE business_id = ? AND client_request_id = ?').get(businessId, input.clientRequestId) as any;
    if (existing) return { invoice: getInvoiceFull(businessId, existing.id), duplicate: true };
  }

  const id = db.transaction(() => createInternal(businessId, userId, input))();
  const invoice = getInvoiceFull(businessId, id);
  if (input.status === 'ISSUED') {
    logAudit({ businessId, userId, action: 'INVOICE_CREATED', entityType: 'INVOICE', entityId: id,
      details: { number: invoice.invoice_number, totalPaise: invoice.total_paise, status: invoice.payment_status } });
  }
  return { invoice, duplicate: false };
}

function loadDraft(businessId: string, id: string) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?').get(id, businessId) as any;
  if (!inv) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found');
  if (inv.status !== 'DRAFT') throw new HttpError(409, 'NOT_A_DRAFT', 'Only draft invoices can be edited');
  return inv;
}

export function updateDraft(businessId: string, userId: string | null, id: string, body: unknown) {
  loadDraft(businessId, id);
  const input = parse(createInvoiceSchema, { ...(body as object), status: 'DRAFT' });
  db.transaction(() => {
    db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
    createInternal(businessId, userId, input, id);
  })();
  return getInvoiceFull(businessId, id);
}

/** Issue a draft: the draft is replaced by a numbered invoice with full stock/payment effects. */
export function issueDraft(businessId: string, userId: string | null, id: string, body: unknown) {
  const draft = loadDraft(businessId, id);
  const saved = JSON.parse(draft.draft_payload_json || '{}');
  const overrides = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const input = parse(createInvoiceSchema, { ...saved, ...overrides, status: 'ISSUED', clientRequestId: undefined });
  const newId = db.transaction(() => {
    db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
    return createInternal(businessId, userId, input);
  })();
  const invoice = getInvoiceFull(businessId, newId);
  logAudit({ businessId, userId, action: 'INVOICE_CREATED', entityType: 'INVOICE', entityId: newId,
    details: { number: invoice.invoice_number, fromDraft: id, totalPaise: invoice.total_paise } });
  return invoice;
}

export function deleteDraft(businessId: string, userId: string | null, id: string) {
  loadDraft(businessId, id);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  logAudit({ businessId, userId, action: 'DRAFT_DELETED', entityType: 'INVOICE', entityId: id });
}

/** Permanently remove a cancelled invoice (or draft). Issued bills must be cancelled first so stock/payments reverse correctly. */
export function deleteInvoice(businessId: string, userId: string | null, id: string) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?').get(id, businessId) as any;
  if (!inv) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found');
  if (inv.status === 'ISSUED') {
    throw new HttpError(409, 'MUST_CANCEL_FIRST', 'Cancel the invoice first so stock and payments are reversed, then delete it from history.');
  }
  if (inv.status === 'DRAFT') {
    deleteDraft(businessId, userId, id);
    return;
  }
  db.prepare('DELETE FROM invoices WHERE id = ? AND business_id = ?').run(id, businessId);
  logAudit({ businessId, userId, action: 'INVOICE_DELETED', entityType: 'INVOICE', entityId: id,
    details: { number: inv.invoice_number, status: inv.status } });
}

/** Copy an invoice's lines and customer into a new draft. */
export function duplicateInvoice(businessId: string, userId: string | null, id: string) {
  const src = getInvoiceFull(businessId, id) as any;
  const payload = {
    status: 'DRAFT',
    customerId: src.customer_id,
    customerName: src.customer_name,
    customerPhone: src.customer_phone,
    customerGstin: src.customer_gstin,
    pricesIncludeTax: false,
    isInterState: !!src.is_inter_state,
    sourceInvoiceId: src.id,
    notes: `Duplicate of ${src.invoice_number}`,
    items: src.items.map((it: any) => ({
      productId: it.product_id && db.prepare('SELECT 1 FROM products WHERE id = ?').get(it.product_id) ? it.product_id : null,
      productName: it.product_name,
      sku: it.sku,
      hsnCode: it.hsn_code,
      unit: it.unit,
      quantity: it.quantity,
      unitPricePaise: it.unit_price_paise,
      discountPaise: 0,
      taxRate: it.tax_rate,
    })),
  };
  return createInvoice(businessId, userId, payload).invoice;
}

const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'Please give a cancellation reason').max(500),
  refundMode: z.enum([...PAYMENT_MODES, 'CUSTOMER_CREDIT'] as [string, ...string[]]).optional(),
});

export function cancelInvoice(businessId: string, userId: string | null, id: string, body: unknown) {
  const { reason, refundMode } = parse(cancelSchema, body ?? {});
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?').get(id, businessId) as any;
  if (!inv) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found');
  if (inv.status === 'CANCELLED') throw new HttpError(409, 'ALREADY_CANCELLED', 'Invoice is already cancelled');
  if (inv.status === 'DRAFT') throw new HttpError(409, 'IS_DRAFT', 'Drafts are deleted, not cancelled');
  const returns = db.prepare('SELECT COUNT(*) AS c FROM credit_notes WHERE invoice_id = ? AND business_id = ?').get(id, businessId) as any;
  if (returns.c > 0) throw new HttpError(409, 'HAS_RETURNS', 'This invoice has sales returns. Use a credit note instead of cancelling.');

  const mode = refundMode || (inv.payment_mode && PAYMENT_MODES.includes(inv.payment_mode) ? inv.payment_mode : 'CASH');
  if (inv.amount_paid_paise > 0 && mode === 'CUSTOMER_CREDIT' && !inv.customer_id) {
    throw new HttpError(400, 'CUSTOMER_REQUIRED', 'Walk-in invoices must be refunded, not kept as customer credit');
  }

  db.transaction(() => {
    db.prepare(`UPDATE invoices SET status = 'CANCELLED', cancelled_at = datetime('now'), cancel_reason = ?, cancelled_by = ?, updated_at = datetime('now')
                WHERE id = ?`).run(reason, userId, id);

    const items = db.prepare(`SELECT ii.*, p.track_stock FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id
                              WHERE ii.invoice_id = ?`).all(id) as any[];
    for (const it of items) {
      if (!it.product_id || it.track_stock !== 1) continue;
      db.prepare("UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = datetime('now') WHERE id = ?").run(it.quantity, it.product_id);
      db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at)
                  VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'CANCELLATION', ?, ?, datetime('now'))`)
        .run(crypto.randomUUID(), businessId, it.product_id, it.quantity, it.product_id, id, `Cancelled invoice ${inv.invoice_number}`);
    }

    if (inv.customer_id) {
      const unpaid = inv.total_paise - inv.amount_paid_paise;
      // Unpaid part is no longer owed; a paid part kept as customer credit becomes an advance (negative balance).
      const reduce = unpaid + (mode === 'CUSTOMER_CREDIT' ? inv.amount_paid_paise : 0);
      if (reduce > 0) {
        db.prepare("UPDATE customers SET outstanding_balance_paise = outstanding_balance_paise - ?, updated_at = datetime('now') WHERE id = ?")
          .run(reduce, inv.customer_id);
      }
    }

    if (inv.amount_paid_paise > 0 && mode !== 'CUSTOMER_CREDIT') {
      db.prepare(`INSERT INTO payments (id, business_id, invoice_id, customer_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_by, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OUT', ?, 'ACTIVE', ?, datetime('now'))`)
        .run(crypto.randomUUID(), businessId, id, inv.customer_id, inv.amount_paid_paise, mode, inv.invoice_number,
          `Refund on cancellation of ${inv.invoice_number}`, localDate(), userId);
    }

    if (inv.customer_id && (inv.loyalty_points_earned || inv.loyalty_points_redeemed)) {
      const delta = (inv.loyalty_points_redeemed || 0) - (inv.loyalty_points_earned || 0);
      db.prepare('UPDATE customers SET loyalty_points = COALESCE(loyalty_points, 0) + ? WHERE id = ?').run(delta, inv.customer_id);
      const bal = (db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(inv.customer_id) as any).loyalty_points;
      db.prepare(`INSERT INTO loyalty_transactions (id, business_id, customer_id, transaction_type, points, balance_after, invoice_id, notes)
                  VALUES (?, ?, ?, 'MANUAL_ADJUSTMENT', ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), businessId, inv.customer_id, delta, bal, id, `Reversed on cancellation of ${inv.invoice_number}`);
    }
  })();

  logAudit({ businessId, userId, action: 'INVOICE_CANCELLED', entityType: 'INVOICE', entityId: id,
    details: { number: inv.invoice_number, reason, totalPaise: inv.total_paise, refundedPaise: inv.amount_paid_paise, refundMode: mode } });
  return getInvoiceFull(businessId, id);
}

const receivePaymentSchema = z.object({
  amountPaise: z.coerce.number().int().positive('Amount must be greater than zero'),
  mode: z.enum(PAYMENT_MODES),
  reference: optText(100),
  paymentDate: z.string().regex(DATE_RE).optional(),
  notes: optText(300),
});

/** Record a later payment against an outstanding invoice. */
export function recordInvoicePayment(businessId: string, userId: string | null, id: string, body: unknown) {
  const input = parse(receivePaymentSchema, body);
  db.transaction(() => {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?').get(id, businessId) as any;
    if (!inv) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found');
    if (inv.status !== 'ISSUED') throw new HttpError(409, 'NOT_PAYABLE', 'Payments can only be recorded on issued invoices');
    const due = inv.total_paise - inv.amount_paid_paise;
    if (due <= 0) throw new HttpError(409, 'ALREADY_PAID', 'Invoice is already fully paid');
    if (input.amountPaise > due) throw new HttpError(400, 'OVERPAYMENT', `Amount exceeds balance due of ₹${(due / 100).toFixed(2)}`);
    applyInvoicePayment(businessId, userId, inv, input.amountPaise, input.mode, input.reference, input.paymentDate, input.notes);
  })();
  const invoice = getInvoiceFull(businessId, id);
  logAudit({ businessId, userId, action: 'PAYMENT_RECEIVED', entityType: 'INVOICE', entityId: id,
    details: { number: invoice.invoice_number, amountPaise: input.amountPaise, mode: input.mode } });
  return invoice;
}

/** Shared by invoice payments and customer on-account allocation. Must run inside a transaction. */
export function applyInvoicePayment(businessId: string, userId: string | null, inv: any, amount: number, mode: string,
  reference?: string | null, paymentDate?: string, notes?: string | null) {
  const paid = inv.amount_paid_paise + amount;
  const status = paid >= inv.total_paise ? 'PAID' : 'PARTIAL';
  db.prepare("UPDATE invoices SET amount_paid_paise = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?").run(paid, status, inv.id);
  db.prepare(`INSERT INTO payments (id, business_id, invoice_id, customer_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN', ?, 'ACTIVE', ?, datetime('now'))`)
    .run(crypto.randomUUID(), businessId, inv.id, inv.customer_id, amount, mode, reference || inv.invoice_number,
      notes || `Payment received for ${inv.invoice_number}`, paymentDate || localDate(), userId);
  if (inv.customer_id) {
    db.prepare("UPDATE customers SET outstanding_balance_paise = outstanding_balance_paise - ?, updated_at = datetime('now') WHERE id = ?")
      .run(amount, inv.customer_id);
  }
}

export function listInvoices(businessId: string, q: Record<string, any>) {
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const page = Math.max(1, Number(q.page) || 1);
  const conditions = ['business_id = ?'];
  const params: any[] = [businessId];
  if (q.search) {
    conditions.push('(invoice_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)');
    params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`);
  }
  if (q.status) { conditions.push('status = ?'); params.push(q.status); }
  if (q.paymentStatus) { conditions.push('payment_status = ?'); params.push(q.paymentStatus); }
  if (q.customerId) { conditions.push('customer_id = ?'); params.push(q.customerId); }
  if (q.fromDate) { conditions.push('invoice_date >= ?'); params.push(q.fromDate); }
  if (q.toDate) { conditions.push('invoice_date <= ?'); params.push(q.toDate); }
  const where = conditions.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM invoices WHERE ${where}`).get(...params) as any).c;
  const data = db.prepare(`SELECT id, business_id, invoice_number, customer_id, customer_name, customer_phone, customer_gstin, invoice_date, due_date,
                                  subtotal_paise, discount_paise, tax_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise,
                                  payment_mode, payment_status, amount_paid_paise, status, cancel_reason, created_at
                           FROM invoices WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);
  return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
}
