import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';

// The packaged desktop app (APNA_EMBEDDED=1) never reads a .env file: one dropped next to the EXE must not be able
// to switch licensing off or change where data lives.
const embedded = process.env.APNA_EMBEDDED === '1';
if (!embedded) dotenv.config();

export const APP_NAME = 'ApnaBilling';
export const APP_VERSION = process.env.APNA_APP_VERSION || '1.1.0';

const isProduction = embedded || process.env.NODE_ENV === 'production';

/**
 * Resolve the per-installation data directory.
 * Production data never lives next to the executable, so reinstalling or upgrading the
 * application cannot overwrite customer data.
 *   Windows: %APPDATA%/ApnaBilling/data
 *   macOS:   ~/Library/Application Support/ApnaBilling/data
 *   Linux:   ~/.local/share/ApnaBilling/data
 */
function resolveDataDir(): string {
  if (process.env.APNA_DATA_DIR) return path.resolve(process.env.APNA_DATA_DIR);
  if (process.env.DB_PATH) return path.dirname(path.resolve(process.env.DB_PATH));
  if (!isProduction) return path.resolve(process.cwd(), 'data');

  let base: string;
  if (process.platform === 'win32') {
    base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (process.platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  }
  return path.join(base, APP_NAME, 'data');
}

const dataDir = resolveDataDir();
fs.mkdirSync(dataDir, { recursive: true });

/**
 * Each installation gets its own randomly generated JWT secret, stored in its data directory.
 * A hard-coded secret would let a token minted on one install be accepted by every other install.
 */
function resolveJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretPath = path.join(dataDir, '.jwt-secret');
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // first run
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}

const demoFlag = process.env.APNA_DEMO_MODE;

function resolveClientDistDir(): string {
  const candidates: string[] = [];
  if (process.env.APNA_CLIENT_DIST) candidates.push(path.resolve(process.env.APNA_CLIENT_DIST));
  // Normal: server/ and client/ are siblings; cwd is server/ or tauri/.
  candidates.push(path.resolve(process.cwd(), '..', 'client', 'dist'));
  candidates.push(path.resolve(process.cwd(), 'client', 'dist'));
  // Debug shell often starts with cwd = tauri/src-tauri.
  candidates.push(path.resolve(process.cwd(), '..', '..', 'client', 'dist'));
  // Absolute from this package (server/dist/config → ../../client/dist).
  candidates.push(path.resolve(__dirname, '..', '..', '..', 'client', 'dist'));
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return candidates[0];
}

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  // Bind to loopback only: the API must not be reachable from other machines on the shop network.
  host: process.env.HOST || '127.0.0.1',
  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  dataDir,
  dbPath: process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(dataDir, 'apna_billing.db'),
  backupDir: process.env.APNA_BACKUP_DIR ? path.resolve(process.env.APNA_BACKUP_DIR) : path.join(dataDir, 'backups'),
  isDev: !isProduction,
  // Demo businesses and quick-login accounts are only created when explicitly requested,
  // or in local development unless turned off.
  demoMode: !embedded && (demoFlag === '1' || (!isProduction && demoFlag !== '0')),
  // A desktop install hosts exactly one business; self-registration closes after first setup.
  singleTenant: embedded || (process.env.APNA_SINGLE_TENANT ? process.env.APNA_SINGLE_TENANT === '1' : isProduction),
  // Directory holding the built client (served by Express in production / desktop).
  // Prefer APNA_CLIENT_DIST (set by the Tauri shell). Fall back across likely repo layouts so a
  // wrong process.cwd() cannot leave the window on Express's blank "Cannot GET /".
  clientDistDir: resolveClientDistDir(),
  licensing: {
    serverUrl: (process.env.APNA_LICENSE_SERVER_URL || 'http://127.0.0.1:7000').replace(/\/$/, ''),
    // Set to '0' only for local development without a license server.
    enforce: embedded || (process.env.APNA_LICENSE_ENFORCE ? process.env.APNA_LICENSE_ENFORCE === '1' : isProduction),
    syncIntervalMs: parseInt(process.env.APNA_LICENSE_SYNC_MS || String(6 * 60 * 60 * 1000), 10),
  },
};
