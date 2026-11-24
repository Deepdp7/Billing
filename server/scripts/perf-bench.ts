/**
 * Shopping-mall scale check. Builds a shop the size of a busy mall store (encrypted, exactly as in the desktop app),
 * then times every heavy thing the app asks the engine for: product search and barcode scans, the bill list and its
 * search, a bill, customers and their ledger, the dashboard, stock screens, every report, GST and profit & loss, a new
 * bill, exports.
 *
 *   npx tsx scripts/perf-bench.ts                     100,000 products, 50,000 customers, 1,000,000 bills (~3 items each)
 *   npx tsx scripts/perf-bench.ts --scale 0.1         a tenth of that (quick check)
 *   npx tsx scripts/perf-bench.ts --keep <dir>        keep / reuse the built shop in <dir> (building it takes minutes)
 *
 * Times are the engine's answer time on this computer (median of 5, after a first, cold call). A low-end shop PC is
 * about 3x slower per core: the targets (scan 15 ms, screens 100 ms, reports 400 ms) keep it under ~1 s there.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const SCALE = Number(arg('scale') || 1);
const N = { products: Math.round(100_000 * SCALE), customers: Math.round(50_000 * SCALE), bills: Math.round(1_000_000 * SCALE), categories: 200 };
const keep = arg('keep');
const dir = keep ? path.resolve(keep) : fs.mkdtempSync(path.join(os.tmpdir(), 'apna-perf-'));
fs.mkdirSync(dir, { recursive: true });
const reuse = !!keep && fs.existsSync(path.join(dir, 'ready.json'));

process.env.NODE_ENV = 'test';
process.env.APNA_DATA_DIR = dir;
process.env.DB_PATH = path.join(dir, 'shop.db');
process.env.APNA_DEMO_MODE = '0';
process.env.APNA_SINGLE_TENANT = '1';
process.env.APNA_LICENSE_ENFORCE = '0';
process.env.APNA_LICENSE_SERVER_URL = 'http://127.0.0.1:1';
process.env.JWT_SECRET = 'perf-secret-'.padEnd(64, 'x');
const keyFile = path.join(dir, 'db.key');
const dbKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : crypto.randomBytes(32).toString('hex');
fs.writeFileSync(keyFile, dbKey);

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(a: T[]) => a[rnd(a.length)];
const WORDS = ['Basmati', 'Rice', 'Toor', 'Dal', 'Sunflower', 'Oil', 'Atta', 'Sugar', 'Tea', 'Coffee', 'Biscuit', 'Soap', 'Shampoo', 'Paste',
  'Masala', 'Ghee', 'Butter', 'Paneer', 'Juice', 'Noodles', 'Detergent', 'Kurta', 'Saree', 'Jeans', 'Shirt', 'Shoes', 'Bag', 'Watch',
  'Bottle', 'Cookware', 'Towel', 'Bedsheet', 'Lamp', 'Charger', 'Cable', 'Earphones', 'Chocolate', 'Chips', 'Namkeen', 'Honey'];
const BRANDS = ['Tata', 'Amul', 'Fortune', 'Aashirvaad', 'Haldiram', 'Britannia', 'Dabur', 'Patanjali', 'Nestle', 'Surf', 'Fabindia',
  'Raymond', 'Bata', 'Titan', 'Prestige', 'Milton', 'Boat', 'Cadbury', 'Lays', 'Parle'];

/** --profile: every SQL statement slower than 15 ms, per case */
const profile = args.includes('--profile');
const slowSql: Array<[number, string]> = [];

