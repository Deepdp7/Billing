import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-upd-'));
process.env.SQLITE_FILE = path.join(tmp, 'license.db');
process.env.NODE_ENV = 'test';
process.env.UPDATES_DIR = path.join(tmp, 'updates');
process.env.UPDATER_PUBLIC_KEY_FILE = path.join(tmp, 'updater.pub');
delete process.env.DATABASE_URL;

// ---- A minisign key + signer, byte-for-byte the format `tauri signer` produces.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const keyId = crypto.randomBytes(8);
const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
const pubB64 = Buffer.from(`untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), keyId, rawPub]).toString('base64')}\n`).toString('base64');
fs.writeFileSync(process.env.UPDATER_PUBLIC_KEY_FILE, pubB64);
function sign(file: Buffer, key = privateKey, id = keyId) {
  const sig = crypto.sign(null, crypto.createHash('blake2b512').update(file).digest(), key);
  const comment = `timestamp:${Math.floor(Date.now() / 1000)}\tfile:setup.exe`;
  const global = crypto.sign(null, Buffer.concat([sig, Buffer.from(comment)]), key);
  const text = `untrusted comment: signature from tauri secret key\n${Buffer.concat([Buffer.from('ED'), id, sig]).toString('base64')}\ntrusted comment: ${comment}\n${global.toString('base64')}\n`;
  return Buffer.from(text).toString('base64');
}
const installer = (n: number) => Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(4096 + n)]);

let base = '';
let server: any;
let knex: any;
let token = '';

async function call(method: string, url: string, body?: unknown, auth = token, headers: Record<string, string> = {}) {
  const raw = Buffer.isBuffer(body);
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': raw ? 'application/octet-stream' : 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers },
    body: body === undefined ? undefined : raw ? (body as Buffer) : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) as any };
}
const upload = (file: Buffer, version: string, signature: string, auth = token) =>
  call('POST', '/api/admin/v1/app-updates/upload', file, auth, { 'X-Release-Version': version, 'X-Release-Signature': signature });

