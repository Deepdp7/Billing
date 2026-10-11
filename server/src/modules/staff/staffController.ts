import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

export function getStaff(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const staff = db.prepare('SELECT * FROM staff WHERE business_id = ? ORDER BY name ASC').all(businessId);
  res.json({ data: staff });
}

export function createStaff(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { name, email, phone = '', role = 'CASHIER' } = req.body;

  if (!name || !email) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Name and email are required' });
    return;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO staff (id, business_id, name, email, phone, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', datetime('now'))
  `).run(id, businessId, name, email, phone, role);

  const member = db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  res.status(201).json({ message: 'Staff member added', staff: member });
}

export function toggleStaffStatus(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { id } = req.params;
  const { status } = req.body;

  db.prepare('UPDATE staff SET status = ? WHERE id = ? AND business_id = ?').run(status, id, businessId);
  res.json({ message: `Staff status updated to ${status}` });
}
