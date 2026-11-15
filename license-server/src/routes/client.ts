import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { knex, nowIso, bool } from '../db.js';
import { ah, parse, HttpError, rateLimit, licenseEvent } from '../lib.js';
import { sha256, randomSecret, generateLicenseKey, safeEqualHex } from '../signing.js';
import { issueForInstallation, getSettings, effectiveLicenseStatus } from '../entitlements.js';
import { FEATURE_KEYS } from '../features.js';
import { attachStream } from '../realtime.js';
import { publishAdmin } from '../adminLive.js';

const router = Router();

/** Whether this computer still belongs to a customer. Used after a removal so the shop app can erase local data. */
router.post('/device-status', ah(async (req: Request, res: Response) => {
  const { fingerprint } = parse(z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }), req.body);
  const row = await knex('installations').where({ fingerprint_hash: sha256(fingerprint) }).first();
  res.json({ known: !!row });
}));

// Unauthenticated activation endpoints are tightly limited per IP.
router.use(['/trial', '/activate'], rateLimit({ name: 'activate', windowMs: 60 * 60 * 1000, max: 20 }));
router.use(rateLimit({ name: 'client', windowMs: 60 * 1000, max: 120 }));

const deviceSchema = z.object({
  deviceName: z.string().trim().max(100).default('Unknown device'),
  os: z.string().trim().max(100).default('Unknown OS'),
  appVersion: z.string().trim().max(30).regex(/^[\d.]+[-\w.]*$/).default('0.0.0'),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

interface ClientRequest extends Request {
  installation?: any;
}

/** Bearer <installationId>.<secret>. Secrets are stored only as SHA-256 hashes and can be rotated. */
const clientAuth = ah(async (req: ClientRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/);
  if (!m) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Missing or malformed installation credentials');
  const inst = await knex('installations').where({ id: m[1] }).first();
  const hash = sha256(m[2]);
  if (!inst) throw new HttpError(401, 'INSTALLATION_REMOVED', 'This computer is no longer registered');
  if (safeEqualHex(hash, inst.secret_hash)) {
    req.installation = inst;
    return next();
  }
  // Credential rotation: the first request made with the new secret promotes it.
  if (inst.pending_secret_hash && safeEqualHex(hash, inst.pending_secret_hash)) {
    await knex('installations').where({ id: inst.id }).update({ secret_hash: inst.pending_secret_hash, pending_secret_hash: null });
    await licenseEvent({ licenseId: inst.license_id, installationId: inst.id, customerId: inst.customer_id, type: 'CREDENTIALS_ROTATED', actor: 'client' });
    req.installation = { ...inst, secret_hash: inst.pending_secret_hash, pending_secret_hash: null };
    return next();
  }
  throw new HttpError(401, 'INVALID_CREDENTIALS', 'Installation credentials are not valid');
});

async function createInstallation(license: any, device: z.infer<typeof deviceSchema>, ip: string | undefined) {
  const id = crypto.randomUUID();
  const secret = randomSecret();
  const now = nowIso();
  await knex.transaction(async (trx) => {
    await trx('installations').insert({
      id, license_id: license.id, customer_id: license.customer_id, device_name: device.deviceName, os: device.os,
      app_version: device.appVersion, fingerprint_hash: device.fingerprint ? sha256(device.fingerprint) : null,
      secret_hash: sha256(secret), status: 'ACTIVE', installed_at: now, activated_at: now, last_seen_at: now,
      last_verified_at: now, last_ip: ip || null,
    });
    await trx('licenses').where({ id: license.id }).update({ activations_count: trx.raw('activations_count + 1'), updated_at: now });
  });
  await licenseEvent({ licenseId: license.id, installationId: id, customerId: license.customer_id, type: 'ACTIVATED', actor: 'client',
    details: { deviceName: device.deviceName, os: device.os, appVersion: device.appVersion } });
  const issued = await issueForInstallation(id);
  return { installationId: id, installationSecret: secret, ...issued };
}

async function assertDeviceCapacity(license: any) {
  const active = await knex('installations').where({ license_id: license.id }).whereNot({ status: 'DEACTIVATED' }).count<{ c: number }[]>({ c: '*' });
  if (Number(active[0].c) >= license.max_devices) {
    throw new HttpError(409, 'DEVICE_LIMIT_REACHED', `This license is already active on ${license.max_devices} device(s). Deactivate another device or contact support.`);
  }
  if (license.max_activations !== null && license.max_activations !== undefined && license.activations_count >= license.max_activations) {
    throw new HttpError(409, 'ACTIVATION_LIMIT_REACHED', 'This license has reached its activation limit. Contact support.');
  }
}

const trialSchema = z.object({
  name: z.string().trim().min(2).max(120),
  businessName: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(150),
  phone: z.string().trim().max(30).optional(),
  device: deviceSchema,
});

router.post('/trial', ah(async (req: Request, res: Response) => {
  const input = parse(trialSchema, req.body);
  const settings = await getSettings();
  if (settings.trials_enabled !== '1') throw new HttpError(403, 'TRIALS_DISABLED', 'Free trials are currently unavailable. Please contact sales.');

  let customer = await knex('customers').where({ email: input.email }).first();
  if (customer && settings.trial_one_per_email === '1') {
    const priorTrial = await knex('licenses').where({ customer_id: customer.id, type: 'TRIAL' }).first();
    if (priorTrial) throw new HttpError(409, 'TRIAL_ALREADY_USED', 'A free trial has already been used with this email address.');
  }
  if (input.device.fingerprint && settings.trial_one_per_device === '1') {
    const seen = await knex('installations as i').join('licenses as l', 'l.id', 'i.license_id')
      .where('i.fingerprint_hash', sha256(input.device.fingerprint)).andWhere('l.type', 'TRIAL').first();
    if (seen) throw new HttpError(409, 'TRIAL_ALREADY_USED', 'A free trial has already been used on this computer.');
  }

  const plan = await knex('plans').where({ code: 'TRIAL' }).first();
  const days = Math.max(1, Number(settings.trial_days) || plan.duration_days || 7);
  const now = new Date();
  const licenseId = crypto.randomUUID();
  await knex.transaction(async (trx) => {
    if (!customer) {
      customer = { id: crypto.randomUUID(), name: input.name, business_name: input.businessName, email: input.email, phone: input.phone || null,
        status: 'ACTIVE', created_at: now.toISOString(), updated_at: now.toISOString() };
      await trx('customers').insert(customer);
    }
    await trx('licenses').insert({
      id: licenseId, license_key: generateLicenseKey(), customer_id: customer.id, plan_id: plan.id, type: 'TRIAL', status: 'ACTIVE',
      starts_at: now.toISOString(), expires_at: new Date(now.getTime() + days * 86400000).toISOString(), max_devices: plan.max_devices,
      max_activations: 2, activations_count: 0, created_at: now.toISOString(), updated_at: now.toISOString(),
    });
  });
  await licenseEvent({ licenseId, customerId: customer.id, type: 'TRIAL_STARTED', actor: 'client', details: { days, email: input.email } });
  const license = await knex('licenses').where({ id: licenseId }).first();
  res.status(201).json(await createInstallation(license, input.device, req.ip));
}));

router.post('/activate', ah(async (req: Request, res: Response) => {
  const input = parse(z.object({ licenseKey: z.string().trim().toUpperCase().regex(/^APNA(-[A-Z0-9]{4}){4}$/, 'Invalid license key format'), device: deviceSchema }), req.body);
  const license = await knex('licenses').where({ license_key: input.licenseKey }).first();
  if (!license) throw new HttpError(404, 'LICENSE_NOT_FOUND', 'License key not recognised');
  const status = effectiveLicenseStatus(license);
  if (status !== 'ACTIVE') throw new HttpError(403, `LICENSE_${status}`, `This license is ${status.toLowerCase()}.`);

  // Same computer already licensed: re-issue, or upgrade a trial seat onto this paid key.
  if (input.device.fingerprint) {
    const existing = await knex('installations')
      .where({ fingerprint_hash: sha256(input.device.fingerprint) })
      .whereNot({ status: 'DEACTIVATED' })
      .first();
    if (existing) {
      const now = nowIso();
      const secret = randomSecret();
      const touch = {
        secret_hash: sha256(secret),
        pending_secret_hash: null,
        status: 'ACTIVE',
        device_name: input.device.deviceName,
        os: input.device.os,
        app_version: input.device.appVersion,
        last_seen_at: now,
        last_verified_at: now,
        last_ip: req.ip || null,
        deactivated_at: null,
      };

      if (existing.license_id === license.id) {
        await knex('installations').where({ id: existing.id }).update(touch);
        const issued = await issueForInstallation(existing.id);
        res.json({ installationId: existing.id, installationSecret: secret, ...issued });
        return;
      }

      const oldLic = await knex('licenses').where({ id: existing.license_id }).first();
      const oldPlan = oldLic ? await knex('plans').where({ id: oldLic.plan_id }).first() : null;
      const oldIsTrial = !!oldLic && (oldLic.type === 'TRIAL' || bool(oldPlan?.is_trial));
      if (oldIsTrial && oldLic.customer_id === license.customer_id) {
        await assertDeviceCapacity(license);
        await knex.transaction(async (trx) => {
          await trx('installations').where({ id: existing.id }).update({
            ...touch,
            license_id: license.id,
            customer_id: license.customer_id,
          });
          await trx('licenses').where({ id: license.id }).update({
            activations_count: trx.raw('activations_count + 1'),
            updated_at: now,
          });
        });
        await licenseEvent({
          licenseId: license.id, installationId: existing.id, customerId: license.customer_id,
          type: 'ACTIVATED', actor: 'client',
          details: { upgradedFrom: oldLic.id, deviceName: input.device.deviceName },
        });
        const issued = await issueForInstallation(existing.id);
        res.json({ installationId: existing.id, installationSecret: secret, ...issued });
        return;
      }

      throw new HttpError(409, 'DEVICE_ALREADY_LICENSED',
        'This computer already has another active license. Deactivate that installation in the Admin Panel, then try again.');
    }
  }

  await assertDeviceCapacity(license);
  res.status(201).json(await createInstallation(license, input.device, req.ip));
}));

router.post('/heartbeat', clientAuth, ah(async (req: ClientRequest, res: Response) => {
  const device = parse(deviceSchema.partial().extend({ reason: z.string().max(20).optional() }), req.body);
  const inst = req.installation;
  const now = nowIso();
  const patch: Record<string, unknown> = { last_seen_at: now, last_verified_at: now, last_ip: req.ip };
  if (device.appVersion && device.appVersion !== inst.app_version) {
    patch.app_version = device.appVersion;
    await licenseEvent({ licenseId: inst.license_id, installationId: inst.id, customerId: inst.customer_id, type: 'APP_UPDATED', actor: 'client',
      details: { from: inst.app_version, to: device.appVersion } });
  }
  if (device.deviceName) patch.device_name = device.deviceName;
  if (device.os) patch.os = device.os;

  let newSecret: string | undefined;
  if (bool(inst.rotate_requested) && inst.status !== 'DEACTIVATED') {
    newSecret = randomSecret();
    patch.pending_secret_hash = sha256(newSecret);
    patch.rotate_requested = false;
  }
  await knex('installations').where({ id: inst.id }).update(patch);
  const issued = await issueForInstallation(inst.id);
  void noteCustomerPresence(inst);
  res.json({ ...issued, ...(newSecret ? { newSecret } : {}) });
}));

/** Live push channel: the desktop keeps this open and re-checks its license whenever a "refresh" event arrives. */
router.get('/events', clientAuth, (req: ClientRequest, res: Response) => {
  attachStream(req.installation.id, res);
});

const usageSchema = z.object({
  items: z.array(z.object({
    feature: z.string().refine((f) => FEATURE_KEYS.includes(f), 'Unknown feature'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    count: z.number().int().min(0).max(1_000_000),
    firstUsedAt: z.string().max(32).optional(),
    lastUsedAt: z.string().max(32).optional(),
  })).max(500),
});

/** Absolute per-day counts: retries and re-sends are idempotent (count = max(existing, received)). */
router.post('/usage', clientAuth, ah(async (req: ClientRequest, res: Response) => {
  const { items } = parse(usageSchema, req.body);
  const now = nowIso();
  for (const it of items) {
    await knex('usage_daily')
      .insert({ installation_id: req.installation.id, feature_key: it.feature, usage_date: it.date, count: it.count,
        first_used_at: it.firstUsedAt || now, last_used_at: it.lastUsedAt || now, received_at: now })
      .onConflict(['installation_id', 'feature_key', 'usage_date'])
      .merge({
        count: knex.raw('CASE WHEN excluded.count > usage_daily.count THEN excluded.count ELSE usage_daily.count END'),
        last_used_at: knex.raw('excluded.last_used_at'),
        received_at: now,
      });
  }
  await knex('installations').where({ id: req.installation.id }).update({ last_seen_at: now });
  noteCustomerUsage(req.installation, items.map((it) => it.feature));
  res.json({ accepted: items.length });
}));

router.post('/deactivate', clientAuth, ah(async (req: ClientRequest, res: Response) => {
  const inst = req.installation;
  await knex('installations').where({ id: inst.id }).update({ status: 'DEACTIVATED', deactivated_at: nowIso() });
  await licenseEvent({ licenseId: inst.license_id, installationId: inst.id, customerId: inst.customer_id, type: 'DEACTIVATED', actor: 'client' });
  res.json({ ok: true });
}));

const presenceAt = new Map<string, number>();
const usageAt = new Map<string, number>();

async function noteCustomerPresence(inst: { id: string; customer_id: string; device_name?: string }) {
  const now = Date.now();
  const prev = presenceAt.get(inst.id) || 0;
  if (now - prev < 15_000) return;
  presenceAt.set(inst.id, now);
  const customer = await knex('customers').where({ id: inst.customer_id }).first();
  const name = customer?.business_name || customer?.name || 'A customer';
  publishAdmin({
    kind: 'customer',
    action: 'SEEN',
    title: 'Customer online',
    message: `${name} is using the billing app${inst.device_name ? ` on ${inst.device_name}` : ''}.`,
    notify: now - prev > 120_000,
  });
}

function noteCustomerUsage(inst: { id: string; customer_id: string }, features: string[]) {
  const now = Date.now();
  const prev = usageAt.get(inst.id) || 0;
  if (now - prev < 15_000) return;
  usageAt.set(inst.id, now);
  const unique = [...new Set(features)].slice(0, 3).join(', ');
  publishAdmin({
    kind: 'customer',
    action: 'USAGE',
    title: 'Feature used',
    message: unique ? `Reported use of ${unique}.` : 'Reported feature use.',
    notify: now - prev > 60_000,
  });
}

export default router;
