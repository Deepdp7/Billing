import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

// ============================================================================
// CUSTOMER LOYALTY & REWARDS LEDGER CONTROLLER (PRD §4.13)
// ============================================================================

export function getLoyaltyRule(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;

  let rule = db.prepare('SELECT * FROM loyalty_rules WHERE business_id = ?').get(businessId) as any;

  if (!rule) {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO loyalty_rules (id, business_id, earn_points_per_rupees, point_value_paise, min_redeem_points, is_active)
      VALUES (?, ?, 100, 100, 10, 1)
    `).run(id, businessId);

    rule = db.prepare('SELECT * FROM loyalty_rules WHERE id = ?').get(id);
  }

  // Stats
  const stats = db.prepare(`
    SELECT 
      SUM(CASE WHEN transaction_type = 'EARNED' THEN points ELSE 0 END) as total_points_issued,
      SUM(CASE WHEN transaction_type = 'REDEEMED' THEN ABS(points) ELSE 0 END) as total_points_redeemed,
      COUNT(DISTINCT customer_id) as active_loyalty_customers
    FROM loyalty_transactions
    WHERE business_id = ?
  `).get(businessId) as any;

  res.json({
    rule,
    stats: {
      total_points_issued: stats?.total_points_issued || 0,
      total_points_redeemed: stats?.total_points_redeemed || 0,
      active_loyalty_customers: stats?.active_loyalty_customers || 0,
    }
  });
}

export function updateLoyaltyRule(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const {
    earn_points_per_rupees = 100,
    point_value_paise = 100,
    min_redeem_points = 10,
    is_active = 1,
  } = req.body;

  let existing = db.prepare('SELECT id FROM loyalty_rules WHERE business_id = ?').get(businessId) as any;

  if (existing) {
    db.prepare(`
      UPDATE loyalty_rules SET
        earn_points_per_rupees = ?,
        point_value_paise = ?,
        min_redeem_points = ?,
        is_active = ?,
        updated_at = datetime('now')
      WHERE business_id = ?
    `).run(Number(earn_points_per_rupees) || 100, Number(point_value_paise) || 100, Number(min_redeem_points) || 10, is_active ? 1 : 0, businessId);
  } else {
    db.prepare(`
      INSERT INTO loyalty_rules (id, business_id, earn_points_per_rupees, point_value_paise, min_redeem_points, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), businessId, Number(earn_points_per_rupees) || 100, Number(point_value_paise) || 100, Number(min_redeem_points) || 10, is_active ? 1 : 0);
  }

  const updated = db.prepare('SELECT * FROM loyalty_rules WHERE business_id = ?').get(businessId);
  res.json({ message: 'Loyalty rules updated successfully', rule: updated });
}

export function getLoyaltyTransactions(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { customerId, search } = req.query as { customerId?: string; search?: string };

  let query = `
    SELECT lt.*, c.name as customer_name, c.phone as customer_phone,
           i.invoice_number
    FROM loyalty_transactions lt
    JOIN customers c ON c.id = lt.customer_id
    LEFT JOIN invoices i ON i.id = lt.invoice_id
    WHERE lt.business_id = ?
  `;
  const params: any[] = [businessId];

  if (customerId) {
    query += ' AND lt.customer_id = ?';
    params.push(customerId);
  }

  if (search) {
    query += ' AND (c.name LIKE ? OR c.phone LIKE ? OR i.invoice_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY lt.created_at DESC LIMIT 100';

  const transactions = db.prepare(query).all(...params);
  res.json({ transactions });
}

export function getCustomerLoyalty(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { customerId } = req.params;

  const customer = db.prepare(`
    SELECT id, name, phone, loyalty_points, outstanding_balance_paise
    FROM customers
    WHERE id = ? AND business_id = ?
  `).get(customerId, businessId) as any;

  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  const points = customer.loyalty_points || 0;
  let tier = 'Bronze';
  if (points >= 1500) tier = 'Platinum';
  else if (points >= 500) tier = 'Gold';
  else if (points >= 100) tier = 'Silver';

  const history = db.prepare(`
    SELECT lt.*, i.invoice_number
    FROM loyalty_transactions lt
    LEFT JOIN invoices i ON i.id = lt.invoice_id
    WHERE lt.customer_id = ? AND lt.business_id = ?
    ORDER BY lt.created_at DESC LIMIT 20
  `).all(customerId, businessId);

  res.json({
    customer: {
      ...customer,
      loyalty_points: points,
      tier,
    },
    history,
  });
}

export function adjustLoyaltyPoints(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { customerId, points, notes } = req.body;

  if (!customerId || points === undefined || Number(points) === 0) {
    res.status(400).json({ error: 'Customer ID and non-zero point delta are required' });
    return;
  }

  const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(customerId, businessId) as any;
  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  const pointDelta = Number(points);
  const currentPoints = customer.loyalty_points || 0;
  const newBalance = Math.max(0, currentPoints + pointDelta);

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE customers SET loyalty_points = ?, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `).run(newBalance, customerId, businessId);

    db.prepare(`
      INSERT INTO loyalty_transactions (
        id, business_id, customer_id, transaction_type, points, balance_after, notes
      ) VALUES (?, ?, ?, 'MANUAL_ADJUSTMENT', ?, ?, ?)
    `).run(
      uuidv4(), businessId, customerId, pointDelta, newBalance,
      notes || 'Manual administrative points adjustment'
    );
  });

  try {
    tx();
    res.json({
      message: 'Points adjusted successfully',
      newBalance,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to adjust points' });
  }
}
