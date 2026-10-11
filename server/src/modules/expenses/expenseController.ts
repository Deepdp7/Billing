import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

export function getExpenses(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { category, fromDate, toDate } = req.query;

  const conditions = ['business_id = ?'];
  const params: any[] = [businessId];

  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }

  if (fromDate) {
    conditions.push('expense_date >= ?');
    params.push(fromDate);
  }

  if (toDate) {
    conditions.push('expense_date <= ?');
    params.push(toDate);
  }

  const expenses = db.prepare(`
    SELECT * FROM expenses 
    WHERE ${conditions.join(' AND ')} 
    ORDER BY expense_date DESC, created_at DESC
  `).all(...params);

  const totalPaise = db.prepare(`
    SELECT COALESCE(SUM(amount_paise), 0) as total 
    FROM expenses 
    WHERE ${conditions.join(' AND ')}
  `).get(...params) as { total: number };

  res.json({ data: expenses, totalPaise: totalPaise.total });
}

export function createExpense(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { category, amountPaise, expenseDate, paymentMode = 'CASH', description = '' } = req.body;

  if (!category || !amountPaise) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Category and amount are required' });
    return;
  }

  const id = uuidv4();
  const dateStr = expenseDate || new Date().toISOString().split('T')[0];

  db.prepare(`
    INSERT INTO expenses (id, business_id, category, amount_paise, expense_date, payment_mode, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, businessId, category, Math.round(Number(amountPaise)), dateStr, paymentMode, description);

  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
  res.status(201).json({ message: 'Expense recorded successfully', expense });
}
