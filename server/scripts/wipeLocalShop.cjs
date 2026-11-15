/**
 * One-shot: clear leftover shop rows so this computer can sign up again.
 * Usage: node scripts/wipeLocalShop.cjs
 */
const Database = require('better-sqlite3-multiple-ciphers');
const path = require('path');
const os = require('os');

const dbPath = process.env.APNA_DB
  || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ApnaBilling', 'data', 'apna_billing.db');

const db = new Database(dbPath);
const keep = new Set(['schema_migrations', 'plans', 'license_state']);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();

db.pragma('foreign_keys = OFF');
const run = db.transaction(() => {
  for (const { name } of tables) {
    if (keep.has(name) || !/^[A-Za-z0-9_]+$/.test(name)) continue;
    db.prepare(`DELETE FROM "${name}"`).run();
  }
  db.prepare(`
    UPDATE license_state
    SET installation_id = NULL, installation_secret = NULL, license_token = NULL,
        last_sync_at = NULL, last_sync_error = NULL, max_seen_time = NULL,
        notices_json = '[]', update_json = NULL, updated_at = datetime('now')
    WHERE id = 1
  `).run();
});
run();
db.pragma('foreign_keys = ON');
const businesses = db.prepare('SELECT COUNT(*) AS c FROM businesses').get().c;
const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
console.log(`Wiped ${dbPath}`);
console.log(`businesses=${businesses} users=${users}`);
db.close();
