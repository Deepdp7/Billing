# Apna Billing — how to run it (simple version)

## What runs where

| Piece | Where | Address |
|---|---|---|
| **Admin Panel** (you control customers, licenses, features, updates) | Your VPS, folder `/home/apna-billing` | **https://72.61.231.155:7443** |
| **License server** (the app talks to it) | Same VPS, same address | — |
| **Billing app** (your clients use it) | Each client's Windows PC | installed from `releases\ApnaBilling-x.y.z-setup.exe` |

Apna Billing runs as its own service (`apna-license`) on port **7443** with its own database. Other sites on this VPS
(nginx + their Node apps) are unchanged. Opening bare `http://72.61.231.155/` used to hit a different app and show
**Cannot GET /** — nginx now redirects that root URL to the Admin Panel on port 7443. Always prefer the full address
with `:7443`.

**Admin Panel login:** `aritradatt39@gmail.com` with your Admin Panel password.

The first time you open https://72.61.231.155:7443 the browser says the connection is "not private". That is expected:
there is no domain, so the server uses its own certificate. Click **Advanced → Continue**. The billing app itself does
not show this. It has the certificate built in and trusts only your server.

## Pushing an update (from the Admin Panel)

1. Make your changes (screens, backend, database: anything in the billing app).
2. On your PC, in the `Billing` folder, run **`npm run build:update`**.
   It raises the version by one (for example 1.1.4 → 1.1.5) and makes two files in `releases\`:
   `ApnaBilling-1.1.5-setup.exe` and `ApnaBilling-1.1.5-setup.exe.sig`.
3. Admin Panel → **App Updates** → drag both files in (or click to choose them).
4. Write what's new, tick **Required update** if everyone must install it, click **Upload & publish**, then type your
   Admin Panel password to confirm.

What happens next:
- Open apps show the "Update available" popup within a second or two. Closed apps show it the next time they open.
- "Install now" downloads it, checks the signature, installs it and restarts the app. Database changes are applied
  automatically on first start, after a backup.
- A required update has no "Later" button.
- The files are stored on the VPS in `/home/apna-billing/updates`.

The **App Updates** page also lets you:
- **Make required / Make optional** for the version that is live.
- **Pause**: stop offering a version if it has a problem. **Resume** brings it back.
- See **clients by version**: how many devices are on each version, and how many have the app open right now.
- Look at the **history** and delete old versions.

Every one of these asks for your password again. Only the OWNER role can see the page. The server refuses any file
that was not built and signed on your PC with your update key, so a wrong file can never reach clients.

## Other commands (run in `C:\Users\ARITRA\Desktop\Billing`)

| You want to… | Run | It asks for |
|---|---|---|
| Make the installer to give to a new client (same version) | `npm run build` | nothing |
| Build the next version for the App Updates page | `npm run build:update` | nothing |
| Build, upload and publish in one step, without the Admin Panel | `npm run release -- --notes "What's new"` (add `--required` if everyone must install it) | VPS password, Admin Panel password |
| Update the Admin Panel / license server on the VPS | `npm run deploy:server` | VPS password |

The newest installer to give new clients is always in `releases\`.

## Giving the app to a client

1. Send them `releases\ApnaBilling-<newest version>-setup.exe`.
2. They install it, create their shop, and press **Start free trial** (or enter a license key you issued).
3. You see them in the Admin Panel immediately, and everything you change there reaches their app instantly.

## Internet is required

When a client's PC loses the internet, the app shows "No internet connection" over the screen. Nothing on the screen
is lost (an open bill stays as it was). The message disappears by itself when the internet comes back. If only your
VPS is down but the client's internet works, the app keeps working, so a server problem does not stop every shop.

## Keep these safe (back them up, e.g. on a USB drive)

| File | Why |
|---|---|
| `C:\Users\ARITRA\.apna-billing\updater.key` | Signs updates. **Lose it and installed apps can never be updated again.** |
| `C:\Users\ARITRA\.apna-billing\data.key` | Encrypts every client's database. **Lose it and new versions cannot open clients' data.** Builds check it against `deploy\data-key.fingerprint`. |
| `license-server\keys\signing-private.pem` | Signs licenses. Also stored on the VPS in `/home/apna-billing/keys`. |
| `deploy\license-ca.crt` | Your server's public certificate (not secret, but every build needs it). |

The VPS backs up its license database every night to `/home/apna-billing/backups` (30 days kept).

## If something goes wrong on the VPS

```
ssh root@72.61.231.155
systemctl status apna-license          # is it running?
journalctl -u apna-license -n 50       # last 50 log lines
systemctl restart apna-license         # restart it
```
