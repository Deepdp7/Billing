# Apna Billing — Feature Audit (Stage 1–2)

Audit date: 2026-11-02. Baseline commit: `5d9ad73`.

Method: every server controller, route, and client page was read; every `<button>` was
machine-scanned for a handler; the server was booted against a copy of the database and
login → product list → checkout was exercised over HTTP.

Legend — **Status**: ✅ works end-to-end · ⚠️ works with defects · ❌ missing/broken.
"Persisted" means the data is written to SQLite and survives restart.

---

## 1. Architecture discovered

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 19, Vite 8, Tailwind 3, lucide-react | Single-page app. Navigation is `useState` (no router). 28 pages. |
| Backend | Node + Express 4 + TypeScript (tsx in dev, tsc build) | 22 controller modules, ~140 REST endpoints under `/api/v1`. |
| Database | SQLite via better-sqlite3 11 | WAL mode, `foreign_keys=ON`, ~50 tables, money stored as integer paise. |
| Auth | JWT (7-day) + bcrypt | Roles: `SUPER_ADMIN`, `BUSINESS_OWNER`, staff roles (staff table is **not** linked to login users). |
| Tenancy | Multi-tenant SaaS (`business_id` on every row) | Designed as a cloud SaaS, not a desktop app. |
| Desktop / installer | **None** | No Electron/Tauri, no installer, no packaging. |
| Licensing | **None** | `plans` table exists but is not enforced anywhere. |
| Tests | **None** | |

### Structural problems found

1. **Database lives in the source tree** (`server/data/apna_billing.db`) and is committed to git, including demo
   users with known passwords. `DB_PATH` defaults to `cwd/data`.
2. **JWT secret is hard-coded** (`config/index.ts`) — any token signed with it is valid on every install.
3. **Server listens on all interfaces with `cors: *`** — on a shop LAN, anyone could reach the API.
4. **Demo data is auto-seeded on every start** (3+ demo businesses, super-admin `admin@apnabilling.com / admin123`).
5. **Demo quick-login** buttons with hard-coded passwords ship in `LoginPage` and the `Navbar` demo switcher.
6. **No migration system** — schema is `CREATE TABLE IF NOT EXISTS` plus `ALTER TABLE` wrapped in empty `catch {}`.
7. **"Platform Admin" is inside the customer's own app and DB** — unusable for controlling remote installs.
8. `credentials.txt` and `Phased/credentials.txt` (demo passwords) are committed.

---

## 2. Feature-by-feature audit — what each feature currently does

### 2.1 Authentication & onboarding
| Feature | What it does today | Status |
|---|---|---|
| Login | Email + password → bcrypt check → 7-day JWT stored in `localStorage`. Blocks suspended user/business. | ✅ |
| Register business | Creates business, owner user, a default category and one sample product; any number of businesses per DB. | ⚠️ unlimited self-registration; sample product is fake data |
| Demo quick login | 7 buttons log in as seeded demo accounts with hard-coded passwords. | ⚠️ must not ship in production |
| `/auth/me` | Returns user + business profile + category default modules. | ✅ |
| Roles / permissions | Only `SUPER_ADMIN` vs tenant is enforced. Staff roles (MANAGER/CASHIER/ACCOUNTANT) are records only — they cannot log in. | ❌ |

### 2.2 Dashboard
Shows today's sales and invoice count, month-to-date sales, receivables (sum of customer balances),
low-stock count, product count, last 5 invoices, top 5 products — all computed from SQLite.
**Missing:** purchases, expenses, profit, sales trend, payment-mode summary. Status ⚠️.

### 2.3 POS Billing (`PosBillingPage` → `POST /billing/checkout`)
What works: product grid by category, text search, barcode/SKU entry, cart with qty and per-line
discount, bill-level discount, payment mode selector (Cash/UPI/Card/Bank/Credit), customer picker,
hold/resume bill, invoice modal with thermal/A4 layout and print. Saving runs in one SQLite
transaction: invoice → items → stock deduction → stock-movement ledger → payment → customer balance → invoice counter.

