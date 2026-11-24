import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { setupTestEnv, startTestServer, setupBusiness, createProduct, TestClient } from './helpers.js';

setupTestEnv();

let api: TestClient;
let db: any;
let biz = '';

before(async () => {
  api = await startTestServer();
  db = (await import('../src/db/connection.js')).db;
  await setupBusiness(api);
  biz = (db.prepare('SELECT id FROM businesses LIMIT 1').get() as any).id;
});
after(async () => { await api.close(); });

/** What the reports used to add up straight from the bills: the truth the summary must always equal */
function fromBills() {
  return db.prepare(`SELECT COALESCE(x.hsn_code, '') AS hsn, x.tax_rate AS rate, ROUND(SUM(x.quantity), 6) AS qty, SUM(x.taxable_paise) AS taxable,
      SUM(x.cgst_paise) AS cgst, SUM(x.sgst_paise) AS sgst, SUM(x.igst_paise) AS igst, SUM(x.tax_paise) AS tax, SUM(x.total_paise) AS total,
      ROUND(SUM(x.quantity * x.cost_price_paise), 4) AS cost
    FROM invoices i JOIN invoice_items x ON x.invoice_id = i.id WHERE i.business_id = ? AND i.status = 'ISSUED'
    GROUP BY 1, 2 ORDER BY 1, 2`).all(biz);
}
function fromSummary() {
  return db.prepare(`SELECT hsn_code AS hsn, tax_rate AS rate, ROUND(SUM(quantity), 6) AS qty, SUM(taxable_paise) AS taxable,
      SUM(cgst_paise) AS cgst, SUM(sgst_paise) AS sgst, SUM(igst_paise) AS igst, SUM(tax_paise) AS tax, SUM(total_paise) AS total,
      ROUND(SUM(cost_paise), 4) AS cost
    FROM sales_rollup WHERE business_id = ? GROUP BY 1, 2 HAVING SUM(lines) > 0 ORDER BY 1, 2`).all(biz);
}
const same = (step: string) => assert.deepEqual(fromSummary(), fromBills(), `after: ${step}`);

test('the sales summary always equals the bills, however they change (and rebuilds to the same)', async () => {
  const rice = await createProduct(api, { name: 'Rice', hsnCode: '1006', taxRate: 5, salePricePaise: 45000, purchasePricePaise: 38000 });
  const oil = await createProduct(api, { name: 'Oil', hsnCode: '1512', taxRate: 18, salePricePaise: 16500, purchasePricePaise: 14000 });
  const bill = (body: any) => api.post('/app/billing/checkout', { paymentMode: 'CASH', ...body });

  // issued bills
  const b1 = (await bill({ items: [{ productId: rice.id, quantity: 2, unitPricePaise: 45000 }, { productId: oil.id, quantity: 1, unitPricePaise: 16500 }] })).data.invoice;
  await bill({ items: [{ productId: oil.id, quantity: 3, unitPricePaise: 16000, discountPaise: 500 }] });
  // a line without a product (typed in at the counter)
  await bill({ items: [{ productName: 'Carry bag', quantity: 1, unitPricePaise: 1000, taxRate: 0 }] });
  same('three bills');

  // a draft does not count; issued, it does; its lines edited while a draft
  const draft = (await bill({ status: 'DRAFT', items: [{ productId: rice.id, quantity: 5, unitPricePaise: 45000 }] })).data.invoice;
  same('a draft');
  assert.equal((await api.put(`/app/billing/invoices/${draft.id}/draft`, { items: [{ productId: rice.id, quantity: 4, unitPricePaise: 44000 }] })).status, 200);
  same('a draft edited');
  assert.equal((await api.post(`/app/billing/invoices/${draft.id}/issue`, {})).status, 201);
  same('the draft issued');

  // cancelled
  assert.equal((await api.post(`/app/billing/invoices/${b1.id}/cancel`, { reason: 'Wrong items' })).status, 200);
  same('a bill cancelled');

  // re-dated, and a line's price changed directly (as an older version or a repair would)
  const any = db.prepare("SELECT id FROM invoices WHERE status = 'ISSUED' LIMIT 1").get() as any;
  db.prepare("UPDATE invoices SET invoice_date = '2026-01-15' WHERE id = ?").run(any.id);
  db.prepare('UPDATE invoice_items SET quantity = quantity + 1, total_paise = total_paise + 100 WHERE invoice_id = ?').run(any.id);
  same('re-dated and a line changed');

  // from another computer: lines first, then the bill (foreign keys off, as sync writes them)
  db.pragma('foreign_keys = OFF');
  const syncId = crypto.randomUUID();
  db.prepare(`INSERT INTO invoice_items (id, business_id, invoice_id, product_id, product_name, quantity, unit_price_paise, tax_rate, tax_paise, total_paise, taxable_paise, cgst_paise, sgst_paise, cost_price_paise)
    VALUES (?, ?, ?, ?, 'Rice', 1, 45000, 5, 2250, 47250, 45000, 1125, 1125, 38000)`).run(crypto.randomUUID(), biz, syncId, rice.id);
  db.prepare(`INSERT INTO invoices (id, business_id, invoice_number, customer_name, invoice_date, subtotal_paise, tax_paise, total_paise, status)
    VALUES (?, ?, 'OTHER-1', 'Walk-in Customer', date('now'), 45000, 2250, 47250, 'ISSUED')`).run(syncId, biz);
  same('a bill from another computer, lines first');
  // removed there: the bill goes first, then its lines
  db.prepare('DELETE FROM invoices WHERE id = ?').run(syncId);
  db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(syncId);
  db.pragma('foreign_keys = ON');
  same('that bill removed');

  // a bill deleted here (its lines go with it)
  const gone = (await bill({ items: [{ productId: oil.id, quantity: 2, unitPricePaise: 16500 }] })).data.invoice;
  same('one more bill');
  db.prepare('DELETE FROM invoices WHERE id = ?').run(gone.id);
  same('a bill deleted with its lines');

  // built again from scratch: exactly what the triggers kept
  const kept = db.prepare('SELECT * FROM sales_rollup WHERE lines != 0 ORDER BY business_id, day, product_key, hsn_code, tax_rate').all();
  const { rebuildSalesSummary } = await import('../src/db/salesSummary.js');
  rebuildSalesSummary(db);
  const rebuilt = db.prepare('SELECT * FROM sales_rollup WHERE lines != 0 ORDER BY business_id, day, product_key, hsn_code, tax_rate').all();
  const round = (rows: any[]) => rows.map((r) => ({ ...r, quantity: Math.round(r.quantity * 1e6) / 1e6, cost_paise: Math.round(r.cost_paise * 1e4) / 1e4 }));
  assert.deepEqual(round(rebuilt), round(kept));
  same('rebuilt');

  // and the reports read it: GST summary per HSN equals the bills
  const gst = (await api.get('/app/accounting/gst-summary')).data;
  const truth = fromBills().filter((r: any) => r.hsn);
  assert.equal(gst.hsnSummary.length, truth.length + (fromBills().some((r: any) => !r.hsn) ? 1 : 0));
  assert.equal(gst.rateSummary.reduce((n: number, r: any) => n + r.tax_amount_paise, 0), fromBills().reduce((n: number, r: any) => n + r.tax, 0));
});
