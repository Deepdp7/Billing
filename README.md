# Apna Billing

All-in-one business billing & management platform.

## Install

```bash
npm run install:all
```

## Local development (three separate terminals)

Each process runs alone — do not start license from Admin or the app.

| Terminal | Command | What it runs |
|---|---|---|
| 1 | `npm run dev:license` | License API on [http://127.0.0.1:7000](http://127.0.0.1:7000) |
| 2 | `npm run dev:admin` | Admin desktop window (+ panel on :3100). Needs license already up. |
| 3 | `npm run dev:app` | Customer billing desktop app (local engine + UI) |

Start **license first**, then Admin and/or the app.

### Browser-only UI (optional)

```bash
npm run dev:admin:web   # admin panel at http://127.0.0.1:3100 (still needs license on :7000)
npm run dev             # local API :5000 + web client :3000 (demo; licensing not enforced)
```

## Other root scripts

| Command | Description |
|---|---|
| `npm run seed` | Seed demo SQLite data |
| `npm run test` | Server, native, license-server, and E2E tests |
| `npm run build` / `npm run build:app` | Desktop installer build |
| `npm run build:license` | Build license server + admin panel for deploy |

## Project layout

| Folder | What it is |
|---|---|
| `server/` | Local API + SQLite (inside the desktop app) |
| `client/` | Billing UI |
| `tauri/` | Customer desktop shell |
| `license-server/` | Central license API |
| `admin-panel/` | Owner admin UI |
| `admin-tauri/` | Admin desktop shell |
| `native/apna-core/` | Licensing core (Rust) |

- Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Desktop packaging: [docs/DESKTOP_ARCHITECTURE.md](docs/DESKTOP_ARCHITECTURE.md)
- Status / what is tested: [docs/COMPLETION_REPORT.md](docs/COMPLETION_REPORT.md)
