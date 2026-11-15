# Desktop app — packaging, protection and installer (from version 1.2)

## 1. What was there before (1.1.x)

| Piece | 1.1.x | Problem |
|---|---|---|
| Shell | Tauri (Rust) window, WebView2 | — fine, kept |
| Local API | `node.exe` (89 MB) + `server/*.js` + `node_modules` (123 MB, ~1,000 files) in `<install>\app` | readable, editable JavaScript; anyone could patch the license checks or run the server with their own Node options |
| UI | `client/` HTML/JS files in `<install>\app\client` | loose files |
| Database | `%APPDATA%\ApnaBilling\data\apna_billing.db`, plain SQLite | opened and edited with any SQLite tool (bills, license state) |
| Backups | plain SQLite copies | same |
| Licensing | Ed25519-signed tokens verified in JavaScript | logic and key visible and patchable |

Rewriting the 11,000-line Express server in Rust would have changed every feature for no user benefit, so the server
code stays TypeScript and the work went into *how it is shipped and what guards it*.

## 2. What ships now

```
<install>\                         (%LOCALAPPDATA%\Programs\Apna Billing, per-user, no admin rights)
  Apna Billing.exe                 Tauri shell (Rust): window, updater, engine launcher, integrity check, data key
  engine\
    apna-billing-engine.exe        sealed engine: the whole local server (bundled, minified, V8 code cache) + the
                                   built UI, embedded as executable assets
    native\apna-storage.dll        SQLite with encryption (SQLite3 Multiple Ciphers, ChaCha20-Poly1305)
    native\apna-core.dll           licensing core, Rust (native/apna-core)
    license-ca.crt                 public certificate of the license server (not secret)
  uninstall.exe
```

The two compiled modules are Node-API native libraries shipped as ordinary `.dll` files; the engine loads them by
file path (`process.dlopen`), so no `.node` files or `node_modules` are installed.

No `.js`, `node_modules`, source maps or client files are installed; the build refuses to package any.

### Start-up sequence
1. The shell hashes every file in `engine\` (SHA-256) and compares with the manifest compiled into it at build time.
   Any difference → "The installation is damaged or has been modified. Please reinstall" and nothing starts.
2. It starts `apna-billing-engine.exe` hidden, with a **cleared environment** (only system variables such as
   `SystemRoot`, `APPDATA`, `PATH`, proxies are passed), so `NODE_OPTIONS`, licensing overrides etc. cannot reach it.
3. It writes the database key to the engine's **stdin pipe** (never an environment variable, argument or file).
4. The engine ignores `NODE_OPTIONS` and Node command-line flags (sealed with `execArgvExtension: "none"`, so no
   `--require`/`--inspect-brk` code runs before it), forces the licensed desktop configuration, loads the two native
   modules, opens the encrypted database and prints its port. The shell opens the window on `http://127.0.0.1:<port>`.
   Started without a key from the shell, it refuses to run; with a wrong key, the shop database does not open.
5. When the shell exits, the pipe closes and the engine exits.

### Encrypted local data
* Live database, pre-migration copies and all backups are encrypted (SQLite3 Multiple Ciphers, ChaCha20-Poly1305,
  per-file random salt). Opening the file with a SQLite tool fails with "file is not a database".
* Key = HMAC-SHA256(product data key, `"apna-billing/sqlite/v1"`). The product data key is compiled into the shell
  (XOR-masked); it is the same for every installation, so **a backup restores on any PC** (moving shops, reinstalling
  Windows) — the restore flow is unchanged. It is not tied to the Windows account on purpose: losing the profile
  must never lose a shop's data.
* Upgrade from 1.1.x: on the first start the plain database is encrypted in place (WAL checkpoint → copy kept as
  `apna_billing.db.pre-encryption` → rekey → integrity check → copy deleted). If power fails half-way, the next start
  redoes it from the copy. Plain backups listed in Backup & Restore are encrypted in the background ~20 s after
  start, and their checksums updated. Plain `.db` backups from older versions can still be restored from file.
