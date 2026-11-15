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

let phone = 9100000000;
const newCustomer = async (name: string) => (await api.post('/app/customers', { name, phone: String(phone++) })).data.customer;
const customer = async (id: string) => (await api.get(`/app/customers/${id}`)).data;
const stock = async (id: string) => (await api.get('/app/products?search=')).data.data.find((p: any) => p.id === id).stock_quantity;
const sell = async (body: Record<string, unknown>) => {
  const res = await api.post('/app/billing/checkout', body);
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.invoice;
};

/** The customer's balance, what their open bills say and their statement must always agree. */
async function assertConsistent(customerId: string) {
  const { customer: c, invoices } = await customer(customerId);
  const ledger = (await api.get(`/app/customers/${customerId}/ledger`)).data;
  assert.equal(ledger.closingBalancePaise, c.outstanding_balance_paise, 'statement closing balance = recorded balance');
  const openDue = invoices.filter((i: any) => i.status === 'ISSUED').reduce((s: number, i: any) => s + i.total_paise - i.amount_paid_paise, 0);
  if (c.outstanding_balance_paise >= 0) assert.equal(openDue, c.outstanding_balance_paise, 'open bills = balance');
  else assert.equal(openDue, 0, 'with an advance, no bill is left open');
}

test('deleting a bill whose payment was kept as advance keeps the payment on record', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const c = await newCustomer('Keep Advance');
  const inv = await sell({ customerId: c.id, items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'CASH' });
  assert.equal((await api.post(`/app/billing/invoices/${inv.id}/cancel`, { refundMode: 'CUSTOMER_CREDIT' })).status, 200);
  assert.equal((await api.del(`/app/billing/invoices/${inv.id}`)).status, 200);
  const after = await customer(c.id);
  assert.equal(after.customer.outstanding_balance_paise, -inv.total_paise);
  assert.equal(after.payments.filter((x: any) => x.direction === 'IN').reduce((s: number, x: any) => s + x.amount_paise, 0), inv.total_paise);
  await assertConsistent(c.id);
});

test('deleting a refunded bill keeps both the payment and the refund', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const c = await newCustomer('Refunded');
  const inv = await sell({ customerId: c.id, items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'UPI' });
  await api.post(`/app/billing/invoices/${inv.id}/cancel`, {});
  await api.del(`/app/billing/invoices/${inv.id}`);
  const after = await customer(c.id);
  assert.equal(after.customer.outstanding_balance_paise, 0);
  assert.deepEqual(after.payments.map((x: any) => x.direction).sort(), ['IN', 'OUT']);
  await assertConsistent(c.id);
});

test('an advance pays the next credit bill, and a later payment settles the rest', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const c = await newCustomer('Advance First');
  await api.post(`/app/customers/${c.id}/payments`, { amountPaise: 14200, mode: 'CASH' });
  const inv = await sell({ customerId: c.id, items: [{ productId: p.id, quantity: 2, unitPricePaise: 10000 }], paymentMode: 'CREDIT' });
  let state = await customer(c.id);
  const bill = state.invoices.find((i: any) => i.id === inv.id);
  assert.equal(bill.amount_paid_paise, 14200);
  assert.equal(bill.payment_status, 'PARTIAL');
  assert.equal(state.customer.outstanding_balance_paise, inv.total_paise - 14200);
  await assertConsistent(c.id);
  await api.post(`/app/customers/${c.id}/payments`, { amountPaise: inv.total_paise - 14200, mode: 'UPI' });
  state = await customer(c.id);
  assert.equal(state.invoices.find((i: any) => i.id === inv.id).payment_status, 'PAID');
  assert.equal(state.customer.outstanding_balance_paise, 0);
  await assertConsistent(c.id);
});

test('cancelling one bill without refund pays the customer\'s other open bill', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const c = await newCustomer('Two Bills');
  const owed = await sell({ customerId: c.id, items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'CREDIT' });
  const paid = await sell({ customerId: c.id, items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'CASH' });
  await api.post(`/app/billing/invoices/${paid.id}/cancel`, { refundMode: 'CUSTOMER_CREDIT' });
  const state = await customer(c.id);
  assert.equal(state.customer.outstanding_balance_paise, 0);
  assert.equal(state.invoices.find((i: any) => i.id === owed.id).payment_status, 'PAID');
  await assertConsistent(c.id);
});

