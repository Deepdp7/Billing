import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, startTestServer, setupBusiness, createProduct, TestClient } from './helpers.js';

setupTestEnv();
let api: TestClient;

before(async () => {
  api = await startTestServer();
  await setupBusiness(api);
});
after(async () => { await api.close(); });

const stockOf = async (id: string) => (await api.get(`/app/products?search=`)).data.data.find((p: any) => p.id === id).stock_quantity;

test('cash sale: invoice saved, stock deducted, payment recorded, number assigned', async () => {
  const p = await createProduct(api, { name: 'Rice 1kg', stockQuantity: 10 });
  const res = await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: 2, unitPricePaise: 10000 }], paymentMode: 'CASH' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const inv = res.data.invoice;
  assert.match(inv.invoice_number, /^TES-\d+$/);
  assert.equal(inv.total_paise, 23600);
  assert.equal(inv.payment_status, 'PAID');
  assert.equal(inv.payments.length, 1);
  assert.equal(inv.items[0].cost_price_paise, 7000);
  assert.equal(await stockOf(p.id), 8);
});

test('validation: negative quantity is rejected (previously coerced to 1)', async () => {
  const p = await createProduct(api);
  const res = await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: -5, unitPricePaise: 10000 }] });
  assert.equal(res.status, 400);
  assert.equal(await stockOf(p.id), 10);
});

test('fractional quantity sells loose items', async () => {
  const p = await createProduct(api, { name: 'Sugar (loose)', unit: 'kg', stockQuantity: 5, taxRate: 0, salePricePaise: 4500 });
  const res = await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: 0.5, unitPricePaise: 4500 }] });
  assert.equal(res.status, 201);
  assert.equal(res.data.invoice.total_paise, 2300); // 2250 rounded off to ₹23
  assert.equal(res.data.invoice.round_off_paise, 50);
  assert.equal(await stockOf(p.id), 4.5);
});

test('insufficient stock blocks the sale and leaves everything unchanged (transaction rollback)', async () => {
  const p1 = await createProduct(api, { stockQuantity: 10 });
  const p2 = await createProduct(api, { stockQuantity: 1 });
  const before = (await api.get('/app/billing/invoices')).data.pagination.total;
  const res = await api.post('/app/billing/checkout', {
    items: [{ productId: p1.id, quantity: 3, unitPricePaise: 10000 }, { productId: p2.id, quantity: 2, unitPricePaise: 10000 }],
  });
  assert.equal(res.status, 409);
  assert.equal(res.data.code, 'INSUFFICIENT_STOCK');
  assert.equal(await stockOf(p1.id), 10);
  assert.equal((await api.get('/app/billing/invoices')).data.pagination.total, before);
});

test('a missing product mid-invoice rolls back the whole invoice', async () => {
  const p1 = await createProduct(api, { stockQuantity: 10 });
  const res = await api.post('/app/billing/checkout', {
    items: [{ productId: p1.id, quantity: 1, unitPricePaise: 100 }, { productId: 'does-not-exist', quantity: 1, unitPricePaise: 100 }],
  });
  assert.equal(res.status, 400);
  assert.equal(await stockOf(p1.id), 10);
});

test('idempotency: the same clientRequestId never creates two invoices', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const body = { clientRequestId: 'req-abcdef-123456', items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }] };
  const a = await api.post('/app/billing/checkout', body);
  const b = await api.post('/app/billing/checkout', body);
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.data.duplicate, true);
  assert.equal(a.data.invoice.id, b.data.invoice.id);
  assert.equal(await stockOf(p.id), 9);
});

test('credit sale requires a customer; with a customer it increases receivables', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const walkIn = await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'CREDIT' });
  assert.equal(walkIn.status, 400);
  assert.equal(walkIn.data.code, 'CUSTOMER_REQUIRED_FOR_CREDIT');

  const cust = (await api.post('/app/customers', { name: 'Ravi Kumar', phone: '9876500001', creditLimitPaise: 1000000 })).data.customer;
  const res = await api.post('/app/billing/checkout', { customerId: cust.id, items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'CREDIT' });
  assert.equal(res.status, 201);
  assert.equal(res.data.invoice.payment_status, 'UNPAID');
  assert.equal(res.data.invoice.payment_mode, 'CREDIT');
  assert.ok(res.data.invoice.due_date);
  const c = (await api.get(`/app/customers/${cust.id}`)).data.customer;
  assert.equal(c.outstanding_balance_paise, 11800);
});

