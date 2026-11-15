import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { knex, nowIso, bool } from '../db.js';
import { ah, parse, HttpError, rateLimit } from '../lib.js';
import { pushSync } from '../realtime.js';
import { openSecret, sealSecret } from '../accounts.js';
import { clientAuth, type ClientRequest } from './client.js';

/**
 * Sync of a shop's data between all computers of one account (the customer). Each computer sends what changed on it
 * (/push) and fetches what changed elsewhere (/pull); connected computers are told at once over the live link.
 *
 * - Rows: the latest copy of each row wins (in the order they reach this server). Stored sealed (AES-256-GCM).
 * - Counters (stock, balances, points) travel as changes ("-1"), never as values, so two computers selling the same
 *   item at the same moment both count. A row's stored copy already includes the changes made before its `seq`.
 * - `seq` orders everything of one account; a computer remembers how far it got.
 * - `epoch` changes when a computer restores a backup: that data becomes the account's, the others take it over.
 */
const router = Router();

router.use(rateLimit({ name: 'sync', windowMs: 60 * 1000, max: 900 }));
router.use(clientAuth);
router.use((req: ClientRequest, _res: Response, next: NextFunction) => {
  if (req.installation?.status !== 'ACTIVE') return next(new HttpError(403, 'INSTALLATION_INACTIVE', 'This computer is not active on the licence'));
  next();
});

const TABLE = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const PK = z.string().min(2).max(500);
const PAGE_BYTES = 4 * 1024 * 1024;

const sealRow = (data: Record<string, unknown>) => sealSecret(JSON.stringify(data));
const openRow = (sealed: string | null): Record<string, any> | null => {
  const plain = openSecret(sealed);
  if (!plain) return null;
  try { return JSON.parse(plain); } catch { return null; }
};
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** The account's sync record, locked for this transaction (PostgreSQL; SQLite runs one writer at a time anyway) */
async function workspaceFor(trx: typeof knex, customerId: string) {
  const q = trx('sync_workspaces').where({ customer_id: customerId });
  return (knex.client.config.client === 'pg' ? q.forUpdate() : q).first();
}

/** Who keeps the plain bill numbers (INV-1001…): the first computer, or a later one that already has bills while the
 *  first still has none. The others number their own series (INV-B1001…), so two computers never use the same number. */
function primaryAfter(ws: any, installationId: string, invoices: number) {
  if (!ws.primary_installation) return { primary_installation: installationId, primary_invoices: invoices };
  if (ws.primary_installation === installationId) return { primary_invoices: invoices };
  if (invoices > 0 && Number(ws.primary_invoices) === 0) return { primary_installation: installationId, primary_invoices: invoices };
  return {};
}

/** Joins this computer to its account's shared data. `role` "seed": the account has nothing yet, this computer's data
 *  becomes it. "join": the account already has data (of `businessId`), this computer takes it over / adds its own. */
router.post('/register', ah(async (req: ClientRequest, res: Response) => {
  const input = parse(z.object({ businessId: z.string().min(1).max(64), invoices: z.number().int().min(0).default(0) }), req.body);
  const inst = req.installation;
  const now = nowIso();
  const out = await knex.transaction(async (trx) => {
    let ws = await workspaceFor(trx as any, inst.customer_id);
    if (!ws) {
      ws = { customer_id: inst.customer_id, business_id: input.businessId, epoch: 1, last_seq: 0, next_device_no: 1,
        primary_installation: null, primary_invoices: 0, created_at: now, updated_at: now };
      await trx('sync_workspaces').insert(ws);
    }
    const hasRows = !!(await trx('sync_rows').where({ customer_id: inst.customer_id }).first('pk'));
    if (!ws.business_id) ws.business_id = input.businessId;
    const role = !hasRows && ws.business_id === input.businessId ? 'seed' : 'join';
    let device = await trx('sync_devices').where({ installation_id: inst.id }).first();
    if (!device) {
      device = { installation_id: inst.id, customer_id: inst.customer_id, device_no: Number(ws.next_device_no), joined_at: now };
      await trx('sync_devices').insert(device);
      ws.next_device_no = Number(ws.next_device_no) + 1;
    }
    Object.assign(ws, primaryAfter(ws, inst.id, input.invoices));
    await trx('sync_workspaces').where({ customer_id: inst.customer_id }).update({
      business_id: ws.business_id, next_device_no: ws.next_device_no, primary_installation: ws.primary_installation,
      primary_invoices: ws.primary_invoices, updated_at: now,
    });
    return { role, businessId: ws.business_id, epoch: Number(ws.epoch), lastSeq: Number(ws.last_seq), deviceNo: Number(device.device_no),
      primary: ws.primary_installation === inst.id };
  });
  res.json(out);
}));

