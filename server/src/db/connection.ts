import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { SCHEMA_SQL } from './schema.js';

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db: Database.Database = new Database(config.dbPath, {
  // verbose: config.isDev ? console.log : undefined,
});

// Configure SQLite for high performance and integrity
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Run schema initialization
db.exec(SCHEMA_SQL);

// Safe column migrations
try {
  db.exec("ALTER TABLE customers ADD COLUMN loyalty_points INTEGER DEFAULT 0;");
} catch {}
try {
  db.exec("ALTER TABLE invoices ADD COLUMN loyalty_points_redeemed INTEGER DEFAULT 0;");
} catch {}
try {
  db.exec("ALTER TABLE invoices ADD COLUMN loyalty_points_earned INTEGER DEFAULT 0;");
} catch {}
try {
  db.exec("ALTER TABLE customers ADD COLUMN customer_type TEXT DEFAULT 'RETAIL';");
} catch {}
try {
  db.exec("ALTER TABLE customers ADD COLUMN credit_days INTEGER DEFAULT 30;");
} catch {}

console.log(`[Database] SQLite connected & initialized at: ${config.dbPath}`);

