import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../db/connection.js';
import { config } from '../config/index.js';
import { getSchemaVersion, LATEST_SCHEMA_VERSION, backfillAfterRestore } from '../db/migrations.js';
import { sha256File } from '../lib/fileHash.js';
import { rebuildSalesSummary } from '../db/salesSummary.js';
import { HttpError } from '../lib/http.js';
import { currentShop } from '../db/shops.js';
import { attachKeyForFile, databaseKey, encryptFileInPlace, isPlainSqliteFile, openBackupFile, SqliteDatabase } from '../db/sqlite.js';
import { afterRestore, quietly } from '../sync/syncEngine.js';

export type BackupKind = 'MANUAL' | 'AUTO' | 'PRE_MIGRATION' | 'PRE_RESTORE' | 'PRE_ERASE' | 'PRE_SYNC';

// Tables describing this installation (identity, license, backup log) are never overwritten by a restore.
const RESTORE_EXCLUDED_TABLES = new Set([
  'schema_migrations', 'license_state', 'account_sync', 'backup_history', 'feature_usage', 'system_settings', 'sqlite_sequence',
  // This computer's place in the account's shared data
  'sync_ctl', 'sync_outbox', 'sync_deltas', 'sync_state',
  // Built again from the restored bills (db/salesSummary.ts)
  'sales_rollup',
]);

export function getSystemSetting(key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function setSystemSetting(key: string, value: string): void {
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value);
}

export function getBackupSettings() {
  return {
    backupDir: getSystemSetting('backup_dir', currentShop().backupDir),
    autoBackupEnabled: getSystemSetting('auto_backup_enabled', '1') === '1',
    autoBackupIntervalHours: Number(getSystemSetting('auto_backup_interval_hours', '24')),
    keepAutoBackups: Number(getSystemSetting('keep_auto_backups', '14')),
  };
}

export function updateBackupSettings(input: {
  backupDir?: string; autoBackupEnabled?: boolean; autoBackupIntervalHours?: number; keepAutoBackups?: number;
}) {
  if (input.backupDir !== undefined) {
    const dir = path.resolve(input.backupDir);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.write-test-${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
    } catch {
      throw new HttpError(400, 'BACKUP_DIR_NOT_WRITABLE', `Backup folder is not writable: ${dir}`);
    }
    setSystemSetting('backup_dir', dir);
  }
  if (input.autoBackupEnabled !== undefined) setSystemSetting('auto_backup_enabled', input.autoBackupEnabled ? '1' : '0');
  if (input.autoBackupIntervalHours !== undefined) {
    setSystemSetting('auto_backup_interval_hours', String(Math.min(168, Math.max(1, Math.round(input.autoBackupIntervalHours)))));
  }
  if (input.keepAutoBackups !== undefined) {
    setSystemSetting('keep_auto_backups', String(Math.min(365, Math.max(1, Math.round(input.keepAutoBackups)))));
  }
  return getBackupSettings();
}


/** Open a backup file read-only and check that it is an intact Apna Billing database. */
export function inspectBackupFile(filePath: string): { ok: boolean; integrity: string; schemaVersion: number; businesses: number; invoices: number } {
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'BACKUP_FILE_MISSING', 'Backup file not found on disk');
  let probe: SqliteDatabase | null = null;
  try {
    probe = openBackupFile(filePath);
    const integrity = (probe.pragma('integrity_check', { simple: true }) as string) || 'unknown';
    const hasBiz = probe.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='businesses'").get();
    if (!hasBiz) return { ok: false, integrity: 'not an Apna Billing database', schemaVersion: 0, businesses: 0, invoices: 0 };
    const hasMig = probe.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    const schemaVersion = hasMig ? ((probe.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as any).v ?? 0) : 0;
    const businesses = (probe.prepare('SELECT COUNT(*) AS c FROM businesses').get() as any).c;
    const invoices = (probe.prepare('SELECT COUNT(*) AS c FROM invoices').get() as any).c;
    return { ok: integrity === 'ok', integrity, schemaVersion, businesses, invoices };
  } catch (err: any) {
    return { ok: false, integrity: `unreadable: ${err.message}`, schemaVersion: 0, businesses: 0, invoices: 0 };
  } finally {
    probe?.close();
  }
}

function rowToApi(row: any) {
  return {
    ...row,
    // Field names kept for the existing Backup page.
    backup_name: row.notes || row.file_name,
    file_size_kb: Math.round((row.size_bytes / 1024) * 100) / 100,
    record_count: row.record_count ?? null,
  };
}

/**
 * Create a consistent copy of the live database with VACUUM INTO (the copy is encrypted with the same key as the live
 * database; SQLite's online backup API cannot write an encrypted copy), then verify it.
 */