* Backups are made with `VACUUM INTO` (SQLite's online-backup API cannot write an encrypted copy).

### Native licensing core (`native/apna-core`, Rust)
* Holds the license-verification public key, compiled in from `server/src/licensing/publicKey.ts` at build time.
* `verifyLicenseToken` — Ed25519 (strict) signature + format check.
* `evaluateLicense` — clock-tamper detection, device/license status, expiry, offline grace, per-feature entitlement
  and temporary-feature expiry. Always enforces; there is no "off" switch in the compiled code.
* The TypeScript versions (`token.ts`, `evaluateLicense()` in `licenseClient.ts`) remain for development and tests.
  **Keep both in step** — `cargo test` in `native/apna-core` covers the Rust side, `npm test` in `server/` the TS side.

### What this protects against, honestly
| Threat | Status |
|---|---|
| Shop staff/owner reading or editing bills, stock or license state with a SQLite tool | blocked (encrypted) |
| Editing JavaScript in the install folder to unlock features | blocked (no JS on disk; engine sealed; shell verifies hashes) |
| Starting the engine with `NODE_OPTIONS`, `--inspect`, `APNA_LICENSE_ENFORCE=0`, a dropped `.env`, … | blocked |
| Forging or editing license tokens | blocked (Ed25519; private key only on the VPS) |
| Turning the PC clock back | detected (unchanged behaviour) |
| A skilled reverse engineer patching machine code or extracting keys from the binaries | raised cost only — true of every offline-capable desktop app; code signing (below) and server-side checks are the next layers |

## 3. Building

Prerequisites: Windows 10/11 x64, Node.js 24 (the engine is built from the Node binary that runs the build), Rust
(stable, MSVC), and the keys below. Normal use stays the same:

```
python deploy/apna_vps.py build            # or: release
```

which runs `npm run build` in `tauri/`:

1. `tauri/scripts/prepare.cjs` — checks the data key, builds `server/` and `client/`, builds `native/apna-core`
   (`cargo build --release --locked`), bundles `tauri/sidecar/run-server.cjs` + the server with esbuild, creates the
   single-executable blob (with code cache and the UI as assets), stamps the engine's file details/icon (rcedit),
   injects the blob (postject), copies the native modules and certificate, refuses forbidden file types, writes
   `tauri/build/engine-manifest.txt`, and **smoke-tests the sealed engine** (starts, serves the UI, enforces
   licensing).
2. `tauri build` — compiles the shell (embedding the manifest, masked data key, license-server URL), bundles NSIS
   installer + signed updater artifacts.

Development is unchanged: `npm run dev` at the root (no encryption, TS licensing), or `npm run dev` in `tauri/`
(debug shell runs `sidecar/run-server.cjs` with `node`; it does encrypt `%APPDATA%\ApnaBilling\data`, with the same
key as release builds).

### Keys to keep safe
| File | Lose it and… |
|---|---|
| `%USERPROFILE%\.apna-billing\data.key` | **new builds cannot open any customer's database.** Created by the first build; `deploy/data-key.fingerprint` (committed) makes later builds refuse a different key. Back it up with `updater.key`. |
| `%USERPROFILE%\.apna-billing\updater.key` | installed apps can never be updated again |
| `license-server/keys/signing-private.pem` | licenses cannot be issued |

## 4. Installers (Installer Studio, per-user)

Both apps are installed by setups made with **Installer Studio** (`C:\Users\ARITRA\Desktop\InstallerStudio`, an
NSIS wizard builder) from the projects in `deploy/installer-studio/`:

| Project | Program folder (made by the build) | Setup |
|---|---|---|
| `Apna Billing.isproj` | `releases/ApnaBilling-files` (`Apna Billing.exe` + `engine\`) | `releases/ApnaBilling-<version>-setup.exe` + `.sig` |
| `Apna Billing Admin.isproj` | `releases/ApnaBillingAdmin-files` (`Apna Billing Admin.exe`) | `releases/ApnaBillingAdmin-<version>-setup.exe` |

`python deploy/apna_vps.py build` / `release` / `admin-app` run Installer Studio from the command line
(`installer-studio build <project>`), filling in version, folders and branding pictures; the client setup is then
signed with the update key (`tauri signer sign`), which in-app updates require. **Never change a project's
`appId`**: it is how a newer setup finds and replaces the installed version.

* Wizard with the brand pictures (`branding/installer/<app>/`), no admin rights, installs into
  `%LOCALAPPDATA%\Programs\<app>`, Start-menu and desktop shortcuts, "Start <app>" at the end.
* Closes the running app and its engine first; a newer setup removes the older version with its own uninstaller.
* In-app updates ("Install now") download the signed setup and run it as `/P /UPDATE /R`: progress bar only, then
  the app starts again (passive mode and `/R` were added to Installer Studio for this).
* **Moving from the 1.1.x / 1.2.0 Tauri installer:** both projects set "Replaces an installation made by another
  installer" to that installer's Add/Remove Programs entry (`Apna Billing`, `Apna Billing Admin`). The first
  Installer Studio setup removes the old copy silently with its own uninstaller (files, shortcuts, entry), then
  installs, so no PC keeps two copies.
* **Deletion protection (client only):** the client project sets "Protect installed files", so the installer denies
  the Windows *Users* group Delete rights over `%LOCALAPPDATA%\Programs\Apna Billing`. A shop employee cannot delete
  the program by dragging it to the Recycle Bin or with `del` — it fails with "access denied", so casual tampering
  cannot break billing. The uninstaller lifts the lock before removing the files, so proper removal still works, and
  an administrator can always recover with `icacls "%LOCALAPPDATA%\Programs\Apna Billing" /reset /T /C`. It is not
  unbreakable (an admin with elevation or another OS can override); it stops accidental and casual deletion. The
  admin app is left unprotected (it runs on your own PC). The lock is re-applied across updates and gone after
  uninstall.
* Uninstall removes exactly the installed files, shortcuts and entry; it never deletes `%APPDATA%\ApnaBilling`
  (bills, backups). Remove that folder by hand if a shop really wants everything gone.
* `tauri build` still makes Tauri's own NSIS setup (with `installer-hooks.nsh`) under `target/`; it is no longer
  given out.

### Code signing (recommended next step)
Unsigned executables trigger SmartScreen. With an OV/EV certificate, set `bundle > windows > certificateThumbprint`
(or a `signCommand`) in `tauri.conf.json`, and sign `engine\apna-billing-engine.exe` and the two `.dll` files in
`prepare.cjs` **before** the manifest is written (the shell checks hashes of the signed files).
