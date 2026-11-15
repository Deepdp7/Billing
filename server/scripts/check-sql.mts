/**
 * Compile every SQL statement in the engine's source against a freshly migrated database. SQLite rejects unknown
 * tables and columns at prepare time, so a statement that could never run (a typo, a column that was renamed) fails
 * here instead of in a customer's shop. Run: npx tsx scripts/check-sql.mts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apna-sql-'));
process.env.NODE_ENV = 'test';
process.env.APNA_DATA_DIR = dir;
process.env.DB_PATH = path.join(dir, 'check.db');
process.env.APNA_DEMO_MODE = '0';
process.env.APNA_LICENSE_ENFORCE = '0';
process.env.JWT_SECRET = 'x'.repeat(64);

const { db } = await import('../src/db/connection.js');

const SRC = path.resolve(import.meta.dirname, '../src');
const files: string[] = [];
const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p);
  else if (p.endsWith('.ts') && !p.includes(`${path.sep}db${path.sep}`)) files.push(p);
});
walk(SRC);

// A ${...} inside SQL is a WHERE fragment, a column list or a value; stand in something that keeps the SQL valid
function fill(sql: string): string {
  return sql.replace(/\$\{([^}]*)\}/g, (_m, expr: string, offset: number) => {
    const before = sql.slice(0, offset).trimEnd().toUpperCase();
    if (/(WHERE|AND|OR|\()$/.test(before) || /join\(' AND '\)|where|cond/i.test(expr)) return '1=1';
    if (/ORDER BY$/.test(before)) return 'rowid';
    if (/(SET|,)$/.test(before) && /join/.test(expr)) return 'rowid = rowid';
    return '';
  });
}

let checked = 0;
let dynamic = 0;
const failures: string[] = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const re = /\.prepare(?:<[^>]*>)?\(\s*(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
  for (let m; (m = re.exec(text)); ) {
    const raw = m[1].slice(1, -1);
    const sql = fill(raw);
    if (!/\b(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(sql)) continue;
    checked++;
    try {
      db.prepare(sql);
    } catch (err: any) {
      // Table or column names chosen at run time (or a backup attached while restoring) cannot be checked here
      if (raw.includes('${') || raw.includes('restore_src.')) { dynamic++; checked--; continue; }
      const line = text.slice(0, m.index).split('\n').length;
      failures.push(`${path.relative(SRC, file)}:${line}  ${err.message}\n    ${sql.replace(/\s+/g, ' ').slice(0, 220)}`);
    }
  }
}
console.log(`${checked} statements checked, ${failures.length} failed (${dynamic} built at run time, skipped)`);
for (const f of failures) console.log(`\n${f}`);
db.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failures.length ? 1 : 0);
