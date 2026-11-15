import crypto from 'crypto';
import { EventEmitter } from 'events';
import type { SqliteDatabase } from '../db/sqlite.js';
import { db } from '../db/connection.js';
import { config } from '../config/index.js';
import { currentShop, currentShopId, onShopOpen, refreshRecord, runInShop, shopExists } from '../db/shops.js';
import { getCredentials, licenseServerUrl } from '../licensing/licenseClient.js';
import { emitLicenseChanged } from '../licensing/events.js';
import { createBackup } from '../services/backupService.js';

/**
 * Sync of everything a shop does between all computers signed in to the same account (see license-server
 * routes/sync.ts for the server's side).
 *
 * Capture: triggers on every shared table note each changed row in sync_outbox (and each change of a stock / balance
 * counter in sync_deltas). Nothing in the features themselves has to know about sync.
 * Send: the current copy of each noted row (or "deleted"), and the counter changes, shortly after every change.
 * Receive: the server tells this computer over the live link; it fetches what changed since it last asked and writes
 * it with the triggers quiet, then tells the open window which tables changed (the screens reload those lists).
 *
 * Rules: the latest copy of a row wins, except while this computer still has its own unsent change of that row.
 * Counters move only by changes ("-1"), so two computers selling the same item at the same moment both count. A row
 * that would break a unique rule (two computers made the same SKU) is settled the same way on every computer.
 */

export const syncEvents = new EventEmitter();
syncEvents.setMaxListeners(100);

/** Tables about this computer itself (licence, backups made here, printer, …): never shared */
const LOCAL_TABLES = new Set(['schema_migrations', 'license_state', 'account_sync', 'backup_history', 'feature_usage',
  'hardware_settings', 'system_settings', 'plans']);
/** Counters: shared as changes, never as values */
export const COUNTERS: Record<string, string[]> = {
  products: ['stock_quantity'],
  clothing_variants: ['stock_quantity'],
  customers: ['outstanding_balance_paise', 'loyalty_points'],
  suppliers: ['outstanding_balance_paise'],
};
/** Columns each computer keeps for itself */
const LOCAL_COLUMNS: Record<string, string[]> = { businesses: ['next_invoice_number'] };
/** Unique numbers that are renamed on a clash (kept both); other unique clashes keep one row */
const RENAME_ON_CLASH: Record<string, string> = { products: 'sku', invoices: 'invoice_number', purchase_orders: 'po_number' };
/** Unique rules that only hold for some rows (a partial index) */
const UNIQUE_ONLY_WHERE: Record<string, string> = { products: 'is_active = 1' };
/** Columns pointing at a user without a declared reference */
const USER_COLUMNS = ['created_by', 'user_id', 'cashier_id', 'performed_by', 'approved_by', 'received_by', 'opened_by', 'closed_by'];

const PUSH_ROWS = 1000;
const PUSH_DELTAS = 10000;
const PUSH_BYTES = 3 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

export function syncEnabled(): boolean {
  return config.licensing.enforce;
}

// ---------------------------------------------------------------- tables

interface TableInfo {
  name: string;
  cols: string[];
  pk: string[];
  pkSet: Set<string>;
  counters: string[];
  counterSet: Set<string>;
  local: Set<string>;
}

const tableCache = new WeakMap<object, Map<string, TableInfo>>();

function readTables(d: SqliteDatabase): Map<string, TableInfo> {
  const out = new Map<string, TableInfo>();
  const names = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'sync_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  for (const { name } of names) {
    if (LOCAL_TABLES.has(name) || !/^[a-z][a-z0-9_]*$/.test(name)) continue;
    const info = d.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string; pk: number }>;
    const pk = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    if (!pk.length) continue;
    const cols = info.map((c) => c.name);
    const counters = (COUNTERS[name] || []).filter((c) => cols.includes(c));
    out.set(name, { name, cols, pk, pkSet: new Set(pk), counters, counterSet: new Set(counters), local: new Set(LOCAL_COLUMNS[name] || []) });
  }
  return out;
}

function tables(d: SqliteDatabase = currentShop().db): Map<string, TableInfo> {
  let t = tableCache.get(d);
  if (!t) tableCache.set(d, (t = readTables(d)));
  return t;
}

