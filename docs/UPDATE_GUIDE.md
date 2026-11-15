# Apna Billing: from code change to every client's PC

A to Z, in order. Run every command in a terminal opened in **`C:\Users\ARITRA\Desktop\Billing`**
(VS Code → **Terminal → New Terminal**).

---

## Easiest: Admin app → Updates & Releases (buttons, no commands)

Open the **Apna Billing Admin** app, sign in, and go to **Updates & Releases** (left menu, under *Control*). Everything
in this guide is on that one page, top to bottom:

| Part of the page | What you do | Same as |
|---|---|---|
| **Live now** | See what clients are offered; **Make required**, **Pause** / **Resume** | Part 4 below |
| **1 · Build the new version** | **Next update** (adds 1), then **Build client installer**. Or open the *Installer Studio* part: **Prepare the program** → **Open in Installer Studio** (press *Build installer* there) → **Sign the installer** | `npm run build:update` |
| **What is happening** | Live output of the build, with **Stop** | |
| **2 · Publish it to every client** | **Use version x.y.z** (the one you just built), write *What's new*, tick *Required* if needed, **Upload & publish**, confirm with your password | Part 4 below |
| **Clients by version**, **History** | Who has which version; publish or delete older uploads | |
| **Admin app (this app)** | Set the version, **Build Admin app installer** (or prepare + open in Installer Studio) | `npm run build:admin-app` |
| **Server (VPS)** | Type the VPS password, **Upload Admin Panel and licence server**; *Rarely needed*: **Reset update history…** | `npm run deploy:server` |

In a browser the page shows only the publishing parts (building needs the Admin app on your PC).

---|---|---|
| **Billing app (for clients)** | Set the version (**Next update** adds 1), then **Build client installer** | `python deploy/apna_vps.py build <version>` |
| | **1. Prepare the program** → **2. Open in Installer Studio** (press *Build installer* there) → **3. Sign the installer** | Making the installer in Installer Studio's own window |
| **Push an update to every client** | **Open App Updates** + **Show the 2 files** (by hand), or type *What's new* → **Build … and publish to all clients** | Part 4 below / `npm run release -- --notes "…"` |
| **Admin app (this app)** | Set the version, then **Build Admin app installer** (or prepare + open in Installer Studio) | `npm run build:admin-app` |
| **Server (VPS)** | **Upload Admin Panel and licence server** | `npm run deploy:server` |
| | **Reset update history…** (rarely) | `python deploy/apna_vps.py reset-updates` |

Type the **VPS password** at the top of the page when a button needs it; it's never saved. Publishing uses your
current Admin sign-in.

---|---|---|
| **1 · Client app** | Type the version (or press **+1**), then **Build client installer** | `python deploy/apna_vps.py build <version>` |
| | **1. Prepare the program** → **2. Open in Installer Studio** (press *Build installer* there) → **3. Sign the installer** | Making the installer in Installer Studio's own window |
| **2 · Push update to clients** | **Open Admin Panel** + **Show the 2 files to upload** | Part 4 below |
| | Type *What's new*, then **Build and publish to all clients** | `npm run release -- --notes "…"` |
| **3 · Admin app** | Type the version, then **Build admin app installer** (or prepare + open in Installer Studio) | `npm run build:admin-app` |
| **4 · Server (VPS)** | **Upload Admin Panel and licence server** | `npm run deploy:server` |
| | **Reset update history…** (rarely) | `python deploy/apna_vps.py reset-updates` |

Type the **VPS password** and **Admin Panel password** at the top only when a button needs them. They're never saved.

---

## The big picture

```
 Your PC                                  Your VPS (72.61.231.155:7443)           Client PCs
 ───────                                  ─────────────────────────────           ──────────
 change code
   │
 npm run build:update  ──► releases\ApnaBilling-x.y.z-setup.exe + .sig
   │
 Admin Panel ► App Updates ► Upload & publish ──► server keeps the file ──► popup "Update available"
                                                                              │
                                                                         Install now → app updates
                                                                         and restarts by itself
```

There are **three things** you can change, and each one goes out a different way:

