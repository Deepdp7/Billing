import type { Response } from 'express';
import { knex } from './db.js';

/**
 * Live "something changed, check in now" pushes to connected desktop installations (Server-Sent Events).
 *
 * A push carries no entitlement data: the desktop reacts by calling /heartbeat and only trusts the signed token
 * it gets back, so a forged or replayed push can at most cause an extra license check.
 *
 * Connections are held in this process. With several license-server instances behind a load balancer, pushes only
 * reach installations connected to the instance that made the change; the others still pick it up on their next
 * scheduled sync (or a shared pub/sub would be needed).
 */

const streams = new Map<string, Set<Response>>();
const PING_MS = 25_000;

export type PushTarget =
  | { scope: 'ALL' }
  | { scope: 'CUSTOMER' | 'LICENSE' | 'INSTALLATION' | 'PLAN'; id: string };

export function isConnected(installationId: string): boolean {
  return (streams.get(installationId)?.size || 0) > 0;
}

export function connectedCount(): number {
  return streams.size;
}

/** Keep an SSE response open for an installation until the client goes away. */
export function attachStream(installationId: string, res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx: don't buffer the stream
  res.flushHeaders();
  res.write('retry: 5000\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

  let set = streams.get(installationId);
  if (!set) streams.set(installationId, (set = new Set()));
  set.add(res);

  const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
  const cleanup = () => {
    clearInterval(ping);
    const s = streams.get(installationId);
    if (s) {
      s.delete(res);
      if (s.size === 0) streams.delete(installationId);
    }
  };
  res.on('close', cleanup);
  res.on('error', cleanup);
}

function writeRefresh(installationId: string, reasons: string[]) {
  const data = JSON.stringify({ reasons, at: new Date().toISOString() });
  for (const res of streams.get(installationId) || []) res.write(`event: refresh\ndata: ${data}\n\n`);
}

/** Every admin change is delivered at once. Waiting would leave the open billing app usable after suspend, revoke, or a feature lock. */
function send(installationId: string, reason: string) {
  writeRefresh(installationId, [reason]);
}

/** Tell affected, currently connected installations to re-check their license now. Never throws. */
export async function pushRefresh(target: PushTarget, reason: string): Promise<number> {
  try {
    const connected = [...streams.keys()];
    if (connected.length === 0) return 0;
    let ids: string[];
    if (target.scope === 'ALL') ids = connected;
    else if (target.scope === 'INSTALLATION') ids = connected.includes(target.id) ? [target.id] : [];
    else {
      const q = knex('installations as i').whereIn('i.id', connected).select('i.id');
      if (target.scope === 'CUSTOMER') q.where('i.customer_id', target.id);
      else if (target.scope === 'LICENSE') q.where('i.license_id', target.id);
      else q.join('licenses as l', 'l.id', 'i.license_id').where('l.plan_id', target.id);
      ids = (await q).map((r: any) => r.id);
    }
    ids.forEach((id) => send(id, reason));
    return ids.length;
  } catch (err) {
    console.warn('[realtime] push failed', err);
    return 0;
  }
}

/**
 * Another computer of this account changed something: its other connected computers fetch it now (the push carries
 * no data; they ask for it over their own authenticated connection). Never throws.
 */
export async function pushSync(customerId: string, except: string): Promise<number> {
  try {
    const connected = [...streams.keys()].filter((id) => id !== except);
    if (connected.length === 0) return 0;
    const ids = (await knex('installations').whereIn('id', connected).where({ customer_id: customerId }).select('id')).map((r: any) => r.id);
    const data = JSON.stringify({ at: new Date().toISOString() });
    for (const id of ids) for (const res of streams.get(id) || []) res.write(`event: sync
data: ${data}

`);
    return ids.length;
  } catch (err) {
    console.warn('[realtime] sync push failed', err);
    return 0;
  }
}

/** Close every stream (server shutdown / tests). Clients reconnect on their own. */
export function closeAllStreams(): void {
  for (const set of streams.values()) for (const res of set) res.end();
  streams.clear();
}
