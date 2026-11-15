/**
 * End-to-end: desktop local server (production mode, license enforced) ↔ central license server.
 * Run from the repo root:  node e2e/licensing-e2e.mjs
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert/strict';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apna-e2e-'));
const LIC_PORT = 47100 + Math.floor(Math.random() * 400);
const APP_PORT = LIC_PORT + 500;
const children = [];
const tsx = path.join(root, 'server', 'node_modules', 'tsx', 'dist', 'cli.mjs');

function start(name, cwd, env) {
  const p = spawn(process.execPath, [tsx, 'src/index.ts'], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', (d) => { log += d; });
  p.stderr.on('data', (d) => { log += d; });
  p.on('exit', (code) => { if (code && code !== 0 && !p.killedByUs) console.error(`[${name}] exited ${code}\n${log}`); });
  children.push(p);
  return { proc: p, log: () => log };
}

async function waitFor(url, label) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not start`);
}

async function http(method, url, body, token) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const steps = [];
const step = async (name, fn) => {
  try { await fn(); steps.push(['PASS', name]); console.log(`✔ ${name}`); }
  catch (e) { steps.push(['FAIL', name]); console.log(`✖ ${name}\n   ${e.message}`); throw e; }
};

try {
  const licEnv = { SQLITE_FILE: path.join(tmp, 'license.db'), PORT: String(LIC_PORT), NODE_ENV: 'development', DATABASE_URL: '' };
  const created = spawnSync(process.execPath, [tsx, 'src/scripts/createAdmin.ts', 'owner@vendor.test', 'Owner', 'super-secret-pass', 'OWNER'],
    { cwd: path.join(root, 'license-server'), env: { ...process.env, ...licEnv }, encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  start('license-server', path.join(root, 'license-server'), licEnv);
  await waitFor(`http://127.0.0.1:${LIC_PORT}/api/health`, 'license server');

  // Desktop server exactly as Electron runs it: production mode → enforcement on, single tenant, no demo data.
  start('desktop', path.join(root, 'server'), {
    NODE_ENV: 'production', PORT: String(APP_PORT), APNA_DATA_DIR: path.join(tmp, 'appdata'), DB_PATH: '',
    APNA_LICENSE_SERVER_URL: `http://127.0.0.1:${LIC_PORT}`, APNA_LICENSE_ENFORCE: '', APNA_DEMO_MODE: '', APNA_SINGLE_TENANT: '', JWT_SECRET: '',
  });
  await waitFor(`http://127.0.0.1:${APP_PORT}/api/health`, 'desktop server');

  const app = (m, u, b, t) => http(m, `http://127.0.0.1:${APP_PORT}/api/v1${u}`, b, t);
  const adm = (m, u, b) => http(m, `http://127.0.0.1:${LIC_PORT}/api/admin/v1${u}`, b, adminToken);
  let adminToken = (await http('POST', `http://127.0.0.1:${LIC_PORT}/api/admin/v1/auth/login`, { email: 'owner@vendor.test', password: 'super-secret-pass' })).data.token;
  let ownerToken = '';
  let installationId = '';
  let productId = '';
  const sell = () => app('POST', '/app/billing/checkout', { items: [{ productId, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'CASH' }, ownerToken);
  const sync = () => app('POST', '/license/sync', {}, ownerToken);

  await step('fresh install: owner account first, but nothing works until a trial or key is active', async () => {
    const info = (await app('GET', '/system/info')).data;
    assert.equal(info.setupRequired, true);
    assert.equal(info.demoMode, false);
    assert.equal((await app('GET', '/license/status')).data.mode, 'UNLICENSED');
    const reg = await app('POST', '/auth/register', { ownerName: 'Asha', email: 'asha@shop.in', password: 'password123', businessName: 'Asha Stores', category: 'GROCERY', state: 'Karnataka' });
    assert.equal(reg.status, 201, JSON.stringify(reg.data));
    ownerToken = reg.data.token;
    assert.equal((await app('POST', '/app/products', { name: 'X', sku: 'X-1', salePricePaise: 100, taxRate: 0, stockQuantity: 1 }, ownerToken)).status, 402);
  });

  await step('7-day trial activation from the desktop app', async () => {
    const r = await app('POST', '/license/trial', { name: 'Asha', businessName: 'Asha Stores', email: 'asha@shop.in', phone: '9000000000' }, ownerToken);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.mode, 'ACTIVE');
    assert.equal(r.data.license.type, 'TRIAL');
    assert.equal(r.data.license.daysRemaining, 7);
    installationId = r.data.installationId;
    const inst = (await adm('GET', `/installations/${installationId}`)).data;
    assert.equal(inst.installation.status, 'ACTIVE');
  });

  await step('billing works during the trial', async () => {
    const p = await app('POST', '/app/products', { name: 'Tea 250g', sku: 'TEA-250', salePricePaise: 10000, taxRate: 5, stockQuantity: 100 }, ownerToken);
    assert.equal(p.status, 201);
    productId = p.data.product.id;
    assert.equal((await sell()).status, 201);
    assert.equal((await sell()).status, 201);
  });

  await step('features not in the trial plan are refused by the desktop backend', async () => {
    const r = await app('GET', '/app/purchases', undefined, ownerToken);
    assert.equal(r.status, 403);
    assert.equal(r.data.code, 'FEATURE_DISABLED');
  });

  await step('admin disables billing for this installation → applied live, without any sync call', async () => {
    // The desktop holds a live link to the license server; the push makes it fetch a fresh signed token at once.
    for (let i = 0; i < 40 && !(await adm('GET', `/installations/${installationId}`)).data.installation.live; i++) await new Promise((r) => setTimeout(r, 250));
    assert.equal((await adm('PUT', '/feature-overrides', { scope: 'INSTALLATION', scopeId: installationId, featureKey: 'billing', enabled: false, reason: 'test' })).status, 200);
    const t0 = Date.now();
    let blocked = false;
    while (!blocked && Date.now() - t0 < 5000) {
      blocked = (await app('GET', '/license/status')).data.features.billing === false;
      if (!blocked) await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(blocked, 'billing was not switched off within 5 s of the admin action');
    console.log(`   (applied ${Date.now() - t0} ms after the admin action)`);
    assert.equal((await sell()).status, 403);
    assert.equal((await app('GET', '/app/customers', undefined, ownerToken)).status, 200, 'rest of the app keeps working');
  });

  await step('admin re-enables billing and grants purchases temporarily', async () => {
    const ov = (await adm('GET', `/feature-overrides?scope=INSTALLATION&scopeId=${installationId}`)).data.data[0];
    await adm('DELETE', `/feature-overrides/${ov.id}`);
    const lid = (await adm('GET', `/installations/${installationId}`)).data.license.id;
    await adm('PUT', '/feature-overrides', { scope: 'LICENSE', scopeId: lid, featureKey: 'purchases', enabled: true, expiresAt: new Date(Date.now() + 86400000).toISOString() });
    const s = (await sync()).data;
    assert.equal(s.features.billing, true);
    assert.equal(s.features.purchases, true);
    assert.ok(s.featureExpiry.purchases);
    assert.equal((await sell()).status, 201);
    assert.equal((await app('GET', '/app/purchases', undefined, ownerToken)).status, 200);
  });

  await step('usage counters sync to the admin panel (metadata only)', async () => {
    await sync(); // sync also uploads usage
    await new Promise((r) => setTimeout(r, 1000));
    const u = (await adm('GET', `/usage?installationId=${installationId}`)).data;
    const billing = u.byFeature.find((f) => f.feature_key === 'billing');
    assert.ok(billing && billing.count >= 3, JSON.stringify(u.byFeature));
  });

  await step('suspension makes the app read-only; reactivation restores it', async () => {
    const lid = (await adm('GET', `/installations/${installationId}`)).data.license.id;
    await adm('POST', `/licenses/${lid}/suspend`, { reason: 'test' });
    assert.equal((await sync()).data.mode, 'SUSPENDED');
    assert.equal((await sell()).status, 402);
    assert.equal((await app('GET', '/app/billing/invoices', undefined, ownerToken)).status, 200, 'data still viewable');
    assert.equal((await app('GET', '/app/backups/export', undefined, ownerToken)).status, 200, 'data still exportable');
    await adm('POST', `/licenses/${lid}/reactivate`);
    assert.equal((await sync()).data.mode, 'ACTIVE');
    assert.equal((await sell()).status, 201);
  });

  await step('trial expiry → read-only; conversion to a 1-year paid license restores everything', async () => {
    const lid = (await adm('GET', `/installations/${installationId}`)).data.license.id;
    await adm('PUT', `/licenses/${lid}`, { expiresAt: new Date(Date.now() - 60000).toISOString() });
    assert.equal((await sync()).data.mode, 'EXPIRED');
    assert.equal((await sell()).status, 402);
    await adm('POST', `/licenses/${lid}/convert`, { planCode: 'YEAR_1', paymentAmountPaise: 499900, paymentReference: 'UPI-1' });
    const s = (await sync()).data;
    assert.equal(s.mode, 'ACTIVE');
    assert.equal(s.license.type, 'PAID');
    assert.ok(s.license.daysRemaining >= 364);
    assert.equal(s.features.data_export, true);
  });

  await step('license server outage does not stop billing (offline grace)', async () => {
    children[0].killedByUs = true;
    children[0].kill();
    await new Promise((r) => setTimeout(r, 800));
    const s = (await sync()).data;
    assert.equal(s.mode, 'ACTIVE');
    assert.ok(s.offline.lastSyncError);
    assert.equal((await sell()).status, 201);
  });

  console.log(`\nE2E: ${steps.filter((s) => s[0] === 'PASS').length}/${steps.length} steps passed`);
} catch (e) {
  console.log(`\nE2E FAILED: ${e.stack || e}`);
  process.exitCode = 1;
} finally {
  for (const c of children) { c.killedByUs = true; c.kill(); }
}
