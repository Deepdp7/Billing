import { Response } from 'express';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

export function getTenantAuditLogs(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;

  const logs = db.prepare(`
    SELECT al.*, u.name as user_name, u.email as user_email
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.business_id = ?
    ORDER BY al.created_at DESC
    LIMIT 100
  `).all(businessId);

  res.json({ logs });
}