async function main() {
  if (profile) {
    const Database: any = (await import('better-sqlite3-multiple-ciphers')).default;
    const prepare = Database.prototype.prepare;
    Database.prototype.prepare = function (sql: string) {
      const st = prepare.call(this, sql);
      for (const m of ['get', 'all', 'run']) {
        const f = st[m];
        st[m] = function (...a: unknown[]) {
          const t = performance.now();
          const out = f.apply(this, a);
          const ms = performance.now() - t;
          if (ms > 15) slowSql.push([ms, sql.replace(/\s+/g, ' ').trim()]);
          return out;
        };
      }
      return st;
    };
  }
  const tOpen = performance.now();
  const { configureRuntime } = await import('../src/config/runtime.js');
  configureRuntime({ dbKey }); // encrypted, as on a shop's computer
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server: any = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  let token = '';
  const call = async (method: string, url: string, body?: unknown) => {
    const t = performance.now();
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, ms: performance.now() - t, bytes: text.length, data: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };

  if (!reuse) {
    const reg = await call('POST', '/auth/register', { ownerName: 'Mall Owner', email: 'owner@mall.test', password: 'password123',
      businessName: 'City Mall Mart', category: 'GROCERY', state: 'West Bengal', gstin: '19AABCM1234A1Z5' });
    if (reg.status !== 201) throw new Error(`register ${reg.status} ${JSON.stringify(reg.data)}`);
  }
  const login = await call('POST', '/auth/login', { email: 'owner@mall.test', password: 'password123' });
  if (reuse) console.log(`  opening the shop (with any upgrade of its data): ${((performance.now() - tOpen) / 1000).toFixed(1)} s`);
  token = login.data.token;
  const { db } = await import('../src/db/connection.js');
  const biz = (db.prepare('SELECT id FROM businesses LIMIT 1').get() as any).id as string;
  // a shop built by an earlier run of this script: this version's indexes (idempotent)
  if (reuse) { const { MIGRATIONS } = await import('../src/db/migrations.js'); MIGRATIONS.find((m: any) => m.version === 6)!.up(db as any); }
  const owner = (db.prepare('SELECT id FROM users LIMIT 1').get() as any).id as string;

  // Built as a shop's data grows under an older version: without this version's new indexes, which are then added
  // exactly as the update does on its first start (timed: that is what a big shop waits once after updating)
  const NEW_INDEXES = ['idx_invoices_created', 'idx_stock_movements_created', 'idx_invoice_items_product', 'idx_invoices_customer_date', 'idx_payments_customer_recent', 'idx_payments_date_created'];
  if (!reuse) {
    for (const ix of NEW_INDEXES) db.exec(`DROP INDEX IF EXISTS ${ix}`);
    db.pragma('cache_size = -400000');
    const t0 = performance.now();
    const id = () => crypto.randomUUID();
    const cats: string[] = [];
    db.transaction(() => {
      const ins = db.prepare('INSERT INTO categories (id, business_id, name) VALUES (?, ?, ?)');
      for (let i = 0; i < N.categories; i++) { const c = id(); cats.push(c); ins.run(c, biz, `${pick(WORDS)} ${i}`); }
    })();
    const products: Array<{ id: string; name: string; sku: string; price: number; tax: number }> = [];
    const insP = db.prepare(`INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, hsn_code, purchase_price_paise, sale_price_paise,
      mrp_paise, tax_rate, stock_quantity, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?, 'pcs', ?, ?, ?, ?, ?, ?, 5)`);
    for (let b = 0; b < N.products; b += 10_000) {
      db.transaction(() => {
        for (let i = b; i < Math.min(N.products, b + 10_000); i++) {
          const price = 1000 + rnd(500_000);
          const p = { id: id(), name: `${pick(BRANDS)} ${pick(WORDS)} ${pick(WORDS)} ${100 + rnd(900)}g`, sku: `SKU${String(i).padStart(7, '0')}`, price, tax: pick([0, 5, 12, 18, 28]) };
          products.push(p);
          insP.run(p.id, biz, pick(cats), p.name, p.sku, `890${String(1_000_000_000 + i)}`, String(1000 + rnd(9000)), Math.round(price * 0.8), price, Math.round(price * 1.1), p.tax, rnd(500));
        }
      })();
    }
    const customers: string[] = [];
    const insC = db.prepare('INSERT INTO customers (id, business_id, name, phone, email) VALUES (?, ?, ?, ?, ?)');
    for (let b = 0; b < N.customers; b += 10_000) {
      db.transaction(() => {
        for (let i = b; i < Math.min(N.customers, b + 10_000); i++) {
          const c = id(); customers.push(c);
          insC.run(c, biz, `${pick(['Ravi', 'Asha', 'Sohan', 'Meena', 'Arjun', 'Priya', 'Kunal', 'Neha', 'Amit', 'Sneha'])} ${pick(['Das', 'Roy', 'Sharma', 'Gupta', 'Sen', 'Bose', 'Iyer', 'Khan'])} ${i}`,
            `9${String(100_000_000 + i).padStart(9, '0')}`, `c${i}@mail.test`);
        }
      })();
    }
    console.log(`  products + customers: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    const insI = db.prepare(`INSERT INTO invoices (id, business_id, invoice_number, customer_id, customer_name, customer_phone, invoice_date, subtotal_paise,
      tax_paise, cgst_paise, sgst_paise, total_paise, payment_mode, payment_status, amount_paid_paise, created_by, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?, ?, 'ISSUED', ?)`);
    const insL = db.prepare(`INSERT INTO invoice_items (id, business_id, invoice_id, product_id, product_name, sku, quantity, unit_price_paise, tax_rate, tax_paise, total_paise)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insPay = db.prepare('INSERT INTO payments (id, business_id, invoice_id, customer_id, amount_paise, payment_mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insM = db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, created_at)
      VALUES (?, ?, ?, ?, ?, 'INVOICE', ?, ?)`);
    const start = Date.now() - 365 * 86_400_000;
    const step = (365 * 86_400_000) / Math.max(1, N.bills);
    for (let b = 0; b < N.bills; b += 20_000) {
      db.transaction(() => {
        for (let i = b; i < Math.min(N.bills, b + 20_000); i++) {
          const inv = id();
          const at = new Date(start + i * step);
          const iso = at.toISOString().replace('T', ' ').slice(0, 19);
          const cust = Math.random() < 0.3 ? pick(customers) : null;
          let sub = 0; let tax = 0;
          const lines = Array.from({ length: 1 + rnd(5) }, () => {
            const p = products[rnd(products.length)];
            const q = 1 + rnd(3);
            const t = Math.round((p.price * q * p.tax) / 100);
            sub += p.price * q; tax += t;
            return { p, q, t };
          });
          const mode = pick(['CASH', 'UPI', 'CARD', 'CASH', 'UPI']);
          insI.run(inv, biz, `INV-${String(i + 1).padStart(7, '0')}`, cust, cust ? 'Member' : 'Walk-in Customer', null, iso.slice(0, 10),
            sub, tax, Math.floor(tax / 2), tax - Math.floor(tax / 2), sub + tax, mode, sub + tax, owner, iso);
          for (const { p, q, t } of lines) {
            insL.run(id(), biz, inv, p.id, p.name, p.sku, q, p.price, p.tax, t, p.price * q + t);
            insM.run(id(), biz, p.id, -q, 100, inv, iso);
          }
          insPay.run(id(), biz, inv, cust, sub + tax, mode, iso);
        }
      })();
      if ((b / 20_000) % 10 === 0) process.stdout.write(`\r  bills: ${Math.min(N.bills, b + 20_000).toLocaleString('en-IN')} / ${N.bills.toLocaleString('en-IN')}`);
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('cache_size = -16000');
    const ti = performance.now();
    const { MIGRATIONS } = await import('../src/db/migrations.js');
    MIGRATIONS.find((m: any) => m.version === 6)!.up(db as any);
    console.log(`  the update's new indexes on this shop: ${((performance.now() - ti) / 1000).toFixed(1)} s (once, at the first start after updating)`);
    // as the app does when it opens a business (and every 6 hours): fresh planner statistics
    db.pragma('analysis_limit = 400');
    db.pragma('optimize = 0x10002');
    console.log(`\n  built in ${((performance.now() - t0) / 1000).toFixed(0)} s; database ${(fs.statSync(process.env.DB_PATH!).size / 1048576).toFixed(0)} MB`);
    fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify(N));
  }

  const count = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c as number;
  console.log(`\nShop: ${count('products').toLocaleString('en-IN')} products, ${count('customers').toLocaleString('en-IN')} customers, ` +
    `${count('invoices').toLocaleString('en-IN')} bills, ${count('invoice_items').toLocaleString('en-IN')} bill lines (encrypted database)\n`);

  const sample = (sql: string) => db.prepare(sql).get() as any;
  const aProduct = sample("SELECT name, sku, barcode FROM products WHERE rowid = (SELECT MAX(rowid) / 2 FROM products)");
  const aCustomer = sample('SELECT id, phone FROM customers WHERE rowid = (SELECT MAX(rowid) / 2 FROM customers)');
  const aBill = sample('SELECT id, invoice_number FROM invoices WHERE rowid = (SELECT MAX(rowid) / 2 FROM invoices)');
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const word = aProduct.name.split(' ')[1];

  type Case = { name: string; url: string; target: number; method?: string; body?: () => unknown };
  const cases: Case[] = [
    { name: 'Scan a barcode (POS)', url: `/app/products?barcode=${aProduct.barcode}&limit=5`, target: 15 },
    { name: 'Type a product code (POS)', url: `/app/products?code=${aProduct.sku}&limit=5`, target: 15 },
    { name: 'Search products by word', url: `/app/products?search=${encodeURIComponent(word)}&limit=50`, target: 100 },
    { name: 'Search products by 3 letters', url: `/app/products?search=${encodeURIComponent(word.slice(0, 3))}&limit=20`, target: 100 },
    { name: 'Products list, first page', url: '/app/products?limit=50', target: 100 },
    { name: 'Products list, page 1,000', url: '/app/products?limit=50&page=1000', target: 150 },
    { name: 'Low-stock products', url: '/app/products?lowStockOnly=true&limit=50', target: 100 },
    { name: 'Bills list, first page', url: '/app/billing/invoices?limit=50', target: 100 },
    { name: 'Bills list, page 5,000', url: '/app/billing/invoices?limit=50&page=5000', target: 150 },
    { name: 'Find a bill by number', url: `/app/billing/invoices?search=${aBill.invoice_number}&limit=20`, target: 100 },
    { name: 'Open a bill', url: `/app/billing/invoices/${aBill.id}`, target: 30 },
    { name: 'Bill lookup for a return', url: `/app/returns/sales/lookup/${aBill.invoice_number}`, target: 50 },
    { name: 'Payments list', url: '/app/billing/payments?limit=50', target: 100 },
    { name: 'Customers list', url: '/app/customers?limit=50', target: 100 },
    { name: 'Find a customer by phone', url: `/app/customers?search=${aCustomer.phone}&limit=20`, target: 50 },
    { name: 'Open a customer', url: `/app/customers/${aCustomer.id}`, target: 50 },
    { name: 'Customer ledger', url: `/app/customers/${aCustomer.id}/ledger`, target: 100 },
    { name: 'Dashboard', url: '/app/business/stats', target: 200 },
    { name: 'Stock alerts', url: '/app/inventory/alerts', target: 150 },
    { name: 'Stock movements', url: '/app/inventory/movements?limit=50', target: 100 },
    { name: 'Stock valuation', url: '/app/inventory/valuation', target: 300 },
    { name: 'GST summary, this month', url: `/app/accounting/gst-summary?fromDate=${monthAgo}&toDate=${today}`, target: 300 },
    { name: 'GST summary, whole year', url: `/app/accounting/gst-summary?fromDate=${yearAgo}&toDate=${today}`, target: 600 },
    { name: 'Profit & loss, this month', url: `/app/accounting/profit-loss?fromDate=${monthAgo}&toDate=${today}`, target: 300 },
    { name: 'Profit & loss, whole year', url: `/app/accounting/profit-loss?fromDate=${yearAgo}&toDate=${today}`, target: 600 },
  ];
  const reports = (await call('GET', '/app/reports')).data;
  const types: string[] = (reports?.data || []).map((r: any) => (typeof r === 'string' ? r : r.type || r.key || r.id)).filter(Boolean);
  for (const t of types) cases.push({ name: `Report: ${t}, this month`, url: `/app/reports/${t}?fromDate=${monthAgo}&toDate=${today}`, target: 400 });
  cases.push({ name: 'New bill (3 items)', url: '/app/billing/checkout', method: 'POST', target: 100, body: () => {
    const ps = db.prepare('SELECT id, sale_price_paise FROM products ORDER BY RANDOM() LIMIT 3').all() as any[];
    return { items: ps.map((p) => ({ productId: p.id, quantity: 1, unitPricePaise: p.sale_price_paise })), paymentMode: 'CASH', clientRequestId: crypto.randomUUID() };
  } });

  const rows: string[][] = [];
  let slow = 0;
  for (const c of cases) {
    const method = c.method || 'GET';
    const first = await call(method, c.url, c.body?.());
    if (first.status >= 400) { rows.push([c.name, '-', '-', `HTTP ${first.status}: ${JSON.stringify(first.data).slice(0, 60)}`]); continue; }
    slowSql.length = 0;
    const times: number[] = [];
    for (let i = 0; i < 5; i++) times.push((await call(method, c.url, c.body?.())).ms);
    times.sort((x, y) => x - y);
    const med = times[2];
    const ok = med <= c.target;
    if (!ok) slow++;
    rows.push([c.name, `${Math.round(first.ms)}`, `${Math.round(med)}`, `${ok ? 'ok' : 'SLOW'} (target ${c.target})${first.bytes > 500_000 ? ` ${(first.bytes / 1048576).toFixed(1)} MB` : ''}`]);
    if (profile && !ok) {
      const seen = new Map<string, number>();
      for (const [ms, sql] of slowSql) seen.set(sql, Math.max(seen.get(sql) || 0, ms));
      for (const [sql, ms] of [...seen].sort((a, b) => b[1] - a[1]).slice(0, 4)) rows.push(['', '', `${Math.round(ms)}`, `  SQL: ${sql.slice(0, 220)}`]);
    }
  }
  const w = Math.max(...rows.map((r) => r[0].length));
  console.log(`${'what'.padEnd(w)}  first ms  usual ms  result`);
  for (const r of rows) console.log(`${r[0].padEnd(w)}  ${r[1].padStart(8)}  ${r[2].padStart(8)}  ${r[3]}`);
  console.log(`\n${slow ? `${slow} over target` : 'everything within target'}  (data in ${dir})`);
  server.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