const q = (c: string) => `"${c.replace(/"/g, '""')}"`;
const pkJson = (info: TableInfo, side: 'NEW' | 'OLD') => `json_array(${info.pk.map((c) => `${side}.${q(c)}`).join(', ')})`;
const pkWhere = (info: TableInfo) => info.pk.map((c) => `${q(c)} = ?`).join(' AND ');
const keyOf = (info: TableInfo, row: Record<string, unknown>) => JSON.stringify(info.pk.map((c) => row[c]));

const statements = new WeakMap<object, Map<string, any>>();
function stmt(sql: string) {
  const d = currentShop().db;
  let m = statements.get(d);
  if (!m) statements.set(d, (m = new Map()));
  let s = m.get(sql);
  if (!s) m.set(sql, (s = d.prepare(sql)));
  return s;
}

// ---------------------------------------------------------------- capture

function triggerSql(info: TableInfo): Record<string, string> {
  const t = info.name;
  const when = 'WHEN (SELECT applying FROM sync_ctl WHERE id = 1) = 0';
  const bump = 'UPDATE sync_ctl SET ver = ver + 1 WHERE id = 1;';
  const note = (side: 'NEW' | 'OLD') =>
    `INSERT OR REPLACE INTO sync_outbox (tbl, pk, ver) VALUES ('${t}', ${pkJson(info, side)}, (SELECT ver FROM sync_ctl WHERE id = 1));`;
  const deltas = info.counters.map((c) => `INSERT INTO sync_deltas (id, tbl, pk, col, delta, ver)
    SELECT lower(hex(randomblob(16))), '${t}', ${pkJson(info, 'NEW')}, '${c}', COALESCE(NEW.${q(c)}, 0) - COALESCE(OLD.${q(c)}, 0), (SELECT ver FROM sync_ctl WHERE id = 1)
    WHERE COALESCE(NEW.${q(c)}, 0) <> COALESCE(OLD.${q(c)}, 0) AND ${pkJson(info, 'NEW')} = ${pkJson(info, 'OLD')};`).join('\n  ');
  return {
    [`sync_i_${t}`]: `CREATE TRIGGER "sync_i_${t}" AFTER INSERT ON "${t}" ${when} BEGIN\n  ${bump}\n  ${note('NEW')}\nEND`,
    [`sync_u_${t}`]: `CREATE TRIGGER "sync_u_${t}" AFTER UPDATE ON "${t}" ${when} BEGIN\n  ${bump}\n  ${note('NEW')}\n  `
      + `INSERT OR REPLACE INTO sync_outbox (tbl, pk, ver) SELECT '${t}', ${pkJson(info, 'OLD')}, (SELECT ver FROM sync_ctl WHERE id = 1) WHERE ${pkJson(info, 'NEW')} <> ${pkJson(info, 'OLD')};`
      + (deltas ? `\n  ${deltas}` : '') + '\nEND',
    [`sync_d_${t}`]: `CREATE TRIGGER "sync_d_${t}" AFTER DELETE ON "${t}" ${when} BEGIN\n  ${bump}\n  ${note('OLD')}\nEND`,
  };
}

/** (Re)creates the capture triggers for the tables this version has. Cheap when they are already right. */
export function installSyncTriggers(d: SqliteDatabase): void {
  tableCache.delete(d);
  statements.delete(d);
  const want: Record<string, string> = {};
  for (const info of tables(d).values()) Object.assign(want, triggerSql(info));
  const have = new Map((d.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync\\_%' ESCAPE '\\'").all() as
    Array<{ name: string; sql: string }>).map((r) => [r.name, r.sql]));
  const same = have.size === Object.keys(want).length && Object.entries(want).every(([n, sql]) => have.get(n) === sql);
  if (same) return;
  d.transaction(() => {
    for (const name of have.keys()) d.exec(`DROP TRIGGER IF EXISTS "${name}"`);
    for (const sql of Object.values(want)) d.exec(sql);
  })();
}

/** Writes made while `fn` runs are not noted for sending (changes from elsewhere, a restore, an erase) */
export function quietly<T>(fn: () => T): T {
  const was = (stmt('SELECT applying FROM sync_ctl WHERE id = 1').get() as { applying: number } | undefined)?.applying ?? 0;
  stmt('UPDATE sync_ctl SET applying = 1 WHERE id = 1').run();
  try {
    return fn();
  } finally {
    stmt('UPDATE sync_ctl SET applying = ? WHERE id = 1').run(was);
  }
}

