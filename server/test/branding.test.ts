import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, startTestServer, setupBusiness, createProduct, TestClient } from './helpers.js';

setupTestEnv();
let api: TestClient;

// A tiny real picture (1×1 transparent PNG)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

before(async () => {
  api = await startTestServer();
  await setupBusiness(api);
});
after(async () => { await api.close(); });

test('branding starts with sensible defaults', async () => {
  const r = await api.get('/app/business/branding');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.branding.logo, null);
  assert.equal(r.data.branding.color, '#059669');
  assert.equal(r.data.branding.showUpiQr, true);
  assert.equal(r.data.branding.signature, null);
});

test('logo, colour, signature, stamp, UPI and bank details are saved and printed with every bill', async () => {
  const saved = await api.put('/app/business/branding', {
    logo: PNG, color: '#2563EB', tagline: 'Fresh every day', website: 'www.testtraders.in', signature: PNG, stamp: PNG,
    upiId: 'testtraders@okaxis', upiPayee: 'Test Traders', bankAccountNumber: '123456789012', bankIfsc: 'sbin0001234', bankName: 'SBI',
    logoOnReceipt: false,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const b = saved.data.branding;
  assert.equal(b.logo, PNG);
  assert.equal(b.color, '#2563EB');
  assert.equal(b.bankIfsc, 'SBIN0001234', 'IFSC is stored in capitals');
  assert.equal(b.logoOnReceipt, false);

  // The logo is the business's own (top bar, storefront) and comes with the signed-in user
  assert.equal((await api.get('/app/business/profile')).data.business.logo_url, PNG);
  assert.equal((await api.get('/auth/me')).data.user.businessLogo, PNG);

  // Every bill carries the branding, so the A4 sheet, the receipt and the PDF show it
  const p = await createProduct(api);
  const sale = await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'CASH' });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  assert.equal(sale.data.invoice.business.logo_url, PNG);
  assert.equal(sale.data.invoice.branding.upiId, 'testtraders@okaxis');
  assert.equal(sale.data.invoice.branding.signature, PNG);

  // The audit log names what changed, without the pictures
  const audit = (await api.get('/app/audit/logs')).data;
  const rows = (audit.data || audit.logs || []).filter((r: any) => r.action === 'BRANDING_UPDATED');
  assert.equal(rows.length, 1, JSON.stringify(audit).slice(0, 300));
  assert.ok(JSON.stringify(rows).includes('signature'), 'it says what changed');
  assert.ok(!JSON.stringify(rows).includes('base64'), 'no pictures in the audit log');
});

test('a picture can be removed, and only what is sent changes', async () => {
  const r = await api.put('/app/business/branding', { stamp: '' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.branding.stamp, null);
  assert.equal(r.data.branding.signature, PNG, 'the signature stays');
  assert.equal(r.data.branding.tagline, 'Fresh every day');
  const logo = await api.put('/app/business/branding', { logo: '' });
  assert.equal(logo.data.branding.logo, null);
  assert.equal((await api.get('/auth/me')).data.user.businessLogo, null);
});

test('bad input is refused: wrong UPI ID, IFSC, colour, or a file that is not a picture', async () => {
  for (const body of [{ upiId: 'not-a-upi' }, { bankIfsc: '12345' }, { color: 'red' }, { logo: 'data:text/html;base64,PHNjcmlwdD4=' },
    { signature: 'javascript:alert(1)' }, { logo: `data:image/png;base64,${'A'.repeat(900_000)}` }]) {
    const r = await api.put('/app/business/branding', body);
    assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 60)} → ${r.status}`);
  }
});

test('only the owner can change the branding; staff can still see it (their bills print it)', async () => {
  const bcrypt = (await import('bcryptjs')).default;
  const { db } = await import('../src/db/connection.js');
  const shops = await import('../src/db/shops.js');
  shops.runInShop('main', () => {
    const biz = (db.prepare('SELECT id FROM businesses LIMIT 1').get() as { id: string }).id;
    db.prepare("INSERT INTO users (id, business_id, name, email, password_hash, role, status) VALUES ('cashier-1', ?, 'Asha', 'asha@staff.in', ?, 'CASHIER', 'ACTIVE')")
      .run(biz, bcrypt.hashSync('cashier-pass', 4));
  });
  const login = await api.post('/auth/login', { email: 'asha@staff.in', password: 'cashier-pass' });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  api.setToken(login.data.token);
  assert.equal((await api.get('/app/business/branding')).status, 200);
  assert.equal((await api.put('/app/business/branding', { color: '#000000' })).status, 403);
});