test('partial + split payment, then later payment settles the invoice', async () => {
  const p = await createProduct(api, { stockQuantity: 10, taxRate: 0, salePricePaise: 50000 });
  const cust = (await api.post('/app/customers', { name: 'Split Buyer', phone: '9876500002' })).data.customer;
  const res = await api.post('/app/billing/checkout', {
    customerId: cust.id,
    items: [{ productId: p.id, quantity: 2, unitPricePaise: 50000 }],
    payments: [{ mode: 'CASH', amountPaise: 30000 }, { mode: 'UPI', amountPaise: 20000, reference: 'UPI123' }],
  });
  assert.equal(res.status, 201);
  const inv = res.data.invoice;
  assert.equal(inv.payment_mode, 'SPLIT');
  assert.equal(inv.payment_status, 'PARTIAL');
  assert.equal(inv.balance_due_paise, 50000);

  const over = await api.post(`/app/billing/invoices/${inv.id}/payments`, { amountPaise: 60000, mode: 'CASH' });
  assert.equal(over.status, 400);
  const pay = await api.post(`/app/billing/invoices/${inv.id}/payments`, { amountPaise: 50000, mode: 'BANK_TRANSFER' });
  assert.equal(pay.status, 201);
  assert.equal(pay.data.invoice.payment_status, 'PAID');
  assert.equal((await api.get(`/app/customers/${cust.id}`)).data.customer.outstanding_balance_paise, 0);
});

test('overpayment at checkout is rejected', async () => {
  const p = await createProduct(api, { taxRate: 0 });
  const res = await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], payments: [{ mode: 'CASH', amountPaise: 20000 }] });
  assert.equal(res.status, 400);
  assert.equal(res.data.code, 'OVERPAYMENT');
});

test('credit limit is enforced', async () => {
  const p = await createProduct(api, { taxRate: 0, stockQuantity: 100 });
  const cust = (await api.post('/app/customers', { name: 'Limited', phone: '9876500003', creditLimitPaise: 15000 })).data.customer;
  const res = await api.post('/app/billing/checkout', { customerId: cust.id, paymentMode: 'CREDIT', items: [{ productId: p.id, quantity: 2, unitPricePaise: 10000 }] });
  assert.equal(res.status, 409);
  assert.equal(res.data.code, 'CREDIT_LIMIT_EXCEEDED');
});

test('inter-state customer gets IGST automatically', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const cust = (await api.post('/app/customers', { name: 'Delhi Buyer', phone: '9876500004', gstin: '07AAACD1234B1Z5', state: 'Delhi' })).data.customer;
  const res = await api.post('/app/billing/checkout', { customerId: cust.id, items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }] });
  assert.equal(res.status, 201);
  assert.equal(res.data.invoice.is_inter_state, 1);
  assert.equal(res.data.invoice.igst_paise, 1800);
  assert.equal(res.data.invoice.cgst_paise, 0);
});

test('cancel (reason optional) restores stock, refunds payment and writes an audit entry', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const inv = (await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: 4, unitPricePaise: 10000 }], paymentMode: 'UPI' })).data.invoice;
  assert.equal(await stockOf(p.id), 6);
  const res = await api.post(`/app/billing/invoices/${inv.id}/cancel`, { reason: 'Customer changed mind' });
  assert.equal(res.status, 200);
  assert.equal(res.data.invoice.status, 'CANCELLED');
  assert.equal(await stockOf(p.id), 10);
  const refund = res.data.invoice.payments.find((x: any) => x.direction === 'OUT');
  assert.equal(refund.amount_paise, inv.total_paise);
  assert.equal(refund.payment_mode, 'UPI');
  assert.equal((await api.post(`/app/billing/invoices/${inv.id}/cancel`, { reason: 'again' })).status, 409);
  const logs = (await api.get('/app/audit/logs')).data.logs;
  assert.ok(logs.some((l: any) => l.action === 'INVOICE_CANCELLED' && l.entity_id === inv.id));
});