export async function createBackup(opts: { kind: BackupKind; userId?: string | null; notes?: string }) {
  const { backupDir } = getBackupSettings();
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // The business's name too: several businesses may share one backup folder
  const name = (db.prepare('SELECT name FROM businesses ORDER BY created_at LIMIT 1').get() as { name?: string } | undefined)?.name || '';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const fileName = `apna-billing-${slug ? `${slug}-` : ''}${opts.kind.toLowerCase()}-${stamp}.db`;
  const filePath = path.join(backupDir, fileName);

  db.prepare('VACUUM INTO ?').run(filePath);

  const check = inspectBackupFile(filePath);
  const stat = fs.statSync(filePath);
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO backup_history (id, file_name, file_path, size_bytes, sha256, kind, status, integrity, schema_version, created_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, fileName, filePath, stat.size, sha256File(filePath), opts.kind, check.ok ? 'VERIFIED' : 'FAILED',
    check.integrity, check.schemaVersion, opts.userId || null, opts.notes || null);

  if (!check.ok) {
    throw new HttpError(500, 'BACKUP_VERIFY_FAILED', `Backup was written but failed verification: ${check.integrity}`);
  }
  if (opts.kind === 'AUTO') pruneAutoBackups();
  return rowToApi({ ...(db.prepare('SELECT * FROM backup_history WHERE id = ?').get(id) as any), record_count: check.invoices });
}

export function listBackups() {
  const rows = db.prepare('SELECT * FROM backup_history ORDER BY created_at DESC, rowid DESC').all() as any[];
  return rows.map((r) => rowToApi({ ...r, status: fs.existsSync(r.file_path) ? r.status : 'MISSING' }));
}

export function verifyBackup(id: string) {
  const row = db.prepare('SELECT * FROM backup_history WHERE id = ?').get(id) as any;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Backup not found');
  if (!fs.existsSync(row.file_path)) {
    db.prepare("UPDATE backup_history SET status = 'MISSING' WHERE id = ?").run(id);
    return { ...rowToApi({ ...row, status: 'MISSING' }), checksumMatches: false };
  }
  const check = inspectBackupFile(row.file_path);
  const checksumMatches = !row.sha256 || sha256File(row.file_path) === row.sha256;
  const status = check.ok && checksumMatches ? 'VERIFIED' : 'FAILED';
  db.prepare('UPDATE backup_history SET status = ?, integrity = ? WHERE id = ?').run(status, check.integrity, id);
  return { ...rowToApi({ ...row, status, integrity: check.integrity }), checksumMatches };
}

/**
 * Keep only the newest N automatic backups. Manual, pre-migration and pre-restore backups are never
 * pruned, and pruning never removes the last verified backup.
 */
export function pruneAutoBackups() {
  const { keepAutoBackups } = getBackupSettings();
  const autos = db.prepare("SELECT * FROM backup_history WHERE kind = 'AUTO' ORDER BY created_at DESC, rowid DESC").all() as any[];
  const verifiedTotal = (db.prepare("SELECT COUNT(*) AS c FROM backup_history WHERE status = 'VERIFIED'").get() as any).c;
  let remainingVerified = verifiedTotal;
  for (const old of autos.slice(keepAutoBackups)) {
    if (old.status === 'VERIFIED' && remainingVerified <= 1) break;
    try { fs.unlinkSync(old.file_path); } catch { /* already gone */ }
    db.prepare('DELETE FROM backup_history WHERE id = ?').run(old.id);
    if (old.status === 'VERIFIED') remainingVerified -= 1;
  }
}

export function deleteBackup(id: string) {
  const row = db.prepare('SELECT * FROM backup_history WHERE id = ?').get(id) as any;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Backup not found');
  const otherVerified = (db.prepare("SELECT COUNT(*) AS c FROM backup_history WHERE status = 'VERIFIED' AND id != ?").get(id) as any).c;
  if (row.status === 'VERIFIED' && otherVerified === 0) {
    throw new HttpError(409, 'LAST_BACKUP', 'This is the only verified backup and cannot be deleted. Create another backup first.');
  }
  try { fs.unlinkSync(row.file_path); } catch { /* already gone */ }
  db.prepare('DELETE FROM backup_history WHERE id = ?').run(id);
}

/**
 * Restore business data from a backup file into the live database, atomically.
 * A PRE_RESTORE backup of the current state is taken first. Only columns present in both schemas are
 * copied, so older backups restore into a newer schema. Installation identity and license state are kept.
 */
