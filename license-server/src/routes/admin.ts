import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { knex, nowIso, bool, parseJson } from '../db.js';
import { ah, parse, HttpError, rateLimit, audit, licenseEvent, base32Encode, verifyTotp } from '../lib.js';
import { sha256, generateLicenseKey } from '../signing.js';
import { config } from '../config.js';
import { FEATURES, FEATURE_KEYS } from '../features.js';
import { effectiveLicenseStatus, getSettings, setSetting, resolveFeatures } from '../entitlements.js';
import { isConnected, pushRefresh } from '../realtime.js';
import { registerUpdateRoutes } from './updates.js';
import { attachAdminStream } from '../adminLive.js';
import { accountSummary, changeAccount, codeEmail, emailConfigured, openSecret, publicCustomer, sealSecret, sendMail, SMTP_KEYS } from '../accounts.js';

const router = Router();
const DAY = 86400000;

type Role = 'OWNER' | 'ADMIN' | 'SUPPORT' | 'VIEWER';
const RANK: Record<Role, number> = { VIEWER: 0, SUPPORT: 1, ADMIN: 2, OWNER: 3 };

interface AdminRequest extends Request {
  admin?: { id: string; email: string; name: string; role: Role };
}

const authenticate = ah(async (req: AdminRequest, res: Response, next: NextFunction) => {
  const m = (req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
  if (!m) throw new HttpError(401, 'UNAUTHORIZED', 'Login required');
  const session = await knex('admin_sessions').where({ token_hash: sha256(m[1]) }).first();
  if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) throw new HttpError(401, 'SESSION_EXPIRED', 'Session expired. Please log in again.');
  const admin = await knex('admin_users').where({ id: session.admin_id }).first();
  if (!admin || admin.status !== 'ACTIVE') throw new HttpError(401, 'UNAUTHORIZED', 'Account disabled');
  req.admin = { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
  (req as any).sessionId = session.id;
  next();
});

const requireRole = (min: Role) => (req: AdminRequest, res: Response, next: NextFunction) => {
  if (!req.admin || RANK[req.admin.role] < RANK[min]) {
    res.status(403).json({ code: 'FORBIDDEN', message: `Requires ${min} role or higher` });
    return;
  }
  next();
};

// ======================= Authentication =======================

const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

router.post('/auth/login', rateLimit({ name: 'admin-login', windowMs: 15 * 60 * 1000, max: 10, key: (r) => `${r.ip}|${String(r.body?.email).toLowerCase()}` }),
  ah(async (req: Request, res: Response) => {
    const { email, password, totp } = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200), totp: z.string().optional() }), req.body);
    const admin = await knex('admin_users').where({ email }).first();
    // Always check a password hash, so an unknown email takes as long as a wrong password (no hint which emails exist)
    const passwordOk = bcrypt.compareSync(password, admin?.password_hash || DUMMY_HASH);
    const ok = admin && admin.status === 'ACTIVE' && passwordOk;
    if (!ok) {
      await knex('audit_logs').insert({ id: crypto.randomUUID(), admin_email: email, action: 'LOGIN_FAILED', entity_type: 'ADMIN', details_json: '{}', ip: req.ip, created_at: nowIso() });
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    if (bool(admin.totp_enabled)) {
      if (!totp) throw new HttpError(401, 'TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator app');
      if (!verifyTotp(admin.totp_secret, totp)) throw new HttpError(401, 'TOTP_INVALID', 'Authenticator code is incorrect');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.adminSessionHours * 3600000).toISOString();
    await knex('admin_sessions').insert({ id: crypto.randomUUID(), admin_id: admin.id, token_hash: sha256(token), expires_at: expiresAt,
      ip: req.ip, user_agent: String(req.headers['user-agent'] || '').slice(0, 255), created_at: nowIso() });
    await knex('admin_users').where({ id: admin.id }).update({ last_login_at: nowIso() });
    (req as AdminRequest).admin = { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
    await audit(req, 'LOGIN', 'ADMIN', admin.id);
    res.json({ token, expiresAt, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role, totpEnabled: bool(admin.totp_enabled) } });
  }));

router.use(authenticate);

// App Updates page (upload a signed installer, publish it to every client).
registerUpdateRoutes(router, requireRole);

router.get('/live', (req, res) => {
  attachAdminStream(res);
});

router.post('/auth/logout', ah(async (req: AdminRequest, res: Response) => {
  await knex('admin_sessions').where({ id: (req as any).sessionId }).update({ revoked_at: nowIso() });
  await audit(req, 'LOGOUT', 'ADMIN', req.admin!.id);
  res.json({ ok: true });
}));

router.get('/auth/me', ah(async (req: AdminRequest, res: Response) => {
  const a = await knex('admin_users').where({ id: req.admin!.id }).first();
  res.json({ admin: { id: a.id, email: a.email, name: a.name, role: a.role, totpEnabled: bool(a.totp_enabled) } });
}));

router.post('/auth/change-password', ah(async (req: AdminRequest, res: Response) => {
  const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string(), newPassword: z.string().min(10, 'Use at least 10 characters').max(200) }), req.body);
  const a = await knex('admin_users').where({ id: req.admin!.id }).first();
  if (!bcrypt.compareSync(currentPassword, a.password_hash)) throw new HttpError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
  await knex('admin_users').where({ id: a.id }).update({ password_hash: bcrypt.hashSync(newPassword, 12) });
  await knex('admin_sessions').where({ admin_id: a.id }).whereNot({ id: (req as any).sessionId }).update({ revoked_at: nowIso() });
  await audit(req, 'PASSWORD_CHANGED', 'ADMIN', a.id);
  res.json({ ok: true });
}));