test('customer advance: paying after a deleted credit bill leaves an advance, which can be returned', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const c = (await api.post('/app/customers', { name: 'Advance Test', phone: '9000011111' })).data.customer;
  const inv = (await api.post('/app/billing/checkout', { customerId: c.id, items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'CREDIT' })).data.invoice;
  assert.equal((await api.post(`/app/billing/invoices/${inv.id}/cancel`, {})).status, 200);
  assert.equal((await api.post(`/app/customers/${c.id}/payments`, { amountPaise: inv.total_paise, mode: 'CASH' })).status, 201);
  const balance = async () => (await api.get('/app/customers?search=Advance%20Test')).data.data[0].outstanding_balance_paise;
  assert.equal(await balance(), -inv.total_paise);
  const blocked = await api.del(`/app/customers/${c.id}`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.message, /advance/);
  assert.equal((await api.post(`/app/customers/${c.id}/refund`, { amountPaise: inv.total_paise + 1, mode: 'CASH' })).status, 400);
  assert.equal((await api.post(`/app/customers/${c.id}/refund`, { amountPaise: inv.total_paise, mode: 'CASH' })).status, 201);
  assert.equal(await balance(), 0);
  assert.equal((await api.post(`/app/customers/${c.id}/refund`, { amountPaise: 100, mode: 'CASH' })).status, 400);
});

test('draft lifecycle: save draft (no stock change) → edit → issue', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const d = await api.post('/app/billing/checkout', { status: 'DRAFT', items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }] });
  assert.equal(d.status, 201);
  assert.equal(d.data.invoice.status, 'DRAFT');
  assert.match(d.data.invoice.invoice_number, /^DRAFT-/);
  assert.equal(await stockOf(p.id), 10);

  const edited = await api.put(`/app/billing/invoices/${d.data.invoice.id}/draft`, { items: [{ productId: p.id, quantity: 3, unitPricePaise: 10000 }] });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.invoice.items[0].quantity, 3);

  const issued = await api.post(`/app/billing/invoices/${d.data.invoice.id}/issue`, { paymentMode: 'CASH' });
  assert.equal(issued.status, 201);
  assert.equal(issued.data.invoice.status, 'ISSUED');
  assert.match(issued.data.invoice.invoice_number, /^TES-/);
  assert.equal(await stockOf(p.id), 7);
});

test('duplicate creates a draft copy', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const inv = (await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: 2, unitPricePaise: 10000 }] })).data.invoice;
  const dup = await api.post(`/app/billing/invoices/${inv.id}/duplicate`);
  assert.equal(dup.status, 201);
  assert.equal(dup.data.invoice.status, 'DRAFT');
  assert.equal(dup.data.invoice.items[0].quantity, 2);
});

test('invoice numbers are unique and sequential', async () => {
  const p = await createProduct(api, { stockQuantity: 100, taxRate: 0 });
  const nums = [];
  for (let i = 0; i < 5; i++) {
    nums.push((await api.post('/app/billing/checkout', { items: [{ productId: p.id, quantity: 1, unitPricePaise: 100 }] })).data.invoice.invoice_number);
  }
  const n = nums.map((x) => Number(x.split('-')[1]));
  for (let i = 1; i < n.length; i++) assert.equal(n[i], n[i - 1] + 1);
});

test('customer ledger, on-account payment (FIFO), edit and delete safeguards', async () => {
  const p = await createProduct(api, { stockQuantity: 100, taxRate: 0 });
  const cust = (await api.post('/app/customers', { name: 'Ledger Co', phone: '9876500005' })).data.customer;
  const i1 = (await api.post('/app/billing/checkout', { customerId: cust.id, paymentMode: 'CREDIT', items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }] })).data.invoice;
  const i2 = (await api.post('/app/billing/checkout', { customerId: cust.id, paymentMode: 'CREDIT', items: [{ productId: p.id, quantity: 1, unitPricePaise: 20000 }] })).data.invoice;

  const pay = await api.post(`/app/customers/${cust.id}/payments`, { amountPaise: 15000, mode: 'CASH' });
  assert.equal(pay.status, 201);
  assert.deepEqual(pay.data.allocations.map((a: any) => a.amountPaise), [10000, 5000]);
  assert.equal((await api.get(`/app/billing/invoices/${i1.id}`)).data.invoice.payment_status, 'PAID');
  assert.equal((await api.get(`/app/billing/invoices/${i2.id}`)).data.invoice.payment_status, 'PARTIAL');

  const ledger = (await api.get(`/app/customers/${cust.id}/ledger`)).data;
  assert.equal(ledger.closingBalancePaise, 15000);
  assert.equal(ledger.recordedOutstandingPaise, 15000);

  assert.equal((await api.put(`/app/customers/${cust.id}`, { name: 'Ledger Company Pvt Ltd', gstin: 'BAD' })).status, 400);
  const upd = await api.put(`/app/customers/${cust.id}`, { name: 'Ledger Company Pvt Ltd', shippingAddress: 'Warehouse 4' });
  assert.equal(upd.data.customer.name, 'Ledger Company Pvt Ltd');

  assert.equal((await api.del(`/app/customers/${cust.id}`)).data.code, 'HAS_BALANCE');
  await api.post(`/app/customers/${cust.id}/payments`, { amountPaise: 15000, mode: 'UPI' });
  assert.equal((await api.del(`/app/customers/${cust.id}`)).data.code, 'HAS_HISTORY');
  const deact = await api.del(`/app/customers/${cust.id}?mode=deactivate`);
  assert.equal(deact.data.deactivated, true);

  const fresh = (await api.post('/app/customers', { name: 'No History', phone: '9876500006' })).data.customer;
  assert.equal((await api.del(`/app/customers/${fresh.id}`)).data.deleted, true);
});

