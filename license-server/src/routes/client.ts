import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { knex, nowIso, bool, parseJson } from '../db.js';
import { ah, parse, HttpError, rateLimit, licenseEvent } from '../lib.js';
import { sha256, randomSecret, generateLicenseKey, safeEqualHex } from '../signing.js';
import { issueForInstallation, getSettings, effectiveLicenseStatus } from '../entitlements.js';
import { FEATURE_KEYS, FEATURES } from '../features.js';
import { attachStream, pushRefresh } from '../realtime.js';
import { publishAdmin } from '../adminLive.js';
import { changeAccount, codeEmail, openSecret, sealSecret, sendMail } from '../accounts.js';

const router = Router();

/** Whether this computer still belongs to a customer. Used after a removal so the shop app can erase local data. */
router.post('/device-status', ah(async (req: Request, res: Response) => {
  const { fingerprint } = parse(z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }), req.body);
  const row = await knex('installations').where({ fingerprint_hash: sha256(fingerprint) }).first();
  res.json({ known: !!row });
}));

// Unauthenticated activation endpoints are tightly limited per IP.
router.use(['/register', '/trial', '/activate'], rateLimit({ name: 'activate', windowMs: 60 * 60 * 1000, max: 20 }));
router.use('/password-reset/request', rateLimit({ name: 'reset-ip', windowMs: 60 * 60 * 1000, max: 10 }));
router.use('/password-reset/request', rateLimit({ name: 'reset-email', windowMs: 15 * 60 * 1000, max: 3, key: (r) => String(r.body?.email || '').trim().toLowerCase() }));
router.use('/password-reset/verify', rateLimit({ name: 'reset-verify', windowMs: 60 * 60 * 1000, max: 30 }));
// Signing in on another computer checks a password here: slowed down per computer and per email
router.use('/account/sign-in', rateLimit({ name: 'signin-ip', windowMs: 60 * 60 * 1000, max: 40 }));
router.use('/account/sign-in', rateLimit({ name: 'signin-email', windowMs: 15 * 60 * 1000, max: 10, key: (r) => String(r.body?.email || '').trim().toLowerCase() }));
router.use(rateLimit({ name: 'client', windowMs: 60 * 1000, max: 120 }));