test('sales return: valued at what the bill charged (discount, tax-inclusive), never more than sold', async () => {
  const p = await createProduct(api, { stockQuantity: 10, taxRate: 18 });
  const inv = await sell({
    items: [{ productId: p.id, quantity: 2, unitPricePaise: 11800, discountPaise: 1180, taxRate: 18 }],
    pricesIncludeTax: true, roundOff: false, paymentMode: 'CASH',
  });
  const line = inv.items[0];
  const tooMany = await api.post('/app/returns/sales', { invoiceId: inv.id, items: [{ productId: p.id, productName: p.name, quantity: 3 }] });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.data.code, 'RETURN_TOO_MANY');

  const res = await api.post('/app/returns/sales', { invoiceId: inv.id, refundMode: 'CASH',
    items: [{ productId: p.id, productName: p.name, quantity: 1, unitPricePaise: 999999, taxRate: 0 }] });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.data.total_refund_paise, Math.round(line.taxable_paise / 2) + Math.round(line.tax_paise / 2));
  assert.ok(res.data.data.total_refund_paise <= Math.ceil(line.total_paise / 2));
  assert.equal(await stock(p.id), 9);

  const second = await api.post('/app/returns/sales', { invoiceId: inv.id, items: [{ productId: p.id, productName: p.name, quantity: 1 }] });
  assert.equal(second.status, 201);
  assert.equal(second.data.data.credit_note_number, `CN-${Number(res.data.data.credit_note_number.slice(3)) + 1}`);
  const third = await api.post('/app/returns/sales', { invoiceId: inv.id, items: [{ productId: p.id, productName: p.name, quantity: 0.5 }] });
  assert.equal(third.status, 400);

  const cash = (await api.get('/app/billing/payments?direction=OUT')).data;
  const rows = cash.data || cash.payments || cash;
  assert.ok(rows.some((x: any) => x.reference_number === res.data.data.credit_note_number && x.amount_paise === res.data.data.total_refund_paise),
    'cash refund is in the cash book');
});

test('sales return on an unpaid credit bill takes it off what is owed, no cash goes out', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const c = await newCustomer('Return On Credit');
  const inv = await sell({ customerId: c.id, items: [{ productId: p.id, quantity: 2, unitPricePaise: 10000 }], paymentMode: 'CREDIT' });
  const res = await api.post('/app/returns/sales', { invoiceId: inv.id, refundMode: 'CASH', items: [{ productId: p.id, productName: p.name, quantity: 1 }] });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const state = await customer(c.id);
  assert.equal(state.customer.outstanding_balance_paise, inv.total_paise - res.data.data.total_refund_paise);
  assert.equal(state.payments.filter((x: any) => x.direction === 'OUT').length, 0);
  await assertConsistent(c.id);
});

test('store credit return: needs a customer; becomes their advance', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const walkIn = await sell({ items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'CASH' });
  const refused = await api.post('/app/returns/sales', { invoiceId: walkIn.id, refundMode: 'STORE_CREDIT', items: [{ productId: p.id, productName: p.name, quantity: 1 }] });
  assert.equal(refused.status, 400);
  assert.equal(refused.data.code, 'CUSTOMER_REQUIRED');

  const c = await newCustomer('Store Credit');
  const inv = await sell({ customerId: c.id, items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'CASH' });
  const res = await api.post('/app/returns/sales', { invoiceId: inv.id, refundMode: 'STORE_CREDIT', items: [{ productId: p.id, productName: p.name, quantity: 1 }] });
  assert.equal(res.status, 201);
  assert.equal((await customer(c.id)).customer.outstanding_balance_paise, -inv.total_paise);
  await assertConsistent(c.id);
});

test('purchase return: lowers what the bill owes first, then money back is recorded', async () => {
  const p = await createProduct(api, { stockQuantity: 0 });
  const sup = (await api.post('/app/suppliers', { name: 'Return Supplier' })).data.supplier;
  const buy = await api.post('/app/purchases', { supplierId: sup.id, supplierName: sup.name, purchaseNumber: 'PB-1',
    items: [{ productId: p.id, productName: p.name, quantity: 10, unitPricePaise: 5000, taxRate: 18 }], amountPaidPaise: 30000 });
  assert.equal(buy.status, 201, JSON.stringify(buy.data));
  const purchase = (await api.get(`/app/purchases/${buy.data.purchaseId}`)).data.purchase;
  const owed = purchase.total_paise - 30000;

  const res = await api.post('/app/returns/purchases', { purchaseId: purchase.id, supplierName: sup.name, refundMode: 'CASH',
    items: [{ productId: p.id, productName: p.name, quantity: 6 }] });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const total = res.data.data.total_paise;
  assert.equal(total, 6 * 5900);
  assert.equal(await stock(p.id), 4);
  const after = (await api.get(`/app/purchases/${purchase.id}`)).data;
  assert.equal(after.purchase.payment_status, 'PAID');
  const ledger = (await api.get(`/app/suppliers/${sup.id}/ledger`)).data;
  assert.equal(ledger.recordedOutstandingPaise, 0);
  assert.equal(ledger.closingBalancePaise, 0);
  assert.ok(ledger.entries.some((e: any) => e.type === 'REFUND_RECEIVED' && e.credit === total - owed));
  const tooMany = await api.post('/app/returns/purchases', { purchaseId: purchase.id, supplierName: sup.name, items: [{ productId: p.id, productName: p.name, quantity: 5 }] });
  assert.equal(tooMany.status, 400);
});

