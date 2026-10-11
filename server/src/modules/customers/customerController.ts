import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

export function getCustomers(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { search, limit = 50, page = 1 } = req.query;

  const conditions = ['business_id = ?'];
  const params: any[] = [businessId];

  if (search) {
    conditions.push('(name LIKE ? OR phone LIKE ? OR gstin LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (Number(page) - 1) * Number(limit);

  const total = db.prepare(`SELECT COUNT(*) as count FROM customers WHERE ${whereClause}`).get(...params) as { count: number };
  const customers = db.prepare(`
    SELECT * FROM customers 
    WHERE ${whereClause} 
    ORDER BY name ASC 
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), offset);

  res.json({
    data: customers,
    pagination: {
      total: total.count,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total.count / Number(limit)),
    },
  });
}

export function createCustomer(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { name, phone = '', email = '', gstin = '', address = '', creditLimitPaise = 0 } = req.body;

  if (!name) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Customer name is required' });
    return;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO customers (id, business_id, name, phone, email, gstin, address, credit_limit_paise, outstanding_balance_paise, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
  `).run(id, businessId, name, phone, email, gstin, address, Math.round(Number(creditLimitPaise) || 0));

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  res.status(201).json({ message: 'Customer added successfully', customer });
}

export function getCustomerById(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { id } = req.params;

  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(id, businessId);
  if (!customer) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Customer not found' });
    return;
  }

  const invoices = db.prepare(`
    SELECT * FROM invoices 
    WHERE customer_id = ? AND business_id = ? 
    ORDER BY created_at DESC 
    LIMIT 20
  `).all(id, businessId);

  res.json({ customer, invoices });
}
