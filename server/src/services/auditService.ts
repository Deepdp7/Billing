import crypto from 'crypto';
import { db } from '../db/connection.js';

export function logAudit(entry: {
  businessId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}): void {
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, business_id, action, entity_type, entity_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    crypto.randomUUID(),
    entry.userId || null,
    entry.businessId || null,
    entry.action,
    entry.entityType,
    entry.entityId || null,
    JSON.stringify(entry.details || {})
  );
}
