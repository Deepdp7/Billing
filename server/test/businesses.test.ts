import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { setupTestEnv, startTestServer, setupBusiness, createProduct, TestClient } from './helpers.js';

const dataDir = setupTestEnv();

let a: TestClient; // signed in to the first business
let b: TestClient; // signed in to the second, at the same time
let shops: typeof import('../src/db/shops.js');
let shopA = '';
let shopB = '';

before(async () => {
  a = await startTestServer();
  b = await startTestServer();
  shops = await import('../src/db/shops.js');
  shopA = (await setupBusiness(a, { businessName: 'Spice Garden', category: 'RESTAURANT', email: 'spice@shop.in' })).user.shopId;
});
after(async () => { await a.close(); await b.close(); });

test('a second sign-up on the same computer makes a new business in its own database file', async () => {
  assert.equal(shopA, 'main');
  const res = await b.post('/auth/register', { ownerName: 'Ravi', email: 'fixit@shop.in', password: 'password123',
    businessName: 'Fix-It Services', category: 'SERVICE', state: 'West Bengal' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  shopB = res.data.user.shopId;
  assert.notEqual(shopB, shopA);
  assert.ok(fs.existsSync(path.join(dataDir, 'shops', shopB, 'apna_billing.db')));
  b.setToken(res.data.token);

  const info = (await b.get('/system/info')).data;
  assert.equal(info.setupRequired, false);
  assert.deepEqual(info.businesses.map((s: any) => s.name).sort(), ['Fix-It Services', 'Spice Garden']);
});

test('each business sees only its own data, both signed in at once', async () => {
  await createProduct(a, { name: 'Paneer Tikka' });
  await createProduct(b, { name: 'AC Service Visit' });
  const names = async (api: TestClient) => (await api.get('/app/products?search=')).data.data.map((p: any) => p.name);
  assert.deepEqual(await names(a), ['Paneer Tikka']);
  assert.deepEqual(await names(b), ['AC Service Visit']);
  assert.equal((await a.get('/auth/me')).data.user.businessName, 'Spice Garden');
  assert.equal((await b.get('/auth/me')).data.user.businessName, 'Fix-It Services');
  // a token's business wins over anything the request asks for
  assert.deepEqual(await names({ ...a, get: (u: string) => a.get(`${u}&shop=${shopB}`) } as TestClient), ['Paneer Tikka']);
});

test('sign-in finds the business by email; an email already used on this computer cannot sign up again', async () => {
  const signIn = async (email: string) => (await a.post('/auth/login', { email, password: 'password123' })).data.user?.shopId;
  assert.equal(await signIn('spice@shop.in'), shopA);
  assert.equal(await signIn('FIXIT@shop.in'), shopB);
  const again = await a.post('/auth/register', { ownerName: 'X', email: 'spice@shop.in', password: 'password123',
    businessName: 'Copy', category: 'GROCERY', state: 'West Bengal' });
  assert.equal(again.status, 409);
  assert.match(again.data.message, /Spice Garden/);
});

test('the same sign-in in two businesses asks which one', async () => {
  const bcrypt = (await import('bcryptjs')).default;
  const { db } = await import('../src/db/connection.js');
  for (const id of [shopA, shopB]) {
    shops.runInShop(id, () => {
      const biz = (db.prepare('SELECT id FROM businesses LIMIT 1').get() as { id: string }).id;
      db.prepare("INSERT INTO users (id, business_id, name, email, password_hash, role, status) VALUES (?, ?, 'Asha', 'asha@staff.in', ?, 'CASHIER', 'ACTIVE')")
        .run(`asha-${id}`, biz, bcrypt.hashSync('cashier-pass', 4));
    });
  }
  const ask = await a.post('/auth/login', { email: 'asha@staff.in', password: 'cashier-pass' });
  assert.equal(ask.data.code, 'CHOOSE_BUSINESS');
  assert.equal(ask.data.details.businesses.length, 2);
  const chosen = await a.post('/auth/login', { email: 'asha@staff.in', password: 'cashier-pass', shopId: shopB });
  assert.equal(chosen.data.user.businessName, 'Fix-It Services');
});

test('erasing one business leaves the other; its empty file is used for the next new business', async () => {
  await b.post('/auth/login', { email: 'fixit@shop.in', password: 'password123' }).then((r) => b.setToken(r.data.token));
  const erased = await b.post('/auth/erase-shop', { confirmName: 'Fix-It Services' });
  assert.equal(erased.status, 200, JSON.stringify(erased.data));
  assert.deepEqual((await a.get('/system/info')).data.businesses.map((s: any) => s.name), ['Spice Garden']);
  assert.equal((await a.get('/app/products?search=')).data.data.length, 1, 'the other business is untouched');

  const next = await a.post('/auth/register', { ownerName: 'Meena', email: 'meena@shop.in', password: 'password123',
    businessName: 'Meena Medicals', category: 'PHARMACY', state: 'West Bengal' });
  assert.equal(next.status, 201, JSON.stringify(next.data));
  assert.equal(next.data.user.shopId, shopB);
});