function note(tbl: string, pk: string) {
  stmt('UPDATE sync_ctl SET ver = ver + 1 WHERE id = 1').run();
  stmt('INSERT OR REPLACE INTO sync_outbox (tbl, pk, ver) VALUES (?, ?, (SELECT ver FROM sync_ctl WHERE id = 1))').run(tbl, pk);
}

/** Every row of every shared table, to be sent (a computer that starts the account's data, or after a restore) */
function noteAll(only?: (tbl: string, pk: string) => boolean) {
  stmt('UPDATE sync_ctl SET ver = ver + 1 WHERE id = 1').run();
  const d = currentShop().db;
  for (const info of tables().values()) {
    const key = pkJson(info, 'NEW').replace(/NEW\./g, '');
    if (!only) {
      d.prepare(`INSERT OR REPLACE INTO sync_outbox (tbl, pk, ver) SELECT '${info.name}', ${key}, (SELECT ver FROM sync_ctl WHERE id = 1) FROM "${info.name}"`).run();
      continue;
    }
    for (const k of d.prepare(`SELECT ${key} AS k FROM "${info.name}"`).pluck().all() as string[]) if (only(info.name, k)) note(info.name, k);
  }
}

function clearPending() {
  stmt('DELETE FROM sync_outbox').run();
  stmt('DELETE FROM sync_deltas').run();
}

// ---------------------------------------------------------------- state

interface SyncState {
  joined: number; business_id: string | null; epoch: number; cursor: number; device_no: number; is_primary: number;
  reset_pending: number; last_push_at: string | null; last_pull_at: string | null; last_error: string | null;
}

function state(): SyncState {
  stmt('INSERT OR IGNORE INTO sync_state (id) VALUES (1)').run();
  return stmt('SELECT * FROM sync_state WHERE id = 1').get() as SyncState;
}

function setState(patch: Partial<SyncState>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  currentShop().db.prepare(`UPDATE sync_state SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = 1`).run(...keys.map((k) => (patch as any)[k]));
}

/**
 * The letter added to this computer's document numbers (INV-B1001) so two computers never hand out the same number.
 * The computer that keeps the plain numbers (the first one, normally) has none.
 */
export function seriesTag(): string {
  try {
    const s = stmt('SELECT joined, is_primary, device_no FROM sync_state WHERE id = 1').get() as { joined: number; is_primary: number; device_no: number } | undefined;
    if (!s || !s.joined || s.is_primary || s.device_no < 1) return '';
    return s.device_no <= 26 ? String.fromCharCode(64 + s.device_no) : `D${s.device_no}`;
  } catch {
    return ''; // a database from before sync
  }
}

export interface SyncStatus { enabled: boolean; joined: boolean; pending: number; state: 'synced' | 'syncing' | 'offline' | 'error' | 'off'; lastSyncAt: string | null; error: string | null; live?: boolean }

const busy = new Set<string>();
const offline = new Set<string>();
const lastCycle = new Map<string, number>();

/** How long ago this business last finished a sync with the server */
export function msSinceSync(shop: string): number {
  return Date.now() - (lastCycle.get(shop) || 0);
}

/** Whether the server can tell this computer about changes at once (else it asks every few seconds) */
let liveLink: () => boolean = () => false;
export function setLiveLinkCheck(fn: () => boolean) {
  liveLink = fn;
}

export function syncStatus(): SyncStatus {
  if (!syncEnabled()) return { enabled: false, joined: false, pending: 0, state: 'off', lastSyncAt: null, error: null };
  const s = state();
  const pending = (stmt('SELECT COUNT(*) AS c FROM sync_outbox').get() as { c: number }).c + (stmt('SELECT COUNT(*) AS c FROM sync_deltas').get() as { c: number }).c;
  const shop = currentShopId();
  const st = busy.has(shop) ? 'syncing' : offline.has(shop) ? 'offline' : s.last_error ? 'error' : 'synced';
  const last = [s.last_pull_at, s.last_push_at].filter(Boolean).sort().pop() || null;
  return { enabled: true, joined: !!s.joined, pending, state: st, lastSyncAt: last, error: s.last_error, live: liveLink() };
}

const announced = new Map<string, string>();
/** The badge hears of a change of state only (a check every few seconds that finds nothing is not news) */
function announceStatus() {
  const status = syncStatus();
  const shop = currentShopId();
  const key = JSON.stringify({ ...status, lastSyncAt: null, state: status.state === 'syncing' ? 'synced' : status.state });
  if (announced.get(shop) === key) return;
  announced.set(shop, key);
  syncEvents.emit('status', { shop, status: status.state === 'syncing' ? { ...status, state: 'synced' } : status });
}

