import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import Database from 'better-sqlite3-multiple-ciphers';
import { setupTestEnv, startTestServer, TestClient } from './helpers.js';

// Start from a COPY of the legacy development database (schema v0, demo data) to prove upgrades preserve data.
const legacySrc = path.resolve(process.cwd(), 'data', 'apna_billing.db');
const hasLegacy = fs.existsSync(legacySrc);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apna-legacy-'));
const dbFile = path.join(workDir, 'legacy.db');
let legacyCounts: Record<string, number> = {};
let legacyVersion = 0;
if (hasLegacy) {
  // Checkpoint through a read-only snapshot so WAL contents are included without touching the original.
  const src = new Database(legacySrc, { readonly: true, fileMustExist: true });
  src.prepare('VACUUM INTO ?').run(dbFile);
  try { legacyVersion = (src.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as any)?.v || 0; } catch { legacyVersion = 0; }
  for (const t of ['businesses', 'invoices', 'invoice_items', 'products', 'customers', 'payments']) {
    legacyCounts[t] = (src.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as any).c;
  }
  src.close();
}
const dataDir = setupTestEnv({ dbFile: hasLegacy ? dbFile : undefined });

let api: TestClient;
let db: Database.Database;

before(async () => {
  api = await startTestServer();
  db = (await import('../src/db/connection.js')).db;
});
after(async () => { await api.close(); });

test('legacy database is migrated to the latest schema without losing data', { skip: !hasLegacy && 'no legacy DB present' }, async () => {
  const { LATEST_SCHEMA_VERSION, getSchemaVersion } = await import('../src/db/migrations.js');
  assert.equal(getSchemaVersion(db), LATEST_SCHEMA_VERSION);
  for (const [t, n] of Object.entries(legacyCounts)) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as any).c, n, `row count changed for ${t}`);
  }
  // When the copy needed upgrading, a pre-migration backup was taken by THIS run and recorded.
  // (A dev database that is already current has nothing to migrate, and older records may point at deleted files.)
  if (legacyVersion < LATEST_SCHEMA_VERSION) {
    const pre = db.prepare("SELECT * FROM backup_history WHERE kind = 'PRE_MIGRATION' ORDER BY created_at DESC").get() as any;
    assert.ok(pre, 'pre-migration backup recorded');
    assert.ok(fs.existsSync(pre.file_path));
  }
  // Backfilled per-line GST split adds up to each line's tax. (Two legacy demo-seed invoices have headers
  // that never matched their lines; the migration preserves source data as-is rather than rewriting it.)
  const mismatch = db.prepare(`SELECT COUNT(*) AS c FROM invoice_items WHERE tax_paise != cgst_paise + sgst_paise + igst_paise`).get() as any;
  assert.equal(mismatch.c, 0);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(String(db.pragma('journal_mode', { simple: true })).toLowerCase(), 'wal');
});

test('migrations are idempotent (re-running applies nothing)', async () => {
  const { runMigrations } = await import('../src/db/migrations.js');
  const r = runMigrations(db, {});
  assert.equal(r.from, r.to);
});