export async function restoreFromFile(filePath: string, userId?: string | null) {
  const resolved = path.resolve(filePath);
  if (!/\.(db|sqlite|sqlite3|bak)$/i.test(resolved)) {
    throw new HttpError(400, 'INVALID_BACKUP_FILE', 'Backup file must be a .db / .sqlite file');
  }
  const check = inspectBackupFile(resolved);
  if (!check.ok) throw new HttpError(400, 'BACKUP_CORRUPT', `Backup failed integrity check: ${check.integrity}`);
  if (check.schemaVersion > LATEST_SCHEMA_VERSION) {
    throw new HttpError(400, 'BACKUP_TOO_NEW', 'This backup was made by a newer version of Apna Billing. Update the application first.');
  }

  const safety = await createBackup({ kind: 'PRE_RESTORE', userId, notes: 'Automatic safety backup before restore' });

  db.prepare('ATTACH DATABASE ? AS restore_src KEY ?').run(resolved, attachKeyForFile(resolved));
  try {
    const mainTables = (db.prepare("SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[]).map((r) => r.name);
    const srcTables = new Set((db.prepare("SELECT name FROM restore_src.sqlite_master WHERE type='table'").all() as any[]).map((r) => r.name));
    const tables = mainTables.filter((t) => !RESTORE_EXCLUDED_TABLES.has(t));

    db.pragma('foreign_keys = OFF');
    try {
      const copy = db.transaction(() => quietly(() => {
        for (const t of tables) db.prepare(`DELETE FROM main."${t}"`).run();
        for (const t of tables) {
          if (!srcTables.has(t)) continue;
          const mainCols = (db.prepare(`PRAGMA main.table_info("${t}")`).all() as any[]).map((c) => c.name);
          const srcCols = new Set((db.prepare(`PRAGMA restore_src.table_info("${t}")`).all() as any[]).map((c) => c.name));
          const cols = mainCols.filter((c) => srcCols.has(c)).map((c) => `"${c}"`).join(', ');
          if (cols) db.prepare(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM restore_src."${t}"`).run();
        }
        backfillAfterRestore(db);
        // The sales summary is not copied: it is built from the restored bills (db/salesSummary.ts)
        rebuildSalesSummary(db);
        const fkProblems = db.prepare('PRAGMA main.foreign_key_check').all();
        if (fkProblems.length > 0) {
          throw new HttpError(400, 'BACKUP_FK_VIOLATION', `Backup contains ${fkProblems.length} broken references; restore aborted.`);
        }
      }));
      copy();
      afterRestore();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  } finally {
    db.prepare('DETACH DATABASE restore_src').run();
  }

  // The restoring user may not exist in the restored data (e.g. a backup from another shop or PC): keep their id in details.
  const userStillExists = !!userId && !!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId);
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, business_id, action, entity_type, entity_id, details_json)
    VALUES (?, ?, NULL, 'BACKUP_RESTORED', 'BACKUP', NULL, ?)
  `).run(crypto.randomUUID(), userStillExists ? userId : null,
    JSON.stringify({ file: path.basename(resolved), safetyBackupId: safety.id, restoredBy: userId || null }));

  return { restoredFrom: path.basename(resolved), safetyBackup: safety, schemaVersion: getSchemaVersion(db), invoices: check.invoices };
}

export async function restoreBackupById(id: string, userId?: string | null) {
  const row = db.prepare('SELECT * FROM backup_history WHERE id = ?').get(id) as any;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Backup not found');
  return restoreFromFile(row.file_path, userId);
}

export async function runScheduledBackupIfDue(): Promise<boolean> {
  const settings = getBackupSettings();
  if (!settings.autoBackupEnabled) return false;
  const hasBusiness = (db.prepare('SELECT COUNT(*) AS c FROM businesses').get() as any).c > 0;
  if (!hasBusiness) return false;
  const last = db.prepare("SELECT created_at FROM backup_history WHERE kind = 'AUTO' AND status = 'VERIFIED' ORDER BY created_at DESC LIMIT 1").get() as any;
  const dueMs = settings.autoBackupIntervalHours * 3600 * 1000;
  if (last && Date.now() - new Date(last.created_at + 'Z').getTime() < dueMs) return false;
  await createBackup({ kind: 'AUTO', notes: 'Scheduled automatic backup' });
  return true;
}

/**
 * One-time upgrade to encrypted storage: backups listed in the history that are still plain SQLite (made before
 * version 1.2) are encrypted in place, and their recorded size and checksum updated. A backup that cannot be
 * converted (read-only folder, removable drive gone) is left as it is and stays restorable.
 */
export function encryptLegacyBackups(): number {
  if (!databaseKey()) return 0;
  const key = databaseKey()!;
  const rows = db.prepare('SELECT id, file_path, status FROM backup_history').all() as Array<{ id: string; file_path: string; status: string }>;
  let converted = 0;
  for (const row of rows) {
    if (!fs.existsSync(row.file_path) || !isPlainSqliteFile(row.file_path)) continue;
    try {
      encryptFileInPlace(row.file_path, key);
      const stat = fs.statSync(row.file_path);
      db.prepare('UPDATE backup_history SET size_bytes = ?, sha256 = ? WHERE id = ?').run(stat.size, sha256File(row.file_path), row.id);
      converted += 1;
    } catch (err: any) {
      console.warn(`[Backup] Could not encrypt ${path.basename(row.file_path)}: ${err?.message || err}`);
    }
  }
  return converted;
}
