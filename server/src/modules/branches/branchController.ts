import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

export function getBranches(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;

  let branches = db.prepare(`
    SELECT * FROM branches
    WHERE business_id = ?
    ORDER BY is_main DESC, created_at ASC
  `).all(businessId) as any[];

  // If no branch exists, auto-initialize main outlet from business record
  if (branches.length === 0) {
    const biz = db.prepare('SELECT name, address, phone FROM businesses WHERE id = ?').get(businessId) as any;
    const mainBranchId = uuidv4();
    db.prepare(`
      INSERT INTO branches (id, business_id, name, code, address, phone, manager_name, is_main)
      VALUES (?, ?, ?, 'MAIN-01', ?, ?, 'Owner', 1)
    `).run(mainBranchId, businessId, biz ? `${biz.name} (Main Outlet)` : 'Main Branch', biz?.address || 'Main Street', biz?.phone || '+91 9800000000');

    branches = db.prepare('SELECT * FROM branches WHERE business_id = ?').all(businessId);
  }

  res.json({ branches });
}

export function createBranch(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { name, code, address, phone, manager_name } = req.body;

  if (!name || !code) {
    res.status(400).json({ error: 'Branch name and code are required' });
    return;
  }

  const branchId = uuidv4();
  db.prepare(`
    INSERT INTO branches (id, business_id, name, code, address, phone, manager_name, is_main)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(branchId, businessId, name, code.toUpperCase(), address || null, phone || null, manager_name || null);

  // Log audit
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, business_id, action, entity_type, entity_id, details_json)
    VALUES (?, ?, ?, 'BRANCH_CREATED', 'BRANCH', ?, ?)
  `).run(uuidv4(), req.user?.userId || null, businessId, branchId, JSON.stringify({ name, code }));

  const created = db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId);
  res.status(201).json({ branch: created });
}

export function updateBranch(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;
  const { name, address, phone, manager_name } = req.body;

  db.prepare(`
    UPDATE branches
    SET name = COALESCE(?, name),
        address = COALESCE(?, address),
        phone = COALESCE(?, phone),
        manager_name = COALESCE(?, manager_name)
    WHERE id = ? AND business_id = ?
  `).run(name, address, phone, manager_name, id, businessId);

  const updated = db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
  res.json({ branch: updated });
}

export function deleteBranch(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;

  const branch = db.prepare('SELECT is_main FROM branches WHERE id = ? AND business_id = ?').get(id, businessId) as any;
  if (!branch) {
    res.status(404).json({ error: 'Branch not found' });
    return;
  }
  if (branch.is_main === 1) {
    res.status(400).json({ error: 'Cannot delete the primary main branch' });
    return;
  }

  db.prepare('DELETE FROM branches WHERE id = ? AND business_id = ?').run(id, businessId);
  res.json({ message: 'Branch deleted successfully' });
}
