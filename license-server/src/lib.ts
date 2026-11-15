import crypto from 'crypto';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodError, ZodTypeAny } from 'zod';
import { knex, nowIso } from './db.js';
import { publishAdmin } from './adminLive.js';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, 'VALIDATION_ERROR', first ? `${first.path.join('.') || 'request'}: ${first.message}` : 'Invalid request', r.error.issues);
  }
  return r.data;
}

export const ah = (fn: (req: any, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: err.issues[0]?.message });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ code: 'INVALID_JSON', message: 'Request body is not valid JSON' });
    return;
  }
  console.error('[license-server]', err);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
}

/** Fixed-window in-memory rate limiter (per process). Put a shared limiter at the proxy for multi-instance deployments. */
export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string; name: string }): RequestHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, opts.windowMs).unref();
  return (req, res, next) => {
    const k = `${opts.name}:${opts.key ? opts.key(req) : req.ip}`;
    const now = Date.now();
    const e = hits.get(k);
    if (!e || e.reset <= now) {
      hits.set(k, { count: 1, reset: now + opts.windowMs });
      return next();
    }
    e.count += 1;
    if (e.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((e.reset - now) / 1000)));
      res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' });
      return;
    }
    next();
  };
}

export async function audit(req: Request & { admin?: any }, action: string, entityType: string, entityId: string | null, details: Record<string, unknown> = {}) {
  await knex('audit_logs').insert({
    id: crypto.randomUUID(),
    admin_id: req.admin?.id || null,
    admin_email: req.admin?.email || null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details_json: JSON.stringify(details),
    ip: req.ip,
    created_at: nowIso(),
  });
  publishAdmin({
    kind: 'admin',
    action,
    title: action.replace(/_/g, ' ').toLowerCase(),
    message: `${req.admin?.email || 'An administrator'} updated ${entityType.toLowerCase()}.`,
    notify: false,
  });
}

export async function licenseEvent(e: { licenseId?: string | null; installationId?: string | null; customerId?: string | null; type: string; actor: string; details?: Record<string, unknown> }) {
  await knex('license_events').insert({
    id: crypto.randomUUID(),
    license_id: e.licenseId || null,
    installation_id: e.installationId || null,
    customer_id: e.customerId || null,
    event_type: e.type,
    details_json: JSON.stringify(e.details || {}),
    actor: e.actor,
    created_at: nowIso(),
  });
  const fromCustomer = e.actor === 'client';
  publishAdmin({
    kind: fromCustomer ? 'customer' : 'admin',
    action: e.type,
    title: eventTitle(e.type),
    message: eventMessage(e),
    notify: fromCustomer,
  });
}

const EVENT_TITLES: Record<string, string> = {
  TRIAL_STARTED: 'Free trial started',
  ACTIVATED: 'License activated',
  DEACTIVATED: 'Computer deactivated',
  APP_UPDATED: 'Billing app updated',
  CREDENTIALS_ROTATED: 'Computer signed in again',
  CUSTOMER_DELETED: 'Customer removed',
  INSTALLATION_DEACTIVATED: 'Computer deactivated',
  FEATURE_OVERRIDE_SET: 'Feature changed',
  FEATURE_OVERRIDE_REMOVED: 'Feature change removed',
  PASSWORD_RESET_REQUESTED: 'Password reset code sent',
  PASSWORD_RESET: 'Password reset by email code',
  SIGNED_IN_NEW_DEVICE: 'Account opened on another computer',
  APP_UNINSTALLED: 'Apna Billing uninstalled',
  INSTALLATION_DELETED: 'Device deleted',
};

function eventTitle(type: string): string {
  return EVENT_TITLES[type] || type.replace(/_/g, ' ').toLowerCase();
}

function eventMessage(e: { type: string; actor: string; details?: Record<string, unknown> }): string {
  const d = e.details || {};
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : '');
  if (e.type === 'TRIAL_STARTED') return `${text(d.email) || 'A shop'} started a free trial.`;
  if (e.type === 'ACTIVATED') return `${text(d.deviceName) || 'A computer'} activated a license.`;
  if (e.type === 'DEACTIVATED' || e.type === 'INSTALLATION_DEACTIVATED') return 'That computer can no longer use this license.';
  if (e.type === 'APP_UPDATED') return `Updated from ${text(d.from) || 'an older version'} to ${text(d.to) || 'a newer version'}.`;
  if (e.type === 'PASSWORD_RESET_REQUESTED') return `A reset code was emailed to ${text(d.email) || 'the shop'}.`;
  if (e.type === 'APP_UNINSTALLED') return `Apna Billing was uninstalled from ${text(d.deviceName) || 'a computer'}. You can delete it from the device list.`;
  if (e.type === 'INSTALLATION_DELETED') return `${text(d.deviceName) || 'A device'} was removed from the device list.`;
  if (e.type === 'SIGNED_IN_NEW_DEVICE') return `${text(d.email) || 'The account'} was opened on ${text(d.deviceName) || 'another computer'}.`;
  if (e.type === 'PASSWORD_RESET') return `${text(d.email) || 'A shop'} set a new password with an email code.`;
  if (e.actor === 'client') return 'A customer installation just reported this.';
  return 'Applied from the admin console.';
}

// ---------------- TOTP (RFC 6238) for optional admin two-factor authentication ----------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secret: string, timeMs = Date.now(), step = 30): string {
  const counter = Math.floor(timeMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}

export function verifyTotp(secret: string, code: string, timeMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((w) => {
    const expected = totpCode(secret, timeMs + w * 30000);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code));
  });
}
