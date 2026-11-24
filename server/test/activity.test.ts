import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'net';
import { setupTestEnv, startTestServer, setupBusiness, TestClient } from './helpers.js';

// A stand-in for the vendor's licence server: it keeps what the engine reports to /activity
const reports: Array<{ auth: string; body: any }> = [];
const vendor = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url === '/api/client/v1/activity') {
      reports.push({ auth: String(req.headers.authorization || ''), body: JSON.parse(raw || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }).end('{}');
  });
});
setupTestEnv({ enforceLicense: true });

let api: TestClient;
let db: any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function next(type: string, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const i = reports.findIndex((r) => r.body.type === type);
    if (i >= 0) return reports.splice(i, 1)[0];
    if (Date.now() > end) throw new Error(`no ${type} report (got ${reports.map((r) => r.body.type).join(', ') || 'nothing'})`);
    await sleep(20);
  }
}

before(async () => {
  await new Promise<void>((r) => vendor.listen(0, '127.0.0.1', () => r()));
  const { config } = await import('../src/config/index.js');
  config.licensing.serverUrl = `http://127.0.0.1:${(vendor.address() as AddressInfo).port}`;
  api = await startTestServer();
  db = (await import('../src/db/connection.js')).db;
  await setupBusiness(api);
  // this computer is connected to a licence (its installation credentials)
  db.prepare('INSERT OR IGNORE INTO license_state (id) VALUES (1)').run();
  db.prepare("UPDATE license_state SET installation_id = 'inst-1', installation_secret = 'secret-1' WHERE id = 1").run();
  reports.length = 0;
});
after(async () => {
  await api.close();
  vendor.close();
});

test('the vendor hears who signed in, who opened the app still signed in, who signed out, and the app closing', async () => {
  // signed in: with name and role, on this computer's own credentials
  const login = await api.post('/auth/login', { email: 'owner@test.local', password: 'password123' });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  api.setToken(login.data.token);
  const signedIn = await next('SIGNED_IN');
  assert.equal(signedIn.auth, 'Bearer inst-1.secret-1');
  assert.deepEqual(signedIn.body.user, { name: 'Test Owner', email: 'owner@test.local', role: 'BUSINESS_OWNER' });

  // the app reads "who am I" right after signing in: not a second report
  assert.equal((await api.get('/auth/me')).status, 200);
  await sleep(150);
  assert.equal(reports.filter((r) => r.body.type === 'SESSION_RESUMED').length, 0);

  // signed out
  assert.equal((await api.post('/auth/logout', { reason: 'manual' })).status, 200);
  const out = await next('SIGNED_OUT');
  assert.equal(out.body.reason, 'manual');
  assert.equal(out.body.user.name, 'Test Owner');

  // the app opened again with a session that is still valid: "opened, already signed in"
  assert.equal((await api.get('/auth/me')).status, 200);
  const resumed = await next('SESSION_RESUMED');
  assert.equal(resumed.body.user.email, 'owner@test.local');

  // a session that ended by itself: its token has expired, but it still names who it was
  const { config } = await import('../src/config/index.js');
  const me = db.prepare("SELECT id, business_id FROM users WHERE email = 'owner@test.local'").get() as any;
  const old = jwt.sign({ userId: me.id, email: 'owner@test.local', role: 'BUSINESS_OWNER', businessId: me.business_id, shopId: 'main',
    exp: Math.floor(Date.now() / 1000) - 60 }, config.jwtSecret);
  api.setToken(old);
  assert.equal((await api.post('/auth/logout', { reason: 'expired' })).status, 200);
  assert.equal((await next('SIGNED_OUT')).body.reason, 'expired');

  // a token that is not this app's: nothing is told, and signing out still answers
  api.setToken(jwt.sign({ userId: me.id, shopId: 'main' }, 'some-other-secret'));
  assert.equal((await api.post('/auth/logout', {})).status, 200);
  await sleep(150);
  assert.equal(reports.filter((r) => r.body.type === 'SIGNED_OUT').length, 0);

  // the app closing: said for this business, with who was last signed in
  api.setToken(login.data.token);
  await api.get('/auth/me');
  await next('SESSION_RESUMED');
  const lic = await import('../src/licensing/licenseClient.js');
  const t0 = Date.now();
  await lic.reportClosing();
  assert.ok(Date.now() - t0 < 1500);
  const closed = await next('APP_CLOSED');
  assert.equal(closed.body.user.name, 'Test Owner');
});
