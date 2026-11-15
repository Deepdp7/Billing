import fs from 'fs';
import https from 'https';
import { config } from './config.js';
import { createApp } from './app.js';
import { knex } from './db.js';
import { migrateLatest } from './migrations.js';
import { closeAllStreams } from './realtime.js';

async function main() {
  // Fail fast if the signing key is missing or not Ed25519.
  void config.signingKeyPem;
  await migrateLatest(knex);
  const admins = await knex('admin_users').count({ c: '*' });
  if (Number(admins[0].c) === 0) {
    console.warn('[license-server] No admin users yet. Create one with: npm run admin:create -- <email> <name> <password>');
  }
  const app = createApp();
  const tls = config.tlsCertFile && config.tlsKeyFile;
  const server = tls
    ? https.createServer({ cert: fs.readFileSync(config.tlsCertFile), key: fs.readFileSync(config.tlsKeyFile) }, app)
    : app.listen(config.port, config.host);
  if (tls) server.listen(config.port, config.host);
  server.on('listening', () => {
    const db = config.databaseUrl ? 'PostgreSQL' : `SQLite ${config.sqliteFile}`;
    console.log(`License server listening on ${tls ? 'https' : 'http'}://${config.host}:${config.port} (${db})`);
  });
  // Live push streams never end on their own; close them so a restart (pm2/systemd/tsx watch) is not held up.
  // Desktops reconnect automatically.
  const shutdown = () => {
    closeAllStreams();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[license-server] failed to start:', err);
  process.exit(1);
});
