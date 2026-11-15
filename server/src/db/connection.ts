import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { runMigrations } from './migrations.js';
import { databaseKey, ensureDatabaseEncrypted, openDatabase, SqliteDatabase } from './sqlite.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

ensureDatabaseEncrypted(config.dbPath);

export const db: SqliteDatabase = openDatabase(config.dbPath, databaseKey());

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const result = runMigrations(db, {
  backupDir: config.backupDir,
  onBackup: (filePath, fromVersion) => {
    const stat = fs.statSync(filePath);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    db.prepare(`
      INSERT INTO backup_history (id, file_name, file_path, size_bytes, sha256, kind, status, schema_version, notes)
      VALUES (?, ?, ?, ?, ?, 'PRE_MIGRATION', 'OK', ?, ?)
    `).run(crypto.randomUUID(), path.basename(filePath), filePath, stat.size, sha256, fromVersion,
      `Automatic backup before upgrading schema from v${fromVersion}`);
  },
});

console.log(`[Database] SQLite ready at ${config.dbPath} (schema v${result.to}${databaseKey() ? ', encrypted' : ''})`);