const pushSchema = z.object({
  epoch: z.number().int(),
  invoices: z.number().int().min(0).optional(),
  counters: z.record(TABLE, z.array(z.string().max(64)).max(20)).default({}),
  rows: z.array(z.object({ t: TABLE, p: PK, x: z.boolean().optional(), d: z.record(z.string(), z.any()).optional() })).max(5000),
  deltas: z.array(z.object({ id: z.string().min(8).max(64), t: TABLE, p: PK, c: z.string().max(64), v: z.number().finite() })).max(20000),
});

router.post('/push', ah(async (req: ClientRequest, res: Response) => {
  const input = parse(pushSchema, req.body);
  const inst = req.installation;
  const customer = inst.customer_id;
  const now = nowIso();
  const out = await knex.transaction(async (trx) => {
    const ws = await workspaceFor(trx as any, customer);
    if (!ws) throw new HttpError(409, 'SYNC_NOT_REGISTERED', 'This computer has not joined its account yet');
    if (Number(ws.epoch) !== input.epoch) throw new HttpError(409, 'SYNC_EPOCH_CHANGED', 'The account was restored from a backup on another computer');
    let seq = Number(ws.last_seq);

    // The current copies of the rows touched, in one read per table
    const current = new Map<string, any>();
    const byTable = new Map<string, Set<string>>();
    for (const r of input.rows) (byTable.get(r.t) || byTable.set(r.t, new Set()).get(r.t)!).add(r.p);
    for (const d of input.deltas) (byTable.get(d.t) || byTable.set(d.t, new Set()).get(d.t)!).add(d.p);
    for (const [tbl, keys] of byTable) {
      const list = [...keys];
      for (let i = 0; i < list.length; i += 400) {
        const rows = await trx('sync_rows').where({ customer_id: customer, tbl }).whereIn('pk', list.slice(i, i + 400));
        for (const row of rows) current.set(`${tbl}\u0000${row.pk}`, row);
      }
    }

    const write = async (tbl: string, pk: string, patch: Record<string, unknown>) => {
      const key = `${tbl}\u0000${pk}`;
      const had = current.get(key);
      if (had) await trx('sync_rows').where({ customer_id: customer, tbl, pk }).update(patch);
      else await trx('sync_rows').insert({ customer_id: customer, tbl, pk, ...patch });
      current.set(key, { ...(had || { customer_id: customer, tbl, pk }), ...patch });
    };

    for (const r of input.rows) {
      seq += 1;
      if (r.x || !r.d) {
        await write(r.t, r.p, { data: null, deleted: true, seq, origin: inst.id, updated_at: now });
        continue;
      }
      const data = { ...r.d };
      const had = current.get(`${r.t}\u0000${r.p}`);
      // A row the account already has keeps its counters: they only ever move by the changes below
      if (had && !bool(had.deleted)) {
        const old = openRow(had.data) || {};
        for (const c of input.counters[r.t] || []) if (c in old) data[c] = old[c];
      }
      await write(r.t, r.p, { data: sealRow(data), deleted: false, seq, origin: inst.id, updated_at: now });
    }

    const seen = new Set<string>();
    for (let i = 0; i < input.deltas.length; i += 400) {
      const ids = input.deltas.slice(i, i + 400).map((d) => d.id);
      for (const row of await trx('sync_deltas').whereIn('id', ids).select('id')) seen.add(row.id);
    }
    for (const d of input.deltas) {
      if (seen.has(d.id)) continue; // sent before (the answer was lost)
      seen.add(d.id);
      seq += 1;
      await trx('sync_deltas').insert({ id: d.id, customer_id: customer, tbl: d.t, pk: d.p, col: d.c, delta: d.v, seq, origin: inst.id, created_at: now });
      const had = current.get(`${d.t}\u0000${d.p}`);
      if (had && !bool(had.deleted)) {
        const data = openRow(had.data) || {};
        data[d.c] = round((Number(data[d.c]) || 0) + d.v);
        seq += 1; // the copy now includes this change: it is newer than the change itself
        await write(d.t, d.p, { data: sealRow(data), seq, updated_at: now });
      }
    }

    const primary = input.invoices !== undefined && ws.primary_installation === inst.id ? { primary_invoices: input.invoices } : {};
    await trx('sync_workspaces').where({ customer_id: customer }).update({ last_seq: seq, updated_at: now, ...primary });
    await trx('sync_devices').where({ installation_id: inst.id }).update({ last_push_at: now });
    return { seq, primary: ws.primary_installation === inst.id };
  });
  res.json(out);
  if (input.rows.length || input.deltas.length) void pushSync(customer, inst.id);
}));

