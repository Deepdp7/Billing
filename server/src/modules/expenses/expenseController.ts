import { Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { parse, HttpError } from '../../lib/http.js';
import { DATE_RE, localDate } from '../../lib/dates.js';
import { PAYMENT_MODES } from '../../services/invoiceService.js';
import { logAudit } from '../../services/auditService.js';
import { sendTable } from '../../services/exportService.js';

const DEFAULT_CATEGORIES = ['Rent', 'Electricity', 'Salaries', 'Maintenance', 'Packaging', 'Transport', 'Internet & Phone', 'Miscellaneous'];

const expenseSchema = z.object({
  category: z.string().trim().min(1, 'Category is required').max(80),
  amountPaise: z.coerce.number().int().positive('Amount must be greater than zero'),
  expenseDate: z.string().regex(DATE_RE, 'Date must be YYYY-MM-DD').optional(),
  paymentMode: z.enum(PAYMENT_MODES).default('CASH'),
  description: z.string().trim().max(1000).optional().nullable(),
  reference: z.string().trim().max(100).optional().nullable(),
});

function filters(req: AuthenticatedRequest) {
  const { category, fromDate, toDate, paymentMode } = req.query as Record<string, string>;
  const cond = ['business_id = ?'];
  const params: any[] = [req.businessId];
  if (category) { cond.push('category = ?'); params.push(category); }
  if (paymentMode) { cond.push('payment_mode = ?'); params.push(paymentMode); }
  if (fromDate) { cond.push('expense_date >= ?'); params.push(fromDate); }
  if (toDate) { cond.push('expense_date <= ?'); params.push(toDate); }
  return { where: cond.join(' AND '), params };
}

export function getExpenses(req: AuthenticatedRequest, res: Response): void {
  const { where, params } = filters(req);
  const expenses = db.prepare(`SELECT * FROM expenses WHERE ${where} ORDER BY expense_date DESC, created_at DESC`).all(...params);
  const total = db.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS total FROM expenses WHERE ${where}`).get(...params) as { total: number };
  res.json({ data: expenses, totalPaise: total.total });
}

export function createExpense(req: AuthenticatedRequest, res: Response): void {
  const e = parse(expenseSchema, req.body);
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO expenses (id, business_id, category, amount_paise, expense_date, payment_mode, description, reference, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
    .run(id, req.businessId, e.category, e.amountPaise, e.expenseDate || localDate(), e.paymentMode, e.description || '', e.reference || null);
  db.prepare('INSERT OR IGNORE INTO expense_categories (id, business_id, name) VALUES (?, ?, ?)').run(crypto.randomUUID(), req.businessId, e.category);
  logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'EXPENSE_RECORDED', entityType: 'EXPENSE', entityId: id,
    details: { category: e.category, amountPaise: e.amountPaise } });
  res.status(201).json({ message: 'Expense recorded successfully', expense: db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) });
}

export function updateExpense(req: AuthenticatedRequest, res: Response): void {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId) as any;
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Expense not found');
  const e = parse(expenseSchema.partial(), req.body);
  db.prepare(`UPDATE expenses SET category = ?, amount_paise = ?, expense_date = ?, payment_mode = ?, description = ?, reference = ?, updated_at = datetime('now')
              WHERE id = ?`)
    .run(e.category ?? existing.category, e.amountPaise ?? existing.amount_paise, e.expenseDate ?? existing.expense_date,
      e.paymentMode ?? existing.payment_mode, e.description !== undefined ? e.description : existing.description,
      e.reference !== undefined ? e.reference : existing.reference, existing.id);
  logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'EXPENSE_UPDATED', entityType: 'EXPENSE', entityId: existing.id,
    details: { before: { category: existing.category, amountPaise: existing.amount_paise, date: existing.expense_date }, fields: Object.keys(e) } });
  res.json({ message: 'Expense updated', expense: db.prepare('SELECT * FROM expenses WHERE id = ?').get(existing.id) });
}

export function deleteExpense(req: AuthenticatedRequest, res: Response): void {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId) as any;
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Expense not found');
  db.prepare('DELETE FROM expenses WHERE id = ?').run(existing.id);
  logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'EXPENSE_DELETED', entityType: 'EXPENSE', entityId: existing.id,
    details: { category: existing.category, amountPaise: existing.amount_paise, date: existing.expense_date } });
  res.json({ message: 'Expense deleted' });
}

export function getExpenseCategories(req: AuthenticatedRequest, res: Response): void {
  const custom = db.prepare('SELECT name FROM expense_categories WHERE business_id = ?').all(req.businessId) as any[];
  const used = db.prepare('SELECT DISTINCT category AS name FROM expenses WHERE business_id = ?').all(req.businessId) as any[];
  const names = new Set([...DEFAULT_CATEGORIES, ...custom.map((c) => c.name), ...used.map((c) => c.name)]);
  res.json({ data: [...names].sort((a, b) => a.localeCompare(b)) });
}

export function getExpenseAnalytics(req: AuthenticatedRequest, res: Response): void {
  const months = Math.min(36, Math.max(1, Number(req.query.months) || 12));
  const now = new Date();
  const from = localDate(new Date(now.getFullYear(), now.getMonth() - months + 1, 1));
  const monthly = db.prepare(`SELECT substr(expense_date, 1, 7) AS month, COALESCE(SUM(amount_paise), 0) AS total_paise, COUNT(*) AS count
                              FROM expenses WHERE business_id = ? AND expense_date >= ? GROUP BY month ORDER BY month`).all(req.businessId, from);
  const byCategory = db.prepare(`SELECT category, COALESCE(SUM(amount_paise), 0) AS total_paise, COUNT(*) AS count
                                 FROM expenses WHERE business_id = ? AND expense_date >= ? GROUP BY category ORDER BY total_paise DESC`).all(req.businessId, from);
  res.json({ from, monthly, byCategory });
}

export function exportExpenses(req: AuthenticatedRequest, res: Response): void {
  const { where, params } = filters(req);
  const rows = db.prepare(`SELECT * FROM expenses WHERE ${where} ORDER BY expense_date DESC`).all(...params) as any[];
  sendTable(res, (req.query.format as string) || 'csv', 'expenses', [
    { key: 'expense_date', label: 'Date' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' },
    { key: 'payment_mode', label: 'Payment Mode' }, { key: 'reference', label: 'Reference' }, { key: 'amount_paise', label: 'Amount (₹)', money: true },
  ], rows);
}