// ---------------------------------------------------------------- server

class SyncHttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function api(path: string, body: unknown): Promise<any> {
  const creds = getCredentials();
  if (!creds) throw new SyncHttpError(401, 'NOT_ACTIVATED', 'This computer is not activated');
  let res: Response;
  try {
    res = await fetch(`${licenseServerUrl()}/api/client/v1/sync${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${creds.id}.${creds.secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SyncHttpError(0, 'OFFLINE', 'The Apna Billing server cannot be reached');
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new SyncHttpError(res.status, data.code || 'SYNC_FAILED', data.message || `Sync failed (${res.status})`);
  return data;
}

// ---------------------------------------------------------------- send

/** Values a row can hold that JSON cannot carry as they are */
function encodeValue(v: unknown) {
  return Buffer.isBuffer(v) ? { $b64: v.toString('base64') } : v;
}
function decodeValue(v: unknown) {
  return v && typeof v === 'object' && typeof (v as any).$b64 === 'string' ? Buffer.from((v as any).$b64, 'base64') : v;
}

function invoiceCount(): number {
  try { return (stmt('SELECT COUNT(*) AS c FROM invoices').get() as { c: number }).c; } catch { return 0; }
}

/** Sends one batch of this computer's changes. True when more are waiting. */
async function pushOnce(): Promise<boolean> {
  const s = state();
  const info = tables();
  const entries = stmt('SELECT tbl, pk, ver FROM sync_outbox ORDER BY ver LIMIT ?').all(PUSH_ROWS) as Array<{ tbl: string; pk: string; ver: number }>;
  const cutoff = (stmt('SELECT ver FROM sync_deltas ORDER BY ver LIMIT 1 OFFSET ?').get(PUSH_DELTAS - 1) as { ver: number } | undefined)?.ver;
  const deltas = (cutoff === undefined ? stmt('SELECT * FROM sync_deltas ORDER BY ver').all() : stmt('SELECT * FROM sync_deltas WHERE ver <= ? ORDER BY ver').all(cutoff)) as
    Array<{ id: string; tbl: string; pk: string; col: string; delta: number; ver: number }>;
  if (!entries.length && !deltas.length) return false;

  // A row the server may not have yet goes with its counters as they were before the changes still to be sent,
  // so each change counts exactly once
  const sent = new Map<string, number>();
  for (const d of deltas) sent.set(`${d.tbl}\u0000${d.pk}\u0000${d.col}`, (sent.get(`${d.tbl}\u0000${d.pk}\u0000${d.col}`) || 0) + d.delta);
  const rows: any[] = [];
  const done: typeof entries = [];
  let bytes = 0;
  for (const e of entries) {
    const t = info.get(e.tbl);
    if (!t) { done.push(e); continue; }
    let values: unknown[];
    try { values = JSON.parse(e.pk); } catch { done.push(e); continue; }
    const row = stmt(`SELECT * FROM "${t.name}" WHERE ${pkWhere(t)}`).get(...values) as Record<string, unknown> | undefined;
    if (!row) {
      rows.push({ t: t.name, p: e.pk, x: true });
      done.push(e);
      continue;
    }
    const data: Record<string, unknown> = {};
    for (const c of t.cols) if (!t.local.has(c)) data[c] = encodeValue(row[c]);
    for (const c of t.counters) {
      const pendingAll = (stmt('SELECT COALESCE(SUM(delta), 0) AS s FROM sync_deltas WHERE tbl = ? AND pk = ? AND col = ?').get(t.name, e.pk, c) as { s: number }).s;
      const unsent = pendingAll - (sent.get(`${t.name}\u0000${e.pk}\u0000${c}`) || 0);
      data[c] = Math.round(((Number(row[c]) || 0) - unsent) * 1e6) / 1e6;
    }
    const size = JSON.stringify(data).length;
    if (rows.length && bytes + size > PUSH_BYTES) break;
    bytes += size;
    rows.push({ t: t.name, p: e.pk, d: data });
    done.push(e);
  }

  const counters: Record<string, string[]> = {};
  for (const t of info.values()) if (t.counters.length) counters[t.name] = t.counters;
  const answer = await api('/push', {
    epoch: s.epoch, invoices: invoiceCount(), counters, rows,
    deltas: deltas.map((d) => ({ id: d.id, t: d.tbl, p: d.pk, c: d.col, v: d.delta })),
  });
  currentShop().db.transaction(() => {
    const del = stmt('DELETE FROM sync_outbox WHERE tbl = ? AND pk = ? AND ver = ?');
    for (const e of done) del.run(e.tbl, e.pk, e.ver);
    const delDelta = stmt('DELETE FROM sync_deltas WHERE id = ?');
    for (const d of deltas) delDelta.run(d.id);
    setState({ last_push_at: new Date().toISOString(), is_primary: answer.primary ? 1 : 0, last_error: null });
  })();
  return done.length < entries.length || entries.length === PUSH_ROWS || cutoff !== undefined;
}

// ---------------------------------------------------------------- receive

type SyncEvent = { s: number; k: 'r' | 'd'; t: string; p: string; x?: number; d?: Record<string, unknown> | null; c?: string; v?: number };

function rowExists(t: TableInfo, values: unknown[]) {
  return !!stmt(`SELECT 1 FROM "${t.name}" WHERE ${pkWhere(t)}`).get(...values);
}

/** Settles a unique clash the same way on every computer: the row with the larger key gives way */
function settleClash(t: TableInfo, data: Record<string, unknown>, incomingKey: string, err: any): 'retry' | 'skip' {
  const m = /UNIQUE constraint failed: (.+)$/.exec(String(err?.message || ''));
  if (!m) return 'skip';
  const cols = m[1].split(',').map((s) => s.trim().split('.').pop()!).filter((c) => t.cols.includes(c));
  if (!cols.length || cols.some((c) => t.pkSet.has(c) && cols.length === t.pk.length && t.pk.every((p) => cols.includes(p)))) return 'skip';
  const only = UNIQUE_ONLY_WHERE[t.name] ? ` AND ${UNIQUE_ONLY_WHERE[t.name]}` : '';
  const other = stmt(`SELECT * FROM "${t.name}" WHERE ${cols.map((c) => `${q(c)} IS ?`).join(' AND ')} AND NOT (${pkWhere(t)})${only} LIMIT 1`)
    .get(...cols.map((c) => data[c]), ...JSON.parse(incomingKey)) as Record<string, unknown> | undefined;
  if (!other) return 'skip';
  const localKey = keyOf(t, other);
  const rename = RENAME_ON_CLASH[t.name];
  if (rename && cols.includes(rename)) {
    const loserKey = incomingKey > localKey ? incomingKey : localKey;
    const tag = crypto.createHash('sha1').update(loserKey).digest('hex').slice(0, 4).toUpperCase();
    if (loserKey === incomingKey) {
      data[rename] = `${data[rename]}-${tag}`;
    } else {
      stmt(`UPDATE "${t.name}" SET ${q(rename)} = ? WHERE ${pkWhere(t)}`).run(`${other[rename]}-${tag}`, ...JSON.parse(localKey));
      note(t.name, localKey); // the other computers take the new number over
    }
    return 'retry';
  }
  if (incomingKey < localKey) {
    stmt(`DELETE FROM "${t.name}" WHERE ${pkWhere(t)}`).run(...JSON.parse(localKey));
    note(t.name, localKey);
    return 'retry';
  }
  return 'skip';
}

function writeRow(t: TableInfo, values: unknown[], key: string, data: Record<string, unknown>, overwrite: boolean): boolean {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (rowExists(t, values)) {
        if (!overwrite && stmt('SELECT 1 FROM sync_outbox WHERE tbl = ? AND pk = ?').get(t.name, key)) return false; // this computer's own change is still to be sent: it wins
        const cols = t.cols.filter((c) => c in data && !t.pkSet.has(c) && !t.local.has(c) && (overwrite || !t.counterSet.has(c)));
        if (!cols.length) return false;
        stmt(`UPDATE "${t.name}" SET ${cols.map((c) => `${q(c)} = ?`).join(', ')} WHERE ${pkWhere(t)}`).run(...cols.map((c) => decodeValue(data[c])), ...values);
      } else {
        const cols = t.cols.filter((c) => c in data && !t.local.has(c));
        stmt(`INSERT INTO "${t.name}" (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => decodeValue(data[c])));
      }
      return true;
    } catch (err: any) {
      if (err?.code !== 'SQLITE_CONSTRAINT_UNIQUE' && err?.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') throw err;
      if (settleClash(t, data, key, err) === 'skip') return false;
    }
  }
  return false;
}

