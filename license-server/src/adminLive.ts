import type { Response } from 'express';

/**
 * Live feed for the Admin Panel. Every license event, audit entry, customer check-in and usage report
 * is written to the open consoles so their lists refresh without a manual reload.
 * The payload is a notice only — the panel re-reads the API, which remains the source of truth.
 */

export type AdminNotice = {
  kind: 'customer' | 'admin';
  action: string;
  title: string;
  message: string;
  /** When false the console refreshes its data but does not pop a notice. */
  notify: boolean;
  at: string;
};

const consoles = new Set<Response>();
const PING_MS = 25_000;

export function attachAdminStream(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 3000\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  consoles.add(res);
  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, PING_MS);
  const cleanup = () => {
    clearInterval(ping);
    consoles.delete(res);
  };
  res.on('close', cleanup);
  res.on('error', cleanup);
}

export function publishAdmin(notice: Omit<AdminNotice, 'at'>): void {
  const data = JSON.stringify({ ...notice, at: new Date().toISOString() });
  for (const res of consoles) {
    if (res.writableEnded) continue;
    res.write(`event: activity\ndata: ${data}\n\n`);
  }
}

export function closeAdminStreams(): void {
  for (const res of consoles) res.end();
  consoles.clear();
}
