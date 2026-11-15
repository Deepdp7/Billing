# Apna Billing — Deployment & Operations Guide

There are two things to deploy:

| Piece | Runs where | Data |
|---|---|---|
| **Desktop app** (`desktop/` → Windows installer) | Each customer's PC | Local SQLite in `%APPDATA%\ApnaBilling\data` |
| **License server + Admin Panel** (`license-server/` + `admin-panel/`) | One server you control (HTTPS) | PostgreSQL |

The desktop app never sends invoices, customers or amounts to your server — only activation details,
license checks, and per-feature daily usage counts.

---

## 1. One-time: production signing keys

The license server signs entitlements with an **Ed25519 private key**; the desktop app verifies them with the
matching **public key** embedded at build time.

> The keypair currently in `license-server/keys/` was generated for development and tests. **Replace it before
> your first production release.**

```bash
cd license-server
npm install
npm run keys:generate -- --force
```

This writes `license-server/keys/signing-private.pem` (secret) and rewrites
`server/src/licensing/publicKey.ts` with the new public key.

- Back up `signing-private.pem` offline (password manager / encrypted USB). Losing it means every installed
  copy must be updated before it can renew.
- Never commit it (`license-server/keys/` is in `.gitignore`) and never copy it into the desktop build
  (the build script refuses to package `.pem` files).
- After rotating keys, rebuild and redistribute the desktop installer.

## 2. License server + Admin Panel

### Requirements
Node.js 20+ (22 LTS recommended), PostgreSQL 14+, a domain with HTTPS (e.g. `license.yourdomain.com`).

### Build
```bash
cd admin-panel && npm install && npm run build      # → admin-panel/dist (served by the license server)
cd ../license-server && npm install && npm run build # → license-server/dist
```

### Configure (environment variables)
| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Required. Refuses to start without `DATABASE_URL`. |
| `DATABASE_URL` | `postgres://apna:***@127.0.0.1:5432/apna_license` | PostgreSQL connection. |
| `LICENSE_SIGNING_PRIVATE_KEY_FILE` | `/etc/apna/signing-private.pem` | Or `LICENSE_SIGNING_PRIVATE_KEY` with the PEM inline. File mode 600. |
| `PORT` / `HOST` | `7000` / `127.0.0.1` | Bind to localhost behind a reverse proxy. |
| `TRUST_PROXY` | `1` | Set when behind nginx/Caddy so rate limits see real client IPs. |
| `ADMIN_SESSION_HOURS` | `12` | Admin login session length. |
| `ADMIN_PANEL_DIR` | `/opt/apna/admin-panel/dist` | Defaults to `../admin-panel/dist`. |

### Initialise and run
```bash
cd license-server
npm run migrate                                   # creates tables, plans, feature catalog, settings
npm run admin:create -- you@yourdomain.com "Your Name" 'a-long-password' OWNER
node dist/index.js                                # run under systemd / pm2 / Docker
```

### HTTPS reverse proxy (Caddy example)
```
license.yourdomain.com {
    reverse_proxy 127.0.0.1:7000
}
```
The desktop app only accepts `https://` license-server URLs in production builds.

### After first login (Admin Panel → https://license.yourdomain.com)
1. **My Security** → enable two-factor authentication.
2. **System Settings** → trial length (default 7 days), offline grace (default 7 days), latest app version.
3. **Subscription Plans** → set prices and which features each plan includes.
4. **Admin Users** → add staff with the least role they need (VIEWER / SUPPORT / ADMIN / OWNER).

### Backups of the license database
Use standard PostgreSQL backups (`pg_dump` nightly + off-site copy). The signing key is not in the database —
back it up separately.

### Scaling note
Rate limiting is in-process. If you run more than one license-server instance, also rate-limit at the proxy.

## 3. Build the Windows installer

The desktop app is a Tauri shell plus a sealed local engine with encrypted storage. Architecture, protection model
and keys: [DESKTOP_ARCHITECTURE.md](DESKTOP_ARCHITECTURE.md).

