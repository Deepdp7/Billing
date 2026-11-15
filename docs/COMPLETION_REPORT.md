# Apna Billing — Completion Report

Date: 2026-11-02 · Desktop app 1.1.0 · Local schema v2 · License server schema 001

Companion documents: `docs/FEATURE_AUDIT.md` (what existed and what each feature did before this work),
`docs/DEPLOYMENT.md` (how to deploy, build, back up), `IMPLEMENTATION_PROGRESS.md` (resume notes).

Status legend: ✅ implemented and tested · 🟡 implemented, partly tested or API-only (no UI yet) · ❌ not done.

---

## 1. Original architecture discovered
React 19 + Vite + Tailwind single-page app; Express 4 + TypeScript API; SQLite (better-sqlite3, WAL, money in
paise) designed as a **multi-tenant cloud SaaS**. No desktop shell, installer, licensing, migrations or tests.
Database and demo passwords committed to git; hard-coded JWT secret; API listening on all interfaces with
`CORS *`; demo data seeded on every start. Full detail: `docs/FEATURE_AUDIT.md`.

## 2. Existing features audited
All 28 pages and ~140 endpoints. Every button has a handler; no page uses mock arrays. Defects found are listed
in the audit (B1–B11 in billing, plus backups, reports, customers, etc.).

## 3. Existing features repaired
| Defect | Fix | Status |
|---|---|---|
| POS always sent “paid in full” → credit/partial sales impossible | POS sends real payment lines; paid-now, change, split payment, balance-on-credit; server requires a customer for credit | ✅ |
| Quantity forced to ≥ 1 (loose items impossible; −5 saved as 1) | Fractional quantities (3 dp) in API and POS; invalid quantities rejected | ✅ |
| Bill discount applied after GST | Pure calculator distributes bill discount pro-rata *before* GST (exact to the paisa) | ✅ |
| IGST unreachable | Inter-state detected from GSTIN state codes / state; per-line CGST/SGST/IGST | ✅ |
| Stock could go negative silently | Blocked by default (setting to allow); services/fees not stock-tracked | ✅ |
| Double-click created duplicate invoices; no unique invoice numbers | Idempotency key per checkout; unique index; numbering skips used numbers | ✅ |
| Held bills lost on refresh | Stored in SQLite | ✅ |
| Cancel had no reason/audit and kept payments | Reason required, refund (or customer credit) recorded, loyalty reversed, audit entry | ✅ |
| “Backup” stored 4 tables inside the same DB; “restore” only restored customers | Real file backups (SQLite online backup), integrity + checksum verification, atomic full restore with safety backup | ✅ |
| JSON export button always returned 401 | Authenticated download; exports every business table | ✅ |
| P&L used *current* purchase price; ignored returns | Cost captured per line at sale; returns netted | ✅ |
| Quotation conversion skipped stock and GST logic | Converts through the invoice service | ✅ |
| Stock edits on the product form bypassed the movement ledger | Recorded as adjustments | ✅ |
| Invoice modal fell back to a hard-coded demo business; printed a fake UPI QR | Uses the installation's own profile; fake QR removed; IGST/round-off/balance/terms shown | ✅ |
| Registration hard-coded state = Maharashtra (wrong GST elsewhere); failed on fresh DB (plan FK) | State required (auto from GSTIN); plan rows created by migration | ✅ |
| Login/registration errors vanished (form unmounted during request) | Initial-session loader separated from request loading | ✅ |
| Dates used UTC (invoices 00:00–05:30 IST dated the previous day) | Local dates | ✅ |
| Sidebar showed “Inventory” twice | Label key fixed | ✅ |
| Reports page had no date range; one failing report broke the page | Date range; reports load independently | ✅ |
| Demo quick-login with known passwords shipped to everyone | Only in demo mode (never in the packaged app) | ✅ |