router.post('/auth/totp/setup', ah(async (req: AdminRequest, res: Response) => {
  // While two-step login is on, a new secret would switch it off: that needs the current code (Turn off) first
  const current = await knex('admin_users').where({ id: req.admin!.id }).first();
  if (bool(current.totp_enabled)) {
    throw new HttpError(409, 'TOTP_ALREADY_ENABLED', 'Two-step login is already on. Turn it off with a code from your app first.');
  }
  const secret = base32Encode(crypto.randomBytes(20));
  await knex('admin_users').where({ id: req.admin!.id }).update({ totp_secret: secret, totp_enabled: false });
  const label = encodeURIComponent(`Apna Billing Admin:${req.admin!.email}`);
  res.json({ secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=Apna%20Billing` });
}));

router.post('/auth/totp/enable', ah(async (req: AdminRequest, res: Response) => {
  const { code } = parse(z.object({ code: z.string() }), req.body);
  const a = await knex('admin_users').where({ id: req.admin!.id }).first();
  if (!a.totp_secret || !verifyTotp(a.totp_secret, code)) throw new HttpError(400, 'TOTP_INVALID', 'Code is incorrect. Check your device time and try again.');
  await knex('admin_users').where({ id: a.id }).update({ totp_enabled: true });
  await audit(req, 'TOTP_ENABLED', 'ADMIN', a.id);
  res.json({ ok: true });
}));

router.post('/auth/totp/disable', ah(async (req: AdminRequest, res: Response) => {
  const { code } = parse(z.object({ code: z.string() }), req.body);
  const a = await knex('admin_users').where({ id: req.admin!.id }).first();
  if (!bool(a.totp_enabled) || !verifyTotp(a.totp_secret, code)) throw new HttpError(400, 'TOTP_INVALID', 'Code is incorrect');
  await knex('admin_users').where({ id: a.id }).update({ totp_enabled: false, totp_secret: null });
  await audit(req, 'TOTP_DISABLED', 'ADMIN', a.id);
  res.json({ ok: true });
}));

// ======================= Dashboard =======================

router.get('/dashboard', ah(async (req: Request, res: Response) => {
  const now = nowIso();
  const in7 = new Date(Date.now() + 7 * DAY).toISOString();
  const day1 = new Date(Date.now() - DAY).toISOString();
  const count = async (q: any) => Number((await q.count({ c: '*' }))[0].c);
  const licenses = () => knex('licenses');
  const stats = {
    totalInstallations: await count(knex('installations')),
    activeInstallations: await count(knex('installations').where({ status: 'ACTIVE' })),
    seenLast24h: await count(knex('installations').where('last_seen_at', '>=', day1)),
    totalCustomers: await count(knex('customers')),
    activeTrials: await count(licenses().where({ type: 'TRIAL', status: 'ACTIVE' }).andWhere('expires_at', '>', now)),
    activePaid: await count(licenses().where({ type: 'PAID', status: 'ACTIVE' }).andWhere((q) => q.whereNull('expires_at').orWhere('expires_at', '>', now))),
    expired: await count(licenses().where({ status: 'ACTIVE' }).andWhere('expires_at', '<=', now)),
    suspended: await count(licenses().where({ status: 'SUSPENDED' })),
    revoked: await count(licenses().where({ status: 'REVOKED' })),
    expiringIn7Days: await count(licenses().where({ status: 'ACTIVE' }).andWhere('expires_at', '>', now).andWhere('expires_at', '<=', in7)),
    totalPaidLicenses: await count(licenses().where({ type: 'PAID' })),
    totalTrials: await count(licenses().where({ type: 'TRIAL' })),
  };
  const trialCustomers = await knex('licenses').where({ type: 'TRIAL' }).distinct('customer_id');
  const converted = trialCustomers.length === 0 ? 0 : Number((await knex('licenses').where({ type: 'PAID' }).whereIn('customer_id', trialCustomers.map((t: any) => t.customer_id)).countDistinct({ c: 'customer_id' }))[0].c);
  const upcomingExpirations = await knex('licenses as l').join('customers as c', 'c.id', 'l.customer_id').join('plans as p', 'p.id', 'l.plan_id')
    .where('l.status', 'ACTIVE').andWhere('l.expires_at', '>', now).andWhere('l.expires_at', '<=', new Date(Date.now() + 30 * DAY).toISOString())
    .select('l.id', 'l.license_key', 'l.type', 'l.expires_at', 'c.name as customer_name', 'c.business_name', 'p.name as plan_name').orderBy('l.expires_at').limit(10);
  const recentActivity = await knex('license_events as e').leftJoin('customers as c', 'c.id', 'e.customer_id')
    .select('e.*', 'c.name as customer_name').orderBy('e.created_at', 'desc').limit(15);
  const since30 = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const featureUsage = await knex('usage_daily').where('usage_date', '>=', since30).select('feature_key').sum({ count: 'count' })
    .countDistinct({ installations: 'installation_id' }).groupBy('feature_key').orderBy('count', 'desc');
  res.json({
    stats: { ...stats, trialConversions: converted, trialConversionRate: trialCustomers.length ? Math.round((converted / trialCustomers.length) * 1000) / 10 : 0 },
    upcomingExpirations,
    recentActivity: recentActivity.map((e: any) => ({ ...e, details: parseJson(e.details_json, {}) })),
    featureUsage: featureUsage.map((f: any) => ({ feature: f.feature_key, count: Number(f.count), installations: Number(f.installations) })),
  });
}));

// ======================= Customers =======================

const customerSchema = z.object({
  name: z.string().trim().min(1).max(150),
  businessName: z.string().trim().max(150).optional().nullable(),
  email: z.string().trim().toLowerCase().email().max(150).optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(30).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

router.get('/customers', ah(async (req: Request, res: Response) => {
  const search = String(req.query.search || '').trim();
  const q = knex('customers as c').select('c.*',
    knex.raw('(SELECT COUNT(*) FROM licenses l WHERE l.customer_id = c.id) AS license_count'),
    knex.raw('(SELECT COUNT(*) FROM installations i WHERE i.customer_id = c.id AND i.status != ?) AS installation_count', ['DEACTIVATED']),
    knex.raw('(SELECT MAX(i.last_seen_at) FROM installations i WHERE i.customer_id = c.id) AS last_seen_at'))
    .orderBy('c.created_at', 'desc').limit(500);
  if (search) q.where((w) => w.where('c.name', 'like', `%${search}%`).orWhere('c.email', 'like', `%${search}%`).orWhere('c.business_name', 'like', `%${search}%`).orWhere('c.phone', 'like', `%${search}%`));
  res.json({ data: (await q).map((r: any) => ({ ...publicCustomer(r), license_count: Number(r.license_count), installation_count: Number(r.installation_count) })) });
}));

router.post('/customers', requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
  const c = parse(customerSchema, req.body);
  const id = crypto.randomUUID();
  await knex('customers').insert({ id, name: c.name, business_name: c.businessName || null, email: c.email || null, phone: c.phone || null,
    notes: c.notes || null, status: 'ACTIVE', created_at: nowIso(), updated_at: nowIso() });
  await audit(req, 'CUSTOMER_CREATED', 'CUSTOMER', id, { name: c.name });
  res.status(201).json({ customer: publicCustomer(await knex('customers').where({ id }).first()) });
}));

router.get('/customers/:id', ah(async (req: Request, res: Response) => {
  const customer = await knex('customers').where({ id: req.params.id }).first();
  if (!customer) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
  const licenses = await knex('licenses as l').join('plans as p', 'p.id', 'l.plan_id').where('l.customer_id', customer.id)
    .select('l.*', 'p.name as plan_name', 'p.code as plan_code').orderBy('l.created_at', 'desc');
  const installations = await knex('installations').where({ customer_id: customer.id }).orderBy('installed_at', 'desc');
  const usage = await knex('usage_daily as u').join('installations as i', 'i.id', 'u.installation_id').where('i.customer_id', customer.id)
    .select('u.feature_key').sum({ count: 'u.count' }).min({ first_used: 'u.first_used_at' }).max({ last_used: 'u.last_used_at' })
    .groupBy('u.feature_key').orderBy('count', 'desc');
  const rev = Number(customer.app_account_rev || 0);
  res.json({
    customer: publicCustomer(customer),
    // The billing app's sign-in; "waiting" lists the computers that have not taken over the last change yet
    account: { ...accountSummary(customer), waiting: installations.filter((i: any) => i.status !== 'DEACTIVATED' && Number(i.account_rev || 0) < rev).length },
    licenses: licenses.map((l: any) => ({ ...l, effective_status: effectiveLicenseStatus(l) })),
    installations: installations.map(publicInstallation),
    usage: usage.map((u: any) => ({ ...u, count: Number(u.count) })),
  });
}));

router.put('/customers/:id', requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
  const c = parse(customerSchema.partial(), req.body);
  const existing = await knex('customers').where({ id: req.params.id }).first();
  if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
  const patch: Record<string, unknown> = { updated_at: nowIso() };
  if (c.name !== undefined) patch.name = c.name;
  if (c.businessName !== undefined) patch.business_name = c.businessName;
  if (c.email !== undefined) patch.email = c.email || null;
  if (c.phone !== undefined) patch.phone = c.phone;
  if (c.notes !== undefined) patch.notes = c.notes;
  if (c.status !== undefined) patch.status = c.status;
  await knex('customers').where({ id: existing.id }).update(patch);
  await audit(req, 'CUSTOMER_UPDATED', 'CUSTOMER', existing.id, { fields: Object.keys(c) });
  if (c.status !== undefined || c.name !== undefined || c.businessName !== undefined) await pushRefresh({ scope: 'CUSTOMER', id: existing.id }, 'CUSTOMER_UPDATED');
  res.json({ customer: publicCustomer(await knex('customers').where({ id: existing.id }).first()) });
}));

/** The billing app's password, shown on request to an owner only; every look is in the audit log */
router.post('/customers/:id/app-password', requireRole('OWNER'), ah(async (req: AdminRequest, res: Response) => {
  const customer = await knex('customers').where({ id: req.params.id }).first();
  if (!customer) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
  const password = openSecret(customer.app_password_enc);
  if (!password) {
    throw new HttpError(404, 'PASSWORD_NOT_KNOWN',
      'Not known yet: the shop’s app sends it the next time someone signs in (or sets a new password) on a computer with this version.');
  }
  await audit(req, 'APP_PASSWORD_VIEWED', 'CUSTOMER', customer.id, { email: customer.app_email || customer.email });
  res.json({ password });
}));

/** New sign-in email and/or password for the billing app; every computer of the customer takes it over */
router.put('/customers/:id/app-account', requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
  const input = parse(z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email').max(150).optional(),
    password: z.string().min(8, 'The password needs at least 8 characters').max(200).optional(),
  }).refine((v) => v.email || v.password, 'Enter a new email or password'), req.body);
  const customer = await knex('customers').where({ id: req.params.id }).first();
  if (!customer) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
  if (input.email) {
    const other = await knex('customers').whereNot({ id: customer.id }).whereRaw('lower(app_email) = ?', [input.email]).first();
    if (other) throw new HttpError(409, 'EMAIL_IN_USE', `${input.email} is already the sign-in of ${other.business_name || other.name}.`);
  }
  const live = await changeAccount(customer.id, { ...input, by: 'ADMIN' });
  await audit(req, 'APP_ACCOUNT_CHANGED', 'CUSTOMER', customer.id, { email: input.email || undefined, passwordChanged: !!input.password });
  const fresh = await knex('customers').where({ id: customer.id }).first();
  res.json({ account: { ...accountSummary(fresh), waiting: 1 }, live });
}));

/**
 * Permanently delete a customer with their licenses, installations, usage, events, overrides and targeted notices.
 * The audit log keeps a record. Refused while any device could still renew: a deleted installation can no
 * longer receive a signed SUSPENDED/REVOKED token, so it would keep working until its offline grace ran out.
 */
router.delete('/customers/:id', requireRole('OWNER'), ah(async (req: AdminRequest, res: Response) => {
  const { confirmName, reason, eraseDevices } = parse(z.object({ confirmName: z.string().trim().min(1), reason: z.string().trim().max(500).optional(),
    // Also when computers still use a licence: each of them erases the shop (after saving a safety backup there)
    eraseDevices: z.boolean().optional() }), req.body);
  const customer = await knex('customers').where({ id: req.params.id }).first();
  if (!customer) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
  const expected = String(customer.business_name || customer.name).trim();
  if (confirmName.toLowerCase() !== expected.toLowerCase()) {
    throw new HttpError(400, 'CONFIRMATION_MISMATCH', `Type "${expected}" exactly to confirm.`);
  }

  const licenses = await knex('licenses').where({ customer_id: customer.id });
  const installations = await knex('installations').where({ customer_id: customer.id });
  const licenseById = new Map(licenses.map((l: any) => [l.id, l]));
  const live = installations.filter((i: any) => i.status === 'ACTIVE' && effectiveLicenseStatus(licenseById.get(i.license_id)) === 'ACTIVE');
  if (live.length && !eraseDevices) {
    throw new HttpError(409, 'CUSTOMER_HAS_ACTIVE_DEVICES',
      `${live.length} device(s) can still use a license (${live.map((i: any) => i.device_name || i.id).join(', ')}). ` +
      'Tick "Erase the shop on its computers too", or revoke the license first.');
  }

  const licenseIds = licenses.map((l: any) => l.id);
  const installationIds = installations.map((i: any) => i.id);
  // Tell every connected device before the rows are removed, so a signed-in app can sign out at once.
  await pushRefresh({ scope: 'CUSTOMER', id: customer.id }, 'CUSTOMER_DELETED');
  await knex.transaction(async (trx) => {
    if (installationIds.length) await trx('usage_daily').whereIn('installation_id', installationIds).delete();
    await trx('feature_overrides').where((w) => {
      w.where({ scope: 'CUSTOMER', scope_id: customer.id });
      if (licenseIds.length) w.orWhere((x) => x.where('scope', 'LICENSE').whereIn('scope_id', licenseIds));
      if (installationIds.length) w.orWhere((x) => x.where('scope', 'INSTALLATION').whereIn('scope_id', installationIds));
    }).delete();
    await trx('notices').where((w) => {
      w.where({ target_scope: 'CUSTOMER', target_id: customer.id });
      if (licenseIds.length) w.orWhere((x) => x.where('target_scope', 'LICENSE').whereIn('target_id', licenseIds));
      if (installationIds.length) w.orWhere((x) => x.where('target_scope', 'INSTALLATION').whereIn('target_id', installationIds));
    }).delete();
    await trx('license_events').where((w) => {
      w.where({ customer_id: customer.id });
      if (licenseIds.length) w.orWhereIn('license_id', licenseIds);
    }).delete();
    await trx('password_resets').where({ customer_id: customer.id }).delete();
    for (const t of ['sync_deltas', 'sync_rows', 'sync_devices', 'sync_workspaces']) await trx(t).where({ customer_id: customer.id }).delete();
    await trx('installations').where({ customer_id: customer.id }).delete();
    await trx('licenses').where({ customer_id: customer.id }).delete();
    await trx('customers').where({ id: customer.id }).delete();
  });
  await audit(req, 'CUSTOMER_DELETED', 'CUSTOMER', customer.id, {
    name: customer.name, businessName: customer.business_name, email: customer.email, reason: reason || null,
    licenses: licenses.map((l: any) => l.license_key), installations: installationIds.length,
  });
  res.json({ deleted: true });
}));

// ======================= Licenses =======================

function publicInstallation(i: any) {
  const { secret_hash, pending_secret_hash, fingerprint_hash, ...rest } = i;
  return { ...rest, force_revalidate: bool(i.force_revalidate), rotate_requested: bool(i.rotate_requested), has_fingerprint: !!fingerprint_hash };
}

async function loadLicense(id: string) {
  const l = await knex('licenses').where({ id }).first();
  if (!l) throw new HttpError(404, 'NOT_FOUND', 'License not found');
  return l;
}

router.get('/licenses', ah(async (req: Request, res: Response) => {
  const { type, status, search, customerId, expiringDays } = req.query as Record<string, string>;
  const now = nowIso();
  const q = knex('licenses as l').join('customers as c', 'c.id', 'l.customer_id').join('plans as p', 'p.id', 'l.plan_id')
    .select('l.*', 'c.name as customer_name', 'c.business_name', 'c.email as customer_email', 'p.name as plan_name', 'p.code as plan_code',
      knex.raw('(SELECT COUNT(*) FROM installations i WHERE i.license_id = l.id AND i.status != ?) AS device_count', ['DEACTIVATED']))
    .orderBy('l.created_at', 'desc').limit(1000);
  if (type) q.where('l.type', type);
  if (customerId) q.where('l.customer_id', customerId);
  if (status === 'EXPIRED') q.where('l.status', 'ACTIVE').andWhere('l.expires_at', '<=', now);
  else if (status === 'ACTIVE') q.where('l.status', 'ACTIVE').andWhere((w) => w.whereNull('l.expires_at').orWhere('l.expires_at', '>', now));
  else if (status) q.where('l.status', status);
  if (expiringDays) q.where('l.status', 'ACTIVE').andWhere('l.expires_at', '>', now).andWhere('l.expires_at', '<=', new Date(Date.now() + Number(expiringDays) * DAY).toISOString());
  if (search) q.where((w) => w.where('l.license_key', 'like', `%${search.toUpperCase()}%`).orWhere('c.name', 'like', `%${search}%`).orWhere('c.email', 'like', `%${search}%`));
  res.json({ data: (await q).map((l: any) => ({ ...l, device_count: Number(l.device_count), effective_status: effectiveLicenseStatus(l) })) });
}));

const createLicenseSchema = z.object({
  customerId: z.string().uuid(),
  planCode: z.string().min(1),
  type: z.enum(['TRIAL', 'PAID']).optional(),
  durationDays: z.number().int().min(1).max(36500).optional().nullable(), // custom duration; null with LIFETIME plan
  startsAt: z.string().datetime().optional(),
  maxDevices: z.number().int().min(1).max(1000).optional(),
  maxActivations: z.number().int().min(1).max(10000).optional().nullable(),
  paymentReference: z.string().max(120).optional().nullable(),
  paymentAmountPaise: z.number().int().min(0).optional().nullable(),
  paymentMethod: z.string().max(40).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

router.post('/licenses', requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
  const input = parse(createLicenseSchema, req.body);
  const customer = await knex('customers').where({ id: input.customerId }).first();
  if (!customer) throw new HttpError(400, 'CUSTOMER_NOT_FOUND', 'Customer not found');
  const plan = await knex('plans').where({ code: input.planCode }).first();
  if (!plan) throw new HttpError(400, 'PLAN_NOT_FOUND', 'Plan not found');
  const starts = input.startsAt ? new Date(input.startsAt) : new Date();
  const days = input.durationDays !== undefined ? input.durationDays : plan.duration_days;
  const id = crypto.randomUUID();
  let key = generateLicenseKey();
  while (await knex('licenses').where({ license_key: key }).first()) key = generateLicenseKey();
  const type = input.type || (bool(plan.is_trial) ? 'TRIAL' : 'PAID');
  await knex('licenses').insert({
    id, license_key: key, customer_id: customer.id, plan_id: plan.id, type, status: 'ACTIVE',
    starts_at: starts.toISOString(), expires_at: days ? new Date(starts.getTime() + days * DAY).toISOString() : null,
    max_devices: input.maxDevices || plan.max_devices, max_activations: input.maxActivations ?? null, activations_count: 0,
    payment_reference: input.paymentReference || null, payment_amount_paise: input.paymentAmountPaise ?? null, payment_method: input.paymentMethod || null,
    paid_at: input.paymentAmountPaise ? nowIso() : null, notes: input.notes || null, created_at: nowIso(), updated_at: nowIso(),
  });
  await licenseEvent({ licenseId: id, customerId: customer.id, type: 'LICENSE_CREATED', actor: req.admin!.id, details: { plan: plan.code, days, type } });
  await audit(req, 'LICENSE_CREATED', 'LICENSE', id, { plan: plan.code, customer: customer.name, days });
  res.status(201).json({ license: await knex('licenses').where({ id }).first() });
}));

router.get('/licenses/:id', ah(async (req: Request, res: Response) => {
  const license = await loadLicense(req.params.id);
  const plan = await knex('plans').where({ id: license.plan_id }).first();
  const customer = await knex('customers').where({ id: license.customer_id }).first();
  const installations = await knex('installations').where({ license_id: license.id }).orderBy('installed_at', 'desc');
  const events = await knex('license_events').where({ license_id: license.id }).orderBy('created_at', 'desc').limit(200);
  const overrides = await knex('feature_overrides').where({ scope: 'LICENSE', scope_id: license.id });
  const features = await resolveFeatures({ plan, customerId: customer.id, licenseId: license.id });
  res.json({
    license: { ...license, effective_status: effectiveLicenseStatus(license) }, plan, customer: publicCustomer(customer),
    installations: installations.map(publicInstallation),
    events: events.map((e: any) => ({ ...e, details: parseJson(e.details_json, {}) })),
    overrides, features,
  });
}));

async function licenseAction(req: AdminRequest, license: any, type: string, patch: Record<string, unknown>, details: Record<string, unknown> = {}) {
  await knex('licenses').where({ id: license.id }).update({ ...patch, updated_at: nowIso() });
  await licenseEvent({ licenseId: license.id, customerId: license.customer_id, type, actor: req.admin!.id, details });
  await audit(req, type, 'LICENSE', license.id, details);
  await pushRefresh({ scope: 'LICENSE', id: license.id }, type);
  return { ...(await knex('licenses').where({ id: license.id }).first()) };
}

router.post('/licenses/:id/extend', requireRole('SUPPORT'), ah(async (req: AdminRequest, res: Response) => {
  const input = parse(z.object({ days: z.number().int().min(1).max(36500).optional(), until: z.string().datetime().optional(), reason: z.string().max(255).optional() })
    .refine((v) => v.days || v.until, 'Provide days or until'), req.body);
  const license = await loadLicense(req.params.id);
  // SUPPORT may only extend trials; paid extensions need ADMIN.
  if (license.type !== 'TRIAL' && RANK[req.admin!.role] < RANK.ADMIN) throw new HttpError(403, 'FORBIDDEN', 'Only admins can extend paid licenses');
  if (!license.expires_at) throw new HttpError(409, 'LIFETIME', 'Lifetime licenses do not expire');
  const base = Math.max(Date.now(), Date.parse(license.expires_at));
  const expiresAt = input.until ? new Date(input.until).toISOString() : new Date(base + input.days! * DAY).toISOString();
  const updated = await licenseAction(req, license, license.type === 'TRIAL' ? 'TRIAL_EXTENDED' : 'LICENSE_EXTENDED',
    { expires_at: expiresAt }, { from: license.expires_at, to: expiresAt, reason: input.reason });
  res.json({ license: updated });
}));

router.post('/licenses/:id/renew', requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
  const input = parse(z.object({ planCode: z.string().optional(), paymentReference: z.string().max(120).optional(), paymentAmountPaise: z.number().int().min(0).optional(),
    paymentMethod: z.string().max(40).optional() }), req.body);
  const license = await loadLicense(req.params.id);
  const plan = input.planCode ? await knex('plans').where({ code: input.planCode }).first() : await knex('plans').where({ id: license.plan_id }).first();
  if (!plan) throw new HttpError(400, 'PLAN_NOT_FOUND', 'Plan not found');
  if (bool(plan.is_trial)) throw new HttpError(400, 'INVALID_PLAN', 'Renew with a paid plan');
  const base = license.expires_at ? Math.max(Date.now(), Date.parse(license.expires_at)) : Date.now();
  const expiresAt = plan.duration_days ? new Date(base + plan.duration_days * DAY).toISOString() : null;
  const updated = await licenseAction(req, license, 'LICENSE_RENEWED', {
    plan_id: plan.id, type: 'PAID', expires_at: expiresAt, status: license.status === 'REVOKED' ? 'REVOKED' : 'ACTIVE',
    payment_reference: input.paymentReference ?? license.payment_reference, payment_amount_paise: input.paymentAmountPaise ?? license.payment_amount_paise,
    payment_method: input.paymentMethod ?? license.payment_method, paid_at: input.paymentAmountPaise ? nowIso() : license.paid_at,
  }, { plan: plan.code, from: license.expires_at, to: expiresAt, amountPaise: input.paymentAmountPaise });
  res.json({ license: updated });
}));

router.post('/licenses/:id/convert', requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
  const input = parse(z.object({ planCode: z.string(), paymentReference: z.string().max(120).optional(), paymentAmountPaise: z.number().int().min(0).optional() }), req.body);
  const license = await loadLicense(req.params.id);
  if (license.type !== 'TRIAL') throw new HttpError(409, 'NOT_TRIAL', 'Only trials can be converted');
  const plan = await knex('plans').where({ code: input.planCode }).first();
  if (!plan || bool(plan.is_trial)) throw new HttpError(400, 'INVALID_PLAN', 'Choose a paid plan');
  const expiresAt = plan.duration_days ? new Date(Date.now() + plan.duration_days * DAY).toISOString() : null;
  const updated = await licenseAction(req, license, 'TRIAL_CONVERTED', {
    type: 'PAID', plan_id: plan.id, status: 'ACTIVE', expires_at: expiresAt, max_devices: Math.max(license.max_devices, plan.max_devices), max_activations: null,
    payment_reference: input.paymentReference || null, payment_amount_paise: input.paymentAmountPaise ?? null, paid_at: input.paymentAmountPaise ? nowIso() : null,
  }, { plan: plan.code, expiresAt });
  res.json({ license: updated });
}));

router.post('/licenses/:id/change-plan', requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
  const { planCode, resetExpiry } = parse(z.object({ planCode: z.string(), resetExpiry: z.boolean().default(false) }), req.body);
  const license = await loadLicense(req.params.id);
  const plan = await knex('plans').where({ code: planCode }).first();
  if (!plan) throw new HttpError(400, 'PLAN_NOT_FOUND', 'Plan not found');
  const isTrial = bool(plan.is_trial);
  const patch: Record<string, unknown> = {
    plan_id: plan.id,
    // Keep license.type in sync with the plan — otherwise the app shows "Free Trial" but hides the activate key field.
    type: isTrial ? 'TRIAL' : 'PAID',
  };
  if (resetExpiry || (isTrial && !license.expires_at)) {
    patch.expires_at = plan.duration_days ? new Date(Date.now() + plan.duration_days * DAY).toISOString() : null;
  }
  if (isTrial) {
    patch.max_devices = plan.max_devices;
  }
  res.json({ license: await licenseAction(req, license, 'PLAN_CHANGED', patch, { to: plan.code, resetExpiry, type: patch.type }) });
}));

for (const [action, status, event] of [['suspend', 'SUSPENDED', 'LICENSE_SUSPENDED'], ['reactivate', 'ACTIVE', 'LICENSE_REACTIVATED'], ['revoke', 'REVOKED', 'LICENSE_REVOKED']] as const) {
  router.post(`/licenses/:id/${action}`, requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
    const { reason } = parse(z.object({ reason: z.string().max(255).optional() }), req.body || {});
    const license = await loadLicense(req.params.id);
    if (license.status === 'REVOKED' && action !== 'revoke') throw new HttpError(409, 'REVOKED', 'Revoked licenses cannot be reactivated. Issue a new license.');
    if (action === 'revoke' && license.type === 'TRIAL' && RANK[req.admin!.role] < RANK.ADMIN) throw new HttpError(403, 'FORBIDDEN', 'Forbidden');
    res.json({ license: await licenseAction(req, license, event, { status }, { reason }) });
  }));
}

router.post('/licenses/:id/cancel-trial', requireRole('SUPPORT'), ah(async (req: AdminRequest, res: Response) => {
  const license = await loadLicense(req.params.id);
  if (license.type !== 'TRIAL') throw new HttpError(409, 'NOT_TRIAL', 'Not a trial license');
  res.json({ license: await licenseAction(req, license, 'TRIAL_CANCELLED', { status: 'REVOKED', expires_at: nowIso() }, {}) });
}));

router.put('/licenses/:id', requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
  const input = parse(z.object({
    maxDevices: z.number().int().min(1).max(1000).optional(),
    maxActivations: z.number().int().min(1).max(10000).nullable().optional(),
    // "Activations used" set back, e.g. to the computers that still use the licence (after uninstalls or deletions)
    activationsCount: z.number().int().min(0).max(100000).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    paymentReference: z.string().max(120).nullable().optional(),
    paymentAmountPaise: z.number().int().min(0).nullable().optional(),
    paymentMethod: z.string().max(40).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  }), req.body);
  const license = await loadLicense(req.params.id);
  const patch: Record<string, unknown> = {};
  if (input.maxDevices !== undefined) patch.max_devices = input.maxDevices;
  if (input.maxActivations !== undefined) patch.max_activations = input.maxActivations;
  if (input.activationsCount !== undefined) patch.activations_count = input.activationsCount;
  if (input.expiresAt !== undefined) patch.expires_at = input.expiresAt;
  if (input.paymentReference !== undefined) patch.payment_reference = input.paymentReference;
  if (input.paymentAmountPaise !== undefined) patch.payment_amount_paise = input.paymentAmountPaise;
  if (input.paymentMethod !== undefined) patch.payment_method = input.paymentMethod;
  if (input.notes !== undefined) patch.notes = input.notes;
  res.json({ license: await licenseAction(req, license, 'LICENSE_UPDATED', patch, input) });
}));

/** Permanently remove a license that is revoked, expired, or not in active use. */
router.delete('/licenses/:id', requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(500).optional() }), req.body || {});
  const license = await loadLicense(req.params.id);
  const eff = effectiveLicenseStatus(license);
  const installations = await knex('installations').where({ license_id: license.id });
  const live = installations.filter((i: any) => i.status === 'ACTIVE');

  if ((eff === 'ACTIVE' || eff === 'SUSPENDED') && live.length > 0) {
    throw new HttpError(409, 'LICENSE_IN_USE',
      `${live.length} device(s) are still attached (${live.map((i: any) => i.device_name || i.id).join(', ')}). ` +
      'Revoke the license or deactivate those devices first, then delete.');
  }

  const installationIds = installations.map((i: any) => i.id);
  await pushRefresh({ scope: 'LICENSE', id: license.id }, 'LICENSE_DELETED');
  await knex.transaction(async (trx) => {
    if (installationIds.length) await trx('usage_daily').whereIn('installation_id', installationIds).delete();
    await trx('feature_overrides').where((w) => {
      w.where({ scope: 'LICENSE', scope_id: license.id });
      if (installationIds.length) w.orWhere((x) => x.where('scope', 'INSTALLATION').whereIn('scope_id', installationIds));
    }).delete();
    await trx('notices').where((w) => {
      w.where({ target_scope: 'LICENSE', target_id: license.id });
      if (installationIds.length) w.orWhere((x) => x.where('target_scope', 'INSTALLATION').whereIn('target_id', installationIds));
    }).delete();
    await trx('license_events').where({ license_id: license.id }).delete();
    await trx('installations').where({ license_id: license.id }).delete();
    await trx('licenses').where({ id: license.id }).delete();
  });
  await audit(req, 'LICENSE_DELETED', 'LICENSE', license.id, {
    key: license.license_key, type: license.type, status: license.status, effectiveStatus: eff,
    customerId: license.customer_id, reason: reason || null, installations: installationIds.length,
  });
  res.json({ deleted: true, licenseKey: license.license_key });
}));

// ======================= Installations =======================

router.get('/installations', ah(async (req: Request, res: Response) => {
  const { status, search, customerId, licenseId, seenWithinDays } = req.query as Record<string, string>;
  const q = knex('installations as i').join('licenses as l', 'l.id', 'i.license_id').join('customers as c', 'c.id', 'i.customer_id').join('plans as p', 'p.id', 'l.plan_id')
    .select('i.*', 'l.license_key', 'l.type as license_type', 'l.status as license_status', 'l.expires_at', 'l.starts_at', 'c.name as customer_name',
      'c.business_name', 'p.name as plan_name', 'p.code as plan_code')
    .orderBy('i.last_seen_at', 'desc').limit(1000);
  if (status) q.where('i.status', status);
  if (customerId) q.where('i.customer_id', customerId);
  if (licenseId) q.where('i.license_id', licenseId);
  if (seenWithinDays) q.where('i.last_seen_at', '>=', new Date(Date.now() - Number(seenWithinDays) * DAY).toISOString());
  if (search) q.where((w) => w.where('i.device_name', 'like', `%${search}%`).orWhere('c.name', 'like', `%${search}%`).orWhere('i.id', 'like', `%${search}%`));
  const rows = await q;
  res.json({ data: rows.map((r: any) => ({ ...publicInstallation(r), live: isConnected(r.id), license_effective_status: effectiveLicenseStatus({ status: r.license_status, expires_at: r.expires_at }) })) });
}));

router.get('/installations/:id', ah(async (req: Request, res: Response) => {
  const inst = await knex('installations').where({ id: req.params.id }).first();
  if (!inst) throw new HttpError(404, 'NOT_FOUND', 'Installation not found');
  const license = await knex('licenses').where({ id: inst.license_id }).first();
  const plan = await knex('plans').where({ id: license.plan_id }).first();
  const customer = await knex('customers').where({ id: inst.customer_id }).first();
  const features = await resolveFeatures({ plan, customerId: customer.id, licenseId: license.id, installationId: inst.id });
  const overrides = await knex('feature_overrides').where({ scope: 'INSTALLATION', scope_id: inst.id });
  const usage = await knex('usage_daily').where({ installation_id: inst.id }).select('feature_key').sum({ count: 'count' })
    .min({ first_used: 'first_used_at' }).max({ last_used: 'last_used_at' }).countDistinct({ active_days: 'usage_date' }).groupBy('feature_key').orderBy('count', 'desc');
  const events = await knex('license_events').where({ installation_id: inst.id }).orderBy('created_at', 'desc').limit(100);
  res.json({
    installation: { ...publicInstallation(inst), live: isConnected(inst.id) }, license: { ...license, effective_status: effectiveLicenseStatus(license) }, plan, customer: publicCustomer(customer), features, overrides,
    usage: usage.map((u: any) => ({ ...u, count: Number(u.count), active_days: Number(u.active_days) })),
    events: events.map((e: any) => ({ ...e, details: parseJson(e.details_json, {}) })),
  });
}));

/**
 * Removes a device from the list for good (an uninstalled computer, or one the shop no longer has). If it is still
 * running it is signed out at once (or when it next connects); it keeps its data. The audit log keeps a record.
 */
router.delete('/installations/:id', requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
  const inst = await knex('installations').where({ id: req.params.id }).first();
  if (!inst) throw new HttpError(404, 'NOT_FOUND', 'Installation not found');
  const live = (await pushRefresh({ scope: 'INSTALLATION', id: inst.id }, 'INSTALLATION_DEACTIVATED')) > 0;
  await knex.transaction(async (trx) => {
    await trx('removed_installations').insert({ id: inst.id, reason: 'DELETED_BY_ADMIN', removed_at: nowIso() }).onConflict('id').ignore();
    await trx('feature_overrides').where({ scope: 'INSTALLATION', scope_id: inst.id }).delete();
    await trx('notices').where({ target_scope: 'INSTALLATION', target_id: inst.id }).delete();
    await trx('usage_daily').where({ installation_id: inst.id }).delete();
    await trx('sync_devices').where({ installation_id: inst.id }).delete();
    await trx('installations').where({ id: inst.id }).delete();
  });
  await licenseEvent({ licenseId: inst.license_id, customerId: inst.customer_id, type: 'INSTALLATION_DELETED', actor: req.admin!.id,
    details: { deviceName: inst.device_name, installationId: inst.id } });
  await audit(req, 'INSTALLATION_DELETED', 'INSTALLATION', inst.id, { deviceName: inst.device_name, customerId: inst.customer_id });
  res.json({ deleted: true, live });
}));

const INSTALLATION_ACTIONS: Record<string, { patch: () => Record<string, unknown>; event: string; role: Role }> = {
  suspend: { patch: () => ({ status: 'SUSPENDED' }), event: 'INSTALLATION_SUSPENDED', role: 'ADMIN' },
  activate: { patch: () => ({ status: 'ACTIVE', deactivated_at: null }), event: 'INSTALLATION_ACTIVATED', role: 'ADMIN' },
  deactivate: { patch: () => ({ status: 'DEACTIVATED', deactivated_at: nowIso() }), event: 'INSTALLATION_DEACTIVATED', role: 'ADMIN' },
  'force-revalidate': { patch: () => ({ force_revalidate: true }), event: 'REVALIDATION_FORCED', role: 'SUPPORT' },
  'clear-revalidate': { patch: () => ({ force_revalidate: false }), event: 'REVALIDATION_CLEARED', role: 'SUPPORT' },
  'rotate-credentials': { patch: () => ({ rotate_requested: true }), event: 'CREDENTIAL_ROTATION_REQUESTED', role: 'ADMIN' },
};

for (const [action, def] of Object.entries(INSTALLATION_ACTIONS)) {
  router.post(`/installations/:id/${action}`, requireRole(def.role), ah(async (req: AdminRequest, res: Response) => {
    const inst = await knex('installations').where({ id: req.params.id }).first();
    if (!inst) throw new HttpError(404, 'NOT_FOUND', 'Installation not found');
    if (action === 'activate' && inst.status === 'DEACTIVATED') {
      const license = await knex('licenses').where({ id: inst.license_id }).first();
      const active = await knex('installations').where({ license_id: license.id }).whereNot({ status: 'DEACTIVATED' }).count({ c: '*' });
      if (Number(active[0].c) >= license.max_devices) throw new HttpError(409, 'DEVICE_LIMIT_REACHED', 'Device limit reached for this license');
    }
    const { reason } = parse(z.object({ reason: z.string().max(255).optional() }), req.body || {});
    await knex('installations').where({ id: inst.id }).update(def.patch());
    await licenseEvent({ licenseId: inst.license_id, installationId: inst.id, customerId: inst.customer_id, type: def.event, actor: req.admin!.id, details: { reason } });
    await audit(req, def.event, 'INSTALLATION', inst.id, { reason });
    const live = (await pushRefresh({ scope: 'INSTALLATION', id: inst.id }, def.event)) > 0;
    res.json({ installation: publicInstallation(await knex('installations').where({ id: inst.id }).first()),
      note: live ? 'Applied now (device is online).' : 'Applied when the installation next connects.' });
  }));
}

// ======================= Plans =======================

const planSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/),
  name: z.string().trim().min(1).max(100),
  durationDays: z.number().int().min(1).max(36500).nullable(),
  pricePaise: z.number().int().min(0).default(0),
  maxDevices: z.number().int().min(1).max(1000).default(1),
  features: z.array(z.string()).refine((f) => f.every((k) => k === '*' || FEATURE_KEYS.includes(k)), 'Unknown feature key'),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(10),
});

router.get('/plans', ah(async (req: Request, res: Response) => {
  const plans = await knex('plans').orderBy('sort_order');
  res.json({ data: plans.map((p: any) => ({ ...p, is_trial: bool(p.is_trial), is_active: bool(p.is_active), features: parseJson(p.features_json, []) })) });
}));

router.post('/plans', requireRole('OWNER'), ah(async (req: AdminRequest, res: Response) => {
  const p = parse(planSchema, req.body);
  if (await knex('plans').where({ code: p.code }).first()) throw new HttpError(409, 'DUPLICATE', 'Plan code already exists');
  const id = crypto.randomUUID();
  await knex('plans').insert({ id, code: p.code, name: p.name, duration_days: p.durationDays, price_paise: p.pricePaise, max_devices: p.maxDevices,
    is_trial: false, features_json: JSON.stringify(p.features), is_active: p.isActive, sort_order: p.sortOrder, created_at: nowIso() });
  await audit(req, 'PLAN_CREATED', 'PLAN', id, { code: p.code });
  res.status(201).json({ plan: await knex('plans').where({ id }).first() });
}));

router.put('/plans/:id', requireRole('OWNER'), ah(async (req: AdminRequest, res: Response) => {
  const p = parse(planSchema.partial().omit({ code: true }), req.body);
  const plan = await knex('plans').where({ id: req.params.id }).first();
  if (!plan) throw new HttpError(404, 'NOT_FOUND', 'Plan not found');
  const patch: Record<string, unknown> = {};
  if (p.name !== undefined) patch.name = p.name;
  if (p.durationDays !== undefined) patch.duration_days = p.durationDays;
  if (p.pricePaise !== undefined) patch.price_paise = p.pricePaise;
  if (p.maxDevices !== undefined) patch.max_devices = p.maxDevices;
  if (p.features !== undefined) patch.features_json = JSON.stringify(p.features);
  if (p.isActive !== undefined) patch.is_active = p.isActive;
  if (p.sortOrder !== undefined) patch.sort_order = p.sortOrder;
  await knex('plans').where({ id: plan.id }).update(patch);
  await audit(req, 'PLAN_UPDATED', 'PLAN', plan.id, { code: plan.code, ...p });
  await pushRefresh({ scope: 'PLAN', id: plan.id }, 'PLAN_UPDATED');
  res.json({ plan: await knex('plans').where({ id: plan.id }).first() });
}));

// ======================= Feature permissions =======================

router.get('/features', ah(async (req: Request, res: Response) => {
  res.json({ data: FEATURES });
}));

router.get('/feature-overrides', ah(async (req: Request, res: Response) => {
  const { scope, scopeId } = req.query as Record<string, string>;
  const q = knex('feature_overrides').orderBy('created_at', 'desc');
  if (scope) q.where({ scope });
  if (scopeId !== undefined) q.where({ scope_id: scopeId });
  res.json({ data: (await q).map((o: any) => ({ ...o, enabled: bool(o.enabled) })) });
}));

const overrideSchema = z.object({
  scope: z.enum(['GLOBAL', 'CUSTOMER', 'LICENSE', 'INSTALLATION']),
  scopeId: z.string().max(36).default(''),
  featureKey: z.string().refine((k) => FEATURE_KEYS.includes(k), 'Unknown feature'),
  enabled: z.boolean(),
  expiresAt: z.string().datetime().nullable().optional(),
  reason: z.string().max(255).optional(),
});

/** Create or replace an override (enable / disable / temporary access / suspension). */
router.put('/feature-overrides', requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
  const o = parse(overrideSchema, req.body);
  const scopeId = o.scope === 'GLOBAL' ? '' : o.scopeId;
  if (o.scope !== 'GLOBAL') {
    const table = { CUSTOMER: 'customers', LICENSE: 'licenses', INSTALLATION: 'installations' }[o.scope];
    if (!scopeId || !(await knex(table).where({ id: scopeId }).first())) throw new HttpError(400, 'SCOPE_NOT_FOUND', `${o.scope.toLowerCase()} not found`);
  }
  const existing = await knex('feature_overrides').where({ scope: o.scope, scope_id: scopeId, feature_key: o.featureKey }).first();
  const row = { scope: o.scope, scope_id: scopeId, feature_key: o.featureKey, enabled: o.enabled, expires_at: o.expiresAt || null,
    reason: o.reason || null, created_by: req.admin!.id, created_at: nowIso() };
  if (existing) await knex('feature_overrides').where({ id: existing.id }).update(row);
  else await knex('feature_overrides').insert({ id: crypto.randomUUID(), ...row });
  const action = o.enabled ? (o.expiresAt ? 'FEATURE_TEMPORARILY_ENABLED' : 'FEATURE_ENABLED') : 'FEATURE_DISABLED';
  await audit(req, action, 'FEATURE', o.featureKey, { scope: o.scope, scopeId, expiresAt: o.expiresAt, reason: o.reason });
  if (o.scope === 'LICENSE') await licenseEvent({ licenseId: scopeId, type: action, actor: req.admin!.id, details: { feature: o.featureKey, expiresAt: o.expiresAt } });
  const pushed = await pushRefresh(o.scope === 'GLOBAL' ? { scope: 'ALL' } : { scope: o.scope, id: scopeId }, action);
  res.json({ pushed, override: await knex('feature_overrides').where({ scope: o.scope, scope_id: scopeId, feature_key: o.featureKey }).first() });
}));

/** Removing an override restores the inherited value (feature restoration). */
router.delete('/feature-overrides/:id', requireRole('ADMIN'), ah(async (req: AdminRequest, res: Response) => {
  const o = await knex('feature_overrides').where({ id: req.params.id }).first();
  if (!o) throw new HttpError(404, 'NOT_FOUND', 'Override not found');
  await knex('feature_overrides').where({ id: o.id }).delete();
  await audit(req, 'FEATURE_OVERRIDE_REMOVED', 'FEATURE', o.feature_key, { scope: o.scope, scopeId: o.scope_id });
  const pushed = await pushRefresh(o.scope === 'GLOBAL' ? { scope: 'ALL' } : { scope: o.scope, id: o.scope_id }, 'FEATURE_OVERRIDE_REMOVED');
  res.json({ ok: true, pushed });
}));

// ======================= Usage analytics =======================

router.get('/usage', ah(async (req: Request, res: Response) => {
  const { customerId, installationId, feature, from, to, licenseType, groupBy } = req.query as Record<string, string>;
  const base = () => {
    const q = knex('usage_daily as u').join('installations as i', 'i.id', 'u.installation_id').join('licenses as l', 'l.id', 'i.license_id')
      .join('customers as c', 'c.id', 'i.customer_id');
    if (customerId) q.where('i.customer_id', customerId);
    if (installationId) q.where('u.installation_id', installationId);
    if (feature) q.where('u.feature_key', feature);
    if (from) q.where('u.usage_date', '>=', from);
    if (to) q.where('u.usage_date', '<=', to);
    if (licenseType) q.where('l.type', licenseType);
    return q;
  };
  const byFeature = await base().select('u.feature_key').sum({ count: 'u.count' }).countDistinct({ installations: 'u.installation_id' })
    .countDistinct({ active_days: 'u.usage_date' }).min({ first_used: 'u.first_used_at' }).max({ last_used: 'u.last_used_at' })
    .groupBy('u.feature_key').orderBy('count', 'desc');
  const rows: any[] = groupBy === 'day'
    ? await base().select('u.usage_date').sum({ count: 'u.count' }).groupBy('u.usage_date').orderBy('u.usage_date')
    : await base().select('c.id as customer_id', 'c.name as customer_name', 'u.feature_key').sum({ count: 'u.count' })
      .max({ last_used: 'u.last_used_at' }).groupBy('c.id', 'c.name', 'u.feature_key').orderBy('c.name');
  res.json({
    byFeature: byFeature.map((f: any) => ({ ...f, count: Number(f.count), installations: Number(f.installations), active_days: Number(f.active_days) })),
    rows: rows.map((r) => ({ ...r, count: Number(r.count) })),
    features: FEATURES,
  });
}));

// ======================= Activity, notices, audit, settings =======================

router.get('/events', ah(async (req: Request, res: Response) => {
  const { type, licenseId, limit } = req.query as Record<string, string>;
  const q = knex('license_events as e').leftJoin('customers as c', 'c.id', 'e.customer_id').leftJoin('licenses as l', 'l.id', 'e.license_id')
    .select('e.*', 'c.name as customer_name', 'l.license_key').orderBy('e.created_at', 'desc').limit(Math.min(1000, Number(limit) || 300));
  if (type) q.where('e.event_type', type);
  if (licenseId) q.where('e.license_id', licenseId);
  res.json({ data: (await q).map((e: any) => ({ ...e, details: parseJson(e.details_json, {}) })) });
}));

router.get('/notices', ah(async (req: Request, res: Response) => {
  res.json({ data: await knex('notices').orderBy('created_at', 'desc').limit(200) });
}));

router.post('/notices', requireRole('SUPPORT'), ah(async (req: AdminRequest, res: Response) => {
  const n = parse(z.object({
    title: z.string().trim().min(1).max(150), message: z.string().trim().min(1).max(2000),
    level: z.enum(['INFO', 'WARNING', 'CRITICAL', 'UPDATE']).default('INFO'),
    targetScope: z.enum(['ALL', 'CUSTOMER', 'LICENSE', 'INSTALLATION']).default('ALL'), targetId: z.string().max(36).optional().nullable(),
    startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional().nullable(),
  }), req.body);
  if (n.targetScope !== 'ALL' && !n.targetId) throw new HttpError(400, 'TARGET_REQUIRED', 'Choose who receives this notice');
  const id = crypto.randomUUID();
  await knex('notices').insert({ id, title: n.title, message: n.message, level: n.level, target_scope: n.targetScope, target_id: n.targetId || null,
    starts_at: n.startsAt || nowIso(), ends_at: n.endsAt || null, created_by: req.admin!.id, created_at: nowIso() });
  await audit(req, 'NOTICE_CREATED', 'NOTICE', id, { title: n.title, target: n.targetScope });
  await pushRefresh(n.targetScope === 'ALL' ? { scope: 'ALL' } : { scope: n.targetScope, id: n.targetId! }, 'NOTICE_CREATED');
  res.status(201).json({ notice: await knex('notices').where({ id }).first() });
}));

router.delete('/notices/:id', requireRole('SUPPORT'), ah(async (req: AdminRequest, res: Response) => {
  const notice = await knex('notices').where({ id: req.params.id }).first();
  await knex('notices').where({ id: req.params.id }).update({ ends_at: nowIso() });
  await audit(req, 'NOTICE_ENDED', 'NOTICE', req.params.id);
  if (notice) await pushRefresh(notice.target_scope === 'ALL' || !notice.target_id ? { scope: 'ALL' } : { scope: notice.target_scope, id: notice.target_id }, 'NOTICE_ENDED');
  res.json({ ok: true });
}));

router.get('/audit-logs', requireRole('ADMIN'), ah(async (req: Request, res: Response) => {
  const { action, entityType, adminId } = req.query as Record<string, string>;
  const q = knex('audit_logs').orderBy('created_at', 'desc').limit(500);
  if (action) q.where({ action });
  if (entityType) q.where({ entity_type: entityType });
  if (adminId) q.where({ admin_id: adminId });
  res.json({ data: (await q).map((a: any) => ({ ...a, details: parseJson(a.details_json, {}) })) });
}));

const SETTING_KEYS = [...SMTP_KEYS, 'trial_days', 'trials_enabled', 'trial_one_per_email', 'trial_one_per_device', 'offline_grace_days', 'latest_version', 'min_supported_version', 'update_url', 'update_message'];

/** The settings, without the stored mail password (only whether one is set) */
async function publicSettings() {
  const { smtp_pass_enc, ...rest } = await getSettings();
  return { ...rest, smtp_pass_set: smtp_pass_enc ? '1' : '0', email_ready: (await emailConfigured()) ? '1' : '0' };
}

router.get('/settings', ah(async (req: Request, res: Response) => {
  res.json({ settings: await publicSettings() });
}));

router.put('/settings', requireRole('OWNER'), ah(async (req: AdminRequest, res: Response) => {
  const input = parse(z.record(z.string(), z.string().max(500)), req.body);
  // The mail password is kept encrypted; an empty value leaves it as it is
  if ('smtp_pass' in input) {
    if (input.smtp_pass) await setSetting('smtp_pass_enc', sealSecret(input.smtp_pass));
    delete input.smtp_pass;
  }
  for (const [k, v] of Object.entries(input)) {
    if (!SETTING_KEYS.includes(k)) throw new HttpError(400, 'UNKNOWN_SETTING', `Unknown setting ${k}`);
    if (k === 'smtp_port' && v && !(Number(v) >= 1 && Number(v) <= 65535)) throw new HttpError(400, 'INVALID_SETTING', 'The mail port must be a number like 587 or 465');
    if (['trial_days', 'offline_grace_days'].includes(k) && !(Number(v) >= 1 && Number(v) <= 365)) throw new HttpError(400, 'INVALID_SETTING', `${k} must be 1–365`);
    if (['latest_version', 'min_supported_version'].includes(k) && v && !/^\d+\.\d+\.\d+(\+\d+)?$/.test(v)) throw new HttpError(400, 'INVALID_SETTING', `${k} must look like 1.2.3 (or 1.2.3+2)`);
    await setSetting(k, v);
  }
  await audit(req, 'SETTINGS_UPDATED', 'SETTINGS', null, input);
  if (Object.keys(input).some((k) => !SMTP_KEYS.includes(k))) await pushRefresh({ scope: 'ALL' }, 'SETTINGS_UPDATED');
  res.json({ settings: await publicSettings() });
}));

/** Sends a sample reset-code email, to check the mail settings */
router.post('/settings/test-email', requireRole('OWNER'), ah(async (req: AdminRequest, res: Response) => {
  const { to } = parse(z.object({ to: z.string().trim().email('Enter a valid email') }), req.body);
  const mail = codeEmail('123456', 'Test email');
  await sendMail(to, 'Apna Billing test email', `This is a test.\n\n${mail.text}`, mail.html);
  res.json({ ok: true });
}));

// ======================= Admin users =======================

router.get('/admin-users', requireRole('OWNER'), ah(async (req: Request, res: Response) => {
  const rows = await knex('admin_users').select('id', 'email', 'name', 'role', 'status', 'totp_enabled', 'last_login_at', 'created_at').orderBy('created_at');
  res.json({ data: rows.map((r: any) => ({ ...r, totp_enabled: bool(r.totp_enabled) })) });
}));

router.post('/admin-users', requireRole('OWNER'), ah(async (req: AdminRequest, res: Response) => {
  const u = parse(z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1).max(120),
    role: z.enum(['OWNER', 'ADMIN', 'SUPPORT', 'VIEWER']), password: z.string().min(10).max(200) }), req.body);
  if (await knex('admin_users').where({ email: u.email }).first()) throw new HttpError(409, 'DUPLICATE', 'An admin with this email exists');
  const id = crypto.randomUUID();
  await knex('admin_users').insert({ id, email: u.email, name: u.name, role: u.role, password_hash: bcrypt.hashSync(u.password, 12), status: 'ACTIVE',
    totp_enabled: false, created_at: nowIso() });
  await audit(req, 'ADMIN_CREATED', 'ADMIN', id, { email: u.email, role: u.role });
  res.status(201).json({ id });
}));

router.put('/admin-users/:id', requireRole('OWNER'), ah(async (req: AdminRequest, res: Response) => {
  const u = parse(z.object({ role: z.enum(['OWNER', 'ADMIN', 'SUPPORT', 'VIEWER']).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    password: z.string().min(10).max(200).optional() }), req.body);
  const target = await knex('admin_users').where({ id: req.params.id }).first();
  if (!target) throw new HttpError(404, 'NOT_FOUND', 'Admin not found');
  if (target.id === req.admin!.id && (u.status === 'DISABLED' || (u.role && u.role !== 'OWNER'))) {
    throw new HttpError(409, 'SELF_LOCKOUT', 'You cannot disable or demote your own account');
  }
  const patch: Record<string, unknown> = {};
  if (u.role) patch.role = u.role;
  if (u.status) patch.status = u.status;
  if (u.password) patch.password_hash = bcrypt.hashSync(u.password, 12);
  await knex('admin_users').where({ id: target.id }).update(patch);
  if (u.status === 'DISABLED' || u.password) await knex('admin_sessions').where({ admin_id: target.id }).update({ revoked_at: nowIso() });
  await audit(req, 'ADMIN_UPDATED', 'ADMIN', target.id, { role: u.role, status: u.status, passwordReset: !!u.password });
  res.json({ ok: true });
}));

export default router;