const deviceSchema = z.object({
  deviceName: z.string().trim().max(100).default('Unknown device'),
  os: z.string().trim().max(100).default('Unknown OS'),
  appVersion: z.string().trim().max(30).regex(/^[\d.]+[-+\w.]*$/).default('0.0.0'), // 1.2.3, 1.2.3+2 (an update of 1.2.3)
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  // The computer, when the installation is one of several businesses on it (the fingerprint is then per business)
  machine: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

/** Which computer an installation is on: the machine hint, or (older apps) the fingerprint, which was the same */
const machineHash = (device: { machine?: string; fingerprint?: string }) => {
  const hint = device.machine || device.fingerprint;
  return hint ? sha256(hint) : null;
};

export interface ClientRequest extends Request {
  installation?: any;
}

/** Bearer <installationId>.<secret>. Secrets are stored only as SHA-256 hashes and can be rotated. */
export const clientAuth = ah(async (req: ClientRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/);
  if (!m) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Missing or malformed installation credentials');
  const inst = await knex('installations').where({ id: m[1] }).first();
  const hash = sha256(m[2]);
  if (!inst) {
    const removed = await knex('removed_installations').where({ id: m[1] }).first();
    if (removed) throw new HttpError(401, 'INSTALLATION_DELETED', 'Your administrator removed this computer from the licence');
    throw new HttpError(401, 'INSTALLATION_REMOVED', 'This computer is no longer registered');
  }
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
  // A new computer keeps the sign-in it was set up with (and reports it); only later changes are handed to it
  const customer = await knex('customers').where({ id: license.customer_id }).first();
  await knex.transaction(async (trx) => {
    await trx('installations').insert({
      account_rev: Number(customer?.app_account_rev || 0),
      id, license_id: license.id, customer_id: license.customer_id, device_name: device.deviceName, os: device.os,
      app_version: device.appVersion, fingerprint_hash: device.fingerprint ? sha256(device.fingerprint) : null, machine_hash: machineHash(device),
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

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  businessName: z.string().trim().min(1).max(150),
  email: z.string().trim().toLowerCase().email().max(150),
  phone: z.string().trim().max(30).optional(),
  category: z.string().trim().max(40).optional(),
  profile: z.lazy(() => profileSchema).optional(),
  device: deviceSchema,
});

/** Business details kept for setting up the same account on another computer */
const profileSchema = z.object({
  category: z.string().trim().max(40).optional(),
  state: z.string().trim().max(60).optional(),
  city: z.string().trim().max(80).optional().nullable(),
  gstin: z.string().trim().max(20).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  ownerName: z.string().trim().max(120).optional(),
  businessName: z.string().trim().max(150).optional(),
});

async function keepProfile(customer: any, profile: z.infer<typeof profileSchema> | undefined) {
  if (!profile) return;
  const merged = { ...parseJson<Record<string, unknown>>(customer.profile_json, {}), ...Object.fromEntries(Object.entries(profile).filter(([, v]) => v)) };
  await knex('customers').where({ id: customer.id }).update({ profile_json: JSON.stringify(merged) });
}

/**
 * A shop was just set up in the app (account + business), before a trial or a licence key: the vendor sees the
 * customer at once and can issue a key for them. The same email is one customer (a later trial or key uses it).
 * Details are only updated while the customer has no licence, so nobody can rename a licensed customer from outside.
 */
router.post('/register', ah(async (req: Request, res: Response) => {
  const input = parse(registerSchema, req.body);
  const now = nowIso();
  let customer = await knex('customers').where({ email: input.email }).first();
  if (!customer) {
    customer = { id: crypto.randomUUID(), name: input.name, business_name: input.businessName, email: input.email, phone: input.phone || null,
      status: 'ACTIVE', created_at: now, updated_at: now };
    await knex('customers').insert(customer);
  } else if (!(await knex('licenses').where({ customer_id: customer.id }).first())) {
    await knex('customers').where({ id: customer.id })
      .update({ name: input.name, business_name: input.businessName, phone: input.phone || customer.phone, updated_at: now });
  }
  await keepProfile(customer, { ...input.profile, category: input.profile?.category || input.category });
  await licenseEvent({ customerId: customer.id, type: 'CUSTOMER_REGISTERED', actor: 'client',
    details: { businessName: input.businessName, category: input.category, deviceName: input.device.deviceName, os: input.device.os, appVersion: input.device.appVersion } });
  res.status(201).json({ ok: true });
}));

router.post('/trial', ah(async (req: Request, res: Response) => {
  const input = parse(trialSchema, req.body);
  const settings = await getSettings();
  if (settings.trials_enabled !== '1') throw new HttpError(403, 'TRIALS_DISABLED', 'Free trials are currently unavailable. Please contact sales.');

  let customer = await knex('customers').where({ email: input.email }).first();
  if (customer && settings.trial_one_per_email === '1') {
    const priorTrial = await knex('licenses').where({ customer_id: customer.id, type: 'TRIAL' }).first();
    if (priorTrial) throw new HttpError(409, 'TRIAL_ALREADY_USED', 'A free trial has already been used with this email address.');
  }
  const machine = machineHash(input.device);
  if (machine && settings.trial_one_per_device === '1') {
    // Any business on this computer (older installations only have the fingerprint, which was the computer's)
    const seen = await knex('installations as i').join('licenses as l', 'l.id', 'i.license_id')
      .where((w) => w.where('i.machine_hash', machine).orWhere('i.fingerprint_hash', machine)).andWhere('l.type', 'TRIAL').first();
    if (seen) throw new HttpError(409, 'TRIAL_ALREADY_USED', 'A free trial has already been used on this computer. Each further business on it needs a licence key: contact Apna Billing.');
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

const accountSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(150),
  password: z.string().min(1).max(200).optional(),
  by: z.enum(['SIGNUP', 'LOGIN', 'SHOP', 'RESET']).default('SHOP'),
});

router.post('/heartbeat', clientAuth, ah(async (req: ClientRequest, res: Response) => {
  const device = parse(deviceSchema.partial().extend({
    reason: z.string().max(20).optional(),
    // The shop's sign-in when it was set or changed on the computer, and the last vendor change it has taken over
    account: accountSchema.optional(),
    accountRev: z.number().int().min(0).optional(),
    profile: profileSchema.optional(),
  }), req.body);
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

  // Sign-in: a change from the vendor (Admin Panel, or a password reset) waits until this computer has taken it over;
  // until then what the computer reports is not kept (it would undo the change)
  const customer = await knex('customers').where({ id: inst.customer_id }).first();
  const rev = Number(customer?.app_account_rev || 0);
  let applied = Number(inst.account_rev || 0);
  if (device.accountRev !== undefined && device.accountRev > applied && device.accountRev <= rev) {
    applied = device.accountRev;
    patch.account_rev = applied;
  }
  let accountAccepted = false;
  if (customer && device.account && applied >= rev) {
    const keep: Record<string, unknown> = { app_email: device.account.email, updated_at: now };
    if (device.account.password && device.account.password !== openSecret(customer.app_password_enc)) {
      keep.app_password_enc = sealSecret(device.account.password);
      keep.app_password_at = now;
      keep.app_password_by = device.account.by;
    }
    await knex('customers').where({ id: customer.id }).update(keep);
    accountAccepted = true;
  }
  if (customer && device.profile) await keepProfile(customer, device.profile);
  const account = customer && applied < rev
    ? { rev, email: customer.app_email || null, password: openSecret(customer.app_password_enc) }
    : undefined;

  await knex('installations').where({ id: inst.id }).update(patch);
  const issued = await issueForInstallation(inst.id);
  void noteCustomerPresence(inst);
  res.json({ ...issued, ...(newSecret ? { newSecret } : {}), ...(account ? { account } : {}), accountAccepted });
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
  void noteCustomerUsage(req.installation, items);
  res.json({ accepted: items.length });
}));

// ---- The same account on another computer (licences with more than one device)

/** The licence an account signs in with on another computer: an active one, paid before trial, the longest first */
async function signInLicense(customerId: string) {
  const licenses = await knex('licenses').where({ customer_id: customerId }).orderBy('created_at', 'desc');
  const active = licenses.filter((l: any) => effectiveLicenseStatus(l) === 'ACTIVE');
  active.sort((a: any, b: any) => (a.type === 'PAID' ? 0 : 1) - (b.type === 'PAID' ? 0 : 1)
    || (b.expires_at ? Date.parse(b.expires_at) : Infinity) - (a.expires_at ? Date.parse(a.expires_at) : Infinity));
  return active[0] || null;
}

function samePassword(a: string, b: string) {
  return crypto.timingSafeEqual(Buffer.from(sha256(a), 'hex'), Buffer.from(sha256(b), 'hex'));
}

/**
 * Sign-in on a computer that does not have this account yet. The email and password are checked against the sign-in
 * the shop's app keeps here; then (activate) this computer becomes one more device on the account's licence, within
 * its device limit. Returns the business details for setting the account up on this computer.
 */
router.post('/account/sign-in', ah(async (req: Request, res: Response) => {
  const input = parse(z.object({
    email: z.string().trim().toLowerCase().email().max(150),
    password: z.string().min(1).max(200),
    activate: z.boolean().default(false),
    device: deviceSchema.optional(),
  }), req.body);
  const customer = await customerBySignIn(input.email);
  const stored = openSecret(customer?.app_password_enc);
  if (customer && !stored) {
    throw new HttpError(401, 'NOT_ON_SERVER_YET', 'This account cannot be opened on another computer yet. Sign in once on the computer where '
      + 'it was created (after updating Apna Billing there), then try again here.');
  }
  if (!customer || !stored || !samePassword(stored, input.password)) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  if (customer.status === 'SUSPENDED') throw new HttpError(403, 'CUSTOMER_SUSPENDED', 'This account is suspended. Contact Apna Billing.');
  const license = await signInLicense(customer.id);
  if (!license) throw new HttpError(403, 'NO_ACTIVE_LICENSE', 'This account has no active licence. Contact Apna Billing to renew it.');

  const registered = await knex('license_events').where({ customer_id: customer.id, event_type: 'CUSTOMER_REGISTERED' }).orderBy('created_at', 'desc').first();
  const saved = parseJson<Record<string, any>>(customer.profile_json, {});
  const profile = {
    ownerName: saved.ownerName || customer.name,
    businessName: saved.businessName || customer.business_name || customer.name,
    email: customer.app_email || customer.email,
    phone: saved.phone || customer.phone || null,
    category: saved.category || parseJson<Record<string, any>>(registered?.details_json, {}).category || null,
    state: saved.state || null,
    city: saved.city || null,
    gstin: saved.gstin || null,
  };
  // This computer's own entry on the licence (also one signed out or uninstalled earlier: it is reused, so a reinstall
  // does not add a second entry or use another activation)
  const existing = input.device?.fingerprint
    ? await knex('installations').where({ fingerprint_hash: sha256(input.device.fingerprint), license_id: license.id }).orderBy('installed_at', 'desc').first()
    : null;
  if (!existing || existing.status === 'DEACTIVATED') await assertDeviceCapacity(license);
  if (!input.activate) {
    res.json({ ok: true, profile });
    return;
  }
  if (!input.device) throw new HttpError(400, 'VALIDATION_ERROR', 'device: required');
  let activation: any;
  if (existing) {
    const secret = randomSecret();
    const now = nowIso();
    await knex('installations').where({ id: existing.id }).update({ secret_hash: sha256(secret), pending_secret_hash: null, status: 'ACTIVE',
      deactivated_at: null, uninstalled_at: null, app_version: input.device.appVersion,
      last_seen_at: now, last_verified_at: now, last_ip: req.ip || null, account_rev: Number(customer.app_account_rev || 0) });
    activation = { installationId: existing.id, installationSecret: secret, ...(await issueForInstallation(existing.id)) };
  } else {
    activation = await createInstallation(license, input.device, req.ip);
  }
  await licenseEvent({ licenseId: license.id, installationId: activation.installationId, customerId: customer.id, type: 'SIGNED_IN_NEW_DEVICE', actor: 'client',
    details: { deviceName: input.device.deviceName, email: input.email } });
  res.status(201).json({ ...activation, profile, accountRev: Number(customer.app_account_rev || 0) });
}));

// ---- Forgot password: a code by email, then the new password (the shop's computer asks on the user's behalf)

const RESET_MINUTES = 10;
const RESET_TRIES = 5;

async function customerBySignIn(email: string) {
  return (await knex('customers').whereRaw('lower(app_email) = ?', [email]).first())
    || (await knex('customers').whereNull('app_email').whereRaw('lower(email) = ?', [email]).first());
}

router.post('/password-reset/request', ah(async (req: Request, res: Response) => {
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email().max(150) }), req.body);
  const customer = await customerBySignIn(email);
  // The same answer whether or not the email is known, so this cannot be used to find out who is a customer
  if (!customer) {
    res.json({ ok: true, minutes: RESET_MINUTES });
    return;
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const id = crypto.randomUUID();
  const now = new Date();
  await knex('password_resets').where({ email }).whereNull('used_at').update({ used_at: now.toISOString() }); // older codes stop working
  await knex('password_resets').insert({
    id, email, customer_id: customer.id, code_hash: sha256(`${id}:${code}`), attempts: 0,
    expires_at: new Date(now.getTime() + RESET_MINUTES * 60_000).toISOString(), created_at: now.toISOString(),
  });
  const mail = codeEmail(code, customer.business_name);
  await sendMail(email, `${code} is your Apna Billing password reset code`, mail.text, mail.html);
  await licenseEvent({ customerId: customer.id, type: 'PASSWORD_RESET_REQUESTED', actor: 'client', details: { email } });
  res.json({ ok: true, minutes: RESET_MINUTES });
}));

router.post('/password-reset/verify', ah(async (req: Request, res: Response) => {
  const input = parse(z.object({
    email: z.string().trim().toLowerCase().email().max(150),
    code: z.string().trim().regex(/^\d{6}$/, 'The code has 6 digits'),
    password: z.string().min(8, 'The password needs at least 8 characters').max(200),
  }), req.body);
  const reset = await knex('password_resets').where({ email: input.email }).whereNull('used_at').orderBy('created_at', 'desc').first();
  if (!reset || Date.parse(reset.expires_at) <= Date.now() || reset.attempts >= RESET_TRIES) {
    throw new HttpError(400, 'CODE_EXPIRED', 'This code has expired. Ask for a new code.');
  }
  if (!safeEqualHex(sha256(`${reset.id}:${input.code}`), reset.code_hash)) {
    const attempts = reset.attempts + 1;
    await knex('password_resets').where({ id: reset.id }).update({ attempts });
    const left = RESET_TRIES - attempts;
    throw new HttpError(400, 'WRONG_CODE', left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Wrong code. Ask for a new code.');
  }
  await knex('password_resets').where({ id: reset.id }).update({ used_at: nowIso() });
  await changeAccount(reset.customer_id, { email: input.email, password: input.password, by: 'RESET' });
  await licenseEvent({ customerId: reset.customer_id, type: 'PASSWORD_RESET', actor: 'client', details: { email: input.email } });
  res.json({ ok: true });
}));

/** Apna Billing is being uninstalled from this computer: its device slot is freed and the vendor is told */
router.post('/uninstalled', clientAuth, ah(async (req: ClientRequest, res: Response) => {
  const inst = req.installation;
  const now = nowIso();
  await knex('installations').where({ id: inst.id }).update({ status: 'DEACTIVATED', deactivated_at: now, uninstalled_at: now });
  await licenseEvent({ licenseId: inst.license_id, installationId: inst.id, customerId: inst.customer_id, type: 'APP_UNINSTALLED', actor: 'client',
    details: { deviceName: inst.device_name } });
  res.json({ ok: true });
}));

/** The computers on this computer's licence (the owner can sign another one out from the app) */
router.get('/devices', clientAuth, ah(async (req: ClientRequest, res: Response) => {
  const inst = req.installation;
  const license = await knex('licenses').where({ id: inst.license_id }).first();
  const rows = await knex('installations').where({ license_id: inst.license_id }).orderBy('installed_at');
  res.json({
    maxDevices: license?.max_devices ?? null,
    devices: rows.map((r: any) => ({ id: r.id, deviceName: r.device_name, os: r.os, appVersion: r.app_version, status: r.status,
      lastSeenAt: r.last_seen_at, installedAt: r.installed_at, uninstalledAt: r.uninstalled_at || null, thisComputer: r.id === inst.id })),
  });
}));

/** Signs another computer on the same licence out (frees its device slot); it keeps its data */
router.post('/devices/:id/deactivate', clientAuth, ah(async (req: ClientRequest, res: Response) => {
  const inst = req.installation;
  const other = await knex('installations').where({ id: req.params.id, license_id: inst.license_id }).first();
  if (!other) throw new HttpError(404, 'NOT_FOUND', 'That computer is not on this licence');
  if (other.id === inst.id) throw new HttpError(400, 'THIS_COMPUTER', 'Use "Deactivate this computer" for this computer');
  await knex('installations').where({ id: other.id }).update({ status: 'DEACTIVATED', deactivated_at: nowIso() });
  await licenseEvent({ licenseId: inst.license_id, installationId: other.id, customerId: inst.customer_id, type: 'INSTALLATION_DEACTIVATED', actor: 'client',
    details: { deviceName: other.device_name, by: inst.device_name } });
  await pushRefresh({ scope: 'INSTALLATION', id: other.id }, 'INSTALLATION_DEACTIVATED');
  res.json({ ok: true });
}));

router.post('/deactivate', clientAuth, ah(async (req: ClientRequest, res: Response) => {
  const inst = req.installation;
  await knex('installations').where({ id: inst.id }).update({ status: 'DEACTIVATED', deactivated_at: nowIso() });
  await licenseEvent({ licenseId: inst.license_id, installationId: inst.id, customerId: inst.customer_id, type: 'DEACTIVATED', actor: 'client' });
  res.json({ ok: true });
}));

const presenceAt = new Map<string, number>();

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

/**
 * The Admin Panel hears of a feature being used as it happens. Only uses of the last two minutes are announced; older
 * ones (sent late, e.g. a computer that was offline) only update the usage figures, with their own times.
 */
const LIVE_USE_MS = 2 * 60 * 1000;
const usageNoticed = new Map<string, { at: number; features: string }>();
async function noteCustomerUsage(inst: { id: string; customer_id: string; device_name?: string }, items: Array<{ feature: string; lastUsedAt?: string }>) {
  const now = Date.now();
  const fresh = [...new Set(items.filter((it) => {
    const at = it.lastUsedAt ? Date.parse(it.lastUsedAt) : NaN;
    return Number.isFinite(at) && Math.abs(now - at) <= LIVE_USE_MS;
  }).map((it) => it.feature))];
  if (!fresh.length) {
    publishAdmin({ kind: 'customer', action: 'USAGE', title: 'Usage updated', message: 'Earlier feature use was reported.', notify: false });
    return;
  }
  const names = fresh.map((k) => FEATURES.find((f) => f.key === k)?.name || k);
  const key = names.slice().sort().join('|');
  const prev = usageNoticed.get(inst.id);
  // The same screens again within a minute: the figures refresh, no new pop-up
  const notify = !prev || prev.features !== key || now - prev.at > 60_000;
  if (notify) usageNoticed.set(inst.id, { at: now, features: key });
  let who = 'A customer';
  try {
    const c = await knex('customers').where({ id: inst.customer_id }).first('business_name', 'name');
    who = c?.business_name || c?.name || who;
  } catch { /* the notice still goes out */ }
  publishAdmin({
    kind: 'customer',
    action: 'USAGE',
    title: 'In use now',
    message: `${who}${inst.device_name ? ` (${inst.device_name})` : ''} is using ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}.`,
    notify,
  });
}

export default router;
