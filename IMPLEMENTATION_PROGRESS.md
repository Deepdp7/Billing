# Implementation Progress

Last updated: 2026-11-02. Read with `docs/FEATURE_AUDIT.md`, `docs/DEPLOYMENT.md`, `docs/COMPLETION_REPORT.md`.

## Stage status
| Stage | Status |
|---|---|
| 1–2 Audit & plan | ✅ `docs/FEATURE_AUDIT.md` |
| 3 SQLite + local backend foundation | ✅ |
| 4–5 Billing repairs & new features | ✅ backend · 🟡 some UI gaps (see below) |
| 6 Central license server | ✅ `license-server/` |
| 7 Admin Panel | ✅ `admin-panel/` |
| 8–10 Trials/subscriptions/devices/features, usage sync, offline licensing | ✅ |
| 11 Windows installer | ✅ `desktop/` → `desktop/release/ApnaBilling-Setup-1.1.0.exe` (built against a localhost license URL for testing) |
| 12 Tests | ✅ 62 + 20 (+20 on PostgreSQL) + E2E 10 + UI 17 + EXE 7 |
| 13 Final report | ✅ `docs/COMPLETION_REPORT.md` |

## Packages
- `server/` — local API (Express + SQLite). `npm test`.
- `client/` — desktop UI (React). Mirrors the invoice calculator in `src/lib/invoiceCalc.ts` (keep in sync with `server/src/services/invoiceCalculator.ts`).
- `license-server/` — central API (Express + Knex; PostgreSQL/SQLite). `npm test`; `npm run keys:generate`, `migrate`, `admin:create`.
- `admin-panel/` — owner console (React), served by the license server.
- `desktop/` — Electron shell + electron-builder NSIS. `npm run dist` with `LICENSE_SERVER_URL` set.
- `e2e/licensing-e2e.mjs` — desktop ↔ license server end-to-end.

## Migrations
Local: v1 `baseline_schema`, v2 `billing_integrity_and_desktop` (`server/src/db/migrations.ts`).
License server: `001_initial` (`license-server/src/migrations.ts`).

## APIs added (local, under /api/v1)
`GET /system/info`; `/license/{status,trial,activate,deactivate,sync,usage}`;
billing `invoices/:id/{payments,duplicate,issue,cancel}`, `invoices/:id/draft` (PUT/DELETE), `payments`, `held`;
customers `:id` (PUT/DELETE), `:id/ledger`, `:id/payments`, `export`; products `export`; categories `:id` (PUT/DELETE);
`inventory/valuation`; suppliers `:id` (PUT/DELETE), `:id/payments`, `:id/ledger`; `purchases/:id`; `purchase-orders` (+ `receive`, `cancel`);
expenses `:id` (PUT/DELETE), `categories`, `analytics`, `export`; `reports`, `reports/:type`, `reports/:type/export`;
`business/settings`; backups `settings`, `:id/verify`, `:id` (DELETE), `restore-upload`.

## Known issues / next steps (priority order)
1. Regenerate production signing keys; deploy license server with PostgreSQL + HTTPS; rebuild installer with the real `LICENSE_SERVER_URL`; code-sign it.
2. UI for: draft editor + “save draft” in POS, loyalty redeem at POS, supplier payments & purchase orders on Purchases page, expense edit, category edit/delete.
3. Staff logins with role-based permissions; cash-register open/close.
4. Auto-update (electron-updater) instead of notice + download link.
5. Untrack `node_modules/`, `server/dist/`, `server/data/`, credentials files from git (see report §14.8).
6. A test run left an empty, unactivated `%APPDATA%\ApnaBilling\data` folder on the dev PC (safe to delete).

## 2026-11-02 — VPS, live updates, internet lock, auto-update
- License server + Admin Panel deployed to the VPS, isolated in `/home/apna-billing` (own user, systemd service
  `apna-license`, own SQLite DB, HTTPS on port 7443 with a private certificate pinned in the app). See `docs/HOW_TO_RUN.md`.
- `deploy/apna_vps.py` (npm: `build`, `release`, `deploy:server`, `vps:setup`, `vps:admin`).
- Signed auto-update (Tauri updater): popup "Install now / Later", required updates without "Later"; pushed instantly.
- Internet required: full-screen lock while offline (`client/src/components/system/AppGuards.tsx`,
  `server/src/licensing/connectivity.ts`); a VPS outage alone does not lock shops.
- Production license-signing key generated (old dev keys in `license-server/keys/old-dev-keys`).
- Current client version: 1.1.3 (`releases/`). 1.1.0/1.1.1 were withdrawn (their Install-now button lacked permission).

## 2026-11-02 — 1.2.0: sealed engine, encrypted storage, native licensing core
See `docs/DESKTOP_ARCHITECTURE.md`.
- Install folder no longer contains Node.js, JavaScript or `node_modules`: `engine/apna-billing-engine.exe` is a Node
  single-executable app with the bundled server and embedded UI (`tauri/scripts/prepare.cjs`, entry `tauri/sidecar/run-server.cjs`).
- Shell checks SHA-256 of every engine file before start, clears the engine's environment, hands the DB key over stdin.
- SQLite → `better-sqlite3-multiple-ciphers` (ChaCha20-Poly1305). Live DB, migration copies and backups encrypted;
  1.1.x databases/backups encrypted on first start; plain backups still restorable (`server/src/db/sqlite.ts`).
- Licensing core in Rust (`native/apna-core`): token verification + license evaluation; TS mirror kept for dev/tests.
- NSIS hooks (`tauri/src-tauri/installer-hooks.nsh`) stop the engine and remove the 1.1.x `app/` folder.
- New key to back up: `%USERPROFILE%\.apna-billing\data.key` (fingerprint in `deploy/data-key.fingerprint`).
- Tests: server 71 (incl. `encryption.test.ts`), `npm run test:native` (Rust) 6.