/**
 * Writes changes from the account's other computers. `overwrite`: a fresh copy of the account (counters included,
 * this computer's unsent changes do not win). Returns the tables that changed.
 */
function applyEvents(events: SyncEvent[], overwrite: boolean, seen?: Set<string>): Set<string> {
  const info = tables();
  const touched = new Set<string>();
  const d = currentShop().db;
  d.pragma('foreign_keys = OFF'); // a page can hold a bill's lines before the bill itself
  try {
    d.transaction(() => quietly(() => {
      for (const e of events) {
        const t = info.get(e.t);
        if (!t) continue; // a table this version does not have
        let values: unknown[];
        try { values = JSON.parse(e.p); } catch { continue; }
        if (!Array.isArray(values) || values.length !== t.pk.length) continue;
        if (e.k === 'd') {
          if (!e.c || !t.counterSet.has(e.c) || typeof e.v !== 'number') continue;
          // A row this computer does not have yet arrives later with the change already in it
          if (stmt(`UPDATE "${t.name}" SET ${q(e.c)} = COALESCE(${q(e.c)}, 0) + ? WHERE ${pkWhere(t)}`).run(e.v, ...values).changes) touched.add(t.name);
          continue;
        }
        seen?.add(`${t.name}\u0000${e.p}`);
        if (e.x) {
          if (stmt(`DELETE FROM "${t.name}" WHERE ${pkWhere(t)}`).run(...values).changes) touched.add(t.name);
          continue;
        }
        if (!e.d) continue;
        if (writeRow(t, values, e.p, { ...e.d }, overwrite)) touched.add(t.name);
      }
    }))();
  } finally {
    d.pragma('foreign_keys = ON');
  }
  return touched;
}

