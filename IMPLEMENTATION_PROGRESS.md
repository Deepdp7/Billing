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

## 2026-11-03 — Branding, admin app on the VPS, Installer Studio installers
- `branding/` + `scripts/build-branding.py`: icons, installer sidebar/header, logos for client (emerald) and admin (indigo).
- Admin desktop app built with the VPS URL opens the real Admin Panel through a local relay that trusts only the
  server certificate (`admin-tauri/src-tauri/src/lib.rs`); `npm run build:admin-app`.
- Both setups are made by Installer Studio from `deploy/installer-studio/*.isproj` (never change their appId).
  Installer Studio gained `/P` (passive), `/R` (restart) and "Replaces an installation made by another installer",
  used to take over 1.1.x/1.2.0 Tauri installs. Tested on this PC: 1.1.4 → 1.2.0 via `/P /UPDATE /R`.

## 2026-11-03 (2) — real branding art, sharper installer, native modules as .dll
- Branding regenerated from the photos in `branding/source/` (app/admin icons + installer sidebar art).
- Installer pictures made sharp: Installer Studio now renders the welcome sidebar at the native 164×314 and the
  header at 150×57 (NSIS was downscaling the old 2× bitmaps with a poor filter → blur at 100% DPI). deploy +
  `.isproj` point at the 164×314 / 150×57 BMPs.
- The two compiled modules ship as `apna-core.dll` and `apna-storage.dll` (were `apna_core.node` /
  `better_sqlite3.node`); the engine loads them by path with `process.dlopen` (`server/src/lib/native.ts`). No
  `.node` files or node_modules are installed. Verified end-to-end on this PC (install → run → uninstall).

## 2026-11-03 (3) — installed files protected from deletion (client)
- New Installer Studio option "Protect installed files" (`protect_files` in the project, toggle in the window):
  the installer denies the Windows Users group Delete/Delete-child over the install folder with icacls, so the
  program cannot be deleted from Explorer/Recycle Bin/`del`. The uninstaller lifts the lock first (un.onInit), so
  proper removal still works; re-applied across updates; Administrators/SYSTEM keep full control
  (recovery: `icacls "<folder>" /reset /T /C`). Enabled for the client (`Apna Billing.isproj`), off for the admin app.
- Verified on this PC: delete of exe/dll/engine/whole-folder all blocked; app runs; in-app update (/P /UPDATE /R)
  replaces files and re-locks; uninstall removes everything. Installer Studio tests + ignored `protects_installed_files`.

## 2026-11-03 (4) — installer pictures sharp at every display scaling
- The 1× pictures were stretched blockily by Windows on PCs at 125 %/150 %/… scaling (the setup is DPI-aware, so
  its picture controls grow). Installer Studio now embeds the sidebar and header at 100–300 % and, on the welcome /
  finish pages and the header (installer and uninstaller), draws the size that fits the control with halftone
  scaling (exact copy when the size matches).
- `build-branding.py` makes 3× masters (`sidebar-492x942.bmp`, `header-450x171.bmp`) that the deploy script and both
  `.isproj` use; `installer-icon.ico` gained 20 / 40 / 96 px.
- `python deploy/apna_vps.py reset-updates`: shows the update state on the VPS, then (after typing RESET) backs up
  the database and forgets every release, so the client numbering can restart lower (e.g. 1.0.0). Licences untouched.

## 2026-11-03 (5) — instant start, no white flash; Control Panel
- Both desktop apps open their window at once on a built-in start screen (`tauri/ui`, `admin-tauri/ui`) painted in the
  app's background colour (WebView background set too), start the engine / relay meanwhile and then navigate to it.
  Measured on this PC (150%, warm): window 0.3 s, app 0.95 s, no white frame (was: nothing for 0.6 s, then white).
- Same start screen in `client/index.html`, `admin-panel/index.html` and the apps' first loaders, so start-up looks
  like one screen. Fonts are bundled (@fontsource) instead of render-blocking Google Fonts.
- Admin app relay prefers port 47831 so the panel's files stay in the window's cache between runs; the license server
  serves `/assets` as immutable (needs `npm run deploy:server`).
- `apna_vps.py` gained `build --files-only`, `sign`, `admin-app [version] [--files-only]` and `APNA_ADMIN_TOKEN`;
  pictures chosen in Installer Studio are kept. Installer Studio opens a project given on its command line.