Defects found (verified by code and/or live API call):
| # | Defect | Impact |
|---|---|---|
| B1 | Client always sends `amountPaidPaise = grandTotal`, even for `CREDIT`. | Credit / partial sales impossible from POS; receivables never grow. |
| B2 | Quantity clamped `Math.max(1, qty)` — verified: qty `-5` saved as `1`; `0.5` kg becomes `1`. | Loose/weighed items cannot be sold; invalid input silently accepted. |
| B3 | Bill-level discount is subtracted **after** GST is computed. | GST charged on pre-discount value — tax overstated. |
| B4 | `isInterState` never sent by client → IGST path unreachable. | Inter-state invoices wrong. |
| B5 | No stock check — stock can go negative. | Inventory integrity. |
| B6 | Client-supplied unit price/tax trusted without validation. | Negative or bogus values accepted. |
| B7 | No idempotency — double-click/retry creates two invoices. | Duplicate transactions. |
| B8 | Invoice number uniqueness not enforced by DB (no unique index). | Possible duplicates. |
| B9 | Held bills are in React memory only. | Lost on refresh/restart. |
| B10 | No tax-inclusive pricing, no round-off, no split payment, no drafts. | Missing features. |
| B11 | Loyalty columns exist on invoices but checkout never earns/redeems points. | Loyalty disconnected from billing. |

### 2.4 Invoices
List with search + status filter + pagination, view invoice (modal), cancel (restores stock, reverses
customer balance). Status ⚠️: cancel has no reason/audit entry and does not reverse the payment record;
no receive-payment-later, no edit-draft, no duplicate, no PDF download (only browser print), no share,
no date filter in UI (API supports it). `InvoiceModal` falls back to a **hard-coded demo business**
("Apna Supermart") if business data is missing.

### 2.5 Products & categories
Create/edit/soft-delete products (name, SKU, barcode, unit, HSN, purchase/sale/MRP, GST %, stock,
low-stock threshold, vertical extra attributes), categories create/list, random barcode generator.
Status ⚠️: editing `stock_quantity` directly bypasses the stock-movement ledger; categories cannot be
edited/deleted; SKU uniqueness checked on create only; no export.

### 2.6 Inventory
Low-stock list, manual stock adjustment (writes movement ledger), movement history (last 50). ✅
Missing: inventory valuation, stock report export.

### 2.7 Customers
List/search, create (name, phone, email, GSTIN, address, credit limit), view last 20 invoices.
Status ❌ for: edit, delete, separate billing/shipping address, state (for IGST), payment receipt,
ledger, export. Credit limit is stored but never enforced.

### 2.8 Purchases & suppliers
Create supplier (with opening balance), list suppliers, record purchase bill (items → stock increase →
movement ledger → supplier payable), list purchases. Status ⚠️: no supplier edit/delete, no supplier
payments, purchase date always "today", no purchase detail view, purchase orders (pre-receipt) absent.

### 2.9 Expenses
Create + list with category/date filters + total. Status ⚠️: no edit/delete, no monthly analytics.

### 2.10 Reports
P&L (revenue, COGS, gross profit, expenses by category, net profit) and GST summary (CGST/SGST/IGST,
HSN-wise) with date range. Status ⚠️: COGS uses **current** purchase price instead of cost at time of
sale; P&L ignores credit notes (returns); no daily/weekly/monthly/yearly sales report, purchase,
inventory, outstanding, payment or cash-flow reports; the "Download" icon is imported but unused —
**no export of any kind**.

### 2.11 Quotations
Create quotation (number from timestamp — not guaranteed unique), list, convert to invoice.
Status ⚠️: conversion creates an invoice marked PAID/CASH with no stock deduction and no customer link.

### 2.12 Returns (credit notes / debit notes)
Sales return by invoice lookup with already-returned-quantity tracking, stock restored, store-credit
adjusts customer balance; purchase return reduces stock and supplier payable. ✅ (numbering via
`COUNT(*)+1` can collide after deletes — low risk.)

### 2.13 Backup & restore
"Snapshot" stores **only business, products, invoices, customers** as JSON inside the same DB;
"Export" downloads JSON of ~16 tables; "Restore" **only upserts customers** — every other table is
ignored while the UI reports success. Status ❌ — not a real backup (a corrupted DB file loses the backups too).