Prerequisites on the build PC: Windows 10/11 x64, Node.js 24, Rust (stable, MSVC), and in
`%USERPROFILE%\.apna-billing\`: `updater.key` and `data.key` (the first build creates `data.key` — back it up).

```bash
npm run install:all                     # once
python deploy/apna_vps.py build         # installer for the VPS license server -> releases\ApnaBilling-<version>-setup.exe
```

What the build does (`tauri/scripts/prepare.cjs`, then `tauri build`):
1. Builds `server/` (TypeScript), `client/` (Vite) and the Rust licensing core `native/apna-core`.
2. Bundles the server into one minified script and seals it, with the UI as embedded assets, into
   `engine/apna-billing-engine.exe` (Node single-executable application with V8 code cache).
3. Refuses to continue if any `.js`, `.map`, `.db`, `.pem`, `.key`, `.env` or credentials file would be packaged.
4. Writes the SHA-256 manifest of the engine files and smoke-tests the sealed engine.
5. Compiles the shell (manifest, masked data key and license-server URL built in) and produces a per-user NSIS
   installer (no admin rights) plus signed updater artifacts. Uninstalling **keeps** customer data.

### Code signing (strongly recommended before distribution)
Unsigned installers trigger Windows SmartScreen warnings. See "Code signing" in
[DESKTOP_ARCHITECTURE.md](DESKTOP_ARCHITECTURE.md#code-signing-recommended-next-step).

### Releasing an update
`python deploy/apna_vps.py release [1.2.3] [--required] [--notes "..."]` builds, uploads and publishes a signed update;
open apps show "Install now" (see [HOW_TO_RUN.md](HOW_TO_RUN.md)). Customer data stays in `%APPDATA%`. On first
launch of a new version the app applies any database migrations (each migration run backs up first); the first 1.2
start also encrypts the existing database and backups.

## 4. Customer installation & first run

1. Run `ApnaBilling-Setup-x.y.z.exe`.
2. First launch shows **Start free trial** or **I have a license key** (internet needed once).
3. Then the one-time business setup (name, owner login, state, GSTIN).
4. Day-to-day billing works offline. The app re-checks the license every 6 hours when online and keeps full
   access offline for the configured grace period (default 7 days). After that — or when a license expires or
   is suspended — the app becomes **read-only**: data can still be viewed, printed and backed up.

To move to a new PC: License page → **Deactivate this computer**, then activate the key on the new PC and
restore a backup there.

## 5. Backup & restore (customer side)

- **Automatic**: every 24 hours by default (Backup & Restore page → schedule, folder, how many to keep).
  The last verified backup is never deleted; manual / pre-update / pre-restore backups are never pruned.
- **Manual**: Backup & Restore → **Create Backup**. Each backup is a complete, encrypted SQLite copy,
  integrity-checked and checksummed; it restores on any Apna Billing installation. Default folder: `%APPDATA%\ApnaBilling\data\backups` — point it at a USB or second drive
  for safety.
- **Restore**: pick a backup in the list, or **Restore from file** (any `.db` backup, e.g. from another PC or an older, unencrypted version).
  The file is integrity-checked first, the current data is backed up automatically, then everything is
  replaced in a single transaction. The license/installation identity is kept.
- **Export**: “Export All Data (JSON)” — every table for the business, for portability.
- Location of everything: Help menu → **Open data folder**.

## 6. Development

Run **three separate terminals** from the Billing folder (do not couple them in one command):

```bash
npm run install:all

npm run dev:license    # terminal 1 — license API :7000 only
npm run dev:admin      # terminal 2 — Admin window (+ panel :3100); needs license up
npm run dev:app        # terminal 3 — customer billing desktop app
```

Optional browser-only helpers:

```bash
npm run dev            # local API :5000 + web client :3000 (demo; licensing not enforced)
npm run dev:admin:web  # admin panel only on :3100 (still needs npm run dev:license)
npm run test           # server + license-server + desktop↔license-server E2E
```

To exercise licensing against a browser client, start with `APNA_LICENSE_ENFORCE=1` and
`APNA_LICENSE_SERVER_URL=http://127.0.0.1:7000`, create an admin with `npm run admin:create` in
`license-server/`, and open the admin panel at http://127.0.0.1:3100.

PostgreSQL test run for the license server: `TEST_DATABASE_URL=postgres://... npm --prefix license-server test`
(drops and recreates the `public` schema of that database — use a throwaway database).