function announceData(tablesChanged: Set<string>) {
  if (!tablesChanged.size) return;
  syncEvents.emit('applied', { shop: currentShopId(), tables: [...tablesChanged] });
  if (tablesChanged.has('businesses') || tablesChanged.has('users')) refreshRecord(currentShop());
}

/** Fetches and writes what changed elsewhere. True when more is waiting. */
async function pullOnce(): Promise<boolean> {
  const s = state();
  const answer = await api('/pull', { epoch: s.epoch, after: s.cursor, full: false });
  const touched = applyEvents(answer.events || [], false);
  setState({ cursor: Number(answer.next) || s.cursor, last_pull_at: new Date().toISOString(), last_error: null });
  announceData(touched);
  return !!answer.more;
}

/** The whole account as it is now (all pages) */
async function fetchAll(epoch: number): Promise<{ events: SyncEvent[]; next: number }> {
  const events: SyncEvent[] = [];
  let after = 0;
  for (let page = 0; page < 100000; page++) {
    const answer = await api('/pull', { epoch, after, full: true, limit: 5000 });
    events.push(...(answer.events || []));
    after = Number(answer.next) || after;
    if (!answer.more) break;
  }
  return { events, next: after };
}

// ---------------------------------------------------------------- joining the account

function localBusinessId(): string | null {
  return (stmt('SELECT id FROM businesses ORDER BY created_at LIMIT 1').get() as { id: string } | undefined)?.id ?? null;
}

/** Points every reference to `from` (a business or a user) at `to` */
function repoint(kind: 'businesses' | 'users', from: string, to: string) {
  const d = currentShop().db;
  const all = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'sync_%'").pluck().all() as string[];
  for (const name of all) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) continue;
    const cols = new Set((d.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).map((c) => c.name));
    const refs = new Set((d.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{ table: string; from: string }>)
      .filter((f) => f.table === kind).map((f) => f.from));
    if (kind === 'businesses' && cols.has('business_id')) refs.add('business_id');
    if (kind === 'users') for (const c of USER_COLUMNS) if (cols.has(c)) refs.add(c);
    if (name === kind) refs.delete('id');
    for (const c of refs) d.prepare(`UPDATE "${name}" SET ${q(c)} = ? WHERE ${q(c)} = ?`).run(to, from);
  }
}

/**
 * This computer's own business becomes part of the account's (signed in on one more computer, or set up here before
 * the account had data elsewhere): the account's copy is taken over, this computer's own records are added to it.
 * Same owner (by email) and the same business: one each. A backup of this computer's data is made first.
 */
