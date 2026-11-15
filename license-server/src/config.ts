import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

function readKey(): string {
  if (process.env.LICENSE_SIGNING_PRIVATE_KEY) return process.env.LICENSE_SIGNING_PRIVATE_KEY.replace(/\\n/g, '\n');
  const file = process.env.LICENSE_SIGNING_PRIVATE_KEY_FILE || path.resolve(process.cwd(), 'keys', 'signing-private.pem');
  if (!fs.existsSync(file)) {
    throw new Error(`License signing key not found. Set LICENSE_SIGNING_PRIVATE_KEY(_FILE) or run "npm run keys:generate". Looked in: ${file}`);
  }
  return fs.readFileSync(file, 'utf8');
}

export const config = {
  isProduction,
  port: parseInt(process.env.PORT || '7000', 10),
  host: process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1'),
  // PostgreSQL in production: postgres://user:pass@host:5432/db. SQLite file for local development/tests.
  databaseUrl: process.env.DATABASE_URL || '',
  sqliteFile: process.env.SQLITE_FILE || path.resolve(process.cwd(), 'data', 'license.db'),
  // A single-server install may keep its own SQLite file instead of PostgreSQL, but must ask for it explicitly.
  allowSqliteInProduction: process.env.DB_CLIENT === 'sqlite',
  // Serve HTTPS directly (e.g. a self-signed certificate pinned in the desktop app) when both files are given.
  tlsCertFile: process.env.TLS_CERT_FILE || '',
  tlsKeyFile: process.env.TLS_KEY_FILE || '',
  // Signed desktop-app updates (latest.json + installers), served at /updates/.
  updatesDir: process.env.UPDATES_DIR || path.resolve(process.cwd(), 'updates'),
  // Public half of the update-signing key (same as the desktop app's). Uploaded installers must verify against it.
  updaterPublicKeyFile: process.env.UPDATER_PUBLIC_KEY_FILE || path.resolve(process.cwd(), 'keys', 'updater.pub'),
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_MB || '400', 10) * 1024 * 1024,
  get signingKeyPem() {
    return readKey();
  },
  adminSessionHours: parseInt(process.env.ADMIN_SESSION_HOURS || '12', 10),
  trustProxy: process.env.TRUST_PROXY === '1',
  adminPanelDir: process.env.ADMIN_PANEL_DIR || path.resolve(process.cwd(), '..', 'admin-panel', 'dist'),
  corsOrigins: (process.env.ADMIN_CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};
