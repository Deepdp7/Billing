import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { parse, HttpError } from '../../lib/http.js';
import { DATE_RE } from '../../lib/dates.js';
import * as invoiceService from '../../services/invoiceService.js';

export function getQuotations(req: AuthenticatedRequest, res: Response): void {
  const quotes = db.prepare('SELECT * FROM quotations WHERE business_id = ? ORDER BY created_at DESC').all(req.businessId);
  res.json({ data: quotes });
}

const quoteSchema = z.object({
  customerId: z.string().max(64).optional().nullable(),
  customerName: z.string().trim().min(1, 'Customer name is required').max(150),
  customerPhone: z.string().trim().max(20).optional().nullable(),
  validUntil: z.string().regex(DATE_RE).optional().nullable().or(z.literal('')),
  notes: z.string().max(1000).optional().nullable(),
  items: z.array(z.object({
    productId: z.string().max(64).optional().nullable(),
    productName: z.string().trim().min(1).max(200),
    quantity: z.coerce.number().positive(),
    unitPricePaise: z.coerce.number().int().nonnegative(),
    taxRate: z.coerce.number().min(0).max(100).default(0),
  })).min(1, 'Add at least one item').max(500),
});

export function createQuotation(req: AuthenticatedRequest, res: Response): void {
  const q = parse(quoteSchema, req.body);
  const businessId = req.businessId!;
  const quoteId = uuidv4();

  let subtotal = 0;
  let tax = 0;
  const processed = q.items.map((it) => {
    const lineSubtotal = Math.round(it.quantity * it.unitPricePaise);
    const lineTax = Math.round((lineSubtotal * it.taxRate) / 100);
    subtotal += lineSubtotal;
    tax += lineTax;
    const productId = it.productId && db.prepare('SELECT 1 FROM products WHERE id = ? AND business_id = ?').get(it.productId, businessId) ? it.productId : null;
    return { ...it, productId, id: uuidv4(), taxPaise: lineTax, totalPaise: lineSubtotal + lineTax };
  });

  let quoteNumber = '';
  db.transaction(() => {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM quotations WHERE business_id = ?').get(businessId) as any).c;
    let n = 1001 + count;
    while (db.prepare('SELECT 1 FROM quotations WHERE business_id = ? AND quotation_number = ?').get(businessId, `EST-${n}`)) n++;
    quoteNumber = `EST-${n}`;
    db.prepare(`INSERT INTO quotations (id, business_id, quotation_number, customer_id, customer_name, customer_phone, valid_until, subtotal_paise, tax_paise, total_paise, status, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SENT', ?, datetime('now'))`)
      .run(quoteId, businessId, quoteNumber, q.customerId || null, q.customerName, q.customerPhone || '', q.validUntil || null, subtotal, tax, subtotal + tax, q.notes || '');
    const insertItem = db.prepare(`INSERT INTO quotation_items (id, business_id, quotation_id, product_id, product_name, quantity, unit_price_paise, tax_rate, tax_paise, total_paise)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const it of processed) {
      insertItem.run(it.id, businessId, quoteId, it.productId, it.productName, it.quantity, it.unitPricePaise, it.taxRate, it.taxPaise, it.totalPaise);
    }
  })();
  res.status(201).json({ message: 'Quotation created successfully', quotationNumber: quoteNumber, id: quoteId });
}

/** Convert a quotation to a real invoice through the invoice service (stock, GST and payments handled consistently). */
export function convertToInvoice(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const quote = db.prepare('SELECT * FROM quotations WHERE id = ? AND business_id = ?').get(req.params.id, businessId) as any;
  if (!quote) throw new HttpError(404, 'NOT_FOUND', 'Quotation not found');
  if (quote.status === 'CONVERTED') throw new HttpError(409, 'ALREADY_CONVERTED', 'Quotation has already been converted');
  const items = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').all(quote.id) as any[];
  const body = (req.body || {}) as Record<string, unknown>;

  const { invoice } = invoiceService.createInvoice(businessId, req.user?.userId || null, {
    customerId: quote.customer_id || undefined,
    customerName: quote.customer_name,
    customerPhone: quote.customer_phone || undefined,
    paymentMode: body.paymentMode || 'CASH',
    amountPaidPaise: body.amountPaidPaise,
    payments: body.payments,
    notes: `Converted from Quotation ${quote.quotation_number}`,
    items: items.map((it) => ({
      productId: it.product_id || undefined,
      productName: it.product_name,
      quantity: it.quantity,
      unitPricePaise: it.unit_price_paise,
      taxRate: it.tax_rate,
    })),
  });
  db.prepare("UPDATE quotations SET status = 'CONVERTED', converted_invoice_id = ? WHERE id = ?").run(invoice.id, quote.id);
  res.json({ message: `Quotation converted to Invoice ${invoice.invoice_number}`, invoiceId: invoice.id, invoice });
}
