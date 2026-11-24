// Copies of the license-server SQLite database on the VPS itself (run by /etc/cron.d/apna-billing):
//   node backup-db.cjs          nightly copy, the last 30 kept
//   node backup-db.cjs hourly   hourly copy, the last 48 kept
// These help after a mistake. When the VPS itself is lost, the owner's off-server backups (Admin app > Backups &
// Recovery) are what bring it back (deploy/apna_vps.py restore).
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const base = path.resolve(__dirname, '..');
const src = process.env.SQLITE_FILE || path.join(base, 'data', 'license.db');
const dir = process.env.BACKUP_DIR || path.join(base, 'backups');
const hourly = process.argv[2] === 'hourly';
const keep = hourly ? 48 : 30;
const prefix = hourly ? 'license-hourly-' : 'license-';
const pattern = hourly ? /^license-hourly-\d{4}-\d{2}-\d{2}-\d{2}\.db$/ : /^license-\d{4}-\d{2}-\d{2}\.db$/;

fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString();
const out = path.join(dir, `${prefix}${hourly ? `${stamp.slice(0, 10)}-${stamp.slice(11, 13)}` : stamp.slice(0, 10)}.db`);
fs.rmSync(out, { force: true });
const db = new Database(src, { readonly: true, fileMustExist: true });
db.prepare('VACUUM INTO ?').run(out);
db.close();
const ok = new Database(out, { readonly: true }).pragma('integrity_check', { simple: true });
console.log(`${stamp} backup ${out}: ${ok}`);

const old = fs.readdirSync(dir).filter((f) => pattern.test(f)).sort().reverse().slice(keep);
for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