### 2.14 Staff
Add staff record, activate/deactivate. Status ⚠️: staff cannot log in; roles not enforced.

### 2.15 Settings
Business profile (name, GSTIN, address, city, state, pincode, phone, email, invoice prefix). ✅
Missing: invoice preferences (tax-inclusive default, round-off, negative stock), backup schedule, license, version.

### 2.16 Audit logs
Tenant audit log page lists last 100 entries. ⚠️ Only backup actions write audit entries; invoice
cancel, product delete, price changes, etc. are not logged.

### 2.17 Vertical modules (shown by business category)
| Module | What it does | Status |
|---|---|---|
| Restaurant tables & KOT | Tables CRUD-lite, status change, KOT create/status. | ✅ (KOT not linked to billing) |
| Pharmacy batches & expiry | Reads `batch_no`/`expiry_date` from product extra attributes, lists expiry buckets. | ✅ read-only |
| Clothing size/colour matrix | Variant matrix creation, variant stock, garment exchanges. | ✅ (variants separate from POS products) |
| Manufacturing / BOM | BOM recipes, production orders, execution consumes raw materials and produces finished goods with costing. | ✅ |
| School fees | Students, fee structures, receipts, outstanding fees. | ✅ |
| Wholesale | Bulk price slabs, routes, party ledger, credit settings. | ✅ (slabs not applied at POS) |
| Service business | Appointments, job cards, recurring invoice definitions, hardware/SMS settings. | ⚠️ recurring invoices never generate; SMS/hardware settings stored only |
| Loyalty | Earn/redeem rules, manual adjustments, ledger. | ⚠️ not wired into checkout |
| Branches & stock transfers | Branch CRUD, transfer challans dispatch/receive/cancel. | ✅ (stock is not per-branch) |
| Online storefront | Public store page + order intake + convert-to-invoice. | ⚠️ needs a publicly reachable server — not usable from a desktop install |
| Barcode generator | Prints barcode labels for products. | ✅ |
| Support desk | Tickets + FAQs stored locally. | ⚠️ tickets never reach the vendor |
| Notifications | Low-stock notifications list / mark read. | ✅ |
| Platform admin | Lists businesses/plans in the local DB, suspend business, edit plan. | ⚠️ SaaS-only concept — replaced by the central Admin Panel |

### 2.18 UI checks
All 28 pages call real API endpoints (no mock arrays in production paths). Every button has a handler
(2 apparent exceptions are nested inside clickable parents). `localStorage` holds only the JWT, theme and language.

---

## 3. Implementation plan (summary)

1. **Local backend foundation** — per-OS data directory (`%APPDATA%/ApnaBilling/data`), generated per-install
   JWT secret, bind to `127.0.0.1`, versioned migrations with pre-migration backup, demo seed only in demo mode,
   app factory for tests/Electron.
2. **Billing correctness** — pure, tested invoice calculator (fractional qty, pro-rata bill discount before GST,
   tax-inclusive, CGST/SGST/IGST, round-off), validation, idempotency keys, unique invoice numbers, stock
   checks, split/partial/credit payments, drafts, receive-payment, cancel with reason + audit, persisted held bills.
3. **Missing CRUD** — customer edit/delete/ledger/payments, supplier edit/payments, expense edit/delete,
   category edit/delete, product stock edits through the ledger.
4. **Reports & exports** — sales by period, payments, outstanding, inventory valuation, cash flow; CSV + XLSX.
5. **Real backups** — SQLite online backup API to files, integrity verification, history, schedule, restore
   with safety backup, retention that never deletes the last good backup.
6. **Central license server** (`license-server/`, PostgreSQL) — Ed25519-signed entitlements, trials, plans,
   device limits, layered feature overrides, remote actions, notices, usage ingestion, audit log, rate limiting.
7. **Admin Panel** (`admin-panel/`) — separate React app for the owner.
8. **Desktop licensing client** — signature verification with an embedded public key, offline grace,
   clock-rollback detection, backend feature enforcement, read-only mode when expired, usage counters.
9. **Electron shell + NSIS installer** (`desktop/`).
10. **Tests** for each of the above.

Progress is tracked in `IMPLEMENTATION_PROGRESS.md`.
