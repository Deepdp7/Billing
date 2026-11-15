import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-test-'));
process.env.SQLITE_FILE = path.join(tmp, 'license.db');
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

let base = '';
let server: any;
let knex: any;
let adminToken = '';
let outbox: Array<{ to: string; subject: string; text: string }>;

async function call(method: string, url: string, body?: unknown, auth?: string) {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) as any };
}
const admin = (method: string, url: string, body?: unknown) => call(method, `/api/admin/v1${url}`, body, adminToken);
const client = (url: string, body: unknown, cred?: { installationId: string; installationSecret: string }) =>
  call('POST', `/api/client/v1${url}`, body, cred ? `${cred.installationId}.${cred.installationSecret}` : undefined);
const fp = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const device = (name: string) => ({ deviceName: name, os: 'Windows 11', appVersion: '1.1.0', fingerprint: fp(name) });

before(async () => {
  const db = await import('../src/db.js');
  knex = db.knex;
  const { migrateLatest } = await import('../src/migrations.js');
  await migrateLatest(knex);
  const bcrypt = (await import('bcryptjs')).default;
  await knex('admin_users').insert({ id: crypto.randomUUID(), email: 'owner@vendor.test', name: 'Owner', role: 'OWNER',
    password_hash: bcrypt.hashSync('correct horse battery', 4), status: 'ACTIVE', totp_enabled: false, created_at: new Date().toISOString() });
  outbox = (await import('../src/accounts.js')).testOutbox;
  const { createApp } = await import('../src/app.js');
  server = await new Promise((r) => { const s = createApp().listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  adminToken = (await call('POST', '/api/admin/v1/auth/login', { email: 'owner@vendor.test', password: 'correct horse battery' })).data.token;
});

after(async () => {
  server?.close();
  await knex?.destroy();
});

test('shop sign-in: reported, shown to the owner, changed by the admin, taken over, reset by email code', async () => {
  const shop = (await client('/trial', { name: 'Ravi', businessName: 'Ravi Kirana', email: 'ravi@shop.in', device: device('PC-R') })).data;
  assert.ok(shop.installationId);
  const customerId = (await knex('installations').where({ id: shop.installationId }).first()).customer_id;

  // the app reports the owner's sign-in with a licence check
  let hb = await client('/heartbeat', { account: { email: 'ravi@shop.in', password: 'first-pass-1', by: 'SIGNUP' }, accountRev: 0 }, shop);
  assert.equal(hb.status, 200, JSON.stringify(hb.data));
  assert.equal(hb.data.accountAccepted, true);
  assert.equal(hb.data.account, undefined);
  const stored = await knex('customers').where({ id: customerId }).first();
  assert.ok(stored.app_password_enc.startsWith('v1:'));
  assert.ok(!stored.app_password_enc.includes('first-pass-1'), 'stored encrypted');

  // the panel never gets the stored value with customer rows; the owner can reveal it
  const detail = await admin('GET', `/customers/${customerId}`);
  assert.equal(detail.data.customer.app_password_enc, undefined);
  assert.equal(detail.data.account.hasPassword, true);
  assert.equal(detail.data.account.passwordBy, 'SIGNUP');
  assert.equal((await admin('GET', '/customers')).data.data.find((c: any) => c.id === customerId).app_password_enc, undefined);
  assert.equal((await admin('POST', `/customers/${customerId}/app-password`, {})).data.password, 'first-pass-1');
  assert.ok(await knex('audit_logs').where({ action: 'APP_PASSWORD_VIEWED', entity_id: customerId }).first());

  // the admin sets a new email and password: the app gets them with its next check
  const changed = await admin('PUT', `/customers/${customerId}/app-account`, { email: 'Owner@Ravi.in', password: 'admin-set-22' });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  hb = await client('/heartbeat', { account: { email: 'ravi@shop.in', password: 'stale-report', by: 'LOGIN' }, accountRev: 0 }, shop);
  assert.equal(hb.data.accountAccepted, false, 'a report made before taking over the change is not kept');
  assert.deepEqual({ email: hb.data.account.email, password: hb.data.account.password }, { email: 'owner@ravi.in', password: 'admin-set-22' });
  const rev = hb.data.account.rev;
  hb = await client('/heartbeat', { accountRev: rev }, shop);
  assert.equal(hb.data.account, undefined, 'taken over: not sent again');
  assert.equal((await admin('GET', `/customers/${customerId}`)).data.account.waiting, 0);

  // forgot password: unknown emails get the same answer and no email
  assert.equal((await client('/password-reset/request', { email: 'owner@ravi.in' })).status, 503, 'mail not set up yet');
  await admin('PUT', '/settings', { smtp_host: 'test-outbox', smtp_from: 'codes@vendor.test', smtp_pass: 'secret-mail-pass' });
  const settings = (await admin('GET', '/settings')).data.settings;
  assert.equal(settings.smtp_pass_enc, undefined);
  assert.equal(settings.smtp_pass_set, '1');
  assert.equal((await client('/password-reset/request', { email: 'nobody@x.in' })).status, 200);
  assert.equal(outbox.length, 0);

  assert.equal((await client('/password-reset/request', { email: 'owner@ravi.in' })).status, 200);
  assert.equal(outbox.length, 1);
  const code = outbox[0].text.match(/\b(\d{6})\b/)![1];
  const wrong = code === '000000' ? '111111' : '000000';
  const bad = await client('/password-reset/verify', { email: 'owner@ravi.in', code: wrong, password: 'brand-new-33' });
  assert.equal(bad.data.code, 'WRONG_CODE');
  const ok = await client('/password-reset/verify', { email: 'owner@ravi.in', code, password: 'brand-new-33' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const again = await client('/password-reset/verify', { email: 'owner@ravi.in', code, password: 'again-44444' });
  assert.equal(again.data.code, 'CODE_EXPIRED', 'a code works once');
  assert.equal((await admin('POST', `/customers/${customerId}/app-password`, {})).data.password, 'brand-new-33');
  hb = await client('/heartbeat', { accountRev: rev }, shop);
  assert.equal(hb.data.account.password, 'brand-new-33', 'every computer takes over the reset');
});

test('two businesses on one computer: separate installations, one free trial per computer, a key for the second', async () => {
  const machine = fp('SHARED-PC');
  const biz = (id: string) => ({ deviceName: 'SHARED-PC', os: 'Windows 11', appVersion: '1.1.0', fingerprint: fp(`SHARED-PC|${id}`), machine });
  const first = await client('/trial', { name: 'Owner', businessName: 'Spice Restaurant', email: 'spice@shop.in', device: { ...biz('a'), fingerprint: machine } });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal((await knex('installations').where({ id: first.data.installationId }).first()).machine_hash.length, 64);

  // second business: no second free trial on this computer
  const trial2 = await client('/trial', { name: 'Owner', businessName: 'Fix-It Services', email: 'fixit@shop.in', device: biz('b') });
  assert.equal(trial2.data.code, 'TRIAL_ALREADY_USED');

  // ...but a key issued for it activates beside the first (not "this computer already has a licence")
  const customer = (await admin('POST', '/customers', { name: 'Owner', businessName: 'Fix-It Services', email: 'fixit@shop.in' })).data.customer;
  const lic = (await admin('POST', '/licenses', { customerId: customer.id, planCode: 'YEAR_1' })).data.license;
  const act = await client('/activate', { licenseKey: lic.license_key, device: biz('b') });
  assert.equal(act.status, 201, JSON.stringify(act.data));
  assert.notEqual(act.data.installationId, first.data.installationId);
  // the first business keeps working on its own licence
  assert.equal((await client('/heartbeat', {}, first.data)).status, 200);
});

test('the same account on another computer: password checked here, one more device within the limit', async () => {
  const pc1 = (await client('/trial', { name: 'Kiran', businessName: 'Kiran Books', email: 'kiran@shop.in', device: device('KIRAN-PC1') })).data;
  await client('/heartbeat', { account: { email: 'kiran@shop.in', password: 'Kiran@123', by: 'SIGNUP' }, accountRev: 0,
    profile: { category: 'GROCERY', state: 'Kerala', city: 'Kochi' } }, pc1);
  const signIn = (password: string, name: string, activate = true) =>
    client('/account/sign-in', { email: 'kiran@shop.in', password, activate, device: device(name) });

  assert.equal((await signIn('wrong-pass', 'KIRAN-PC2')).data.code, 'INVALID_CREDENTIALS');
  assert.equal((await signIn('Kiran@123', 'KIRAN-PC2')).data.code, 'DEVICE_LIMIT_REACHED', 'a trial allows one device');
  const lic = await knex('licenses').where({ id: (await knex('installations').where({ id: pc1.installationId }).first()).license_id }).first();
  await admin('PUT', `/licenses/${lic.id}`, { maxDevices: 2 });
  const check = await signIn('Kiran@123', 'KIRAN-PC2', false);
  assert.deepEqual([check.data.profile.businessName, check.data.profile.category, check.data.profile.state], ['Kiran Books', 'GROCERY', 'Kerala']);
  const pc2 = await signIn('Kiran@123', 'KIRAN-PC2');
  assert.equal(pc2.status, 201, JSON.stringify(pc2.data));
  assert.notEqual(pc2.data.installationId, pc1.installationId);
  assert.equal((await signIn('Kiran@123', 'KIRAN-PC2')).status, 201, 'the same computer again reuses its device');
  assert.equal((await signIn('Kiran@123', 'KIRAN-PC3')).data.code, 'DEVICE_LIMIT_REACHED');
  assert.equal((await client('/heartbeat', {}, pc1)).status, 200, 'the first computer keeps working');
});

test('device control: the shop sees and signs out its other computers; uninstall frees the slot; the admin deletes a device', async () => {
  const pc1 = (await client('/trial', { name: 'Uma', businessName: 'Uma Traders', email: 'uma@shop.in', device: device('UMA-PC1') })).data;
  const licId = (await knex('installations').where({ id: pc1.installationId }).first()).license_id;
  await admin('PUT', `/licenses/${licId}`, { maxDevices: 2, maxActivations: 10 });
  const key = (await knex('licenses').where({ id: licId }).first()).license_key;
  const pc2 = (await client('/activate', { licenseKey: key, device: device('UMA-PC2') })).data;
  assert.ok(pc2.installationId, JSON.stringify(pc2));

  const list = (await call('GET', '/api/client/v1/devices', undefined, `${pc1.installationId}.${pc1.installationSecret}`)).data;
  assert.deepEqual(list.devices.map((d: any) => [d.deviceName, d.thisComputer]), [['UMA-PC1', true], ['UMA-PC2', false]]);
  assert.equal((await client(`/devices/${pc2.installationId}/deactivate`, {}, pc1)).status, 200);
  assert.equal((await knex('installations').where({ id: pc2.installationId }).first()).status, 'DEACTIVATED');

  // uninstalled: slot freed and the vendor told
  const pc3 = (await client('/activate', { licenseKey: key, device: device('UMA-PC3') })).data;
  assert.equal((await client('/uninstalled', {}, pc3)).status, 200);
  const row = await knex('installations').where({ id: pc3.installationId }).first();
  assert.equal(row.status, 'DEACTIVATED');
  assert.ok(row.uninstalled_at);
  assert.ok(await knex('license_events').where({ installation_id: pc3.installationId, event_type: 'APP_UNINSTALLED' }).first());

  // deleted by the admin: gone from the list; if it connects again it is told it was removed (not "customer deleted")
  assert.equal((await admin('DELETE', `/installations/${pc1.installationId}`)).status, 200);
  assert.equal(await knex('installations').where({ id: pc1.installationId }).first(), undefined);
  assert.equal((await client('/heartbeat', {}, pc1)).data.code, 'INSTALLATION_DELETED');
});

test('the admin resets "activations used" and the device limit to the computers still in use', async () => {
  const pc = (await client('/trial', { name: 'Vik', businessName: 'Vik Stores', email: 'vik@shop.in', device: device('VIK-PC1') })).data;
  const licId = (await knex('installations').where({ id: pc.installationId }).first()).license_id;
  await knex('licenses').where({ id: licId }).update({ activations_count: 2, max_activations: 2 });
  assert.equal((await admin('PUT', `/licenses/${licId}`, { activationsCount: 1, maxDevices: 1 })).status, 200);
  const l = await knex('licenses').where({ id: licId }).first();
  assert.deepEqual([l.activations_count, l.max_devices], [1, 1]);
  assert.ok(await knex('audit_logs').where({ entity_id: licId }).first());
});

test('reinstalling on a computer that was uninstalled reuses its entry (no second entry, no extra activation)', async () => {
  const pc1 = (await client('/trial', { name: 'Raj', businessName: 'Raj Mart', email: 'raj@shop.in', device: device('RAJ-PC1') })).data;
  await client('/heartbeat', { account: { email: 'raj@shop.in', password: 'Raj@12345', by: 'SIGNUP' }, accountRev: 0 }, pc1);
  const licId = (await knex('installations').where({ id: pc1.installationId }).first()).license_id;
  await admin('PUT', `/licenses/${licId}`, { maxDevices: 1, maxActivations: 3 });
  const before = (await knex('licenses').where({ id: licId }).first()).activations_count;
  assert.equal((await client('/uninstalled', {}, pc1)).status, 200);
  const again = await client('/account/sign-in', { email: 'raj@shop.in', password: 'Raj@12345', activate: true, device: device('RAJ-PC1') });
  assert.equal(again.status, 201, JSON.stringify(again.data));
  assert.equal(again.data.installationId, pc1.installationId, 'the same entry');
  const row = await knex('installations').where({ id: pc1.installationId }).first();
  assert.deepEqual([row.status, row.uninstalled_at], ['ACTIVE', null]);
  assert.equal(await knex('installations').where({ license_id: licId }).count({ c: '*' }).then((r: any) => Number(r[0].c)), 1);
  assert.equal((await knex('licenses').where({ id: licId }).first()).activations_count, before);
});