## 4. New features implemented
| Area | Feature | Status |
|---|---|---|
| Billing | Tax-inclusive pricing, round-off, split/partial/credit payments, due dates, credit-limit enforcement | ✅ |
| Billing | Receive later payments against an invoice (UI on Invoices page) | ✅ |
| Billing | Drafts: create, edit, issue, delete, duplicate-as-draft | 🟡 API tested; UI can duplicate/issue/delete drafts but has no draft *editor* (POS has no “save draft” button) |
| Billing | Loyalty earn/redeem on checkout | 🟡 API tested; POS has no redeem control |
| Customers | Edit, safe delete / deactivate, billing + shipping address, state, ledger with running balance, on-account payments (FIFO), export | ✅ |
| Products | Export, inventory valuation, category edit/delete | 🟡 export ✅ UI; valuation via report ✅; category edit/delete API only |
| Purchases | Supplier edit/deactivate, supplier payments, supplier ledger, purchase detail, duplicate-bill guard, purchase orders → receive | 🟡 API tested; Purchases page has no new buttons yet |
| Expenses | Edit, delete, categories, monthly analytics, export | 🟡 delete in UI; edit/analytics API only |
| Reports | 12 reports (sales daily/weekly/monthly/yearly, invoice register, P&L, GST-HSN, payments, cash flow, customer ageing, supplier outstanding, product profit, inventory, purchases, expenses) with CSV, real XLSX and PDF/print | ✅ |
| Dashboard | Purchases, expenses, gross/net profit, payables, 30-day sales trend, payment-mode summary | ✅ |
| Settings | Billing preferences (round-off, tax-inclusive, negative stock, credit limit, credit days, terms, footer) | ✅ |
| Backup | Scheduled automatic backups, retention, configurable folder, verify, delete, restore from file, pre-migration and pre-upgrade backups | ✅ |
| Audit | Invoice create/cancel, payments, price changes, deletions, settings, backups, logins | ✅ |
| Cash register | Table created | ❌ no API/UI |
| Staff login with roles | — | ❌ staff remain records only; one owner login per install |

## 5. SQLite database architecture
- Location: `%APPDATA%\ApnaBilling\data\apna_billing.db` (never the install folder); WAL, foreign keys ON,
  `busy_timeout`, per-install random JWT secret in the same folder.
- Versioned migrations in `server/src/db/migrations.ts` with a `schema_migrations` table; a consistent copy
  (`VACUUM INTO`) is written to `backups/` before any migration runs on existing data.
- All money in integer paise; every multi-row write (invoice, payment, cancel, purchase, restore) is one
  transaction. Verified: a process killed mid-transaction leaves no partial invoice and passes `integrity_check`.

## 6. Database schema (changes in migration v2)
Columns: invoice GST split/round-off/place of supply/tax-inclusive/due date/addresses/cancellation audit/
idempotency key/draft payload; invoice-item taxable/CGST/SGST/IGST/cost/MRP/unit; payment direction/date/status/
supplier/purchase; customer billing+shipping address/city/state/pincode/active; product `track_stock`;
quotation product links. New tables: `system_settings`, `app_settings`, `held_bills`, `expense_categories`,
`purchase_orders`, `purchase_order_items`, `cash_register_sessions`, `backup_history`, `license_state`,
`feature_usage`. New unique indexes: invoice number, idempotency key, active SKU. Units and payment methods
remain text enums (no separate tables).

## 7. Backend API architecture
Controllers → services (`invoiceService`, `invoiceCalculator`, `backupService`, `exportService`,
`settingsService`, `auditService`) → SQLite. Zod validation with field-level 400s, typed `HttpError`s, central
error handler (no stack traces in production). App factory (`createApp`) used by the CLI, tests and Electron.
New endpoints are listed in `IMPLEMENTATION_PROGRESS.md`.

## 8. Central licensing architecture
`license-server/`: Express + Knex. PostgreSQL in production (tests also pass on SQLite and PostgreSQL 17).
Tables: admin users/sessions, customers, plans, licenses, installations, features, feature overrides,
license events, daily usage, notices, settings, audit logs.
Client API: `trial`, `activate`, `heartbeat`, `usage`, `deactivate`. Installation credentials are random
secrets stored only as SHA-256 hashes, rotatable from the Admin Panel.

## 9. Admin Panel functionality
All 15 requested sections: Overview, Customers, Installations/Devices, Trial Licenses, Paid Licenses,
Subscription Plans, Feature Permissions, Feature Usage, Activation History, Suspended, Expired, Notifications,
Audit Logs, System Settings, Admin Users — plus My Security (password, TOTP 2FA). Customer, license and
installation detail pages with all remote actions. Roles: OWNER / ADMIN / SUPPORT / VIEWER.