async function mergeInto(target: { businessId: string; epoch: number; deviceNo: number; primary: boolean }) {
  const mine = localBusinessId();
  if (mine && hasOwnRecords()) await createBackup({ kind: 'PRE_SYNC', notes: 'Automatic backup before this computer joined the account\'s shared data' });
  const snapshot = await fetchAll(target.epoch);
  const users = new Map<string, string>();
  for (const e of snapshot.events) {
    if (e.k === 'r' && e.t === 'users' && !e.x && e.d && typeof e.d.email === 'string') users.set(String(e.d.email).toLowerCase(), String(e.d.id));
  }
  const d = currentShop().db;
  d.pragma('foreign_keys = OFF');
  try {
    d.transaction(() => quietly(() => {
      for (const u of d.prepare('SELECT id, email FROM users').all() as Array<{ id: string; email: string }>) {
        const theirs = users.get(String(u.email).toLowerCase());
        if (theirs && theirs !== u.id) {
          repoint('users', u.id, theirs);
          d.prepare('DELETE FROM users WHERE id = ?').run(u.id);
        }
      }
      if (mine && mine !== target.businessId) {
        repoint('businesses', mine, target.businessId);
        d.prepare('DELETE FROM businesses WHERE id = ?').run(mine);
      }
      clearPending();
    }))();
  } finally {
    d.pragma('foreign_keys = ON');
  }
  const seen = new Set<string>();
  applyEvents(snapshot.events, true, seen);
  // What only this computer had goes to the account
  d.transaction(() => noteAll((tbl, pk) => !seen.has(`${tbl}\u0000${pk}`)))();
  setState({ joined: 1, business_id: target.businessId, epoch: target.epoch, cursor: snapshot.next, device_no: target.deviceNo,
    is_primary: target.primary ? 1 : 0, reset_pending: 0, last_error: null });
  refreshRecord(currentShop());
  return mine !== target.businessId;
}

function hasOwnRecords(): boolean {
  for (const t of ['invoices', 'products', 'customers', 'suppliers', 'purchase_invoices', 'expenses']) {
    try { if (stmt(`SELECT 1 FROM "${t}" LIMIT 1`).get()) return true; } catch { /* not in this version */ }
  }
  return false;
}

async function join(quiet: boolean) {
  const mine = localBusinessId();
  if (!mine) return; // nothing set up here yet
  const r = await api('/register', { businessId: mine, invoices: invoiceCount() });
  if (r.role === 'seed') {
    currentShop().db.transaction(() => {
      clearPending();
      noteAll();
      setState({ joined: 1, business_id: mine, epoch: r.epoch, cursor: r.lastSeq, device_no: r.deviceNo, is_primary: r.primary ? 1 : 0, reset_pending: 0, last_error: null });
    })();
    return;
  }
  const changedIds = await mergeInto({ businessId: r.businessId, epoch: r.epoch, deviceNo: r.deviceNo, primary: !!r.primary });
  announceData(new Set(tables().keys()));
  // Whoever was signed in here was signed in to this computer's own copy of the business: sign in again
  if (changedIds && !quiet) emitLicenseChanged('session-ended', { sessionEnded: true, reason: 'SYNC_JOINED' });
}

/** The account was restored from a backup on another computer: its data replaces this computer's */
async function takeOverRestoredAccount() {
  const r = await api('/register', { businessId: localBusinessId() || 'none', invoices: invoiceCount() });
  if (hasOwnRecords()) await createBackup({ kind: 'PRE_SYNC', notes: 'Automatic backup before taking over the data restored on another computer' });
  const before = localBusinessId();
  const snapshot = await fetchAll(r.epoch);
  const d = currentShop().db;
  d.pragma('foreign_keys = OFF');
  try {
    d.transaction(() => quietly(() => {
      for (const t of tables().values()) d.prepare(`DELETE FROM "${t.name}"`).run();
      clearPending();
    }))();
  } finally {
    d.pragma('foreign_keys = ON');
  }
  applyEvents(snapshot.events, true);
  setState({ joined: 1, business_id: r.businessId, epoch: r.epoch, cursor: snapshot.next, device_no: r.deviceNo, is_primary: r.primary ? 1 : 0,
    reset_pending: 0, last_error: null });
  refreshRecord(currentShop());
  announceData(new Set(tables().keys()));
  if (before !== localBusinessId()) emitLicenseChanged('session-ended', { sessionEnded: true, reason: 'SYNC_JOINED' });
}

