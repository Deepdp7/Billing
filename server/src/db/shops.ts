import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AsyncLocalStorage, AsyncResource } from 'async_hooks';
import { config } from '../config/index.js';
import { runMigrations } from './migrations.js';
import { databaseKey, ensureDatabaseEncrypted, openDatabase, SqliteDatabase } from './sqlite.js';

/**
 * Several businesses on one computer, each in its own encrypted database file (like company files in Tally): a
 * restaurant and a service shop never share a table, a backup, an erase or a licence.
 *
 *   data/apna_billing.db + data/backups        the first business ("main", where it always was)
 *   data/shops/<id>/apna_billing.db + backups  every business added later
 *   data/shops.json                            the list (names for the sign-in screen) and the last one used
 *
 * Which file a piece of code uses is decided per request: the signed-in user's token names its business, and
 * everything that request does (including work that continues after an await) uses that file. Background work
 * (licence checks, scheduled backups) runs for the business in use ("active").
 */

export interface ShopRecord {
  id: string;
  name: string | null;
  category: string | null;
  ownerEmail: string | null;
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface ShopHandle {
  id: string;
  db: SqliteDatabase;
  dbPath: string;
  backupDir: string;
  /** Folder for this business's own small files */
  dir: string;
}

const MAIN = 'main';
const registryFile = () => path.join(config.dataDir, 'shops.json');
const handles = new Map<string, ShopHandle>();
const scope = new AsyncLocalStorage<ShopHandle>();
let registry: { active: string; shops: ShopRecord[] } = { active: MAIN, shops: [] };
let activeHandle: ShopHandle;
const activeListeners: Array<(id: string) => void> = [];
let openHook: ((db: SqliteDatabase) => void) | null = null;

/** Runs for every business file as it opens, and for those already open (sync's change capture) */
export function onShopOpen(hook: (db: SqliteDatabase) => void) {
  openHook = hook;
  for (const h of handles.values()) hook(h.db);
}

function paths(id: string) {
  if (id === MAIN) return { dbPath: config.dbPath, backupDir: config.backupDir, dir: path.dirname(config.dbPath) };
  if (!/^[a-z0-9-]{6,40}$/.test(id)) throw new Error(`Invalid business file id ${id}`);
  const dir = path.join(config.dataDir, 'shops', id);
  return { dbPath: path.join(dir, 'apna_billing.db'), backupDir: path.join(dir, 'backups'), dir };
}

function saveRegistry() {
  const tmp = `${registryFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2));
  fs.renameSync(tmp, registryFile());
}

function loadRegistry() {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryFile(), 'utf8'));
    if (Array.isArray(parsed?.shops)) registry = { active: String(parsed.active || MAIN), shops: parsed.shops };
  } catch { /* first start of a version with several businesses: just the main one */ }
  if (!registry.shops.some((s) => s.id === MAIN)) {
    registry.shops.unshift({ id: MAIN, name: null, category: null, ownerEmail: null, createdAt: new Date().toISOString(), lastOpenedAt: null });
  }
  // A business whose file is gone (deleted by hand) is dropped from the list
  registry.shops = registry.shops.filter((s) => s.id === MAIN || fs.existsSync(paths(s.id).dbPath));
  if (!registry.shops.some((s) => s.id === registry.active)) registry.active = MAIN;
}

/** Opens (once) the database of a business: encrypted, migrated to the current version */
export function openShop(id: string): ShopHandle {
  const open = handles.get(id);
  if (open) return open;
  const p = paths(id);
  fs.mkdirSync(path.dirname(p.dbPath), { recursive: true });
  ensureDatabaseEncrypted(p.dbPath);
  const db = openDatabase(p.dbPath, databaseKey());
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  // A larger page cache (16 MB) and temporary sorting in memory: searches and reports read the disk less
  db.pragma('cache_size = -16000');
  db.pragma('temp_store = MEMORY');
  const result = runMigrations(db, {
    backupDir: p.backupDir,
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
  openHook?.(db);
  console.log(`[Database] SQLite ready at ${p.dbPath} (schema v${result.to}${databaseKey() ? ', encrypted' : ''})`);
  const handle: ShopHandle = { id, db, ...p };
  handles.set(id, handle);
  refreshRecord(handle);
  return handle;
}

/** The business the current request (or background job) works on */
export function currentShop(): ShopHandle {
  return scope.getStore() ?? activeHandle;
}

export function currentShopId(): string {
  return currentShop().id;
}

export function activeShopId(): string {
  return activeHandle.id;
}

/** Runs `fn` (and everything it continues with after awaits) on the given business's database */
export function runInShop<T>(id: string, fn: () => T): T {
  return scope.run(openShop(id), fn);
}

/** A callback run later by an event emitter keeps the business it was created for */
export function bindToShop<F extends (...args: any[]) => any>(fn: F): F {
  return AsyncResource.bind(fn) as F;
}

/** Every business file on this computer, set up or not */
export function allShopIds(): string[] {
  return registry.shops.map((s) => s.id);
}

export function shopExists(id: string): boolean {
  return registry.shops.some((s) => s.id === id);
}

function hasBusiness(h: ShopHandle): boolean {
  return (h.db.prepare('SELECT COUNT(*) AS c FROM businesses').get() as { c: number }).c > 0;
}

/** Takes the business name, category and owner email from its database into the list */
export function refreshRecord(h: ShopHandle) {
  const rec = registry.shops.find((s) => s.id === h.id);
  if (!rec) return;
  const row = h.db.prepare(`SELECT b.name, b.category,
      (SELECT u.email FROM users u WHERE u.business_id = b.id AND u.role = 'BUSINESS_OWNER' ORDER BY u.created_at LIMIT 1) AS owner
    FROM businesses b ORDER BY b.created_at LIMIT 1`).get() as { name: string; category: string; owner: string | null } | undefined;
  const next = { name: row?.name ?? null, category: row?.category ?? null, ownerEmail: row?.owner ?? null };
  if (rec.name !== next.name || rec.category !== next.category || rec.ownerEmail !== next.ownerEmail) {
    Object.assign(rec, next);
    saveRegistry();
  }
}

/** The businesses on this computer that are set up (an erased or never-used file is not listed) */
export function listShops(): ShopRecord[] {
  for (const h of handles.values()) refreshRecord(h);
  return registry.shops
    .filter((s) => s.name)
    .sort((a, b) => String(b.lastOpenedAt || b.createdAt).localeCompare(String(a.lastOpenedAt || a.createdAt)));
}

/**
 * The file a new business is set up in: the one in use when it is still empty (first start), otherwise any empty
 * one (a business that was erased), otherwise a new file.
 */
export function shopForNewBusiness(): string {
  if (!hasBusiness(currentShop())) return currentShop().id;
  for (const s of registry.shops) {
    if (!s.name && !hasBusiness(openShop(s.id))) return s.id;
  }
  const id = crypto.randomUUID().slice(0, 13);
  registry.shops.push({ id, name: null, category: null, ownerEmail: null, createdAt: new Date().toISOString(), lastOpenedAt: null });
  saveRegistry();
  openShop(id);
  return id;
}

/** Every business with a user signed in by this email (sign-in, forgot password) */
export function shopsWithUser(email: string): string[] {
  const found: string[] = [];
  for (const s of registry.shops) {
    const h = openShop(s.id);
    if (h.db.prepare('SELECT 1 FROM users WHERE LOWER(email) = LOWER(?)').get(email)) found.push(s.id);
  }
  return found;
}

/** The business now in use on this computer: background work moves to it, and the next start opens it */
export function setActiveShop(id: string) {
  const rec = registry.shops.find((s) => s.id === id);
  if (!rec) return;
  rec.lastOpenedAt = new Date().toISOString();
  const changed = registry.active !== id;
  registry.active = id;
  saveRegistry();
  if (changed) {
    activeHandle = openShop(id);
    for (const l of activeListeners) l(id);
  }
}

export function onActiveShopChanged(listener: (id: string) => void) {
  activeListeners.push(listener);
}

export function initShops(): ShopHandle {
  loadRegistry();
  try {
    activeHandle = openShop(registry.active);
  } catch (err) {
    if (registry.active === MAIN) throw err;
    console.error(`[Database] could not open business ${registry.active}; opening the main one`, err);
    registry.active = MAIN;
    activeHandle = openShop(MAIN);
  }
  saveRegistry();
  return activeHandle;
}
