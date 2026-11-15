import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3-multiple-ciphers';
import { setupTestEnv, startTestServer, setupBusiness, createProduct, TestClient } from './helpers.js';

const dataDir = setupTestEnv();

let api: TestClient;
let db: Database.Database;
let lic: typeof import('../src/licensing/licenseClient.js');
const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;

before(async () => {
  api = await startTestServer();
  db = (await import('../src/db/connection.js')).db;
  lic = await import('../src/licensing/licenseClient.js');
  await setupBusiness(api, { businessName: 'Erase Me Traders' });
  await createProduct(api, { name: 'Keep-in-backup product' });
});
after(async () => { await api.close(); });

test('erase is refused (nothing deleted) when the safety backup cannot be saved', async () => {
  // Point the backup folder at a path under a regular file, so the folder cannot be created.
  const blocker = path.join(dataDir, 'not-a-folder');
  fs.writeFileSync(blocker, 'x');
  db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('backup_dir', ?, datetime('now'))").run(path.join(blocker, 'backups'));
  let hookRan = false;
  const r = await lic.backupThenWipe('TEST', async () => { hookRan = true; });
  assert.equal(r.erased, false);
  assert.ok(r.error);
  assert.equal(hookRan, false, 'deactivation hook must not run when the backup failed');
  assert.equal(count('businesses'), 1);
  assert.ok(count('products') >= 1);
  db.prepare("DELETE FROM system_settings WHERE key = 'backup_dir'").run();
});

test('erase saves a verified PRE_ERASE backup containing the shop, then clears it; the backup stays listed', async () => {
  const r = await lic.backupThenWipe('TEST');
  assert.equal(r.erased, true);
  assert.ok(r.backupFile && fs.existsSync(r.backupFile), 'backup file exists');
  // The live database is empty...
  assert.equal(count('businesses'), 0);
  assert.equal(count('products'), 0);
  assert.equal(count('users'), 0);
  // ...but the backup holds the whole shop.
  const b = new Database(r.backupFile!, { readonly: true });
  assert.equal((b.prepare('SELECT name FROM businesses').get() as any).name, 'Erase Me Traders');
  assert.ok((b.prepare("SELECT COUNT(*) AS c FROM products WHERE name = 'Keep-in-backup product'").get() as any).c === 1);
  assert.equal(b.pragma('integrity_check', { simple: true }), 'ok');
  b.close();
  // The record survives the erase, so the Backup page can still show and restore it.
  const row = db.prepare("SELECT * FROM backup_history WHERE kind = 'PRE_ERASE'").get() as any;
  assert.ok(row, 'PRE_ERASE backup recorded');
  assert.equal(row.status, 'VERIFIED');
  assert.equal(row.file_path, r.backupFile);
});

test('a fresh sign-up works on the erased computer, and the old shop can be restored from the safety backup', async () => {
  api.setToken('');
  await setupBusiness(api, { businessName: 'New Owner Stores', email: 'new@test.local' });
  const row = db.prepare("SELECT id FROM backup_history WHERE kind = 'PRE_ERASE'").get() as any;
  const restored = await api.post('/app/backups/restore', { backupId: row.id });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.equal((db.prepare('SELECT name FROM businesses').get() as any).name, 'Erase Me Traders');
});
