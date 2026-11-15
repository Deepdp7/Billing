import { Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { parse, HttpError } from '../../lib/http.js';
import * as invoiceService from '../../services/invoiceService.js';

const uid = (req: AuthenticatedRequest) => req.user?.userId || null;

/** POST /billing/checkout — create an issued invoice (or a draft with `status: "DRAFT"`). Idempotent on clientRequestId. */
export function createInvoice(req: AuthenticatedRequest, res: Response): void {
  const { invoice, duplicate } = invoiceService.createInvoice(req.businessId!, uid(req), req.body);
  res.status(duplicate ? 200 : 201).json({
    message: duplicate ? 'Invoice already saved (duplicate submission ignored)' : invoice.status === 'DRAFT' ? 'Draft saved' : 'Invoice created successfully',
    duplicate,
    invoice,
  });
}

export function getInvoices(req: AuthenticatedRequest, res: Response): void {
  res.json(invoiceService.listInvoices(req.businessId!, req.query));
}

export function getInvoiceById(req: AuthenticatedRequest, res: Response): void {
  res.json({ invoice: invoiceService.getInvoiceFull(req.businessId!, req.params.id) });
}

export function cancelInvoice(req: AuthenticatedRequest, res: Response): void {
  const invoice = invoiceService.cancelInvoice(req.businessId!, uid(req), req.params.id, req.body);
  res.json({ message: 'Invoice cancelled, stock restored and payments reversed', invoice });
}

export function recordPayment(req: AuthenticatedRequest, res: Response): void {
  const invoice = invoiceService.recordInvoicePayment(req.businessId!, uid(req), req.params.id, req.body);
  res.status(201).json({ message: 'Payment recorded', invoice });
}

export function updateDraft(req: AuthenticatedRequest, res: Response): void {
  res.json({ message: 'Draft updated', invoice: invoiceService.updateDraft(req.businessId!, uid(req), req.params.id, req.body) });
}

export function issueDraft(req: AuthenticatedRequest, res: Response): void {
  res.status(201).json({ message: 'Invoice issued', invoice: invoiceService.issueDraft(req.businessId!, uid(req), req.params.id, req.body) });
}

export function deleteDraft(req: AuthenticatedRequest, res: Response): void {
  invoiceService.deleteDraft(req.businessId!, uid(req), req.params.id);
  res.json({ message: 'Draft deleted' });
}

export function deleteInvoice(req: AuthenticatedRequest, res: Response): void {
  invoiceService.deleteInvoice(req.businessId!, uid(req), req.params.id);
  res.json({ message: 'Invoice removed from history' });
}

export function duplicateInvoice(req: AuthenticatedRequest, res: Response): void {
  res.status(201).json({ message: 'Draft copy created', invoice: invoiceService.duplicateInvoice(req.businessId!, uid(req), req.params.id) });
}

export function getPayments(req: AuthenticatedRequest, res: Response): void {
  const { fromDate, toDate, mode, direction, customerId } = req.query as Record<string, string>;
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const cond = ['p.business_id = ?', "p.status = 'ACTIVE'"];
  const params: any[] = [req.businessId];
  if (fromDate) { cond.push('p.payment_date >= ?'); params.push(fromDate); }
  if (toDate) { cond.push('p.payment_date <= ?'); params.push(toDate); }
  if (mode) { cond.push('p.payment_mode = ?'); params.push(mode); }
  if (direction) { cond.push('p.direction = ?'); params.push(direction); }
  if (customerId) { cond.push('p.customer_id = ?'); params.push(customerId); }
  const rows = db.prepare(`
    SELECT p.*, i.invoice_number, c.name AS customer_name, s.name AS supplier_name
    FROM payments p
    LEFT JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE ${cond.join(' AND ')}
    ORDER BY p.payment_date DESC, p.created_at DESC LIMIT ?`).all(...params, limit);
  res.json({ data: rows });
}

// ---------------- Held (parked) bills ----------------

const holdSchema = z.object({
  label: z.string().trim().max(80).optional().nullable(),
  customerName: z.string().trim().max(150).optional().nullable(),
  payload: z.record(z.any()),
});

export function getHeldBills(req: AuthenticatedRequest, res: Response): void {
  const rows = db.prepare('SELECT * FROM held_bills WHERE business_id = ? ORDER BY created_at ASC').all(req.businessId) as any[];
  res.json({ data: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload_json), payload_json: undefined })) });
}

export function holdBill(req: AuthenticatedRequest, res: Response): void {
  const input = parse(holdSchema, req.body);
  const count = (db.prepare('SELECT COUNT(*) AS c FROM held_bills WHERE business_id = ?').get(req.businessId) as any).c;
  if (count >= 50) throw new HttpError(409, 'TOO_MANY_HELD', 'Too many held bills. Resume or discard some first.');
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO held_bills (id, business_id, label, customer_name, payload_json, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.businessId, input.label || null, input.customerName || null, JSON.stringify(input.payload), uid(req));
  res.status(201).json({ id });
}

export function deleteHeldBill(req: AuthenticatedRequest, res: Response): void {
  db.prepare('DELETE FROM held_bills WHERE id = ? AND business_id = ?').run(req.params.id, req.businessId);
  res.json({ message: 'Held bill removed' });
}