/** This computer restored a backup: that data becomes the account's */
async function resetAccountToThis() {
  const mine = localBusinessId();
  if (!mine) return;
  const r = await api('/reset', { businessId: mine, invoices: invoiceCount() });
  currentShop().db.transaction(() => {
    clearPending();
    noteAll();
    setState({ joined: 1, business_id: mine, epoch: r.epoch, cursor: r.lastSeq, device_no: r.deviceNo, is_primary: 1, reset_pending: 0, last_error: null });
  })();
}

// ---------------------------------------------------------------- running

const runs = new Map<string, { running: Promise<void> | null; again: boolean; timer: NodeJS.Timeout | null }>();

async function cycle(quiet: boolean) {
  if (!syncEnabled() || !getCredentials()) return;
  const s = state();
  if (s.reset_pending && s.joined) await resetAccountToThis();
  else if (!s.joined) await join(quiet);
  if (!state().joined) return;
  for (let i = 0; i < 200 && (await pushOnce()); i++) { /* more to send */ }
  for (let i = 0; i < 1000 && (await pullOnce()); i++) { /* more to fetch */ }
}

async function runCycle(shop: string, quiet: boolean): Promise<void> {
  const r = runs.get(shop) || { running: null, again: false, timer: null };
  runs.set(shop, r);
  if (r.running) {
    r.again = true;
    return r.running;
  }
  r.running = (async () => {
    do {
      r.again = false;
      await runInShop(shop, async () => {
        busy.add(shop);
        announceStatus();
        try {
          await cycle(quiet);
          offline.delete(shop);
          lastCycle.set(shop, Date.now());
        } catch (err: any) {
          if (err instanceof SyncHttpError && err.code === 'SYNC_NOT_REGISTERED') {
            // The server no longer has this account's shared data (the customer was set up again): join afresh
            currentShop().db.transaction(() => { clearPending(); setState({ joined: 0, cursor: 0, epoch: 0 }); })();
            r.again = true;
          } else if (err instanceof SyncHttpError && err.code === 'SYNC_EPOCH_CHANGED') {
            try { await takeOverRestoredAccount(); } catch (inner: any) { setState({ last_error: String(inner?.message || inner) }); }
          } else if (err instanceof SyncHttpError && (err.code === 'OFFLINE' || err.status === 0)) {
            offline.add(shop);
          } else if (err instanceof SyncHttpError && (err.status === 401 || err.status === 403 || err.status === 404)) {
            // Not (or no longer) on the licence, or a server from before sync: nothing to sync until that changes
          } else {
            setState({ last_error: String(err?.message || err).slice(0, 300) });
            console.warn('[Sync]', err?.message || err);
          }
        } finally {
          busy.delete(shop);
          announceStatus();
        }
      });
    } while (r.again);
  })().finally(() => { r.running = null; });
  return r.running;
}

/** Sync soon (changes made here, a push from the server, a timer). Several requests close together make one run. */
export function requestSync(shop: string = currentShopId(), delayMs = 30) {
  if (!syncEnabled() || !shopExists(shop)) return;
  const r = runs.get(shop) || { running: null, again: false, timer: null };
  runs.set(shop, r);
  if (r.timer) return;
  r.timer = setTimeout(() => {
    r.timer = null;
    void runCycle(shop, false);
  }, delayMs);
}

/** Sync now and wait (signing in on a computer that just joined the licence: the account's data is here at once) */
export async function syncNow(opts: { quiet?: boolean; timeoutMs?: number } = {}): Promise<void> {
  if (!syncEnabled()) return;
  const shop = currentShopId();
  await Promise.race([runCycle(shop, !!opts.quiet), new Promise<void>((r) => setTimeout(r, opts.timeoutMs ?? 30_000))]);
}

/** A backup was restored here: once online, it becomes the account's data on every computer */
export function afterRestore() {
  if (!syncEnabled()) return;
  if (state().joined) setState({ reset_pending: 1 });
  requestSync();
}

/** The shop on this computer was erased: it is no longer part of any account's shared data */
export function afterErase() {
  clearPending();
  setState({ joined: 0, business_id: null, epoch: 0, cursor: 0, device_no: 0, is_primary: 1, reset_pending: 0, last_error: null });
}

// Change capture is in place before anything can be written to a business file
onShopOpen((d) => { if (syncEnabled()) installSyncTriggers(d); });
