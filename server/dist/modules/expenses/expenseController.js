"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExpenses = getExpenses;
exports.createExpense = createExpense;
exports.updateExpense = updateExpense;
exports.deleteExpense = deleteExpense;
exports.getExpenseCategories = getExpenseCategories;
exports.getExpenseAnalytics = getExpenseAnalytics;
exports.exportExpenses = exportExpenses;
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const connection_js_1 = require("../../db/connection.js");
const http_js_1 = require("../../lib/http.js");
const dates_js_1 = require("../../lib/dates.js");
const invoiceService_js_1 = require("../../services/invoiceService.js");
const auditService_js_1 = require("../../services/auditService.js");
const exportService_js_1 = require("../../services/exportService.js");
const DEFAULT_CATEGORIES = ['Rent', 'Electricity', 'Salaries', 'Maintenance', 'Packaging', 'Transport', 'Internet & Phone', 'Miscellaneous'];
const expenseSchema = zod_1.z.object({
    category: zod_1.z.string().trim().min(1, 'Category is required').max(80),
    amountPaise: zod_1.z.coerce.number().int().positive('Amount must be greater than zero'),
    expenseDate: zod_1.z.string().regex(dates_js_1.DATE_RE, 'Date must be YYYY-MM-DD').optional(),
    paymentMode: zod_1.z.enum(invoiceService_js_1.PAYMENT_MODES).default('CASH'),
    description: zod_1.z.string().trim().max(1000).optional().nullable(),
    reference: zod_1.z.string().trim().max(100).optional().nullable(),
});
function filters(req) {
    const { category, fromDate, toDate, paymentMode } = req.query;
    const cond = ['business_id = ?'];
    const params = [req.businessId];
    if (category) {
        cond.push('category = ?');
        params.push(category);
    }
    if (paymentMode) {
        cond.push('payment_mode = ?');
        params.push(paymentMode);
    }
    if (fromDate) {
        cond.push('expense_date >= ?');
        params.push(fromDate);
    }
    if (toDate) {
        cond.push('expense_date <= ?');
        params.push(toDate);
    }
    return { where: cond.join(' AND '), params };
}
function getExpenses(req, res) {
    const { where, params } = filters(req);
    const expenses = connection_js_1.db.prepare(`SELECT * FROM expenses WHERE ${where} ORDER BY expense_date DESC, created_at DESC`).all(...params);
    const total = connection_js_1.db.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS total FROM expenses WHERE ${where}`).get(...params);
    res.json({ data: expenses, totalPaise: total.total });
}
function createExpense(req, res) {
    const e = (0, http_js_1.parse)(expenseSchema, req.body);
    const id = crypto_1.default.randomUUID();
    connection_js_1.db.prepare(`INSERT INTO expenses (id, business_id, category, amount_paise, expense_date, payment_mode, description, reference, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
        .run(id, req.businessId, e.category, e.amountPaise, e.expenseDate || (0, dates_js_1.localDate)(), e.paymentMode, e.description || '', e.reference || null);
    connection_js_1.db.prepare('INSERT OR IGNORE INTO expense_categories (id, business_id, name) VALUES (?, ?, ?)').run(crypto_1.default.randomUUID(), req.businessId, e.category);
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'EXPENSE_RECORDED', entityType: 'EXPENSE', entityId: id,
        details: { category: e.category, amountPaise: e.amountPaise } });
    res.status(201).json({ message: 'Expense recorded successfully', expense: connection_js_1.db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) });
}
function updateExpense(req, res) {
    const existing = connection_js_1.db.prepare('SELECT * FROM expenses WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!existing)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Expense not found');
    const e = (0, http_js_1.parse)(expenseSchema.partial(), req.body);
    connection_js_1.db.prepare(`UPDATE expenses SET category = ?, amount_paise = ?, expense_date = ?, payment_mode = ?, description = ?, reference = ?, updated_at = datetime('now')
              WHERE id = ?`)
        .run(e.category ?? existing.category, e.amountPaise ?? existing.amount_paise, e.expenseDate ?? existing.expense_date, e.paymentMode ?? existing.payment_mode, e.description !== undefined ? e.description : existing.description, e.reference !== undefined ? e.reference : existing.reference, existing.id);
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'EXPENSE_UPDATED', entityType: 'EXPENSE', entityId: existing.id,
        details: { before: { category: existing.category, amountPaise: existing.amount_paise, date: existing.expense_date }, fields: Object.keys(e) } });
    res.json({ message: 'Expense updated', expense: connection_js_1.db.prepare('SELECT * FROM expenses WHERE id = ?').get(existing.id) });
}
function deleteExpense(req, res) {
    const existing = connection_js_1.db.prepare('SELECT * FROM expenses WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!existing)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Expense not found');
    connection_js_1.db.prepare('DELETE FROM expenses WHERE id = ?').run(existing.id);
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'EXPENSE_DELETED', entityType: 'EXPENSE', entityId: existing.id,
        details: { category: existing.category, amountPaise: existing.amount_paise, date: existing.expense_date } });
    res.json({ message: 'Expense deleted' });
}
function getExpenseCategories(req, res) {
    const custom = connection_js_1.db.prepare('SELECT name FROM expense_categories WHERE business_id = ?').all(req.businessId);
    const used = connection_js_1.db.prepare('SELECT DISTINCT category AS name FROM expenses WHERE business_id = ?').all(req.businessId);
    const names = new Set([...DEFAULT_CATEGORIES, ...custom.map((c) => c.name), ...used.map((c) => c.name)]);
    res.json({ data: [...names].sort((a, b) => a.localeCompare(b)) });
}
function getExpenseAnalytics(req, res) {
    const months = Math.min(36, Math.max(1, Number(req.query.months) || 12));
    const now = new Date();
    const from = (0, dates_js_1.localDate)(new Date(now.getFullYear(), now.getMonth() - months + 1, 1));
    const monthly = connection_js_1.db.prepare(`SELECT substr(expense_date, 1, 7) AS month, COALESCE(SUM(amount_paise), 0) AS total_paise, COUNT(*) AS count
                              FROM expenses WHERE business_id = ? AND expense_date >= ? GROUP BY month ORDER BY month`).all(req.businessId, from);
    const byCategory = connection_js_1.db.prepare(`SELECT category, COALESCE(SUM(amount_paise), 0) AS total_paise, COUNT(*) AS count
                                 FROM expenses WHERE business_id = ? AND expense_date >= ? GROUP BY category ORDER BY total_paise DESC`).all(req.businessId, from);
    res.json({ from, monthly, byCategory });
}
function exportExpenses(req, res) {
    const { where, params } = filters(req);
    const rows = connection_js_1.db.prepare(`SELECT * FROM expenses WHERE ${where} ORDER BY expense_date DESC`).all(...params);
    (0, exportService_js_1.sendTable)(res, req.query.format || 'csv', 'expenses', [
        { key: 'expense_date', label: 'Date' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' },
        { key: 'payment_mode', label: 'Payment Mode' }, { key: 'reference', label: 'Reference' }, { key: 'amount_paise', label: 'Amount (₹)', money: true },
    ], rows);
}