test('purchases add stock and supplier payables; supplier payments settle bills', async () => {
  const p = await createProduct(api, { stockQuantity: 0, purchasePricePaise: 5000 });
  const sup = (await api.post('/app/suppliers', { name: 'Wholesale Mart' })).data.supplier;
  const res = await api.post('/app/purchases', {
    supplierId: sup.id, supplierName: sup.name, purchaseNumber: 'WM-001', amountPaidPaise: 0,
    items: [{ productId: p.id, productName: p.name, quantity: 20, unitPricePaise: 5500, taxRate: 18 }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(await stockOf(p.id), 20);
  const dup = await api.post('/app/purchases', { supplierId: sup.id, supplierName: sup.name, purchaseNumber: 'WM-001', items: [{ productName: 'x', quantity: 1, unitPricePaise: 1 }] });
  assert.equal(dup.status, 409);
  let s = (await api.get('/app/suppliers')).data.data.find((x: any) => x.id === sup.id);
  assert.equal(s.outstanding_balance_paise, 129800);
  const pay = await api.post(`/app/suppliers/${sup.id}/payments`, { amountPaise: 129800, mode: 'BANK_TRANSFER' });
  assert.equal(pay.status, 201);
  s = (await api.get('/app/suppliers')).data.data.find((x: any) => x.id === sup.id);
  assert.equal(s.outstanding_balance_paise, 0);
});

test('purchase order → receive goods', async () => {
  const p = await createProduct(api, { stockQuantity: 0 });
  const sup = (await api.post('/app/suppliers', { name: 'PO Supplier' })).data.supplier;
  const po = await api.post('/app/purchase-orders', { supplierId: sup.id, supplierName: sup.name, items: [{ productId: p.id, productName: p.name, quantity: 5, unitPricePaise: 1000 }] });
  assert.equal(po.status, 201);
  const rec = await api.post(`/app/purchase-orders/${po.data.order.id}/receive`, { purchaseNumber: 'POS-77', amountPaidPaise: 5000 });
  assert.equal(rec.status, 201, JSON.stringify(rec.data));
  assert.equal(await stockOf(p.id), 5);
  assert.equal((await api.post(`/app/purchase-orders/${po.data.order.id}/receive`, { purchaseNumber: 'POS-78' })).status, 409);
});

test('expenses: create, update, delete, analytics', async () => {
  const c = await api.post('/app/expenses', { category: 'Rent', amountPaise: 1500000, expenseDate: '2026-10-01' });
  assert.equal(c.status, 201);
  assert.equal((await api.post('/app/expenses', { category: 'Rent', amountPaise: -5 })).status, 400);
  const u = await api.put(`/app/expenses/${c.data.expense.id}`, { amountPaise: 1600000 });
  assert.equal(u.data.expense.amount_paise, 1600000);
  const a = (await api.get('/app/expenses/analytics?months=12')).data;
  assert.ok(a.byCategory.some((r: any) => r.category === 'Rent'));
  assert.equal((await api.del(`/app/expenses/${c.data.expense.id}`)).status, 200);
});

test('quotation converts into a real invoice with stock deduction', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const q = await api.post('/app/quotations', { customerName: 'Prospect', items: [{ productId: p.id, productName: p.name, quantity: 2, unitPricePaise: 10000, taxRate: 18 }] });
  assert.equal(q.status, 201);
  assert.match(q.data.quotationNumber, /^EST-\d+$/);
  const conv = await api.post(`/app/quotations/${q.data.id}/convert`);
  assert.equal(conv.status, 200, JSON.stringify(conv.data));
  assert.equal(conv.data.invoice.total_paise, 23600);
  assert.equal(await stockOf(p.id), 8);
  assert.equal((await api.post(`/app/quotations/${q.data.id}/convert`)).status, 409);
});

test('products: stock edits go through the movement ledger; duplicate SKU rejected', async () => {
  const p = await createProduct(api, { sku: 'UNIQUE-1', stockQuantity: 10 });
  assert.equal((await api.post('/app/products', { name: 'dup', sku: 'UNIQUE-1' })).status, 409);
  await api.put(`/app/products/${p.id}`, { stockQuantity: 7 });
  const mv = (await api.get(`/app/inventory/movements?productId=${p.id}`)).data.data;
  assert.ok(mv.some((m: any) => m.change_quantity === -3 && m.resulting_quantity === 7));
});

test('reports: P&L uses cost at time of sale; registry reports and CSV/XLSX export work', async () => {
  const pl = (await api.get('/app/accounting/profit-loss')).data;
  assert.ok(pl.revenuePaise > 0);
  assert.equal(pl.grossProfitPaise, pl.revenuePaise - pl.cogsPaise);
  for (const type of ['sales', 'payments', 'customer-outstanding', 'supplier-outstanding', 'cash-flow', 'inventory', 'gst-hsn', 'top-products', 'profit-loss', 'invoices']) {
    const r = await api.get(`/app/reports/${type}?groupBy=month`);
    assert.equal(r.status, 200, `${type}: ${JSON.stringify(r.data)}`);
    assert.ok(Array.isArray(r.data.rows));
  }
  const csv = await api.getRaw('/app/reports/sales/export?format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.buffer.toString('utf8'), /Period,Invoices/);
  const xlsx = await api.getRaw('/app/reports/invoices/export?format=xlsx');
  assert.equal(xlsx.status, 200);
  assert.equal(xlsx.buffer.subarray(0, 2).toString(), 'PK'); // zip container
  const custCsv = await api.getRaw('/app/customers/export');
  assert.equal(custCsv.status, 200);
});

test('products: the Excel export imports back; a CSV adds and updates by SKU, makes categories, uses the stock ledger', async () => {
  // The export is the template: importing it unchanged updates every product and adds none
  const xlsx = await api.getRaw('/app/products/export?format=xlsx');
  const back = await api.post('/app/products/import', { fileName: 'products.xlsx', data: xlsx.buffer.toString('base64') });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  assert.equal(back.data.created, 0);
  assert.ok(back.data.updated > 0);
  assert.equal(back.data.skipped, 0, JSON.stringify(back.data.errors));

  // Common column names, any order, a new category, prices with ₹ and commas; a bad row is skipped and explained
  const csv = 'Name,SKU,Category,Unit,GST %,Selling Price,Stock\r\nImported Tea,IMP-TEA-1,Imported Drinks,box,5,"₹1,250.50",12\r\nBroken,IMP-BAD,,pcs,5,abc,1\r\n';
  const added = await api.post('/app/products/import', { fileName: 'products.csv', data: Buffer.from(csv).toString('base64') });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  assert.equal(added.data.created, 1);
  assert.equal(added.data.skipped, 1);
  assert.equal(added.data.errors[0].row, 3);
  assert.match(added.data.errors[0].message, /not a number/);
  let tea = (await api.get('/app/products?search=Imported%20Tea')).data.data[0];
  assert.equal(tea.sale_price_paise, 125050);
  assert.equal(tea.unit, 'box');
  assert.equal(tea.tax_rate, 5);
  assert.equal(tea.stock_quantity, 12);
  assert.ok((await api.get('/app/categories')).data.data.some((c: any) => c.name === 'Imported Drinks'));

  // The same SKU again updates it (no duplicate); the stock change is a ledger entry
  const again = await api.post('/app/products/import', { fileName: 'p.csv', data: Buffer.from('Name,SKU,Selling Price,Stock\nImported Tea,IMP-TEA-1,1300,20\n').toString('base64') });
  assert.deepEqual([again.data.created, again.data.updated], [0, 1]);
  tea = (await api.get('/app/products?search=Imported%20Tea')).data.data;
  assert.equal(tea.length, 1);
  assert.equal(tea[0].stock_quantity, 20);
  assert.equal(tea[0].sale_price_paise, 130000);

  assert.equal((await api.post('/app/products/import', { fileName: 'x.csv', data: Buffer.from('Foo,Bar\n1,2\n').toString('base64') })).data.code, 'IMPORT_COLUMNS');
});

test('categories: the form is offered the ones that fit the business and are not there yet', async () => {
  const r = (await api.get('/app/categories')).data;
  assert.ok(Array.isArray(r.suggestions));
  const have = new Set(r.data.map((c: any) => c.name.toLowerCase()));
  assert.ok(r.suggestions.every((n: string) => !have.has(n.toLowerCase())));
});

test('product lists: categories, units and GST rates can be added, renamed and deleted', async () => {
  // Units and rates start from the defaults, each with how many products use it
  let o = (await api.get('/app/products/options')).data;
  assert.ok(o.units.some((u: any) => u.value === 'pcs' && u.products > 0));
  assert.ok(o.gstRates.some((r: any) => r.rate === '18'));

  // Own lists: a new unit and a new rate; a renamed unit takes its products along
  o = (await api.put('/app/products/options', { units: [...o.units.map(({ value, label }: any) => ({ value, label })), { value: 'roll', label: 'Roll' }], gstRates: [0, 5, 1.5, 18, 18] })).data;
  assert.ok(o.units.some((u: any) => u.value === 'roll'));
  assert.deepEqual(o.gstRates.map((r: any) => r.rate), ['0', '1.5', '5', '18']);
  const boxed = await api.post('/app/products', { name: 'Tape', sku: 'TAPE-1', unit: 'roll', salePricePaise: 4000, taxRate: 1.5 });
  assert.equal(boxed.status, 201, JSON.stringify(boxed.data));
  o = (await api.put('/app/products/options', { units: o.units.map(({ value, label }: any) => (value === 'roll' ? { value: 'rl', label: 'Roll (rl)' } : { value, label })), renameUnit: { from: 'roll', to: 'rl' } })).data;
  assert.equal(o.units.find((u: any) => u.value === 'rl').products, 1);
  assert.equal((await api.get('/app/products?search=Tape')).data.data[0].unit, 'rl');
  assert.equal((await api.put('/app/products/options', { gstRates: [101] })).status, 400);

  // Categories: rename, then delete (its products become uncategorised)
  const cat = (await api.post('/app/categories', { name: 'Temp Shelf' })).data.category;
  assert.equal((await api.put(`/app/categories/${cat.id}`, { name: 'Shelf A' })).status, 200);
  assert.ok((await api.get('/app/categories')).data.data.some((c: any) => c.name === 'Shelf A'));
  assert.equal((await api.del(`/app/categories/${cat.id}`)).status, 200);
  assert.ok(!(await api.get('/app/categories')).data.data.some((c: any) => c.id === cat.id));
});

test('dashboard statistics are computed from stored records', async () => {
  const s = (await api.get('/app/business/stats')).data;
  assert.ok(s.today.invoices > 0);
  assert.equal(s.salesTrend.length, 30);
  assert.ok(s.month.salesPaise >= s.today.salesPaise);
  assert.ok(Array.isArray(s.paymentSummary));
});

test('held bills persist on the server', async () => {
  const h = await api.post('/app/billing/held', { label: 'Table 4', customerName: 'Walk-in', payload: { cart: [{ productId: 'x', quantity: 1 }] } });
  assert.equal(h.status, 201);
  const list = (await api.get('/app/billing/held')).data.data;
  assert.ok(list.some((b: any) => b.id === h.data.id && b.payload.cart.length === 1));
  await api.del(`/app/billing/held/${h.data.id}`);
  assert.ok(!(await api.get('/app/billing/held')).data.data.some((b: any) => b.id === h.data.id));
});

test('unauthenticated requests are rejected', async () => {
  api.setToken('');
  assert.equal((await api.get('/app/products')).status, 401);
});

