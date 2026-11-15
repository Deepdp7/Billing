import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { setupTestEnv, startTestServer, setupBusiness, createProduct, TestClient } from './helpers.js';

setupTestEnv({ enforceLicense: true });

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const DAY = 86400000;

let api: TestClient;
let db: any;
let lic: typeof import('../src/licensing/licenseClient.js');
let FEATURE_KEYS: readonly string[];

function sign(payload: object, key = privateKey) {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${b64url(crypto.sign(null, Buffer.from(body), key))}`;
}

function payload(over: Record<string, any> = {}) {
  const now = Date.now();
  return {
    v: 1, iid: 'inst-1', lid: 'lic-1', cid: 'cust-1', customerName: 'Test Customer', licenseKeyHint: 'ABCD',
    type: 'TRIAL', plan: { code: 'TRIAL', name: 'Trial' }, status: 'ACTIVE', installationStatus: 'ACTIVE',
    licenseExpiresAt: new Date(now + 7 * DAY).toISOString(),
    features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, { enabled: true }])),
    maxDevices: 1, graceDays: 7, iat: new Date(now).toISOString(), exp: new Date(now + 7 * DAY).toISOString(),
    ...over,
  };
}

function install(p: object, token?: string) {
  db.prepare('INSERT OR IGNORE INTO license_state (id) VALUES (1)').run();
  db.prepare("UPDATE license_state SET installation_id = 'inst-1', installation_secret = 's', license_token = ?, max_seen_time = NULL WHERE id = 1")
    .run(token ?? sign(p));
}

before(async () => {
  api = await startTestServer();
  db = (await import('../src/db/connection.js')).db;
  lic = await import('../src/licensing/licenseClient.js');
  FEATURE_KEYS = (await import('../src/licensing/features.js')).FEATURE_KEYS;
  lic.__setPublicKeyForTests(publicKey.export({ type: 'spki', format: 'pem' }) as string);
});
after(async () => { await api.close(); });

test('unlicensed install can create its owner account first, but cannot use the app until a trial or key is active', async () => {
  const s = (await api.get('/license/status')).data;
  assert.equal(s.mode, 'UNLICENSED');
  await setupBusiness(api); // 201: first-run order is account → trial/key
  assert.equal((await api.post('/app/customers', { name: 'Not yet' })).status, 402);
});

test('active trial: setup and billing work, trial days are reported', async () => {
  install(payload());
  const s = (await api.get('/license/status')).data;
  assert.equal(s.mode, 'ACTIVE');
  assert.equal(s.license.type, 'TRIAL');
  assert.equal(s.license.daysRemaining, 7);
  const p = await createProduct(api);
  const inv = await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: 1, unitPricePaise: 100 }] });
  assert.equal(inv.status, 201);
});

test('a token edited in SQLite fails signature verification', async () => {
  const good = sign(payload());
  const [body, sig] = good.split('.');
  const forged = JSON.parse(Buffer.from(body, 'base64').toString());
  forged.licenseExpiresAt = '2099-01-01T00:00:00.000Z';
  forged.type = 'PAID';
  install({}, `${b64url(Buffer.from(JSON.stringify(forged)))}.${sig}`);
  assert.equal((await api.get('/license/status')).data.mode, 'INVALID');
  assert.equal((await api.post('/app/customers', { name: 'X' })).status, 402);
});

test('a token signed by a different key is rejected', async () => {
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  install({}, sign(payload(), other));
  assert.equal((await api.get('/license/status')).data.mode, 'INVALID');
});

test('a token for another installation is rejected', async () => {
  install({}, sign(payload({ iid: 'someone-else' })));
  assert.equal((await api.get('/license/status')).data.mode, 'INVALID');
});

test('expired trial → read-only: data can be viewed and backed up, not created', async () => {
  install(payload({ licenseExpiresAt: new Date(Date.now() - 1000).toISOString() }));
  const s = (await api.get('/license/status')).data;
  assert.equal(s.mode, 'EXPIRED');
  assert.equal(s.canWrite, false);
  assert.equal((await api.get('/app/customers')).status, 200);
  assert.equal((await api.get('/app/billing/invoices')).status, 200);
  assert.equal((await api.get('/app/backups/export')).status, 200);
  const write = await api.post('/app/customers', { name: 'Blocked' });
  assert.equal(write.status, 402);
  assert.equal(write.data.code, 'LICENSE_EXPIRED');
});

test('offline longer than the grace period → read-only until the app reconnects', async () => {
  install(payload({ iat: new Date(Date.now() - 10 * DAY).toISOString(), exp: new Date(Date.now() - DAY).toISOString() }));
  assert.equal((await api.get('/license/status')).data.mode, 'GRACE_EXPIRED');
  assert.equal((await api.post('/app/customers', { name: 'Blocked' })).status, 402);
});

test('within the offline grace period billing continues normally', async () => {
  install(payload({ iat: new Date(Date.now() - 5 * DAY).toISOString(), exp: new Date(Date.now() + 2 * DAY).toISOString() }));
  const s = (await api.get('/license/status')).data;
  assert.equal(s.mode, 'ACTIVE');
  assert.equal(s.offline.daysRemaining, 2);
  assert.equal((await api.post('/app/customers', { name: 'Offline OK' })).status, 201);
});

test('clock turned back before the token issue time is detected', async () => {
  install(payload({ iat: new Date(Date.now() + 3 * DAY).toISOString(), exp: new Date(Date.now() + 10 * DAY).toISOString() }));
  assert.equal((await api.get('/license/status')).data.mode, 'CLOCK_TAMPERED');
});

test('suspended and revoked licenses, deactivated devices', async () => {
  install(payload({ status: 'SUSPENDED' }));
  assert.equal((await api.get('/license/status')).data.mode, 'SUSPENDED');
  install(payload({ status: 'REVOKED' }));
  assert.equal((await api.get('/license/status')).data.mode, 'REVOKED');
  install(payload({ installationStatus: 'SUSPENDED' }));
  assert.equal((await api.get('/license/status')).data.mode, 'SUSPENDED');
  install(payload({ installationStatus: 'DEACTIVATED' }));
  assert.equal((await api.get('/license/status')).data.mode, 'DEACTIVATED');
});

test('disabled features are refused by the backend (not just hidden in the UI)', async () => {
  const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, { enabled: true }]));
  features.purchases = { enabled: false };
  features.reports_advanced = { enabled: false };
  features.data_export = { enabled: false };
  install(payload({ features }));
  assert.equal((await api.get('/app/purchases')).status, 403);
  assert.equal((await api.post('/app/suppliers', { name: 'S' })).data.code, 'FEATURE_DISABLED');
  assert.equal((await api.get('/app/reports/cash-flow')).status, 403);
  assert.equal((await api.get('/app/reports/sales')).status, 200);
  assert.equal((await api.get('/app/customers/export')).status, 403);
  // Full-data backup export is never gated by data_export (regression found in E2E).
  assert.equal((await api.get('/app/backups/export')).status, 200);
  // POS still loads suppliers/products/customers lookups even when their management screens are disabled.
  assert.equal((await api.get('/app/suppliers')).status, 200);
  assert.equal((await api.get('/app/billing/invoices')).status, 200);
});

test('temporary feature access expires at its expiry time', async () => {
  const features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, { enabled: true }]));
  features.expenses = { enabled: true, expiresAt: new Date(Date.now() - 1000).toISOString() } as any;
  features.quotations = { enabled: true, expiresAt: new Date(Date.now() + DAY).toISOString() } as any;
  install(payload({ features }));
  assert.equal((await api.get('/app/expenses')).status, 403);
  assert.equal((await api.get('/app/quotations')).status, 200);
});

test('usage is counted per feature (metadata only) after successful operations', async () => {
  install(payload());
  db.prepare('DELETE FROM feature_usage').run();
  const p = await createProduct(api);
  await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: 1, unitPricePaise: 100 }] });
  await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: 1, unitPricePaise: 100 }] });
  await api.post('/app/billing/checkout', { items: [] }); // failed → not counted
  await api.get('/app/reports/sales');
  const rows = db.prepare('SELECT feature_key, count FROM feature_usage').all() as any[];
  const by = Object.fromEntries(rows.map((r) => [r.feature_key, r.count]));
  assert.equal(by.billing, 2);
  assert.equal(by.products, 1);
  assert.equal(by.reports_basic, 1);
  assert.deepEqual(Object.keys(db.prepare('SELECT * FROM feature_usage LIMIT 1').get()).sort(),
    ['count', 'feature_key', 'first_used_at', 'last_used_at', 'synced_count', 'usage_date']);
});

test('license sync failure never blocks billing (server unreachable)', async () => {
  install(payload());
  const s = await lic.syncLicense('manual');
  assert.equal(s.mode, 'ACTIVE');
  assert.ok(s.offline.lastSyncError);
  const p = await createProduct(api);
  assert.equal((await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: 1, unitPricePaise: 100 }] })).status, 201);
});

test('feature catalog matches the license server catalog', async () => {
  const fs = await import('fs');
  const path = await import('path');
  const serverCatalog = path.resolve(process.cwd(), '..', 'license-server', 'src', 'features.ts');
  if (!fs.existsSync(serverCatalog)) return;
  const src = fs.readFileSync(serverCatalog, 'utf8');
  const keys = [...src.matchAll(/key:\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...keys].sort(), [...FEATURE_KEYS].sort());
});
