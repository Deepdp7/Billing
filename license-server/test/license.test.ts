import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-test-'));
process.env.SQLITE_FILE = path.join(tmp, 'license.db');
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const DAY = 86400000;
const publicPem = fs.readFileSync(path.resolve('keys', 'signing-public.pem'), 'utf8');
let base = '';
let server: any;
let knex: any;
let adminToken = '';

function verify(token: string) {
  const [body, sig] = token.split('.');
  const ok = crypto.verify(null, Buffer.from(body), crypto.createPublicKey(publicPem), Buffer.from(sig, 'base64url'));
  assert.ok(ok, 'token signature must verify with the public key');
  return JSON.parse(Buffer.from(body, 'base64url').toString());
}

async function call(method: string, url: string, body?: unknown, auth?: string) {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) as any };
}
const admin = (method: string, url: string, body?: unknown, tok = adminToken) => call(method, `/api/admin/v1${url}`, body, tok);
const client = (url: string, body: unknown, cred?: { installationId: string; installationSecret: string }) =>
  call('POST', `/api/client/v1${url}`, body, cred ? `${cred.installationId}.${cred.installationSecret}` : undefined);

const fp = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const device = (name: string) => ({ deviceName: name, os: 'Windows 11', appVersion: '1.1.0', fingerprint: fp(name) });