## 2026-11-03 (6) — Build & Release inside the Admin app
- Admin Panel → **Build & Release** (OWNER, Admin app only): build the client / Admin app installers (directly or via
  Installer Studio's window), sign, publish an update, upload the server, reset update history; live output on the
  page. Runs fixed actions of `deploy/apna_vps.py` through `admin-tauri/src-tauri/src/release.rs` (commands
  `release_*`, permissions in capabilities/default.json); publishing reuses the panel sign-in. Replaces the separate
  Python Control Panel (removed).

## 2026-11-03 (7) — one Updates & Releases page, faster start, motion
- Admin Panel: App Updates and Build & Release are one page, **Updates & Releases** (build → output → publish → clients /
  history; Admin app and server below; building only in the Admin app). The Admin app hands the built installer to the
  page (`release_file`), which publishes it through the normal upload (history, signature check, password).
- Admin Panel menu: a licence/customer/installation opened from a list keeps that list lit (was: always Paid Licenses).
- Client start (warm, this PC): app on screen 0.95 s → 0.72 s. The engine starts before the window is created; exceljs
  loads on the first Excel export (server start-up 350–500 ms → ~185 ms); 29 screens load on demand and are preloaded
  right after start (start-up JS 950 KB → 346 KB).
- Licence server: SQLite `synchronous=NORMAL` + `busy_timeout`, gzip responses (not event streams or installers).
- Both apps: shared motion (screens settle in, pop-ups rise, buttons press, keyboard focus ring), off with Windows'
  reduce-animations setting.


## 2026-11-04 — update numbers (same version, new update)
- `1.0.1+N` builds: clients get them as updates but still see 1.0.1 (app, sidebar, installer, Windows' installed-apps
  list); only the update pop-up / licence page say "1.0.1 (update N)". Order 1.0.1 < 1.0.1+1 < 1.0.1+2 < 1.0.2.
- Client shell: `APNA_BUILD` (from `tauri/update-number.txt`, written by `apna_vps.py`) is appended to the version the
  updater and engine report. Licence server compares the update number (`versionLt`) and accepts it everywhere.
- Admin app → Updates & Releases: **Update 1.0.1 again (1.0.1+N)** button; installer file names with `+N` are found,
  uploaded and published. Admin app must be rebuilt (Rust changed); apps built before this need one normal update first.

## 2026-11-04 (2) — A4 bill redesign, sticker labels
- A4 bill (`client/src/components/billing/A4Invoice.tsx`): seller block with logo/initials, invoice facts strip, Bill To /
  Payment cards with status pill, item table with unit, discount (when any), taxable value and GST per line, amount in
  words (Indian lakh/crore), GST summary per rate, totals with a highlighted Total and Balance due, CANCELLED watermark.
  "Tax Invoice" only when the shop has a GSTIN, otherwise "Invoice". Prints on A4.
- Printing goes through `PrintPortal` (a copy under `<body>`), so prints are never clipped to the window and run over
  as many pages as needed; colours are kept on paper and in PDFs.
- Barcode & Sticker Labels: dark theme; real Code 128 barcodes (`lib/code128.ts`, checked with a scanner library) instead
  of decorative bars; sheets sized in mm for 24/40-up A4 sticker paper and 50 × 25 mm thermal rolls (Print used to
  print a blank page).

## 2026-11-04 (3) — Products lists window, no hover tooltips
- "Manage lists" is now **Categories & Units** (window: "Categories, Units & GST Rates"); it closes only with ✕, and the
  "⚙ Edit or delete…" entries are gone from the form's dropdowns. Confirm/prompt pop-ups sit above every window.
- Both apps: browser hover tooltips are switched off (`lib/noTooltips.ts`); icon buttons keep the hint as their
  accessible name.

## 2026-11-04 (4) — optional delete reason, credit bills for new customers
- Deleting (cancelling) a bill: the reason is optional (engine and app).
- POS: a credit / part-paid bill for someone typed in by hand no longer errors. The cashier is asked (Yes/No): an
  existing customer with the same phone is reused, otherwise the person is added to Customers and the bill saved on
  their account. With no name typed (Walk-in), the name is asked first.

## 2026-11-04 (5) — customer advances
- A negative customer balance is an advance (customer's money the shop holds). Shown as "₹X advance" / "₹X due"
  instead of "₹-X". New **Return advance** (₹ button when there is an advance → `POST /customers/:id/refund`): a
  refund paid out, shown in the statement, balance back to 0. Delete-customer message says who owes whom.
- POS, paid bills (Cash/UPI/Card): when a name was typed instead of picking a customer, the cashier is asked
  "Save this customer?" (Yes → added to Customers and the bill linked; No → bill keeps the typed name only). A phone
  that matches an existing customer offers to add the bill to their account.

## 2026-11-04 (6) — audit: money, stock, security, speed
Fixed
- Delete bill erased its payment rows (cascade): a payment kept as the customer's advance vanished from the cash book
  while the advance stayed (the −₹142 case). Payments are now kept, only unlinked from the deleted bill.
- Customer advances settle open bills (`applyCustomerAdvance`): after a new credit bill, a bill cancelled without
  refund, store-credit returns and ledger credits. Balance, open bills and statement always agree (tested invariant).
- Sales / purchase returns rewritten: validated input, quantity capped at what is left to return, valued at what the
  bill actually charged (discounts, tax-inclusive), untracked products not restocked, store credit needs a customer,
  the bill's unpaid part is settled first, cash refunds recorded in the cash book (migration v3 backfills old ones),
  statements show every credit/debit note, numbers never repeat, local (IST) dates.
- Online order → bill and production runs always failed (SQL used columns that do not exist). Online orders now go
  through the normal billing engine (GST, delivery line, payment, no double bill).
- Admin two-step login could be switched off from a stolen session (setup reset it); login timing no longer reveals
  which emails exist.
- UTC dates (day off before 05:30 IST) in returns, transfers, production, fee receipts, online orders, service summary.
- BOM codes / transfer numbers no longer repeat after deletions.
- App shows the real error text for older screens (`error` field).
Speed
- Indexes for the duplicate-sale check (every POS sale) and bill lines (every bill opened); both were full scans.
Checks
- `npm run check:sql` compiles all 544 static SQL statements against a fresh database (0 failures).
- New `test/money.test.ts` (10 tests). Engine 85/85, licence server 30/30 (+1 skipped).

## 2026-11-04 (7) — barcode scanners everywhere
- `lib/scanner.ts`: any USB/Bluetooth keyboard scanner works on every screen without clicking into a box. A scan is
  told apart from typing by speed; scanned into an ordinary field (e.g. customer name) the characters are taken back
  out. Fields marked `data-scan-input` keep scans as text. Scanners without an Enter suffix work too. Counter beep.
- POS: scan anywhere adds to the bill (products beyond the loaded list looked up; unknown code → add as product).
  Products: scan opens the product, or a new one with the barcode filled in. Invoices: scanned bill number opens it.
  Returns: scan the bill, then scan each item coming back. Purchases: scan adds the item. Inventory: finds it.
  Barcode labels: picks the product. Any other screen: pop-up with price / MRP / stock → Sell / Stickers / Edit.
- Every bill (A4 and thermal) prints its bill number as a Code 128 barcode.
- Engine: `GET /products?code=` matches barcode or SKU exactly.

## 2026-11-04 (8) — leftover ₹142 cash, loyalty screen
- Customers who owe money or hold an advance always show in Customers, even when made inactive (one was hidden with
  a ₹142 advance, so nothing could clear it). New **Undo** on payment rows of a customer's statement
  (`POST /customers/:id/payments/:paymentId/void`): the payment is marked VOID, balance and bill restored.
- Dashboard payment summary leaves out modes that net to ₹0.
- Loyalty screen: engine/screen field names did not match (every row "Customer", reversals shown as +, empty
  balance, rule changes not saved, "Redeemed" adjustments added points). Translated in `api.ts`; removed customers'
  history hidden; deleting a cancelled bill removes its earned + reversed points rows.

## 2026-11-05 — dark theme: Backup, Audit Logs, Help & Support
- These three pages were light-only (white cards, dark headings, white inputs). Now the same slate/emerald dark
  styling as the rest of the app: cards, tables, inputs, file picker, badges, notices and pop-ups; page titles match
  the other screens. Light mode unchanged in look. No other page was missing dark classes.

## 2026-11-08 — launch speed and the taskbar icon (both apps)
- Taskbar: the native start screen was a "tool window", which Windows never shows in the taskbar; the app's own window
  (hidden until the first screen) was the only button. The start screen is now a normal taskbar window with the app's
  icons (verified: button with icon from ~30 ms).
- Client, first screen drawn (this PC, warm): ~720 ms → ~470 ms. Engine starts first thing (15 ms, not after 400 ms),
  its file check runs alongside it (the key is handed over only after every file matches), the window is made at once
  instead of waiting for it. First launch after install/update (new files scanned by Defender): ~1.5 s → ~1.0 s.
- Both apps: `core:default` (dozens of framework commands the pages never call) compiled to ~200 ms of URL rules at every
  start; capabilities now list only the commands the pages use (window controls, event listen/unlisten). Checked from
  inside the pages that each still works and that unlisted ones stay refused.
- Admin: relay starts first and the window opens straight on it; the panel's own files are kept in
  %LOCALAPPDATA%\in.apnabilling.admin\panel-cache (stale-while-revalidate): opens without waiting for the server
  (~0.4 s), refreshes in the background, and reloads into a newer panel if the server has one (checked).
- `APNA_TRACE=1` prints start-up timing marks (ms since the process was created). `splash::first_instance` replaces
  the window check as the "already running" test.

## 2026-11-10 — shop sign-in in the Admin Panel, forgot password, grey dark theme, F11 full screen

- **App sign-in (Admin Panel → Customers → a customer).** The billing app reports the owner's email and password with
  its licence check (at sign-up, sign-in and after a reset; `account_sync` table, engine migration v4). The server keeps
  the password encrypted (AES-256-GCM, key derived from the signing key; `license-server/src/accounts.ts`, migration
  `003_app_accounts`). Owners can show it (each look is audit-logged as `APP_PASSWORD_VIEWED`); admins can set a new
  email/password, which is pushed to the shop's computers and taken over at once when online (`app_account_rev` /
  `installations.account_rev`). Customer rows never carry the stored password to the panel.
- **Forgot password (billing app login).** A 6-digit code is emailed by the server (nodemailer; 10 minutes, 5 tries,
  one code at a time, rate-limited per IP and per email, same answer for unknown emails). The new password is set on
  the computer only after the server accepts the code, and every computer of the shop takes it over.
  Mail settings: Admin Panel → System Settings → "Email for password reset codes" (password kept encrypted, "Send test").
- **Admin dark theme is neutral grey** (the slate scale is CSS variables, swapped to charcoal greys in dark mode).
  The chosen theme is saved by the Admin app on disk (`%LOCALAPPDATA%\in.apnabilling.admin\theme`) and injected into
  the page, the start screen and the window background on the next launch.
- **F11 full screen in both apps.** Maximize in full screen goes to a maximized window; minimize/restore keeps full
  screen; the page settles in with a short zoom on each change (`lib/windowState.ts`, same file in both).
- Tests: `license-server/test/accounts.test.ts`; checked end to end with the engine against a local HTTPS server and a
  local mail sink, and in a side-by-side test build of the Admin app.

## 2026-11-13 — several businesses on one computer

- **One encrypted database file per business** (like company files in Tally): the first stays at
  `data/apna_billing.db` (+ `data/backups`), each added business gets `data/shops/<id>/apna_billing.db` (+ `backups`);
  `data/shops.json` lists them (names for the sign-in screen) and remembers the one in use. `server/src/db/shops.ts`.
- `db` (db/connection.ts) is now a proxy to the current business's database, chosen per request with
  AsyncLocalStorage: the signed-in token's `shopId` (missing in old tokens = "main"), else `?shop=`, else the business in
  use. Work that continues after an await stays on its business, so two businesses can be signed in at once and a
  switch never sends a write to the wrong file. Background jobs (licence sync, live link, scheduled backups) run for
  the business in use and move when another one signs in (`onActiveShopChanged`); the realtime loop has a generation
  number so a restarted link ends the old one. Licence events carry their business; the UI stream filters on it.
- **Licence per business** (decided 2026-11-13): each business is its own installation and its own customer in the
  Admin Panel. The first business keeps the computer's fingerprint (existing installs unchanged); others send
  sha256(machine|shopId) plus `machine`, stored as `installations.machine_hash` (license-server migration
  `004_machine`) so "one free trial per computer" still applies to the whole computer.
- Sign-up on a computer that already has a business adds a new business (an erased business's empty file is reused).
  Each business needs its own sign-in email (Gmail plus-addresses suggested). Sign-in finds the business by email; the
  same sign-in in two businesses asks which one (`CHOOSE_BUSINESS`). Forgot password works across businesses.
- App: user menu → Switch business (instant while that business is still signed in here; otherwise its sign-in) and
  Add a new business (with a way back). A paused/revoked business offers to open the others.
- Backups carry the business name in the file name; `account_sync` is never overwritten by a restore.
- Tests: `server/test/businesses.test.ts`, license-server `accounts.test.ts` (two businesses on one PC). Checked end to
  end with the engine + a local licence server, and the screens in headless Edge.

## 2026-11-15 — the same account on a second computer; the same layout on every screen

- **Sign-in on another computer** (licences with more than one device): a sign-in this computer does not know is
  checked by the licence server (`POST /api/client/v1/account/sign-in`, rate-limited per IP and per email) against the
  sign-in the shop's app keeps there (2026-11-10). If it matches and the licence has a free device, this computer is
  activated as one more device and the business and owner are set up locally (`openFromServer` in the engine's
  authController, `createBusinessWithOwner` shared with sign-up). Older accounts without saved details are asked for
  state and business type once (`ACCOUNT_DETAILS_NEEDED`). The server now keeps the business details for this
  (`customers.profile_json`, migration `005_customer_profile`; sent with registration and with sign-in reports).
  Accounts whose password has not reached the server yet get `NOT_ON_SERVER_YET` (sign in once on the first computer
  after updating). Bills and stock stay per computer; the app says so and points to backup/restore.
- **Same layout on every screen:** both apps zoom the whole page to fit the screen's work area the way the 2560×1600
  @150% design screen does (1707×1019 logical; 80%–135%), refit when moved to another monitor, and Ctrl + / − / 0
  adjust it (remembered). `lib/uiScale.ts` (same file in both); permission `core:webview:allow-set-webview-zoom`.
  Checked in a test build: zoom applies, the page's screen size is unaffected by zoom, the choice survives a restart.
- Test builds of the admin app (`APNA_TEST_IDENTIFIER`) keep their own WebView profile (they shared the installed
  app's before).

## 2026-11-15 (later) — second-computer sign-in bug; full device control; uninstall clean-up

- **"License server response failed signature verification" on a second PC** was not a signature problem: the compiled
  licensing core (`native/apna-core`, Rust) linked the Visual C++ runtime dynamically (VCRUNTIME140.dll), so it could
  not load on computers without the VC++ Redistributable, and `storeActivation` reported every failure as a bad
  signature. Now built with `+crt-static` (`native/apna-core/.cargo/config.toml`; checked: neither engine DLL imports
  the runtime), and the error says what really failed (`LICENSE_CORE_UNAVAILABLE` / the token error code).
- **Device control (Admin Panel):** delete icon on every device list (Installations, licence, customer) and "Delete
  device" on a device page (`DELETE /api/admin/v1/installations/:id`): a running computer is signed out (live push or
  next connection) and keeps its data — a tombstone (`removed_installations`, migration `006_device_removal`) makes the
  server answer `INSTALLATION_DELETED`, which the app treats as a sign-out (own reason, so the start-up check never
  erases it), not as a deleted customer. "UNINSTALLED" badge; warnings when active devices exceed the limit or all
  activations are used.
- **The shop's app:** License page → "Computers on this licence" lists every device; the owner can sign another one out
  (`GET /devices`, `POST /devices/:id/deactivate`, client API; engine `/license/devices`).
- **Uninstall:** the uninstaller runs `Apna Billing.exe --uninstall` (new Installer Studio option "When uninstalled,
  start the program with", `uninstallArgs`; never on an update: the installer now runs the old uninstaller with
  `/UPGRADE`, and a silent uninstall adds `--quiet`). The shell starts the engine in uninstall mode (handshake
  `"uninstall": true`): every business tells the server (`POST /uninstalled`: slot freed, `uninstalled_at`, admin
  notification `APP_UNINSTALLED`), then asks (default Yes; `--quiet` skips) and deletes %APPDATA%\ApnaBilling and the
  window storage. Tested: Installer Studio `uninstall_clean_up_not_on_upgrade` (upgrade does not run it, uninstall
  does) and `install_upgrade_uninstall`; the sealed engine reported two businesses; the shell deleted a test data folder.
  Installs get the new uninstaller with their next update (older uninstallers have no clean-up step).
- Licence page → Devices: "Installed and in use now: N · signed out · uninstalled", **Reset activations** (sets
  "Activations used", default = computers in use) and **Set device limit** (default = computers in use).
  `PUT /api/admin/v1/licenses/:id` accepts `activationsCount` (audit-logged). Test in `accounts.test.ts`.
- The 1.0.0+9 client installer was made by an older Installer Studio installed in %LOCALAPPDATA% (2026-11-03), so it
  had no uninstall clean-up (uninstalling on DELL-G15 neither told the server nor deleted data). `apna_vps.py` now uses
  the newest of the installed copy and the source build (`_newest_studio`).
- Lite mode (`lib/performance.ts`, both apps): 4 or fewer threads or ≤ 4 GB memory → no backdrop blur and no
  animations. Engine databases: `cache_size = -16000`, `temp_store = MEMORY`.
- **The billing app forgot its theme (and its saved sign-ins and zoom) at every start**: the engine listened on a random
  port each time, and a page's saved storage belongs to its address. The engine now uses 127.0.0.1:47832 when free
  (any free port otherwise; `tauri/sidecar/run-server.cjs`), and the shell also keeps the theme on disk
  (`<data>/ui-theme`, command `apna_set_theme`): the start screen, the window background and the page (an
  initialization script sets `<html data-apna-theme>`) open in it from the first frame. Test runs with
  `--apna-data-dir` keep their own window storage. Checked in a test copy: Dark survives a normal restart.

### 2026-11-15 — A second computer with the business already set up joins the account's licence
- Case: on another PC the business existed locally (signed up again, or left from an earlier install) but was not
  connected to a licence; "Start my free trial" was refused ("A free trial has already been used with this email
  address") and the computer never appeared in the Admin Panel, although the device limit was 2.
- The engine's `startTrial` now answers that refusal by joining the account's licence (`joinAccountLicense`, via the
  server's `/account/sign-in` with `activate`), using the password kept from the last sign-in. If this computer's
  password differs from the account's, the activation page asks for the account password (`ACCOUNT_PASSWORD_NEEDED`,
  new engine route `POST /license/join`); it then becomes this computer's password too.
- Verified with a local licence server and three engines: join with the same password (2 devices active), password
  asked when different, wrong password refused, sign-in with the account password afterwards. Engine tests: 91 pass.
- Needs a client update; no licence-server change.

### 2026-11-15 — Sign-in at every start; signing in on another computer goes straight to the dashboard; startup log
- Sign-in is asked for every time the desktop app is opened again (index.html: a new start, seen by an empty
  sessionStorage, drops `apna_billing_token` / `apna_billing_sessions`; reloads keep them; theme and zoom stay). It had
  become "remembered" only because the engine now keeps the same address between starts.
- Sign-in to a business that is here but has no licence (set up again, set up offline, left from an earlier install):
  the engine joins the account's licence with the typed password (`joinIfAccountLicensed`; not after the vendor turned
  the computer off or removed it), so the dashboard opens directly. Sign-up with an email + password that already has an
  account on the server opens that account here (`openFromServer`) instead of a second business; device limit,
  suspended or expired accounts are reported at once. LicenseContext re-reads the licence after every sign-in.
- The desktop shell keeps its startup timings in `<data dir>/startup.log` (last starts only) to find out why a start
  is slow on a given computer. Measured here: first start of a fresh install 1.4 s (≈1.2 s is Windows scanning the 97 MB
  engine), later starts ≈0.5 s.
- Verified: local licence server + engines (sign-up again → ACTIVE on the licence; offline-made business → joins on
  sign-in, 3 devices active); desktop test copy (reload keeps sign-ins, restart clears them, theme kept). Engine tests pass.

### 2026-11-15 — Second PC still saw "Start free trial": it never got the update; sign-in now always reconnects
- Cause: updates reach a computer only with its licence check, so an unlicensed computer (the client's second PC)
  never heard of the new version and kept the old screens. Also, the new auto-join skipped computers the admin had
  deleted from the list.
- `offerUpdateWithoutLicence` (jobs: 4 s after start, then every sync interval): businesses without a licence read
  the public `/updates/latest.json` and get an update offer; the update prompt is now shown on the sign-in, sign-up and
  licence screens as well.
- Sign-in with the account password reconnects any unlicensed business here (also after a delete in the Admin Panel).
  Reasons worth showing (device limit, activation limit, no active licence, suspended, offline) come with the sign-in
  and appear on the licence screen. The licence screen has "Already using Apna Billing on another computer? Use that
  account's licence" (password → `/license/join`).
- Verified with a local licence server + 3 engines: deleted PC signs in → ACTIVE; unlicensed PC offered 9.9.9 from
  latest.json. Engine tests pass; client builds.

### 2026-11-15 — Live sync of everything between all computers of one account
- **What**: every insert / edit / delete in every shared table of a business reaches the account's other computers
  within ~0.2–0.5 s; open screens reload their lists quietly (no reload, no spinner, cart and forms untouched).
- **Engine** (`server/src/sync/syncEngine.ts`, migration v5 `sync`): triggers (installed on every open via
  `onShopOpen`) note changed rows in `sync_outbox` and counter changes in `sync_deltas`. Local tables (licence,
  backups, printer, system settings, plans) and `businesses.next_invoice_number` are not shared. Counters
  (`products/clothing_variants.stock_quantity`, `customers.outstanding_balance_paise/loyalty_points`,
  `suppliers.outstanding_balance_paise`) travel as changes, so concurrent sales all count. A row's own unsent change
  wins over an incoming copy; unique clashes are settled the same way everywhere (SKU / invoice / PO number renamed
  with a suffix, other uniques keep the smaller key). Sync runs after every mutating request, on a live-link push
  (`event: sync`), on reconnect and every 20 s. Each extra computer numbers its own series (INV-B1001, CN-B1001, PO-B…)
  via `seriesTag()`; the computer with the account's first bills keeps the plain numbers.
- **Joining**: first computer seeds the account; a computer signing in (or activating) takes the account's data over
  before the dashboard opens (`takeOverAccountData`), its own records (backed up first, `PRE_SYNC`) are merged in
  (business and owner re-pointed). Restoring a backup makes it the account's data (`/sync/reset`, epoch); the others
  take it over (backup first). Erasing a shop affects only that computer.
- **Licence server** (`routes/sync.ts`, migration `007_sync`): register / push / pull / reset, rows sealed with
  AES-256-GCM, counter changes folded into the stored copy, idempotent change ids, paging that never skips,
  pruning of changes every computer has fetched, cleanup on customer / installation delete, `pushSync` over SSE.
- **Client**: `useLiveRefresh` on 25 screens (Settings excluded while editing), `SyncBadge` (Synced / Syncing /
  Offline · n waiting / Sync problem), `SYNC_JOINED` notice, wording about data staying on one computer updated.
- **Verified**: licence-server tests 39 pass (new `test/sync.test.ts`), engine tests 91 pass; multi-engine runs with a
  local licence server: new device has everything at sign-in, add/edit/delete both ways, concurrent sales (20−2−3,
  60 sales on 3 PCs → exact), bill series never clash, credit balances, offline catch-up, merge of a computer with its
  own records (clashing bill renamed), backup restore propagated, live screen update in Edge (~0.5 s, no reload),
  packaged sealed engine syncing with a second engine; full release build passes.
- **Deploy order**: upload licence server + Admin Panel first (new tables/routes), then publish the client update.

### 2026-11-15 — Feature use reported as it happens
- Cause: uses were stored on the computer and uploaded at start-up / every 6 h; the server announced every upload as
  "Reported use of …" at upload time, so the Admin Panel showed Dashboard use while the client was still on the
  sign-in screen (yesterday's use, sent on start).
- Engine: `recordUsage` schedules an upload 2 s later (uses close together go in one report); times go as ISO UTC
  (SQLite `datetime('now')` had no zone). Requests from lists reloading on their own (`X-Apna-Background: 1`, set by
  `useLiveRefresh` via `inBackground`) are not counted as use.
- Licence server: `noteCustomerUsage` announces only uses of the last 2 minutes ("In use now: <business> (<computer>)
  is using Dashboard, …"); older uses only refresh the figures (no pop-up); the same screens again within a minute
  do not pop up again.
- Verified with a local licence server + engine and the admin live stream: sign-in screen → nothing; background
  reload → nothing; opening the dashboard → announced after ~2 s with business and computer. Tests pass.

### 2026-11-15 — Faster sync when the live link is down; quicker screen updates
- Without the live link (dropped, reconnecting, blocked by a network) computers only checked every 20 s. Now every
  3 s while it is down, every 15 s as a safety check while it is up (`jobs.ts`, `msSinceSync`). Local changes are sent
  30 ms after the request (was 120 ms); screens reload 80 ms after a change arrives (was 250 ms).
- `syncStatus().live` (from `realtime.ts` via `setLiveLinkCheck`): the badge tooltip says whether changes arrive
  live or are checked every 3 s. The badge no longer flickers on every check (only real state changes are sent).
- Measured locally: change on PC1 → PC2's open screen ~0.2 s (was ~0.5 s); live link down right after a server
  restart → ~2.3 s (was up to 20 s). Could not measure against the VPS from here (its private certificate).

### 2026-11-15 — Animated showcase on the sign-in screen
- `client/src/components/auth/LoginShowcase.tsx` (left side of the sign-in / sign-up screen, which opens at every
  start): a looping story drawn in code — barcode scanned, items drop into the bill, GST total counts up, "Paid · UPI",
  receipt prints, the bill appears on Counter 2 ("Synced in 0.2 s") — with a rotating headline, feature chips and a
  slow background glow. Keyframes in `index.css` (transform / opacity only). Pauses while the window is hidden.
- Chosen over an MP4: sharp at every resolution, follows light / dark, a few KB, no codec or start-up cost.
  Lite mode keeps the story (instant steps) without the blurred glow; "reduce motion" shows the finished picture.
- Checked in light and dark at 1920×1080 and 2560×1440 (Edge, frame by frame): no overlaps.

### 2026-11-15 — Delete a customer completely (all computers, synced data)
- Admin Panel → Customers → customer → Delete: the dialog now offers "Erase the shop on its computers too" when
  computers still use a licence (server: `eraseDevices`), instead of requiring a revoke first. The delete removes the
  licence(s), installations, usage and the shop's synced data on the server; open computers erase the shop at once
  (live push `CUSTOMER_DELETED`), others when they next connect (`INSTALLATION_REMOVED`), each after a PRE_ERASE
  safety backup in its backup folder. Signing in with the old email fails; Sign Up starts a fresh, empty shop.
- Verified (local licence server, 2 engines, one switched off during the delete): refused without the tick; with it,
  the open computer erased at once, the switched-off one at its next start; same email signs up again with a new trial
  and no old products. Licence-server tests pass.

## Logo & branding (2026-11-22)

- **Settings → Logo & Branding** (owner only; staff see it read-only): logo upload (PNG/JPG/WebP/SVG, drag and drop,
  resized to ≤512 px WebP, ~20–80 KB), brand colour (12 swatches + custom), tagline, website/Instagram, authorised
  signature and company stamp (photo on white paper: the paper is made transparent), UPI ID + payee name with a
  "Scan to pay" QR, bank details (account name/number, IFSC, bank, branch), logo on 80 mm receipts. Live preview is the
  real A4 sheet fitted to the space.
- Stored per business: logo in `businesses.logo_url`, the rest in `app_settings` (`brand.*`), so it is backed up with
  the shop and synced to the account's other computers. Engine: `services/brandingService.ts`,
  `GET/PUT /app/business/branding` (PUT owner only; pictures validated as PNG/JPEG/WebP data URLs ≤ ~600 KB; UPI ID and
  IFSC checked; audit log records only which fields changed). `getInvoiceFull` returns `branding`; `/auth/me` returns
  `businessLogo`.
- Printed: A4 bill (logo, colour on top line/title/total/thank-you, tagline, website, bank details, UPI QR for exactly
  the balance due, signature image, stamp), 80 mm receipt (grey logo, tagline, website, UPI QR when money is due),
  report printouts (letterhead with logo, address, GSTIN). App top bar shows the logo.
- UPI QR: `qrcode-generator` 1.4.4 (MIT), drawn as SVG (`components/ui/QrSvg.tsx`); link `upi://pay?pa=…&pn=…&am=…&cu=INR&tn=Bill …`.
- Verified: engine tests 96/96 (new `test/branding.test.ts`: defaults, save/print with every bill, remove a picture,
  bad input refused, owner-only); real app in headless Edge: uploads through the file buttons, save, A4 bill, receipt,
  preview screenshots.

## Sign-in screen with looping shop videos (2026-11-24, Parts A + B of the plan)

- **Screen**: the 4 clips (grocery, pharmacy, clothing, restaurant; 8 s each) fill the whole sign-in window, darkened, with
  the headline, category chip and 4 progress bars on the left (a bar jumps to its clip) and the sign-in card on the
  right as frosted glass. `components/auth/VideoBackdrop.tsx` (player), `components/auth/loginStory.tsx` (shared clip
  state: the bars are moved straight in the page, never through React renders), `lib/loginMedia.ts` (clips + words).
  The old drawn `LoginShowcase` is removed.
- **Player**: two `<video>` elements only (clip on screen + the next, loaded ~3 s ahead), one timer per clip (no per-frame
  JavaScript), 0.6 s cross-fade, pauses while the window is hidden, frees the videos on leaving the screen. Lite
  computers (`html.lite`) get the 720p files; others 1080p; both 24 fps (the clips' own) H.264 (hardware decoding on every Windows PC).
  Reduce-motion, a video that cannot play or a 10 s start-up timeout show the posters instead.
- **Files**: `scripts/encode-login-videos.mjs` (`--placeholder` makes stand-ins; real clips go in
  `branding/login-videos/raw/{1..4}-*.mp4`, which is git-ignored) writes `client/public/login-media/` (content-hashed
  names, 1080p <= 4.5 MB, 720p <= 2 MB, poster) and `client/src/lib/loginMedia.generated.ts`.
- **Serving, encrypted**: in the installed app there is no .mp4 / .webp file. `tauri/scripts/prepare.cjs` encrypts each
  into `engine/login-media/<opaque name>.dat` (AES-256-CTR, random IV per file; `server/src/lib/loginMedia.ts`, the same
  code the engine decrypts with). The key is `HMAC(dataKey, "apna-login-media-v1")`: the data key reaches the engine
  from the shell at every start, so the key is in no file of the installation. The engine (`server/src/app.ts`,
  `/login-media/<name>.mp4`) decrypts while serving, with range requests (206), `Cache-Control: no-store` (the window
  keeps no decrypted copy on disk) and a plain 404 for anything else. From source (dev) the plain files are served.
  This hides the files from anyone browsing the install folder; it is not protection against a person who runs the
  app (the picture is on the screen, and is served on 127.0.0.1 while the app is open). The files stay out of the
  start-up integrity manifest (hashing ~18 MB more would slow every start); the build's smoke test checks 206, that the
  decrypted bytes are an MP4 ("ftyp"), and 404 for a .dat name.
- **Fixed on the way**: lite mode never removed blur. The CSS build dropped the standard `backdrop-filter: none` from the
  `html.lite` rule and kept only the `-webkit-` one, which Edge / WebView2 ignore. Now only the standard property is
  written and the build emits both.
- Verified: engine tests 96/96; real sealed-engine build with smoke test; headless Edge, 22 checks (1080p playback, one
  clip loaded at a time, next clip 3 s ahead, cross-fade, headline + bars, jump by bar, quick double press, hidden
  pauses / visible resumes, typing keeps playing, light / dark / 1280x720 / phone, lite = 720p + no blur + solid card,
  reduce motion = posters that change every 8 s, blocked video = posters).
- **Part C (done)**: the owner's 4 real clips (4K, 24 fps, 8.00 s, with sound) are encoded to 1080p (2.5-3.6 MB) and
  720p (1.0-1.5 MB), 192 frames each at 24 fps (no frame-rate conversion), sound removed, colours converted from the
  clips' BT.601 tag to BT.709 and tagged, posters = first frame. Touch-ups for flaws in the AI clips live in `CLIPS` in
  the encode script: clip 1 had a sign reading "4K 24 fps" on a pillar for its first 2.4 s (the wall below is copied
  over it through a soft mask that follows it), clip 2 had garbled sign lettering at the top edge (top 5 % cropped,
  zoomed). When a clip is made again, delete its entry (or run with `--no-fixes`). `client/public/login-media/`
  (the encoded files) is git-ignored: they are the owner's own and the repository is public.
- Verified on the real sealed engine started like the shell does: 22 browser checks, byte-for-byte equal output to the
  original through the engine, ffprobe reads it over HTTP; engine tests 101/101 (new `test/loginMedia.test.ts`: every
  kind of byte range incl. 60 random ones, wrong/no key, odd names).
- **Rebuilt as one looping video (2026-11-25)**: the two-player design above (two `<video>` elements swapped with a
  fade, the next clip loaded ahead) is gone. The owner saw black screens, a frozen picture and uneven clip changes on a
  real PC: a hand-over between two players can stall (the next one waits for data while the old one has ended) or show
  nothing (on some graphics chips a video fading in and out loses its hardware overlay). Now:
  - `scripts/encode-login-videos.mjs` makes ONE file, `login.<hash>.mp4` (1080p, 30 fps, H.264 high, BT.709, 28.67 s =
    860 frames, ~12 MB): the 4 clips one after another with 0.8 s (24 frame) dissolves, each shop owning 7.17 s, cut from
    the middle of the dissolve "last shop into first" to the middle of the same dissolve one lap later, so the file
    loops with no visible join (measured: the picture difference across the join is the same as between any two
    neighbouring frames). 24 -> 30 fps by motion interpolation (a 60 Hz screen shows 30 fps frames twice each: even; 24
    fps would be 3-2-3-2). Per-clip touch-ups and the 4 posters (each shop's first clean picture, which is also where
    the video starts) are made from the same masters. No 720p copy.
  - `VideoBackdrop.tsx`: one `<video>` (muted, loop), no fades or blur on top of it, one poster under it, a fixed
    darkening layer, a dark-green gradient under everything (never plain black). The words and bars follow the video's
    own clock (`currentTime`, 4x a second), so they cannot drift from the picture. A watchdog (1 s) restarts a picture
    that is paused or whose clock stands still (3 s) from where it was, at most 3 times a minute, then falls back to the
    posters. Hidden/minimised pauses it. Pressing a bar seeks to that shop's clean picture.
  - The sign-in card is solid (94 % / 90 %), no frosted glass (a blur over moving video is redrawn for every frame).
  - Verified on the real sealed engine in headless Edge, 25 checks: starts playing at once at 1080p / 30 fps from the
    first shop's picture; never black or frozen over 62 s (2 laps; brightness of the decoded picture sampled every
    second); the words change in the right order within 0.3 s of the video reaching each shop; the clock never stands
    still at the loop point; a paused or frozen player recovers by itself; reduce-motion, blocked video and nothing
    loading at all all give a working screen. Headless Edge has no real graphics chip, so no real frame-time numbers
    are claimed: the black screen could not be reproduced there, only designed out.

## Rollback reaches every computer (2026-11-25)

- Rollback already existed (Updates & Releases -> History -> "Roll back to this"; the server offers the live older version
  to every computer on a different version; the shell's updater uses `version_comparator(remote != current)`). Proven end
  to end with a real SuperAdmin licence server + real engines + a browser (15 checks): an open signed-in app shows the
  normal "Update available / Version 1.0.0 - you have 1.0.1" popup 0.3 s after the admin presses the button; a required
  rollback shows "Update required" without Later; a computer that was switched off gets it when it starts; a computer
  already on that version gets nothing.
- Fixed: a computer with no licence yet (it reads `/updates/latest.json` itself) only accepted NEWER versions, so a
  rollback never reached it. The server now writes `rollback: true/false` into latest.json (Tauri's updater ignores
  unknown fields: checked in tauri-plugin-updater 2.14.1), and `offerUpdateWithoutLicence` offers any different version
  when it is true. Tests: SuperAdmin `updates.test.ts` (flag on rollback, cleared by a newer publish), engine 101/101.
- Needs the licence server uploaded to the VPS (Upload Admin Panel and licence server) and the new client build.
  Apps built before 15 Nov (no "+N" in the version) only accept newer versions and cannot be rolled back.

## Sign-in background: real cause of the black screen fixed, PLRMS player (2026-11-25)

- **Black screen with a broken-picture icon on every installed app** was a key bug: the desktop shell hands the engine
  `HMAC(data key, "apna-billing/sqlite/v1")` (lib.rs `database_key`), but the build encrypted the sign-in media with
  the raw data key, and the build's smoke test and my test launcher also passed the raw key, so every test passed while
  every installation decrypted noise. Now `prepare.cjs` derives `shellDatabaseKey` exactly as the shell (checked by
  running the shell's own Rust code: same key), encrypts with it and gives it to the smoke test. The encrypted header
  now carries a key check: files made with another key are refused (404 + one log line) instead of served as noise.
- **The player is now the PLRMS sign-in player** (plrms-demo `LoginHero.tsx`): four clips, each 1920x1080, 24 fps,
  played at 80 % speed (motion-interpolated, like PLRMS's; dropped since, see below), exactly 8.5 s / 204 frames, key picture
  every 2 s, H.264 only (PLRMS also ships AV1, which low-end PCs decode in software). Each clip plays once with a slow
  zoom (scale 1 -> 1.09 over 8.5 s); the next fades in over the last 1.2 s; only the visible clip decodes; a hidden
  window freezes clip, zoom and bar and resumes on the same frame (snapshot canvas). The bars fill by a CSS animation.
- **Fixed beyond PLRMS** (found by logging every switch): a clip that played a round ago is rewound and the browser puts
  its player to sleep while it still reports "ready", so at the loop the previous clip could stand on its last frame.
  The next clip is now reloaded 3 s before its turn, started if not ready at the switch, the current one switches at
  once if it ends, and every clip has its poster (never black). Lite mode keeps the zoom / fade durations.
- Verified on the real sealed engine started with the shell's key, 19 checks incl. "the next clip is already moving
  1.2 s before the previous one ends" at all 9 switches of two rounds (1.19-1.21 s), 24 fps, zoom running, never black,
  hidden/visible, lite, reduce motion, blocked video. Headless Edge stops drawing frames at times, which delays CSS
  fades in the test only (shown by the page's animation clock and fixed in the test by drawing continuously).

## Sign-in videos no longer "shake"; digital stamp; no text highlighting in the desktop app (2026-11-24)

- **Shaking camera fixed.** The 80 % slow motion needed 4 of every 5 frames invented by motion interpolation
  (ffmpeg `minterpolate`), and those made-up frames warp (cloth and hands melt between frames), which reads as a
  shaking camera. The clips now play at their own speed with the camera's own frames only: 24 fps, 192 frames, 8.0 s
  (each shop on screen 6.8 s). The encoder refuses a source that is not 24 fps or shorter than 192 frames instead of
  converting it. Checked: every frame of the new clip matches its source frame (PSNR >= 44.6 dB on all 192 frames).
  The zoom, bar and fade lengths now come from the clips through CSS variables (`--hero-ms`, `--story-ms`, `--fade-ms`),
  also in lite mode. The 19 sign-in checks pass on the rebuilt sealed engine (holds 6.7-6.9 s).
- **Still shaking after that: the slow zoom removed.** Measured on the four clips (phase correlation of the whole
  picture, every frame): the camera movement is smooth (the picture's movement changes by under 1 px from one frame
  to the next), so the files don't shake. The shake came from the PLRMS-style zoom (scale 1 -> 1.09) the player put on
  top: it re-scales the picture by a fraction of a pixel on every screen refresh while the video changes 24 times a
  second, and the two beat against each other. The picture is now never scaled or moved; only the cross-fade and the
  progress bars animate. A check in the sign-in test proves no video or parent has a transform or animation (19/19).
- **Digital stamp** (Settings > Logo & Branding > Digital stamp): no stamp, a round seal the app draws (shop name round
  the top, city round the bottom, AUTHORISED / PAID / RECEIVED / ... in the middle, optional bill date), or the shop's
  own stamp picture pressed in stamp-pad ink (or its own colours). Ink colour, beside the signature or as a faint
  watermark across the A4 bill, size S/M/L, ink strength 20-100 %, and "also on receipts" (solid black, no grain:
  thermal printers can't print grey). Drawn as SVG with a slightly worn, tilted impression that multiplies with the
  paper, so text under it stays readable. Live preview in settings. A shop that had uploaded a stamp picture keeps it.
- **Desktop app: no text highlighting.** In the desktop window a click, drag or double-click no longer paints text
  blue and pictures can't be dragged out; typing fields (and anything marked `.selectable`) still select and copy.

## The app's own "fill in this field" bubble instead of the browser's (2026-11-24)

- Every form in the app showed the browser's plain white bubble ("Please fill out this field."). `lib/fieldWarnings.ts`
  (installed in `main.tsx`, like `noTooltips`) cancels it and shows a bubble in the app's style instead: a red "!" icon,
  a message that names the field ("Business Email is needed", "Password is needed", "Enter a valid email, like
  name@shop.com", "Please choose Category", "Quantity must be 1 or more"), an arrow to the field, light and dark. The
  first problem field is focused with a red border and glow. The bubble goes when the person types, leaves the field,
  presses Esc (which then does not also close the dialog) or after 6 s. One bubble at a time; it follows the field when
  the panel scrolls. No form had to change: the forms' own rules (`required`, `type="email"`, `min`, `pattern`) are
  kept, only the way a problem is shown. The field's name is its label, also where the label is written above the box
  without being linked to it (the usual pattern here), taken only when one field is under that label.
- Tested in headless Edge on the sealed engine (9 checks): empty sign-in, wrong email, empty password, one bubble at a
  time, typing / Esc / leaving the field close it, light and dark.

## Sign-in video: quiet start, no hiccup at launch (2026-11-24)

- **Cause found by measuring** (cold launch against a freshly started sealed engine in headless Edge, logging every
  shown picture, stall, dropped picture and media request): the next clip was loaded as soon as the first "could play
  through". For a local file that is immediately, so the second clip's request went out at 150-190 ms, exactly when the
  first clip started to move: a second video decoder opened in the most fragile moment, while the app was still
  starting. On busy computers that freezes the picture for a moment and then skips pictures.
- **Fixed:** (1) the next clip is only opened once the visible one has played steadily for 2 s (the existing 3 s
  "warm-up" still makes sure it is ready for the switch); (2) the first shot waits on its still picture (which is its
  first frame, so the swap is invisible) until the app has finished starting (page loaded, then an idle moment, at most
  1.5 s); (3) the progress bar and the words wait for the first moving picture, so the bar is never ahead of the video.
- **Measured, same probe before and after** (cold launches on this fast PC): before, 4 of 6 launches dropped 1-2
  pictures at the start and 1 of 6 visibly skipped 3; after, 0 dropped and 0 skipped in 10 launches, also with the CPU
  slowed 4x and every core busy. A shop PC is slower than this one, so it should gain more; not measurable from here.
  The engine itself was never the problem (it answers a clip in 3-40 ms). Sign-in checks 19/19.

## Live activity in the admin console (2026-11-24)

- **What the vendor sees** (SuperAdmin: server `activity.ts`, `presence.ts`, migration `010_activity`; panel `Live
  Activity` page, `activity.tsx`, customer page): every shop's computers right now (online or not, who is signed in to
  the app, which screen is in use) and a kept, searchable timeline of everything: came online, app closed / went
  offline, signed in, opened while already signed in, signed out (by hand or session ended), screens in use, trial,
  licence, uninstalled, taken off the licence, and computers that have not connected for 3 days. Pop-ups as it happens
  (an uninstall stays until closed, with a sound), a bell with unread count, per-type pop-up switches, and optional
  Windows alerts when the console is in the background.
- **Online / offline is instant**: every running app keeps a live stream to the server; its first stream is "online"
  and its last one closing is "offline" (after 20 s, so a network blip or server restart is not announced; right after
  a server start the reconnecting apps are noted silently).
- **Billing app side**: the engine tells the vendor on sign-in (`SIGNED_IN`, name and role), on the first "who am I" of
  a session that was still open (`SESSION_RESUMED`), on sign-out (`POST /auth/logout`, also for an expired session:
  its token is read only to name who it was) and when the app closes (`APP_CLOSED`). Closing: the shell now closes the
  engine's input first; the engine reports (at most ~1.2 s, nothing if offline) and exits by itself; still running
  after 2 s it is ended. So every engine process still stops when the app closes.
- **Uninstall** was already reported by the uninstaller (`--uninstall`); it now lands in the timeline as an alert, and
  the computer is not also announced as "went offline". A computer deleted by hand (no uninstaller, so nobody is told)
  shows up as "Not seen for days" after 3 days without a connection.
- Tests: SuperAdmin `test/activity.test.ts` (real server and real streams: sign-in, repeat, resumed, expired sign-out,
  online, blip not announced, offline after grace, app closed at once, usage, uninstall, quiet computers, feed
  filters; all 62 pass), Billing `server/test/activity.test.ts` (engine reports to a stand-in vendor server; 103 pass).
  Checked on screen: Live page, customer page, bell (headless Edge against a local server with the built panel).
- Live only after: the admin panel + licence server upload (admin app: Upload Admin Panel and licence server), and a
  Billing client update (the engine reports and the shell's graceful close are in the new build).

## Opens maximized, stops completely on close, smoother switch between sign-in clips (2026-11-24)

- **Always maximized** (every computer, every start): the start screen now covers the whole work area (square corners,
  as a maximized window has) and the app's window is built maximized while still hidden, so it is laid out at its real
  size before it shows and the hand-over from the start screen cannot be seen. The restore button gives a normal
  1366 x 860 window. Not F11 full screen (that stays on F11).
- **Start-up order** was already parallel and stays so: the engine starts first on its own thread at program start,
  the start screen shows at once, the window is made meanwhile, and the window opens on the engine as soon as both are
  ready.
- **Closing stops everything**: the shell closes the engine's input; the engine tells the vendor "app closed" and exits
  by itself (at most ~1.2 s), and is ended after 2 s at the latest. The WebView processes end with the shell. If the
  shell itself is killed, the engine sees its input close and exits the same way.
- **Clip switch**: the cross-fade now starts 0.5 s earlier than strictly needed (each shop 6.3 s), so on a slow
  computer whose next clip takes a moment to start, the clip going out is still moving until it has faded away and is
  paused only then (before, it could reach its last frame while still visible: "stuck just before the next one").
  The `will-change` hint that moved from one clip to the next at the switch (rebuilding the layers mid-fade) is gone,
  and the headline's blurred drop-shadow filter is a plain text-shadow (no filter layer over the moving video).
  Sign-in checks 19/19, incl. "no clip ever runs out at a switch: 12 starts, 0 ended".

## Print options for every bill: paper, kind of document, logo, signature, stamp, watermark, copies (2026-11-24)

- The print window (POS billing, Invoices, Dashboard: components/billing/InvoiceModal.tsx) has a panel beside the
  preview: paper 80 mm / 58 mm receipt, A5 or A4; document: automatic, tax invoice, bill of supply, cash memo,
  estimate, delivery challan (goods and quantities only, a "received" line); on the bill: logo, authorised signature,
  "scan to pay" UPI code, bank details; stamp: none / round seal / the stamp picture, by the signature or as a
  watermark; 1-3 copies (original / duplicate / triplicate; on receipts customer / shop / office copy). Choices that
  need something not uploaded or set up are greyed out and say where to set it up. It starts from the shop's settings
  (Logo & Branding) and the kind of business (grocery, restaurant, clothing: 80 mm; pharmacy, school: A5; wholesale,
  manufacturing: A4 in two copies; services: A4), and the last choice is remembered on that computer (each counter has
  its own printer); "Back to shop settings" resets it. lib/printOptions.ts holds the rules. PDF names follow the
  document (Tax-Invoice-DES-1001.pdf, Delivery-Challan-…).
- Checked in headless Edge with a real bill (12/12): 80 mm with seal and UPI, A4 with bank details and signature,
  watermark + 2 copies, challan without prices, A5 (bank details stacked on the half page), 58 mm without stamp, the
  choice remembered and reset.

## Shopping-mall scale: measured and fixed (2026-11-24)

- scripts/perf-bench.ts builds an encrypted shop of 100,000 products, 50,000 customers and 1,000,000 bills (3 million
  lines, 3.2 GB) and times every heavy request (`npx tsx scripts/perf-bench.ts [--scale 0.1] [--keep dir] [--profile]`).
- Fixed after measuring: indexes for the newest-first lists, stock history, a customer's bills and payments (partial
  indexes that leave out walk-in sales: with most bills walk-in an index over all of them looked useless to SQLite),
  products in name order and by code ignoring case, low stock; planner statistics kept current (PRAGMA optimize at
  opening and every 6 h); the dashboard reads the last 30 days, not every bill ever made; lists are not counted on every
  page (searches not at all, plain lists up to 10,000: lib/paging.ts); a bill number typed or scanned in full is found by
  its index first; report screens show the first 1,000 rows (Export has all, totals are for all).
- The day's sales per product (db/salesSummary.ts, migration v7): kept by triggers on bills and lines (issued only;
  drafts, edits, cancels, deletes, re-dating and sync's lines-before-bill all handled), never synced, the last 3 days
  rebuilt at every opening; the dashboard, profit & loss, GST summary and the product and HSN reports read it. A test
  changes bills every way and checks it equals the bills and rebuilds to the same.
- A big shop's first start after this update upgrades its data once (safety copy, indexes, summary): the engine says
  APNA_UPGRADING and the shell waits up to 30 minutes instead of reporting a failed start after 60 s.

## The central server: off-server backups and recovery (2026-11-24)

- Admin app → System → Backups & Recovery (owner): set a recovery password once; the app makes a backup when it opens
  and every 3 hours while open, into Documents\Winteg Wave Backups (24 newest, then one a day for 60 days), with a menu
  dot when the newest is over a day old. The server encrypts each backup to the owner's key (ECDH P-256 + HKDF +
  AES-256-GCM, SuperAdmin server/src/backup.ts); the private key is locked with the recovery password (PBKDF2 600k) in
  recovery-key.json beside the backups, so the folder can be copied anywhere. Inside: the database, the licence-signing
  key, TLS certificate and key, settings, and the TLS CA key (root-only on the VPS: Upload encrypts it to the backup key).
- `python deploy/apna_vps.py restore` rebuilds the server on a new VPS from the newest backup with the same keys (a new
  certificate for the new address from the same CA, so installed apps trust it), and `publish-address` signs "the server
  is now at …" (deploy/servers.json + .sig, Ed25519 with the licence key). Installed apps that cannot reach their server
  for 10 minutes read it from GitHub (and a CDN copy), check the signature and follow it (licensing/serverAddress.ts);
  the update check follows it too. The VPS also keeps hourly copies (2 days) besides the nightly ones (30 days).
- Tested: backup round trip (server test), WebCrypto key + Python-sealed CA key + Node backup opened by the Python
  restore tool with only the password, wrong password refused; address following (newer signed only, tampered and
  older refused, kept across restarts); the published address verified against the key built into the apps.
