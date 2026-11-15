import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3-multiple-ciphers';
import { setupTestEnv, startTestServer, setupBusiness, createProduct, TestClient } from './helpers.js';
import { configureRuntime } from '../src/config/runtime.js';
import { runMigrations } from '../src/db/migrations.js';

const dataDir = setupTestEnv();
const KEY = crypto.randomBytes(32).toString('hex');
const dbPath = process.env.DB_PATH!;

// An installation from before encrypted storage: plain SQLite in WAL mode, with uncheckpointed writes.
{
  const legacy = new Database(dbPath);
  legacy.pragma('journal_mode = WAL');
  runMigrations(legacy);
  legacy.prepare("INSERT INTO system_settings (key, value) VALUES ('legacy_marker', 'kept')").run();
  legacy.close();
}
configureRuntime({ dbKey: KEY });

let api: TestClient;
let db: Database.Database;
let backups: typeof import('../src/services/backupService.js');
let sqlite: typeof import('../src/db/sqlite.js');
const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;

function plainCopyOf(encryptedFile: string, dest: string) {
  fs.copyFileSync(encryptedFile, dest);
  const d = new Database(dest);
  d.pragma(`key = '${KEY}'`);
  d.pragma("rekey = ''");
  d.close();
  assert.ok(sqlite.isPlainSqliteFile(dest));
}

before(async () => {
  api = await startTestServer();
  db = (await import('../src/db/connection.js')).db;
  backups = await import('../src/services/backupService.js');
  sqlite = await import('../src/db/sqlite.js');
  await setupBusiness(api, { businessName: 'Cipher Traders' });
  await createProduct(api, { name: 'Encrypted product' });
});
after(async () => { await api.close(); });

test('a plain database from an older version is encrypted on first start, with its data intact', () => {
  assert.equal(sqlite.isPlainSqliteFile(dbPath), false);
  assert.equal(fs.existsSync(`${dbPath}.pre-encryption`), false);
  assert.equal((db.prepare("SELECT value FROM system_settings WHERE key = 'legacy_marker'").get() as any).value, 'kept');
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
});

test('the database cannot be opened without the key, or with a different one', () => {
  assert.throws(() => sqlite.openDatabase(dbPath, null, { readonly: true }), /not a database/);
  assert.throws(() => sqlite.openDatabase(dbPath, crypto.randomBytes(32).toString('hex'), { readonly: true }), /not a database/);
  const raw = fs.readFileSync(dbPath);
  assert.equal(raw.includes(Buffer.from('Cipher Traders')), false, 'business name must not be readable in the file');
});

test('backups are encrypted, verified, and restore', async () => {
  const b = await backups.createBackup({ kind: 'MANUAL', notes: 'enc' });
  assert.equal(b.status, 'VERIFIED');
  assert.equal(sqlite.isPlainSqliteFile(b.file_path), false);
  assert.equal(fs.readFileSync(b.file_path).includes(Buffer.from('Encrypted product')), false);

  await createProduct(api, { name: 'Added after backup' });
  const r = await backups.restoreBackupById(b.id);
  assert.equal(r.restoredFrom, path.basename(b.file_path));
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM products WHERE name = 'Added after backup'").get() as any).c, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM products WHERE name = 'Encrypted product'").get() as any).c, 1);
});

test('a plain backup made by an older version still inspects and restores', async () => {
  const enc = await backups.createBackup({ kind: 'MANUAL' });
  const plain = path.join(dataDir, 'old-version-backup.db');
  plainCopyOf(enc.file_path, plain);
  assert.equal(backups.inspectBackupFile(plain).ok, true);
  await createProduct(api, { name: 'Gone after plain restore' });
  await backups.restoreFromFile(plain);
  assert.equal(count('businesses'), 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM products WHERE name = 'Gone after plain restore'").get() as any).c, 0);
});

test('plain backups listed in the history are encrypted once, and still verify', async () => {
  const enc = await backups.createBackup({ kind: 'MANUAL' });
  plainCopyOf(enc.file_path, enc.file_path + '.plain');
  fs.renameSync(enc.file_path + '.plain', enc.file_path);
  assert.equal(backups.verifyBackup(enc.id).checksumMatches, false);

  assert.ok(backups.encryptLegacyBackups() >= 1);
  assert.equal(sqlite.isPlainSqliteFile(enc.file_path), false);
  const v = backups.verifyBackup(enc.id);
  assert.equal(v.status, 'VERIFIED');
  assert.equal(v.checksumMatches, true);
});

test('an interrupted encryption is redone from the untouched copy', () => {
  const f = path.join(dataDir, 'interrupted.db');
  const p = new Database(f);
  p.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('original')");
  p.close();
  fs.copyFileSync(f, `${f}.pre-encryption`);
  fs.writeFileSync(f, crypto.randomBytes(8192)); // half-written file left by a power cut
  sqlite.encryptFileInPlace(f, KEY);
  assert.equal(fs.existsSync(`${f}.pre-encryption`), false);
  const e = sqlite.openDatabase(f, KEY, { readonly: true });
  assert.equal((e.prepare('SELECT v FROM t').get() as any).v, 'original');
  e.close();
});