before(async () => {
  const db = await import('../src/db.js');
  knex = db.knex;
  if (process.env.DATABASE_URL) {
    await knex.raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  const { migrateLatest } = await import('../src/migrations.js');
  await migrateLatest(knex);
  const bcrypt = (await import('bcryptjs')).default;
  await knex('admin_users').insert({ id: crypto.randomUUID(), email: 'owner@vendor.test', name: 'Owner', role: 'OWNER',
    password_hash: bcrypt.hashSync('correct horse battery', 4), status: 'ACTIVE', totp_enabled: false, created_at: new Date().toISOString() });
  const { createApp } = await import('../src/app.js');
  server = await new Promise((r) => { const s = createApp().listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  await knex?.destroy();
});

test('admin authentication: wrong password rejected, correct password yields a session', async () => {
  assert.equal((await call('POST', '/api/admin/v1/auth/login', { email: 'owner@vendor.test', password: 'nope' })).status, 401);
  const r = await call('POST', '/api/admin/v1/auth/login', { email: 'owner@vendor.test', password: 'correct horse battery' });
  assert.equal(r.status, 200);
  adminToken = r.data.token;
  assert.equal((await admin('GET', '/auth/me')).data.admin.role, 'OWNER');
  assert.equal((await admin('GET', '/dashboard', undefined, 'invalid-token-'.padEnd(43, 'x'))).status, 401);
});

let trial: any;

test('trial activation registers the installation and returns a signed 7-day token with trial features', async () => {
  const r = await client('/trial', { name: 'Asha', businessName: 'Asha Stores', email: 'asha@shop.in', phone: '9000000000', device: device('PC-A') });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  trial = r.data;
  const p = verify(trial.token);
  assert.equal(p.type, 'TRIAL');
  assert.equal(p.status, 'ACTIVE');
  assert.equal(p.iid, trial.installationId);
  const days = (Date.parse(p.licenseExpiresAt) - Date.now()) / DAY;
  assert.ok(days > 6.99 && days <= 7.0001, `trial length ${days}`);
  assert.equal(p.features.billing.enabled, true);
  assert.equal(p.features.purchases.enabled, false);
  assert.equal(p.features.data_export.enabled, false);
  // Secrets are stored hashed only.
  const row = await knex('installations').where({ id: trial.installationId }).first();
  assert.notEqual(row.secret_hash, trial.installationSecret);
});

test('one trial per email and per device', async () => {
  assert.equal((await client('/trial', { name: 'Asha', businessName: 'XY', email: 'asha@shop.in', device: device('PC-Z') })).data.code, 'TRIAL_ALREADY_USED');
  assert.equal((await client('/trial', { name: 'Other', businessName: 'XY', email: 'other@shop.in', device: device('PC-A') })).data.code, 'TRIAL_ALREADY_USED');
});

test('heartbeat requires valid installation credentials', async () => {
  assert.equal((await client('/heartbeat', {}, { installationId: trial.installationId, installationSecret: 'wrong-secret-xxxxxxxxxxxxxxxxx' })).status, 401);
  const r = await client('/heartbeat', { appVersion: '1.1.0' }, trial);
  assert.equal(r.status, 200);
  assert.equal(verify(r.data.token).iid, trial.installationId);
});

test('usage ingestion is idempotent (absolute daily counts)', async () => {
  const items = (count: number) => ({ items: [{ feature: 'billing', date: '2026-11-01', count }, { feature: 'customers', date: '2026-11-01', count: 3 }] });
  assert.equal((await client('/usage', items(5), trial)).status, 200);
  await client('/usage', items(5), trial);
  await client('/usage', items(7), trial);
  await client('/usage', items(6), trial); // late/out-of-order resend never lowers the count
  const row = await knex('usage_daily').where({ installation_id: trial.installationId, feature_key: 'billing' }).first();
  assert.equal(Number(row.count), 7);
  assert.equal((await client('/usage', { items: [{ feature: 'not_a_feature', date: '2026-11-01', count: 1 }] }, trial)).status, 400);
  const usage = (await admin('GET', `/usage?installationId=${trial.installationId}`)).data;
  assert.equal(usage.byFeature.find((f: any) => f.feature_key === 'billing').count, 7);
});

test('admin dashboard reflects installations and trials', async () => {
  const d = (await admin('GET', '/dashboard')).data;
  assert.equal(d.stats.totalInstallations, 1);
  assert.equal(d.stats.activeTrials, 1);
  assert.ok(d.featureUsage.some((f: any) => f.feature === 'billing'));
});

test('trial extension, expiry and conversion to a paid 1-year license', async () => {
  const lic = await knex('licenses').where({ type: 'TRIAL' }).first();
  const ext = await admin('POST', `/licenses/${lic.id}/extend`, { days: 3, reason: 'Demo requested' });
  assert.equal(ext.status, 200);
  assert.ok(Math.abs(Date.parse(ext.data.license.expires_at) - Date.parse(lic.expires_at) - 3 * DAY) < 5000);

  await knex('licenses').where({ id: lic.id }).update({ expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal(verify((await client('/heartbeat', {}, trial)).data.token).status, 'EXPIRED');

  const conv = await admin('POST', `/licenses/${lic.id}/convert`, { planCode: 'YEAR_1', paymentReference: 'UPI-778', paymentAmountPaise: 499900 });
  assert.equal(conv.status, 200);
  const p = verify((await client('/heartbeat', {}, trial)).data.token);
  assert.equal(p.type, 'PAID');
  assert.equal(p.status, 'ACTIVE');
  assert.equal(p.features.purchases.enabled, true);
  const days = (Date.parse(p.licenseExpiresAt) - Date.now()) / DAY;
  assert.ok(days > 364.9 && days <= 365.001);
  const events = (await admin('GET', `/licenses/${lic.id}`)).data.events.map((e: any) => e.event_type);
  for (const e of ['TRIAL_STARTED', 'ACTIVATED', 'TRIAL_EXTENDED', 'TRIAL_CONVERTED']) assert.ok(events.includes(e), e);
});

test('one-year license expires after its term; renewal extends from the expiry date', async () => {
  const lic = await knex('licenses').where({ customer_id: (await knex('customers').where({ email: 'asha@shop.in' }).first()).id }).first();
  const at = new Date(Date.now() + 10 * DAY).toISOString();
  await knex('licenses').where({ id: lic.id }).update({ expires_at: at });
  const r = await admin('POST', `/licenses/${lic.id}/renew`, { planCode: 'YEAR_1', paymentAmountPaise: 499900 });
  assert.ok(Math.abs(Date.parse(r.data.license.expires_at) - (Date.parse(at) + 365 * DAY)) < 5000, 'renewal adds a year to the current expiry');
});

test('feature permissions: installation > license > customer > global > plan, with temporary access', async () => {
  const lic = await knex('licenses').where({ id: verify(trial.token).lid }).first();
  const cust = lic.customer_id;
  const put = (b: object) => admin('PUT', '/feature-overrides', b);
  assert.equal((await put({ scope: 'GLOBAL', featureKey: 'online_store', enabled: false, reason: 'kill switch' })).status, 200);
  await put({ scope: 'CUSTOMER', scopeId: cust, featureKey: 'reports_advanced', enabled: false });
  await put({ scope: 'LICENSE', scopeId: lic.id, featureKey: 'reports_advanced', enabled: true });
  await put({ scope: 'INSTALLATION', scopeId: trial.installationId, featureKey: 'data_export', enabled: false });
  const until = new Date(Date.now() + 2 * DAY).toISOString();
  await put({ scope: 'CUSTOMER', scopeId: cust, featureKey: 'online_store', enabled: true, expiresAt: until });
  await put({ scope: 'INSTALLATION', scopeId: trial.installationId, featureKey: 'loyalty', enabled: true, expiresAt: new Date(Date.now() - 1000).toISOString() });

  const p = verify((await client('/heartbeat', {}, trial)).data.token);
  assert.equal(p.features.reports_advanced.enabled, true, 'license beats customer');
  assert.equal(p.features.data_export.enabled, false, 'installation-level disable');
  assert.equal(p.features.online_store.enabled, true, 'customer grant beats global kill switch');
  assert.equal(p.features.online_store.expiresAt, until, 'temporary access carries expiry into the token');
  assert.equal(p.features.loyalty.enabled, true, 'expired override ignored → falls back to plan');
  assert.equal(p.features.billing.enabled, true, 'untouched features keep plan value');

  // Restoration: deleting the override restores inheritance.
  const ov = await knex('feature_overrides').where({ scope: 'INSTALLATION', feature_key: 'data_export' }).first();
  await admin('DELETE', `/feature-overrides/${ov.id}`);
  assert.equal(verify((await client('/heartbeat', {}, trial)).data.token).features.data_export.enabled, true);
});

test('suspend / reactivate / revoke license, suspend installation', async () => {
  const lid = verify(trial.token).lid;
  await admin('POST', `/licenses/${lid}/suspend`, { reason: 'payment dispute' });
  assert.equal(verify((await client('/heartbeat', {}, trial)).data.token).status, 'SUSPENDED');
  await admin('POST', `/licenses/${lid}/reactivate`);
  assert.equal(verify((await client('/heartbeat', {}, trial)).data.token).status, 'ACTIVE');

  await admin('POST', `/installations/${trial.installationId}/suspend`);
  assert.equal(verify((await client('/heartbeat', {}, trial)).data.token).installationStatus, 'SUSPENDED');
  await admin('POST', `/installations/${trial.installationId}/activate`);
  assert.equal(verify((await client('/heartbeat', {}, trial)).data.token).installationStatus, 'ACTIVE');
});

test('paid lifetime license with device limit; client deactivation frees the slot', async () => {
  const cust = (await admin('POST', '/customers', { name: 'Bala', businessName: 'Bala Traders', email: 'bala@x.in' })).data.customer;
  const lic = (await admin('POST', '/licenses', { customerId: cust.id, planCode: 'LIFETIME', maxDevices: 1, paymentAmountPaise: 1999900 })).data.license;
  assert.equal(lic.expires_at, null);
  assert.match(lic.license_key, /^APNA(-[A-Z0-9]{4}){4}$/);
  const a = await client('/activate', { licenseKey: lic.license_key, device: device('Bala-1') });
  assert.equal(a.status, 201);
  assert.equal(verify(a.data.token).licenseExpiresAt, null);
  const b = await client('/activate', { licenseKey: lic.license_key, device: device('Bala-2') });
  assert.equal(b.status, 409);
  assert.equal(b.data.code, 'DEVICE_LIMIT_REACHED');
  assert.equal((await client('/deactivate', {}, a.data)).status, 200);
  assert.equal(verify((await client('/heartbeat', {}, a.data)).data.token).installationStatus, 'DEACTIVATED');
  assert.equal((await client('/activate', { licenseKey: lic.license_key, device: device('Bala-2') })).status, 201);
  assert.equal((await admin('PUT', `/licenses/${lic.id}`, { maxDevices: 2 })).status, 200);
  assert.equal((await client('/activate', { licenseKey: lic.license_key, device: device('Bala-3') })).status, 201);
  assert.equal((await client('/activate', { licenseKey: 'APNA-AAAA-BBBB-CCCC-DDDD', device: device('x') })).status, 404);
});

test('delete customer: owner only, name confirmation, blocked while devices are live, removes all linked rows', async () => {
  const cust = (await admin('POST', '/customers', { name: 'Chitra', businessName: 'Chitra Cloths', email: 'chitra@x.in' })).data.customer;
  const lic = (await admin('POST', '/licenses', { customerId: cust.id, planCode: 'MONTH_1' })).data.license;
  const act = await client('/activate', { licenseKey: lic.license_key, device: device('Chitra-1') });
  assert.equal(act.status, 201);
  await client('/usage', { events: [{ featureKey: 'billing', date: new Date().toISOString().slice(0, 10), count: 3 }] }, act.data);
  await admin('PUT', '/feature-overrides', { scope: 'CUSTOMER', scopeId: cust.id, featureKey: 'reports', enabled: false });

  // Non-owners cannot delete.
  await admin('POST', '/admin-users', { email: 'admin2@vendor.test', name: 'A2', role: 'ADMIN', password: 'admin2-password-1' });
  const a2 = (await call('POST', '/api/admin/v1/auth/login', { email: 'admin2@vendor.test', password: 'admin2-password-1' })).data.token;
  assert.equal((await admin('DELETE', `/customers/${cust.id}`, { confirmName: 'Chitra Cloths' }, a2)).status, 403);

  // The typed name must match.
  const wrong = await admin('DELETE', `/customers/${cust.id}`, { confirmName: 'Someone else' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.code, 'CONFIRMATION_MISMATCH');

  // A live device blocks the delete, and nothing is removed.
  const blocked = await admin('DELETE', `/customers/${cust.id}`, { confirmName: 'chitra cloths' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'CUSTOMER_HAS_ACTIVE_DEVICES');
  assert.ok(await knex('customers').where({ id: cust.id }).first());

  // After revoking, delete succeeds and removes every linked row; the audit log keeps a record.
  assert.equal((await admin('POST', `/licenses/${lic.id}/revoke`, { reason: 'test' })).status, 200);
  const ok = await admin('DELETE', `/customers/${cust.id}`, { confirmName: 'chitra cloths', reason: 'cleanup' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await admin('GET', `/customers/${cust.id}`)).status, 404);
  for (const [table, col] of [['licenses', 'customer_id'], ['installations', 'customer_id'], ['license_events', 'customer_id']] as const) {
    assert.equal((await knex(table).where({ [col]: cust.id })).length, 0, table);
  }
  assert.equal((await knex('usage_daily').where({ installation_id: act.data.installationId })).length, 0);
  assert.equal((await knex('feature_overrides').where({ scope: 'CUSTOMER', scope_id: cust.id })).length, 0);
  const audit = (await admin('GET', '/audit-logs')).data.data.find((a: any) => a.action === 'CUSTOMER_DELETED' && a.entity_id === cust.id);
  assert.ok(audit, 'deletion is audit-logged');

  // The deleted installation can no longer sync, and the customer's email may start a fresh trial.
  assert.equal((await client('/heartbeat', {}, act.data)).status, 401);
  assert.equal((await admin('DELETE', `/customers/${cust.id}`, { confirmName: 'x' })).status, 404);
});

test('revoked license cannot be reactivated or activated', async () => {
  const cust = (await admin('POST', '/customers', { name: 'Chandra' })).data.customer;
  const lic = (await admin('POST', '/licenses', { customerId: cust.id, planCode: 'MONTH_1' })).data.license;
  await admin('POST', `/licenses/${lic.id}/revoke`, { reason: 'fraud' });
  assert.equal((await admin('POST', `/licenses/${lic.id}/reactivate`)).status, 409);
  assert.equal((await client('/activate', { licenseKey: lic.license_key, device: device('C-1') })).data.code, 'LICENSE_REVOKED');
});

test('custom-duration license and plan change', async () => {
  const cust = (await admin('POST', '/customers', { name: 'Dev' })).data.customer;
  const lic = (await admin('POST', '/licenses', { customerId: cust.id, planCode: 'MONTH_1', durationDays: 45 })).data.license;
  assert.ok(Math.abs(Date.parse(lic.expires_at) - Date.now() - 45 * DAY) < 5000);
  const ch = await admin('POST', `/licenses/${lic.id}/change-plan`, { planCode: 'MONTH_6', resetExpiry: true });
  assert.ok(Math.abs(Date.parse(ch.data.license.expires_at) - Date.now() - 180 * DAY) < 5000);
});

test('credential rotation: new secret delivered on heartbeat, promoted on first use, old secret then rejected', async () => {
  await admin('POST', `/installations/${trial.installationId}/rotate-credentials`);
  const r = await client('/heartbeat', {}, trial);
  assert.ok(r.data.newSecret);
  const rotated = { installationId: trial.installationId, installationSecret: r.data.newSecret };
  assert.equal((await client('/heartbeat', {}, rotated)).status, 200);
  assert.equal((await client('/heartbeat', {}, trial)).status, 401);
  trial = { ...rotated, token: trial.token };
});

test('force revalidation shortens the offline window to one day', async () => {
  await admin('POST', `/installations/${trial.installationId}/force-revalidate`);
  const p = verify((await client('/heartbeat', {}, trial)).data.token);
  assert.ok(Date.parse(p.exp) - Date.parse(p.iat) <= DAY);
  await admin('POST', `/installations/${trial.installationId}/clear-revalidate`);
  const p2 = verify((await client('/heartbeat', {}, trial)).data.token);
  assert.equal(Math.round((Date.parse(p2.exp) - Date.parse(p2.iat)) / DAY), 7);
});

test('targeted notices and update notifications reach the right installation', async () => {
  await admin('POST', '/notices', { title: 'Maintenance', message: 'Server maintenance Sunday', level: 'INFO' });
  await admin('POST', '/notices', { title: 'Just you', message: 'Hi', targetScope: 'INSTALLATION', targetId: trial.installationId });
  await admin('PUT', '/settings', { latest_version: '1.2.0', update_message: 'New GST report' });
  const r = (await client('/heartbeat', { appVersion: '1.1.0' }, trial)).data;
  assert.deepEqual(r.notices.map((n: any) => n.title).sort(), ['Just you', 'Maintenance']);
  assert.equal(r.update.latestVersion, '1.2.0');
  assert.equal(r.update.mandatory, false);
  assert.equal((await admin('PUT', '/settings', { latest_version: 'banana' })).status, 400);
});

test('role-based access: VIEWER cannot change licenses; audit log records admin actions', async () => {
  await admin('POST', '/admin-users', { email: 'viewer@vendor.test', name: 'V', role: 'VIEWER', password: 'viewer-password-1' });
  const v = (await call('POST', '/api/admin/v1/auth/login', { email: 'viewer@vendor.test', password: 'viewer-password-1' })).data.token;
  const lid = verify(trial.token).lid;
  assert.equal((await admin('GET', '/licenses', undefined, v)).status, 200);
  assert.equal((await admin('POST', `/licenses/${lid}/suspend`, {}, v)).status, 403);
  assert.equal((await admin('PUT', '/feature-overrides', { scope: 'GLOBAL', featureKey: 'billing', enabled: false }, v)).status, 403);
  const actions = (await admin('GET', '/audit-logs')).data.data.map((a: any) => a.action);
  for (const a of ['LOGIN', 'TRIAL_EXTENDED', 'LICENSE_SUSPENDED', 'FEATURE_DISABLED', 'INSTALLATION_SUSPENDED', 'ADMIN_CREATED']) assert.ok(actions.includes(a), a);
});

test('two-factor authentication (TOTP)', async () => {
  const { totpCode } = await import('../src/lib.js');
  const setup = (await admin('POST', '/auth/totp/setup')).data;
  assert.equal((await admin('POST', '/auth/totp/enable', { code: '000000' })).status, 400);
  assert.equal((await admin('POST', '/auth/totp/enable', { code: totpCode(setup.secret) })).status, 200);
  const noCode = await call('POST', '/api/admin/v1/auth/login', { email: 'owner@vendor.test', password: 'correct horse battery' });
  assert.equal(noCode.data.code, 'TOTP_REQUIRED');
  const ok = await call('POST', '/api/admin/v1/auth/login', { email: 'owner@vendor.test', password: 'correct horse battery', totp: totpCode(setup.secret) });
  assert.equal(ok.status, 200);
  adminToken = ok.data.token;
});

test('logout revokes the session', async () => {
  const tok = (await call('POST', '/api/admin/v1/auth/login', { email: 'viewer@vendor.test', password: 'viewer-password-1' })).data.token;
  await admin('POST', '/auth/logout', {}, tok);
  assert.equal((await admin('GET', '/auth/me', undefined, tok)).status, 401);
});

function openEvents(cred: { installationId: string; installationSecret: string } | 'admin') {
  const adminLive = cred === 'admin';
  const ac = new AbortController();
  const pending: Array<{ event: string; data: any }> = [];
  const waiters: Array<() => void> = [];
  const push = (ev: { event: string; data: any }) => {
    pending.push(ev);
    waiters.splice(0).forEach((w) => w());
  };
  const done = (async () => {
    const res = await fetch(adminLive ? base + '/api/admin/v1/live' : base + '/api/client/v1/events', {
      headers: { Authorization: `Bearer ${adminLive ? adminToken : `${cred.installationId}.${cred.installationSecret}`}`, Accept: 'text/event-stream' },
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done: ended } = await reader.read();
        if (ended) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
          const block = buf.slice(0, idx);
          const sep = buf.slice(idx).match(/^\r?\n\r?\n/)![0].length;
          buf = buf.slice(idx + sep);
          let event = 'message';
          let data = '';
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (lineIsEvent(event)) push({ event, data: data ? JSON.parse(data) : {} });
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') throw err;
    }
  })();
  const next = (pred: (e: { event: string; data: any }) => boolean, ms = 4000) => new Promise<{ event: string; data: any }>((resolve, reject) => {
    const take = () => {
      const i = pending.findIndex(pred);
      if (i < 0) return false;
      resolve(pending.splice(i, 1)[0]);
      return true;
    };
    if (take()) return;
    const timer = setTimeout(() => reject(new Error(`no matching event in ${ms}ms; saw ${JSON.stringify(pending)}`)), ms);
    const arm = () => {
      waiters.push(() => {
        if (take()) clearTimeout(timer);
        else arm();
      });
    };
    arm();
  });
  return { next, close: () => { ac.abort(); return done.catch(() => undefined); } };
}

function lineIsEvent(event: string) {
  return event === 'hello' || event === 'refresh' || event === 'activity';
}

test('live push reaches a connected installation: feature lock, deactivation, and customer deletion', async () => {
  const cust = (await admin('POST', '/customers', { name: 'Esha', businessName: 'Esha Stores', email: 'esha@shop.in' })).data.customer;
  const lic = (await admin('POST', '/licenses', { customerId: cust.id, planCode: 'MONTH_1' })).data.license;
  const act = await client('/activate', { licenseKey: lic.license_key, device: device('Esha-PC') });
  assert.equal(act.status, 201, JSON.stringify(act.data));
  const es = openEvents(act.data);
  await es.next((e) => e.event === 'hello');

  await admin('PUT', '/feature-overrides', { scope: 'INSTALLATION', scopeId: act.data.installationId, featureKey: 'billing', enabled: false, reason: 'paused' });
  const locked = await es.next((e) => e.event === 'refresh' && e.data.reasons?.includes('FEATURE_DISABLED'));
  assert.ok(locked.data.reasons.includes('FEATURE_DISABLED'));
  assert.equal(verify((await client('/heartbeat', {}, act.data)).data.token).features.billing.enabled, false);

  await admin('PUT', '/feature-overrides', { scope: 'INSTALLATION', scopeId: act.data.installationId, featureKey: 'billing', enabled: true });
  const unlocked = await es.next((e) => e.event === 'refresh' && e.data.reasons?.includes('FEATURE_ENABLED'));
  assert.ok(unlocked.data.reasons.includes('FEATURE_ENABLED'));

  await admin('POST', `/installations/${act.data.installationId}/deactivate`, { reason: 'lost device' });
  const off = await es.next((e) => e.event === 'refresh' && e.data.reasons?.includes('INSTALLATION_DEACTIVATED'));
  assert.ok(off.data.reasons.includes('INSTALLATION_DEACTIVATED'));

  const removed = await admin('DELETE', `/customers/${cust.id}`, { confirmName: 'Esha Stores', reason: 'closed' });
  assert.equal(removed.status, 200, JSON.stringify(removed.data));
  const gone = await es.next((e) => e.event === 'refresh' && e.data.reasons?.includes('CUSTOMER_DELETED'));
  assert.ok(gone.data.reasons.includes('CUSTOMER_DELETED'));
  assert.equal((await client('/heartbeat', {}, act.data)).status, 401);
  await es.close();
});

test('admin console hears a customer check-in immediately', async () => {
  const cust = (await admin('POST', '/customers', { name: 'Nila', businessName: 'Nila Stores', email: 'nila@shop.in' })).data.customer;
  const lic = (await admin('POST', '/licenses', { customerId: cust.id, planCode: 'MONTH_1' })).data.license;
  const act = await client('/activate', { licenseKey: lic.license_key, device: device('Nila-PC') });
  assert.equal(act.status, 201, JSON.stringify(act.data));
  const es = openEvents('admin');
  try {
    await es.next((e) => e.event === 'hello');
    const beat = await client('/heartbeat', { appVersion: '1.1.1' }, act.data);
    assert.equal(beat.status, 200, JSON.stringify(beat.data));
    const seen = await es.next((e) => e.event === 'activity' && e.data.action === 'SEEN' && String(e.data.message).includes('Nila'));
    assert.equal(seen.data.notify, true);
  } finally {
    await es.close();
  }
});

test('login is rate limited', async () => {
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await call('POST', '/api/admin/v1/auth/login', { email: 'brute@vendor.test', password: 'x' })).status;
  assert.equal(last, 429);
});