before(async () => {
  knex = (await import('../src/db.js')).knex;
  await (await import('../src/migrations.js')).migrateLatest(knex);
  const bcrypt = (await import('bcryptjs')).default;
  for (const [email, role] of [['owner@v.test', 'OWNER'], ['admin@v.test', 'ADMIN']]) {
    await knex('admin_users').insert({ id: crypto.randomUUID(), email, name: role, role, password_hash: bcrypt.hashSync('correct horse battery', 4), status: 'ACTIVE', totp_enabled: false, created_at: new Date().toISOString() });
  }
  const { createApp } = await import('../src/app.js');
  server = await new Promise((r) => { const s = createApp().listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  token = (await call('POST', '/api/admin/v1/auth/login', { email: 'owner@v.test', password: 'correct horse battery' }, '')).data.token;
});
after(async () => { server?.close(); await knex?.destroy(); });

test('real Tauri build: the signature check accepts it and rejects a wrong .sig or a modified file', { skip: !fs.existsSync(path.resolve('..', 'releases', 'ApnaBilling-1.1.3-setup.exe')) && 'no local release build' }, async () => {
  const { verifyUpdateSignature } = await import('../src/updateSignature.js');
  const conf = JSON.parse(fs.readFileSync(path.resolve('..', 'tauri', 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const exe = path.resolve('..', 'releases', 'ApnaBilling-1.1.3-setup.exe');
  const pub = conf.plugins.updater.pubkey;
  assert.deepEqual(await verifyUpdateSignature(exe, fs.readFileSync(`${exe}.sig`, 'utf8'), pub), { ok: true });
  const other = path.resolve('..', 'releases', 'ApnaBilling-1.1.2-setup.exe.sig');
  if (fs.existsSync(other)) assert.equal((await verifyUpdateSignature(exe, fs.readFileSync(other, 'utf8'), pub)).ok, false);
  const copy = path.join(tmp, 'tampered.exe');
  fs.copyFileSync(exe, copy);
  const fd = fs.openSync(copy, 'r+'); fs.writeSync(fd, Buffer.from([0x41]), 0, 1, 5000); fs.closeSync(fd);
  assert.equal((await verifyUpdateSignature(copy, fs.readFileSync(`${exe}.sig`, 'utf8'), pub)).ok, false);
});

test('upload: only OWNER, only signed with the update key, only real installers', async () => {
  const admin = (await call('POST', '/api/admin/v1/auth/login', { email: 'admin@v.test', password: 'correct horse battery' }, '')).data.token;
  const f = installer(1);
  assert.equal((await upload(f, '1.2.0', sign(f), admin)).status, 403);
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  const bad = await upload(f, '1.2.0', sign(f, other, crypto.randomBytes(8)));
  assert.equal(bad.status, 400);
  assert.equal(bad.data.code, 'BAD_SIGNATURE');
  assert.equal((await upload(f, '1.2.0', sign(installer(2)))).data.code, 'BAD_SIGNATURE', 'signature of a different file');
  assert.equal((await upload(Buffer.concat([Buffer.from('PK'), crypto.randomBytes(5000)]), '1.2.0', 'x')).data.code, 'NOT_EXE');
  assert.equal((await upload(f, '1.2', sign(f))).data.code, 'BAD_VERSION');
  const ok = await upload(f, '1.2.0', sign(f));
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.release.status, 'UPLOADED');
  assert.ok(fs.existsSync(path.join(process.env.UPDATES_DIR!, 'ApnaBilling-1.2.0-setup.exe')));
  assert.ok(!fs.existsSync(path.join(process.env.UPDATES_DIR!, 'latest.json')), 'uploading alone does not offer it to clients');
});

test('publish needs the password, writes latest.json, sets the update settings, and marks it live', async () => {
  const rel = (await call('GET', '/api/admin/v1/app-updates')).data.releases.find((r: any) => r.version === '1.2.0');
  const wrong = await call('POST', `/api/admin/v1/app-updates/${rel.id}/publish`, { password: 'wrong' });
  assert.equal(wrong.status, 400, 'a mistyped password must not look like an expired session');
  assert.equal(wrong.data.code, 'PASSWORD_INCORRECT');
  assert.equal((await call('GET', '/api/admin/v1/app-updates')).status, 200, 'still signed in');
  const pub = await call('POST', `/api/admin/v1/app-updates/${rel.id}/publish`, { password: 'correct horse battery', notes: 'Faster billing', required: false });
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  const manifest = JSON.parse(fs.readFileSync(path.join(process.env.UPDATES_DIR!, 'latest.json'), 'utf8'));
  assert.equal(manifest.version, '1.2.0');
  assert.match(manifest.platforms['windows-x86_64'].url, /\/updates\/ApnaBilling-1\.2\.0-setup\.exe$/);
  assert.equal(manifest.platforms['windows-x86_64'].signature, rel.signature);
  const served = await fetch(`${base}/updates/latest.json`);
  assert.equal(served.status, 200);
  const page = (await call('GET', '/api/admin/v1/app-updates')).data;
  assert.equal(page.live.version, '1.2.0');
  assert.equal(page.live.required, false);
  assert.equal(page.live.message, 'Faster billing');
});

test('required / optional, pause / resume, and only newer versions can be published', async () => {
  assert.equal((await call('POST', '/api/admin/v1/app-updates/required', { password: 'correct horse battery', required: true })).status, 200);
  assert.equal((await call('GET', '/api/admin/v1/app-updates')).data.live.required, true);
  assert.equal((await call('POST', '/api/admin/v1/app-updates/required', { password: 'correct horse battery', required: false })).status, 200);
  assert.equal((await call('GET', '/api/admin/v1/app-updates')).data.live.required, false);

  assert.equal((await call('POST', '/api/admin/v1/app-updates/pause', { password: 'correct horse battery' })).status, 200);
  let page = (await call('GET', '/api/admin/v1/app-updates')).data;
  assert.equal(page.live.version, null);
  assert.equal(page.live.paused, true);
  assert.equal((await fetch(`${base}/updates/latest.json`)).status, 404, 'paused: the app updater finds nothing');
  assert.equal((await call('POST', '/api/admin/v1/app-updates/resume', { password: 'correct horse battery' })).status, 200);
  assert.equal((await call('GET', '/api/admin/v1/app-updates')).data.live.version, '1.2.0');

  const older = installer(3);
  const up = await upload(older, '1.1.9', sign(older));
  assert.equal(up.status, 201);
  const pub = await call('POST', `/api/admin/v1/app-updates/${up.data.release.id}/publish`, { password: 'correct horse battery' });
  assert.equal(pub.status, 409);
  assert.equal(pub.data.code, 'NOT_NEWER');
  assert.equal((await upload(installer(4), '1.2.0', 'x')).data.code, 'VERSION_EXISTS');

  const newer = installer(5);
  const up2 = await upload(newer, '1.2.1', sign(newer));
  assert.equal((await call('POST', `/api/admin/v1/app-updates/${up2.data.release.id}/publish`, { password: 'correct horse battery', required: true })).status, 200);
  page = (await call('GET', '/api/admin/v1/app-updates')).data;
  assert.equal(page.live.version, '1.2.1');
  assert.equal(page.live.required, true);
  assert.equal(page.releases.find((r: any) => r.version === '1.2.0').status, 'SUPERSEDED');

  const live = page.releases.find((r: any) => r.version === '1.2.1');
  assert.equal((await call('POST', `/api/admin/v1/app-updates/${live.id}/delete`, { password: 'correct horse battery' })).data.code, 'IS_LIVE');
  const old = page.releases.find((r: any) => r.version === '1.1.9');
  assert.equal((await call('POST', `/api/admin/v1/app-updates/${old.id}/delete`, { password: 'correct horse battery' })).status, 200);
  assert.ok(!fs.existsSync(path.join(process.env.UPDATES_DIR!, 'ApnaBilling-1.1.9-setup.exe')));
  const actions = (await call('GET', '/api/admin/v1/audit-logs')).data.data.map((a: any) => a.action);
  for (const a of ['APP_RELEASE_UPLOADED', 'APP_RELEASE_PUBLISHED', 'APP_RELEASE_REQUIRED', 'APP_RELEASE_PAUSED', 'APP_RELEASE_DELETED']) assert.ok(actions.includes(a), a);
});

test('rolling back puts an older version live on purpose, and the next newer one clears it', async () => {
  let page = (await call('GET', '/api/admin/v1/app-updates')).data;
  const previous = page.releases.find((r: any) => r.version === '1.2.0');
  // Without "rollback" an older version is refused, so nothing goes back by mistake
  assert.equal((await call('POST', `/api/admin/v1/app-updates/${previous.id}/publish`, { password: 'correct horse battery' })).data.code, 'NOT_NEWER');

  const back = await call('POST', `/api/admin/v1/app-updates/${previous.id}/publish`, { password: 'correct horse battery', rollback: true });
  assert.equal(back.status, 200);
  assert.equal(back.data.rollback, true);
  page = (await call('GET', '/api/admin/v1/app-updates')).data;
  assert.equal(page.live.version, '1.2.0');
  assert.equal(page.live.rollback, true);
  assert.equal(page.live.required, false, 'the earlier "required" of 1.2.1 does not stick to the rollback');
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.UPDATES_DIR!, 'latest.json'), 'utf8')).version, '1.2.0');
  assert.equal(page.releases.find((r: any) => r.version === '1.2.1').status, 'SUPERSEDED');

  const next = installer(6);
  const up = await upload(next, '1.2.2', sign(next));
  assert.equal((await call('POST', `/api/admin/v1/app-updates/${up.data.release.id}/publish`, { password: 'correct horse battery' })).status, 200);
  page = (await call('GET', '/api/admin/v1/app-updates')).data;
  assert.equal(page.live.version, '1.2.2');
  assert.equal(page.live.rollback, false);
  const actions = (await call('GET', '/api/admin/v1/audit-logs')).data.data.map((a: any) => a.action);
  assert.ok(actions.includes('APP_RELEASE_ROLLED_BACK'));

  // Another update of the same version: 1.2.2+1 is newer than 1.2.2 and publishes normally
  const again = installer(7);
  const up2 = await upload(again, '1.2.2+1', sign(again));
  assert.equal(up2.status, 201, JSON.stringify(up2.data));
  assert.equal((await call('POST', `/api/admin/v1/app-updates/${up2.data.release.id}/publish`, { password: 'correct horse battery' })).status, 200);
  page = (await call('GET', '/api/admin/v1/app-updates')).data;
  assert.equal(page.live.version, '1.2.2+1');
  assert.equal(page.live.rollback, false);
  assert.ok(fs.existsSync(path.join(process.env.UPDATES_DIR!, 'ApnaBilling-1.2.2+1-setup.exe')));
});
