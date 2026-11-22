// Nightly backup of the license-server SQLite database (run by /etc/cron.d/apna-billing). Keeps the last 30.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const src = process.env.SQLITE_FILE || '/home/winteg-wave/data/license.db';
const dir = process.env.BACKUP_DIR || '/home/winteg-wave/backups';
const keep = 30;

fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `license-${new Date().toISOString().slice(0, 10)}.db`);
fs.rmSync(out, { force: true });
const db = new Database(src, { readonly: true, fileMustExist: true });
db.prepare('VACUUM INTO ?').run(out);
db.close();
const ok = new Database(out, { readonly: true }).pragma('integrity_check', { simple: true });
console.log(`${new Date().toISOString()} backup ${out}: ${ok}`);

const old = fs.readdirSync(dir).filter((f) => /^license-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(keep);
for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