test('online order becomes a normal bill: GST, delivery line, stock, payment; never twice', async () => {
  const p = await createProduct(api, { stockQuantity: 10, taxRate: 18, salePricePaise: 11800 });
  const store = (await api.get('/app/store/config')).data.store;
  const order = await api.post(`/public/store/${store.slug}/orders`, {
    customer_name: 'Online Buyer', customer_phone: '9000000001', delivery_address: '1 MG Road', payment_mode: 'UPI',
    items: [{ product_id: p.id, quantity: 2 }],
  });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  const res = await api.post(`/app/store/orders/${order.data.orderId}/convert-to-invoice`, {});
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const bill = (await api.get(`/app/billing/invoices/${res.data.invoiceId}`)).data.invoice;
  assert.equal(bill.total_paise, order.data.totalAmountPaise, 'bill totals what the buyer was quoted');
  assert.ok(bill.tax_paise > 0, 'GST is split out');
  assert.equal(bill.payment_status, 'PAID');
  assert.equal(bill.payments[0].payment_mode, 'UPI');
  assert.equal(await stock(p.id), 8);
  assert.equal((await api.post(`/app/store/orders/${order.data.orderId}/convert-to-invoice`, {})).status, 409);
});

test('production run uses up raw material and adds finished goods, with stock history', async () => {
  const raw = await createProduct(api, { name: 'Flour', stockQuantity: 50 });
  const made = await createProduct(api, { name: 'Bread', stockQuantity: 0 });
  const bom = await api.post('/app/manufacturing/boms', { finished_product_id: made.id, output_quantity: 1,
    items: [{ raw_material_id: raw.id, quantity_required: 2 }] });
  assert.equal(bom.status, 201, JSON.stringify(bom.data));
  const order = await api.post('/app/manufacturing/orders', { bom_id: bom.data.bomId, target_quantity: 5 });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  const run = await api.post(`/app/manufacturing/orders/${order.data.orderId}/execute`, { completed_quantity: 5 });
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(await stock(raw.id), 40);
  assert.equal(await stock(made.id), 5);
});

test('a mistaken advance payment can be undone; customers holding money are never hidden', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const c = await newCustomer('Undo Me');
  const inv = await sell({ customerId: c.id, items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'CREDIT' });
  await api.post(`/app/billing/invoices/${inv.id}/cancel`, {});
  await api.post(`/app/customers/${c.id}/payments`, { amountPaise: 14200, mode: 'CASH' });
  assert.equal((await customer(c.id)).customer.outstanding_balance_paise, -14200);
  const list = (await api.get('/app/customers?search=Undo%20Me')).data.data;
  assert.equal(list.length, 1, 'still listed');

  const ledger = (await api.get(`/app/customers/${c.id}/ledger`)).data;
  const row = ledger.entries.find((e: any) => e.payment_id);
  const undo = await api.post(`/app/customers/${c.id}/payments/${row.payment_id}/void`, {});
  assert.equal(undo.status, 200, JSON.stringify(undo.data));
  assert.equal((await customer(c.id)).customer.outstanding_balance_paise, 0);
  assert.equal((await api.post(`/app/customers/${c.id}/payments/${row.payment_id}/void`, {})).status, 409);
  await assertConsistent(c.id);
  const stats = (await api.get('/app/business/stats')).data;
  const modes = JSON.stringify(stats);
  assert.ok(!/"amount_paise":0[,}]/.test(modes), 'no payment mode that nets to zero is listed');
});

test('a payment on a bill can be undone: the bill owes it again', async () => {
  const p = await createProduct(api, { stockQuantity: 10 });
  const c = await newCustomer('Undo Bill Pay');
  const inv = await sell({ customerId: c.id, items: [{ productId: p.id, quantity: 1, unitPricePaise: 10000 }], paymentMode: 'CREDIT' });
  await api.post(`/app/billing/invoices/${inv.id}/payments`, { amountPaise: inv.total_paise, mode: 'UPI' });
  const row = (await api.get(`/app/customers/${c.id}/ledger`)).data.entries.find((e: any) => e.payment_id);
  assert.equal((await api.post(`/app/customers/${c.id}/payments/${row.payment_id}/void`, {})).status, 200);
  const state = await customer(c.id);
  assert.equal(state.customer.outstanding_balance_paise, inv.total_paise);
  assert.equal(state.invoices.find((i: any) => i.id === inv.id).payment_status, 'UNPAID');
  await assertConsistent(c.id);
});
