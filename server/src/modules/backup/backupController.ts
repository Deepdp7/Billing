import { Response, Request } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { asyncHandler, parse, HttpError } from '../../lib/http.js';
import { APP_VERSION } from '../../config/index.js';
import { getSchemaVersion } from '../../db/migrations.js';
import * as backupService from '../../services/backupService.js';
import { logAudit } from '../../services/auditService.js';

/** Full JSON export of every table that belongs to this business (data portability). */
export function exportBackup(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[]).map((t) => t.name);
  const data: Record<string, unknown[]> = {};
  for (const t of tables) {
    const cols = (db.prepare(`PRAGMA table_info("${t}")`).all() as any[]).map((c) => c.name);
    if (!cols.includes('business_id')) continue;
    data[t] = db.prepare(`SELECT * FROM "${t}" WHERE business_id = ?`).all(businessId);
  }
  data.businesses = [db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId)];
  logAudit({ businessId, userId: req.user?.userId, action: 'DATA_EXPORTED', entityType: 'BACKUP' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="apna-billing-export-${Date.now()}.json"`);
  res.send(JSON.stringify({
    metadata: { platform: 'Apna Billing', appVersion: APP_VERSION, schemaVersion: getSchemaVersion(db), exported_at: new Date().toISOString(), business_id: businessId },
    data,
  }));
}

export const createBackupSnapshot = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
  const backup = await backupService.createBackup({ kind: 'MANUAL', userId: req.user?.userId, notes: name || 'Manual backup' });
  logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'BACKUP_CREATED', entityType: 'BACKUP', entityId: backup.id,
    details: { file: backup.file_name, sizeBytes: backup.size_bytes } });
  res.status(201).json({ message: 'Backup created and verified', backup });
});

export function getBackups(req: AuthenticatedRequest, res: Response): void {
  res.json({ backups: backupService.listBackups(), settings: backupService.getBackupSettings() });
}

export function verifyBackup(req: AuthenticatedRequest, res: Response): void {
  res.json({ backup: backupService.verifyBackup(req.params.id) });
}

export function deleteBackup(req: AuthenticatedRequest, res: Response): void {
  backupService.deleteBackup(req.params.id);
  logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'BACKUP_DELETED', entityType: 'BACKUP', entityId: req.params.id });
  res.json({ message: 'Backup deleted' });
}

const restoreSchema = z.object({
  backupId: z.string().max(64).optional(),
  filePath: z.string().max(1024).optional(),
}).refine((v) => v.backupId || v.filePath, 'Provide backupId or filePath');

export const restoreBackup = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const input = parse(restoreSchema, req.body);
  const result = input.backupId
    ? await backupService.restoreBackupById(input.backupId, req.user?.userId)
    : await backupService.restoreFromFile(input.filePath!, req.user?.userId);
  res.json({ message: 'Backup restored successfully. A safety backup of the previous data was created first.', details: result });
});

/** Restore from a .db file uploaded as the raw request body (application/octet-stream). */
export const uploadAndRestore = asyncHandler(async (req: Request & AuthenticatedRequest, res: Response) => {
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) throw new HttpError(400, 'NO_FILE', 'Upload a backup .db file');
  if (req.body.subarray(0, 15).toString('utf8') !== 'SQLite format 3') throw new HttpError(400, 'INVALID_BACKUP_FILE', 'File is not a SQLite database');
  const { backupDir } = backupService.getBackupSettings();
  fs.mkdirSync(backupDir, { recursive: true });
  const dest = path.join(backupDir, `uploaded-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.db`);
  fs.writeFileSync(dest, req.body);
  const result = await backupService.restoreFromFile(dest, req.user?.userId);
  res.json({ message: 'Backup restored successfully. A safety backup of the previous data was created first.', details: result });
});

export function getBackupSettings(req: AuthenticatedRequest, res: Response): void {
  res.json({ settings: backupService.getBackupSettings() });
}

export function updateBackupSettings(req: AuthenticatedRequest, res: Response): void {
  const input = parse(z.object({
    backupDir: z.string().trim().min(1).max(1024).optional(),
    autoBackupEnabled: z.boolean().optional(),
    autoBackupIntervalHours: z.coerce.number().min(1).max(168).optional(),
    keepAutoBackups: z.coerce.number().int().min(1).max(365).optional(),
  }), req.body);
  const settings = backupService.updateBackupSettings(input);
  logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'BACKUP_SETTINGS_UPDATED', entityType: 'BACKUP', details: input });
  res.json({ message: 'Backup settings saved', settings });
}
