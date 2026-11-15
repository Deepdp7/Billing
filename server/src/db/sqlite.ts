import Database from 'better-sqlite3-multiple-ciphers';
import fs from 'fs';
import { runtimeOptions } from '../config/runtime.js';
import { loadNativeModule } from '../lib/native.js';

export type SqliteDatabase = Database.Database;

/**
 * SQLite with transparent encryption (SQLite3 Multiple Ciphers, ChaCha20-Poly1305). The packaged desktop app hands
 * the key to the engine at startup; the live database, pre-migration copies and backups are all encrypted with it,
 * so a backup restores on any Apna Billing installation but cannot be read or edited with ordinary SQLite tools.
 * Without a key (development, tests) databases are plain SQLite, exactly as before.
 */

const SQLITE_MAGIC = 'SQLite format 3\0';

export function databaseKey(): string | null {
  return runtimeOptions().dbKey || null;
}

function sqliteOptions(extra: Database.Options = {}): Database.Options {
  const binding = loadNativeModule<object>('better_sqlite3.node');
  return binding ? { ...extra, nativeBinding: binding as any } : extra;
}

/** True when the file is an unencrypted SQLite database (backups and databases from versions before 1.2). */
export function isPlainSqliteFile(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(16);
    return fs.readSync(fd, header, 0, 16, 0) === 16 && header.toString('latin1') === SQLITE_MAGIC;
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function applyKey(db: SqliteDatabase, key: string | null): void {
  if (!key) return;
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid database key');
  db.pragma(`key = '${key}'`);
}

/**
 * Open a database with the given key (null = unencrypted) and prove the key is right by reading the schema.
 * A wrong key fails here with "file is not a database" rather than later, half-way through a request.
 */
export function openDatabase(filePath: string, key: string | null, options: Database.Options = {}): SqliteDatabase {
  const db = new Database(filePath, sqliteOptions(options));
  try {
    applyKey(db, key);
    db.prepare('SELECT COUNT(*) FROM sqlite_master').get();
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

/** Key for an existing file: none for a plain SQLite file, otherwise this installation's key. */
export function keyForFile(filePath: string): string | null {
  return isPlainSqliteFile(filePath) ? null : databaseKey();
}

/** Open a backup (encrypted or from an older plain version) read-only. */
export function openBackupFile(filePath: string): SqliteDatabase {
  return openDatabase(filePath, keyForFile(filePath), { readonly: true, fileMustExist: true });
}

/** Value for `ATTACH DATABASE ? AS x KEY ?` (an empty key attaches a plain SQLite file to an encrypted database). */
export function attachKeyForFile(filePath: string): string {
  return keyForFile(filePath) || '';
}

function removeSidecars(filePath: string): void {
  for (const ext of ['-wal', '-shm', '-journal']) fs.rmSync(filePath + ext, { force: true });
}

/**
 * Encrypt a plain SQLite file in place. A copy of the original is kept until the encrypted file has opened and
 * passed an integrity check, so an interrupted run (power cut) is retried from the copy on the next start.
 */
export function encryptFileInPlace(filePath: string, key: string): void {
  const pending = `${filePath}.pre-encryption`;
  if (!fs.existsSync(pending)) {
    if (!isPlainSqliteFile(filePath)) return;
    const plain = new Database(filePath, sqliteOptions());
    try {
      plain.pragma('wal_checkpoint(TRUNCATE)');
      plain.pragma('journal_mode = DELETE');
    } finally {
      plain.close();
    }
    removeSidecars(filePath);
    fs.copyFileSync(filePath, `${pending}.tmp`);
    fs.renameSync(`${pending}.tmp`, pending);
  } else {
    // A previous attempt did not finish: start again from the untouched original.
    removeSidecars(filePath);
    fs.copyFileSync(pending, filePath);
  }

  const db = new Database(filePath, sqliteOptions());
  try {
    db.pragma(`rekey = '${key}'`);
  } finally {
    db.close();
  }
  const check = openDatabase(filePath, key);
  try {
    const integrity = check.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`integrity check after encryption: ${integrity}`);
  } catch (err) {
    check.close();
    fs.copyFileSync(pending, filePath);
    fs.rmSync(pending, { force: true });
    throw err;
  }
  check.close();
  fs.rmSync(pending, { force: true });
}

/**
 * Before opening the live database: if this installation has a key and the database is still plain SQLite (created
 * by a version before 1.2, or an unfinished earlier attempt), encrypt it once. A new database is created encrypted.
 */
export function ensureDatabaseEncrypted(filePath: string): void {
  const key = databaseKey();
  if (!key) return;
  const pending = fs.existsSync(`${filePath}.pre-encryption`);
  if (!pending && (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0 || !isPlainSqliteFile(filePath))) return;
  console.log('[Database] Encrypting the local database (one-time upgrade)…');
  encryptFileInPlace(filePath, key);
  console.log('[Database] Local database encrypted');
}