/** What changed since `after` (rows and counter changes in order). `full`: everything, as a fresh start. */
router.post('/pull', ah(async (req: ClientRequest, res: Response) => {
  const input = parse(z.object({ epoch: z.number().int(), after: z.number().int().min(0), full: z.boolean().default(false),
    limit: z.number().int().min(1).max(5000).default(2000) }), req.body);
  const inst = req.installation;
  const customer = inst.customer_id;
  const ws = await knex('sync_workspaces').where({ customer_id: customer }).first();
  if (!ws) throw new HttpError(409, 'SYNC_NOT_REGISTERED', 'This computer has not joined its account yet');
  if (Number(ws.epoch) !== input.epoch) throw new HttpError(409, 'SYNC_EPOCH_CHANGED', 'The account was restored from a backup on another computer');
  const upTo = Number(ws.last_seq);

  const rowsQ = knex('sync_rows').where({ customer_id: customer }).andWhere('seq', '>', input.after).andWhere('seq', '<=', upTo)
    .orderBy('seq').limit(input.limit);
  if (!input.full) rowsQ.andWhere((w) => w.whereNull('origin').orWhereNot('origin', inst.id));
  const rows = await rowsQ;
  const deltas = input.full ? [] : await knex('sync_deltas').where({ customer_id: customer }).andWhere('seq', '>', input.after)
    .andWhere('seq', '<=', upTo).andWhere((w) => w.whereNull('origin').orWhereNot('origin', inst.id)).orderBy('seq').limit(input.limit);

  // Either list cut short by the limit ends the page where it was cut (nothing after it is certain yet)
  let boundary = upTo;
  if (rows.length === input.limit) boundary = Math.min(boundary, Number(rows[rows.length - 1].seq));
  if (deltas.length === input.limit) boundary = Math.min(boundary, Number(deltas[deltas.length - 1].seq));
  const events: any[] = [
    ...rows.map((r: any) => ({ s: Number(r.seq), k: 'r', t: r.tbl, p: r.pk, x: bool(r.deleted) ? 1 : 0, d: bool(r.deleted) ? null : openRow(r.data) })),
    ...deltas.map((d: any) => ({ s: Number(d.seq), k: 'd', t: d.tbl, p: d.pk, c: d.col, v: Number(d.delta) })),
  ].filter((e) => e.s <= boundary).sort((a, b) => a.s - b.s);

  // One page: up to `limit` events and a few MB; the rest comes with the next call
  const page: any[] = [];
  let bytes = 0;
  for (const e of events) {
    if (page.length >= input.limit) break;
    const size = e.d ? JSON.stringify(e.d).length : 64;
    if (page.length && bytes + size > PAGE_BYTES) break;
    page.push(e);
    bytes += size;
  }
  const cut = page.length < events.length || boundary < upTo;
  // A page cut short ends at its last event (or where a list was cut); a complete answer reaches the account's end
  const next = page.length < events.length ? page[page.length - 1].s : boundary;
  await knex('sync_devices').where({ installation_id: inst.id }).update({ last_pull_at: nowIso(), cursor: input.full ? 0 : input.after });
  res.json({ events: page, next, more: cut, epoch: Number(ws.epoch) });
  if (Math.random() < 0.1) void prune(customer);
}));

/**
 * Counter changes and deleted-row markers every computer of the account has already fetched are no longer needed
 * (a computer that joins later gets the rows with the changes already in them). Never throws.
 */
async function prune(customer: string) {
  try {
    const devices = await knex('sync_devices').where({ customer_id: customer }).select('cursor');
    if (!devices.length) return;
    const upTo = Math.min(...devices.map((d: any) => Number(d.cursor) || 0));
    if (upTo <= 0) return;
    await knex('sync_deltas').where({ customer_id: customer }).andWhere('seq', '<=', upTo).delete();
    await knex('sync_rows').where({ customer_id: customer, deleted: true }).andWhere('seq', '<=', upTo).delete();
  } catch (err) {
    console.warn('[sync] prune failed', err);
  }
}

/** A backup was restored on this computer: its data becomes the account's (the others take it over) */
router.post('/reset', ah(async (req: ClientRequest, res: Response) => {
  const input = parse(z.object({ businessId: z.string().min(1).max(64), invoices: z.number().int().min(0).default(0) }), req.body);
  const inst = req.installation;
  const now = nowIso();
  const out = await knex.transaction(async (trx) => {
    const ws = await workspaceFor(trx as any, inst.customer_id);
    if (!ws) throw new HttpError(409, 'SYNC_NOT_REGISTERED', 'This computer has not joined its account yet');
    const epoch = Number(ws.epoch) + 1;
    await trx('sync_rows').where({ customer_id: inst.customer_id }).delete();
    await trx('sync_deltas').where({ customer_id: inst.customer_id }).delete();
    await trx('sync_workspaces').where({ customer_id: inst.customer_id }).update({
      epoch, business_id: input.businessId, primary_installation: inst.id, primary_invoices: input.invoices, updated_at: now,
    });
    const device = await trx('sync_devices').where({ installation_id: inst.id }).first();
    return { epoch, lastSeq: Number(ws.last_seq), deviceNo: Number(device?.device_no || 1), primary: true };
  });
  res.json(out);
  void pushSync(inst.customer_id, inst.id);
}));

export default router;
