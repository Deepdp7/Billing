import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
process.env.SQLITE_FILE = path.join(tmp, 'license.db');
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

let base = '';
let server: any;
let knex: any;

async function call(url: string, body: unknown, cred?: { installationId: string; installationSecret: string }) {
  const res = await fetch(`${base}/api/client/v1${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cred ? { Authorization: `Bearer ${cred.installationId}.${cred.installationSecret}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) as any };
}
const fp = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const device = (name: string) => ({ deviceName: name, os: 'Windows 11', appVersion: '1.1.0', fingerprint: fp(name) });
const COUNTERS = { products: ['stock_quantity'] };
const pk = (id: string) => JSON.stringify([id]);

before(async () => {
  const db = await import('../src/db.js');
  knex = db.knex;
  const { migrateLatest } = await import('../src/migrations.js');
  await migrateLatest(knex);
  const { createApp } = await import('../src/app.js');
  server = await new Promise((r) => { const s = createApp().listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  await knex?.destroy();
});

test('sync: two computers of one account share rows and counter changes, each counted once', async () => {
  const one = (await call('/trial', { name: 'Asha', businessName: 'Asha Stores', email: 'asha@sync.in', device: device('SYNC-1') })).data;
  const license = await knex('installations').where({ id: one.installationId }).first();
  await knex('licenses').where({ id: license.license_id }).update({ max_devices: 3 });
  const key = (await knex('licenses').where({ id: license.license_id }).first()).license_key;
  const two = (await call('/activate', { licenseKey: key, device: device('SYNC-2') })).data;
  assert.ok(two.installationId, JSON.stringify(two));

  // The first computer starts the account's data; the second joins it (another business id on its side)
  const r1 = (await call('/sync/register', { businessId: 'biz-1', invoices: 3 }, one)).data;
  assert.equal(r1.role, 'seed');
  assert.equal(r1.primary, true);
  const r2 = (await call('/sync/register', { businessId: 'biz-2', invoices: 0 }, two)).data;
  assert.equal(r2.role, 'join');
  assert.equal(r2.businessId, 'biz-1');
  assert.equal(r2.primary, false);
  assert.notEqual(r2.deviceNo, r1.deviceNo);

  // A product with stock 10 (sent before its change of -1 is: its copy carries 10 - (-1 not yet sent) = as it was)
  let p = await call('/sync/push', { epoch: 1, counters: COUNTERS, rows: [{ t: 'products', p: pk('p1'), d: { id: 'p1', name: 'Pen', stock_quantity: 10 } }],
    deltas: [{ id: 'delta-00000001', t: 'products', p: pk('p1'), c: 'stock_quantity', v: -1 }] }, one);
  assert.equal(p.status, 200, JSON.stringify(p.data));

  // The second computer gets the product with the change already in it (stock 9)
  let pull = (await call('/sync/pull', { epoch: 1, after: 0 }, two)).data;
  const row = pull.events.find((e: any) => e.k === 'r' && e.p === pk('p1'));
  assert.equal(row.d.stock_quantity, 9);
  assert.ok(pull.events.some((e: any) => e.k === 'd' && e.s < row.s), 'the change comes before the copy that includes it');
  let cursor2 = pull.next;

  // Both sell at once: -2 on one, -3 on two. A later edit of the name from two does not overwrite the stock.
  await call('/sync/push', { epoch: 1, counters: COUNTERS, rows: [], deltas: [{ id: 'delta-00000002', t: 'products', p: pk('p1'), c: 'stock_quantity', v: -2 }] }, one);
  await call('/sync/push', { epoch: 1, counters: COUNTERS, rows: [{ t: 'products', p: pk('p1'), d: { id: 'p1', name: 'Pen (blue)', stock_quantity: 999 } }],
    deltas: [{ id: 'delta-00000003', t: 'products', p: pk('p1'), c: 'stock_quantity', v: -3 }] }, two);
  // The same change sent twice (an answer that got lost) counts once
  await call('/sync/push', { epoch: 1, counters: COUNTERS, rows: [], deltas: [{ id: 'delta-00000003', t: 'products', p: pk('p1'), c: 'stock_quantity', v: -3 }] }, two);
  const stored = await knex('sync_rows').where({ tbl: 'products', pk: pk('p1') }).first();
  const { openSecret } = await import('../src/accounts.js');
  const data = JSON.parse(openSecret(stored.data)!);
  assert.equal(data.stock_quantity, 4, '10 - 1 - 2 - 3');
  assert.equal(data.name, 'Pen (blue)');
  assert.ok(!String(stored.data).includes('Pen'), 'stored sealed');

  // Each computer only fetches what the others did
  pull = (await call('/sync/pull', { epoch: 1, after: cursor2 }, two)).data;
  assert.deepEqual(pull.events.filter((e: any) => e.k === 'd').map((e: any) => e.v), [-2]);
  cursor2 = pull.next;
  const pull1 = (await call('/sync/pull', { epoch: 1, after: r1.lastSeq }, one)).data;
  assert.ok(pull1.events.some((e: any) => e.k === 'd' && e.v === -3));
  assert.ok(!pull1.events.some((e: any) => e.k === 'd' && (e.v === -1 || e.v === -2)));

  // Deletes arrive as such
  await call('/sync/push', { epoch: 1, counters: COUNTERS, rows: [{ t: 'products', p: pk('p1'), x: true }], deltas: [] }, one);
  pull = (await call('/sync/pull', { epoch: 1, after: cursor2 }, two)).data;
  assert.ok(pull.events.some((e: any) => e.k === 'r' && e.p === pk('p1') && e.x === 1));
});

test('sync: pages never skip anything, and a restore elsewhere makes the others start over', async () => {
  const one = (await call('/trial', { name: 'Bina', businessName: 'Bina Stores', email: 'bina@sync.in', device: device('SYNC-3') })).data;
  await call('/sync/register', { businessId: 'biz-b', invoices: 0 }, one);
  const rows = Array.from({ length: 25 }, (_, i) => ({ t: 'customers', p: pk(`c${i}`), d: { id: `c${i}`, name: `Customer ${i}` } }));
  const deltas = Array.from({ length: 25 }, (_, i) => ({ id: `delta-cust-${i}`, t: 'customers', p: pk(`c${i}`), c: 'outstanding_balance_paise', v: 100 }));
  await call('/sync/push', { epoch: 1, counters: { customers: ['outstanding_balance_paise'] }, rows, deltas }, one);
  // Fetch in small pages as a fresh computer would (everything, own changes included)
  const got = new Map<string, any>();
  let after = 0;
  for (let i = 0; i < 100; i++) {
    const page = (await call('/sync/pull', { epoch: 1, after, full: true, limit: 7 }, one)).data;
    for (const e of page.events) got.set(e.p, e);
    after = page.next;
    if (!page.more) break;
  }
  assert.equal(got.size, 25);
  assert.ok([...got.values()].every((e) => e.d.outstanding_balance_paise === 100));

  const reset = (await call('/sync/reset', { businessId: 'biz-b2', invoices: 0 }, one)).data;
  assert.equal(reset.epoch, 2);
  const stale = await call('/sync/pull', { epoch: 1, after: 0 }, one);
  assert.equal(stale.data.code, 'SYNC_EPOCH_CHANGED');
  const fresh = (await call('/sync/pull', { epoch: 2, after: 0, full: true }, one)).data;
  assert.equal(fresh.events.length, 0, 'the restoring computer sends its data again');
});

test('sync: computers not on the licence get nothing', async () => {
  const res = await call('/sync/pull', { epoch: 1, after: 0 }, { installationId: crypto.randomUUID(), installationSecret: 'x'.repeat(40) });
  assert.equal(res.status, 401);
});