## 10. Feature permission architecture
28 feature keys. Effective value = plan → GLOBAL override → CUSTOMER → LICENSE → INSTALLATION (most specific
wins); overrides can expire (temporary access) and removing one restores inheritance. The result is signed into
the token. **Enforced by the desktop backend** (`licenseGuard` maps every `/app/*` route to features; disabled
features get 403 on reads and writes); the UI mirrors it with lock icons and a “not included” page.
Backups and data export are never gated.

## 11. Trial and paid workflows
Trial: desktop → `POST /trial` (name, business, email, device info) → customer + 7-day trial license +
installation → signed token. One trial per email and per device fingerprint (configurable; fingerprint is a
soft signal). Admin can extend, cancel, or convert to paid. Paid: admin issues key (1/3/6 months, 1/2 years,
lifetime, or custom days) with device limit and optional activation limit → customer enters key → device
registered. Renew adds the plan term to the current expiry. Suspend/reactivate/revoke, change plan, edit
limits. Every action is recorded in license events and the audit log and applies at the next sync.

## 12. Security implementation
- Ed25519 signatures (fixed algorithm, no JWT `alg` confusion); private key only on the server; public key
  embedded in the app. Editing the token in SQLite → `INVALID` (tested).
- Offline grace (default 7 days, per-installation “force revalidation” shortens it to 1 day); clock rollback
  detection; expired/suspended/revoked/offline-too-long → read-only, data still viewable/exportable.
- Packaged app ignores `.env` files and licensing env overrides (tested); Electron fuses: no run-as-node
  (tested), no inspector, asar integrity, load only from asar; renderer sandboxed with context isolation and no
  Node access (tested); navigation locked to the local origin.
- Local API binds to 127.0.0.1 only; CORS only in development; login throttling (10 failures / 15 min).
- License server: hashed admin sessions with expiry and logout revocation, bcrypt (cost 12), optional TOTP,
  role checks on every mutation, rate limits (login, activation, client API), HSTS, audit log with IP.
- Usage data: feature key + date + count only.

## 13. Test results (all run on 2026-11-02)
| Suite | Result |
|---|---|
| `server` — calculator (12, incl. 2,000 random invoices), billing flows (26), database/migration/backup/restore/restart/crash (9), license enforcement (15) | **62/62 pass** |
| `license-server` on SQLite | **20/20 pass** |
| `license-server` on PostgreSQL 17 | **20/20 pass** |
| `e2e/licensing-e2e.mjs` — production desktop server ↔ license server | **10/10 pass** |
| UI smoke in Microsoft Edge (desktop app + Admin Panel) | **17/17 steps pass** |
| Packaged `Apna Billing.exe` checks | **7/7 pass** |

Bugs found *by* these tests and fixed: fresh-install registration FK failure; backup export blocked by the
`data_export` feature; login/registration errors vanishing; Electron run-as-node exposure.

Not covered by automated tests: the PDF “Save” dialog path (bridge verified, file write not automated); the
NSIS installer's install/uninstall wizard itself (the unpacked app it contains was tested); printing to
physical thermal printers.

## 14. Remaining limitations
1. **Client-side licensing can be defeated by a determined attacker** who modifies the app's JavaScript.
   Signatures, fuses and asar integrity raise the bar; **code-sign the installer** to make integrity
   validation meaningful.
2. No auto-installer for updates — the app shows an update notice with your download link.
3. UI not yet wired for: draft editor, loyalty redemption at POS, supplier payments, purchase orders, expense
   edit, category edit/delete (all available and tested in the API).
4. Staff cannot log in (owner only); cash-register sessions not implemented.
5. Pre-existing verticals unchanged: recurring invoices never auto-generate; online storefront needs a
   public server; SMS/printer settings are stored only; wholesale slab prices not applied at POS.
6. Two legacy demo-seed invoices (ASM-1001/1002) have header tax ≠ line tax; preserved as-is.
7. Rate limiting is per license-server process.
8. Repository hygiene (not changed by me): `node_modules/`, `server/dist/`, `server/data/*.db` and
   `credentials.txt` files are tracked in git. A new `.gitignore` covers them; to stop tracking run
   `git rm -r --cached node_modules server/dist server/data credentials.txt Phased/credentials.txt`.
9. The bundled signing keypair is a development key — regenerate before release (DEPLOYMENT.md §1).

## 15–19. Deployment, EXE build, Admin Panel, central backend, backup/restore
See `docs/DEPLOYMENT.md`: §2 license server + Admin Panel, §3 Windows installer, §4 customer first run,
§5 backup & restore, §1 signing keys.