test('fresh install: setup, data, then backup → verify → modify → restore', async () => {
  const biz = (db.prepare('SELECT COUNT(*) AS c FROM businesses').get() as any).c;
  if (biz === 0) {
    const reg = await api.post('/auth/register', { ownerName: 'O', email: 'o@x.io', password: 'password123', businessName: 'Backup Biz', category: 'GROCERY', state: 'Kerala' });
    assert.equal(reg.status, 201);
    api.setToken(reg.data.token);
  } else {
    const login = await api.post('/auth/login', { email: 'owner@apnasupermart.com', password: 'password123' });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    api.setToken(login.data.token);
  }
  const cust = await api.post('/app/customers', { name: 'Before Backup', phone: '9000000001' });
  assert.equal(cust.status, 201);

  const b = await api.post('/app/backups/snapshot', { name: 'Test backup' });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  assert.equal(b.data.backup.status, 'VERIFIED');
  assert.ok(fs.existsSync(b.data.backup.file_path));
  assert.ok(b.data.backup.file_path.startsWith(path.join(dataDir, 'backups')));

  const v = await api.post(`/app/backups/${b.data.backup.id}/verify`);
  assert.equal(v.data.backup.checksumMatches, true);

  const after = await api.post('/app/customers', { name: 'After Backup', phone: '9000000002' });
  assert.equal(after.status, 201);

  const r = await api.post('/app/backups/restore', { backupId: b.data.backup.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const names = (await api.get('/app/customers?limit=500')).data.data.map((c: any) => c.name);
  assert.ok(names.includes('Before Backup'));
  assert.ok(!names.includes('After Backup'));

  // A safety backup of the pre-restore state exists and still contains the newer customer.
  const list = (await api.get('/app/backups')).data.backups;
  const safety = list.find((x: any) => x.kind === 'PRE_RESTORE');
  assert.ok(safety);
  const probe = new Database(safety.file_path, { readonly: true });
  assert.equal((probe.prepare("SELECT COUNT(*) AS c FROM customers WHERE name = 'After Backup'").get() as any).c, 1);
  probe.close();
});

test('corrupt or foreign files are refused by restore', async () => {
  const junk = path.join(dataDir, 'junk.db');
  fs.writeFileSync(junk, 'this is not a database');
  const r = await api.post('/app/backups/restore', { filePath: junk });
  assert.equal(r.status, 400);
  const other = path.join(dataDir, 'other.db');
  const o = new Database(other);
  o.exec('CREATE TABLE x (a)');
  o.close();
  assert.equal((await api.post('/app/backups/restore', { filePath: other })).status, 400);
});

test('the only verified backup cannot be deleted; automatic backups are pruned to the configured count', async () => {
  const backup = await import('../src/services/backupService.js');
  backup.updateBackupSettings({ keepAutoBackups: 2 });
  for (let i = 0; i < 4; i++) await backup.createBackup({ kind: 'AUTO' });
  const autos = backup.listBackups().filter((b: any) => b.kind === 'AUTO');
  assert.equal(autos.length, 2);
  for (const b of backup.listBackups()) {
    try { backup.deleteBackup(b.id); } catch { /* last one refuses */ }
  }
  const remaining = backup.listBackups().filter((b: any) => b.status === 'VERIFIED');
  assert.equal(remaining.length, 1, 'last verified backup is kept');
});

test('backup directory is configurable and validated', async () => {
  const custom = path.join(dataDir, 'custom-backups');
  const ok = await api.put('/app/backups/settings', { backupDir: custom });
  assert.equal(ok.status, 200);
  const b = await api.post('/app/backups/snapshot', {});
  assert.ok(b.data.backup.file_path.startsWith(custom));
});

test('data persists across a real process restart', async () => {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM customers').get() as any).c;
  const script = `
    process.env.NODE_ENV='test'; process.env.DB_PATH=${JSON.stringify(process.env.DB_PATH)};
    process.env.APNA_DATA_DIR=${JSON.stringify(dataDir)}; process.env.JWT_SECRET='x'.repeat(40);
    const { db } = await import('./src/db/connection.ts');
    console.log(JSON.stringify({ c: db.prepare('SELECT COUNT(*) AS c FROM customers').get().c }));`;
  const out = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd(), encoding: 'utf8' });
  const line = out.stdout.trim().split('\n').pop()!;
  assert.equal(JSON.parse(line).c, count, out.stderr);
});

test('a process killed mid-transaction leaves no partial invoice and an intact database', async () => {
  const before = (db.prepare('SELECT COUNT(*) AS c FROM invoices').get() as any).c;
  const script = `
    const Database = (await import('better-sqlite3-multiple-ciphers')).default;
    const db = new Database(${JSON.stringify(process.env.DB_PATH)});
    db.pragma('journal_mode = WAL');
    const biz = db.prepare('SELECT id FROM businesses LIMIT 1').get().id;
    db.exec('BEGIN');
    db.prepare("INSERT INTO invoices (id, business_id, invoice_number, total_paise) VALUES ('crash-1', ?, 'CRASH-1', 100)").run(biz);
    process.kill(process.pid, 'SIGKILL');`;
  spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM invoices').get() as any).c, before);
  assert.equal(db.prepare("SELECT 1 FROM invoices WHERE id = 'crash-1'").get(), undefined);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});

test('production data directory is outside the install folder', async () => {
  const out = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `const { config } = await import('./src/config/index.ts'); console.log(JSON.stringify(config));`],
  { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', APNA_DATA_DIR: '', DB_PATH: '', JWT_SECRET: '',
    APNA_LICENSE_ENFORCE: '', APNA_SINGLE_TENANT: '', APNA_DEMO_MODE: '', APPDATA: path.join(dataDir, 'AppDataRoaming') } });
  const cfg = JSON.parse(out.stdout.trim().split('\n').pop()!);
  if (process.platform === 'win32') assert.equal(cfg.dataDir, path.join(dataDir, 'AppDataRoaming', 'ApnaBilling', 'data'));
  assert.equal(cfg.demoMode, false);
  assert.equal(cfg.singleTenant, true);
  assert.equal(cfg.licensing.enforce, true);
  assert.equal(cfg.host, '127.0.0.1');
  assert.ok(fs.existsSync(path.join(cfg.dataDir, '.jwt-secret')), 'per-install JWT secret generated');
});