| What you changed | Folders | How it reaches people |
|---|---|---|
| **The billing app** (screens, billing logic, reports, database) | `client\`, `server\`, `tauri\`, `native\` | Build an update, then publish it in **App Updates** (Part 3) |
| **Admin Panel / licence server** (what *you* see and control) | `admin-panel\`, `license-server\` | `npm run deploy:server` (Part 5). Clients do nothing |
| **The admin desktop window itself** | `admin-tauri\` | `npm run build:admin-app`, then reinstall it on your PC (Part 6) |

Changing licences, features, prices or customers **inside** the Admin Panel needs no build at all: it reaches the
clients' apps instantly.

---

## Part 0: One-time setup (only on a new PC)

Skip this part if your PC already builds the app.

1. Install these:
   - **Node.js** (LTS)
   - **Python 3**, then run `pip install paramiko pillow numpy`
   - **Rust**, from rustup.rs (the default MSVC option)
   - **Visual Studio** with **Desktop development with C++**
2. Install all project packages:
   ```
   npm run install:all
   ```
3. Install **Installer Studio**, which makes the setup files:
   - Open `C:\Users\ARITRA\Desktop\InstallerStudio\src-tauri\target\release\bundle\nsis`
   - Double-click **`Installer Studio_1.0.0_x64-setup.exe`** → **Next** → **Install** → **Finish**.
     If Windows says "Windows protected your PC", click **More info → Run anyway**.
4. Check that these key files are on the PC (copy them from your USB backup if not):

   | File | Without it |
   |---|---|
   | `C:\Users\ARITRA\.apna-billing\updater.key` | You can never update installed apps again |
   | `C:\Users\ARITRA\.apna-billing\data.key` | New versions cannot open clients' data |
   | `deploy\license-ca.crt` | The build stops |

---

## Part 1: Make your change and try it

1. Change the code.
2. Try it on your PC:
   ```
   npm run dev:app
   ```
   This opens the billing app in test mode. Close it when you're happy.

---

## Part 2: Choose the version number

Versions look like **1.0.0** and must always **go up**. Installed apps ignore a lower or equal number.

| Kind of change | Example | Command in Part 3 |
|---|---|---|
| Small fix (normal case) | 1.0.0 → 1.0.1 | `npm run build:update` (adds 1 by itself) |
| Bigger release, you pick the number | 1.0.5 → 1.1.0 | `python deploy/apna_vps.py build 1.1.0` |
| Small update, **number stays the same** | 1.0.1 → 1.0.1+1 → 1.0.1+2 | Admin app: **Update 1.0.1 again**, or `python deploy/apna_vps.py build 1.0.1+1` |

**Same number, new update (`1.0.1+N`).** Clients get the changes like any update, but the app, the installer and
Windows' installed-apps list still say **1.0.1**. Only the update pop-up says "1.0.1 (update 2)", and the installer
file is named `ApnaBilling-1.0.1+2-setup.exe`. Order: 1.0.1 < 1.0.1+1 < 1.0.1+2 < 1.0.2. The next normal version
(1.0.2) drops the `+N`.

> Apps from before this feature (1.0.0, 1.0.1 built before November 2026) only understand normal numbers. Send
> them one normal update first (e.g. 1.0.2). After that, `+N` updates reach everyone.

---

## Part 3: Build the update

1. Run the command you picked in Part 2, for example:
   ```
   npm run build:update
   ```
2. Wait a few minutes until you see **`Installer ready: …`**.
3. Open the **`releases`** folder. You now have two files:
   - `ApnaBilling-1.0.1-setup.exe`: the app (also the installer for new clients)
   - `ApnaBilling-1.0.1-setup.exe.sig`: its signature (proves the file came from you)

> **Test it first (recommended).** Double-click the new `setup.exe` on your own PC, check that it opens and works, and
> only then publish it.

---

## Part 4: Push it to every client

1. Open the **Admin Panel**: the Admin desktop app, or **https://72.61.231.155:7443** in a browser (if the browser
   warns "not private", click **Advanced → Continue**; that's expected).
2. Log in with `aritradatt39@gmail.com` and your Admin Panel password.
3. Go to **App Updates**.
4. Drag **both** files from `releases` (the `.exe` and the `.sig`) into the box, or click the box to choose them.
5. Check the **Version** (it fills in by itself).
6. Write **What's new**. Clients see this text in the popup.
7. Tick **Required update** only if everyone *must* install it (no "Later" button).
8. Click **Upload & publish**, then type your password to confirm.

**What clients see:**
- Apps that are open get the popup **"Update available"** within a few seconds. Closed apps show it the next time
  they open.
- They click **Install now**. The app downloads the update, checks the signature, installs, and **restarts by itself**.
- Their data stays on their PC and is backed up before any database change.
- If they click **Later**, they're asked again the next time the app opens.

**Watch it on the App Updates page:**
- **Clients by version**: how many PCs are on each version, and how many are open right now.
- **Pause**: stop offering an update that has a problem. **Resume** brings it back.
- **Make required / Make optional**: change your mind after publishing.
- **History**: old versions, which you can delete.

**Shortcut:** steps 1 to 8 in one command, without opening the Admin Panel:
```
npm run release -- --notes "What's new"
```
Add `--required` to make it required. It asks for your VPS password and your Admin Panel password.

---

## Going back to an older version (rollback)

If a version has a problem, you can send every client back to an earlier one. It works like an update: each app
shows the popup, and **Install now** puts the older version back. Each computer keeps its data.

1. **Updates & Releases → History**: next to the older version press **Roll back to this**.
   If that version was never uploaded, use **Or go back to an older version → Use x.y.z** in *2 · Publish it to
   every client* (the Admin app finds it in the releases folder), then **Upload & publish**.
2. The confirmation says it is a rollback. Type your password and press **Roll back all clients**.
3. **Live now** shows the older version with **ROLLED_BACK**. Publishing a newer version later ends the rollback.

Only roll back if the newer version did not change the database (new tables or columns): the older version may not
work with them. Rollback needs apps from version 1.0.2 on (older apps only accept newer versions).

---

## Part 5: Update the Admin Panel / licence server (only when you changed them)

```
npm run deploy:server
```
It asks for your VPS password and restarts the server in a few seconds. The Admin Panel (browser and Admin app)
shows the new version straight away, and clients don't need to do anything.

---

## Part 6: Admin desktop app (only when you changed `admin-tauri\`)

1. Raise `"version"` in `admin-tauri\src-tauri\tauri.conf.json` (for example `1.1.0` → `1.1.1`).
2. Run:
   ```
   npm run build:admin-app
   ```
3. Install `releases\ApnaBillingAdmin-<version>-setup.exe` on **your own PC only**. It replaces the old copy.
   Never give it to clients.

---

## Part 7: Give the app to a new client

1. Send them the newest `releases\ApnaBilling-<version>-setup.exe`.
   To make it again without changing the version, run `npm run build`.
2. They double-click it → **Next** → **Install**, create their shop, then press **Start free trial** or enter the
   licence key you gave them.
3. They appear in the Admin Panel straight away, and they get every future update through the popup.

---

## Quick reference

| I want to… | Do this |
|---|---|
| Send a fix to all clients | `npm run build:update` → App Updates → drop `.exe` + `.sig` → **Upload & publish** |
| Do the same in one step | `npm run release -- --notes "What's new"` |
| Make a setup for a new client | `npm run build` → send `releases\ApnaBilling-<version>-setup.exe` |
| Change the Admin Panel / server | `npm run deploy:server` |
| Rebuild my Admin app | Raise its version, then `npm run build:admin-app` |
| Stop a bad update | App Updates → **Pause** |
| Start version numbers again lower (only when **no** client has the app) | `python deploy/apna_vps.py reset-updates`, then `python deploy/apna_vps.py build 1.0.0` |

## When something goes wrong

| Problem | Fix |
|---|---|
| "Installer Studio not found" | Install it (Part 0, step 3) |
| "Apps only install versions newer than …" | Build a higher number (Part 2) |
| Upload says the signature is wrong | Use the `.sig` made **together with** that same `.exe`, and build on the PC that has `updater.key` |
| A client never gets the popup | Their PC needs the internet. Check **Clients by version**, and ask them to close and reopen the app |
| Server down | `ssh root@72.61.231.155`, then `systemctl restart apna-license` (logs: `journalctl -u apna-license -n 50`) |

**Never** lose `updater.key` or `data.key` (keep a USB copy), and **never** change the hidden App ID in
`deploy\installer-studio\*.isproj`.
