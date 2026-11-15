import crypto from 'crypto';
import { knex, bool, parseJson, nowIso } from './db.js';
import { FEATURE_KEYS } from './features.js';
import { signToken } from './signing.js';

const DAY_MS = 86400000;

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await knex('settings').select('key', 'value');
  return Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
}

export async function setSetting(key: string, value: string) {
  const updated = await knex('settings').where({ key }).update({ value, updated_at: nowIso() });
  if (!updated) await knex('settings').insert({ key, value, updated_at: nowIso() });
}

/** EXPIRED is derived from the expiry date so it never drifts out of sync. */
export function effectiveLicenseStatus(license: any, now = Date.now()): 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED' {
  if (license.status === 'REVOKED') return 'REVOKED';
  if (license.status === 'SUSPENDED') return 'SUSPENDED';
  if (license.expires_at && Date.parse(license.expires_at) <= now) return 'EXPIRED';
  return 'ACTIVE';
}

export interface ResolvedFeature {
  enabled: boolean;
  expiresAt: string | null;
  source: 'PLAN' | 'GLOBAL' | 'CUSTOMER' | 'LICENSE' | 'INSTALLATION';
}

/**
 * Feature resolution, most specific wins:
 *   plan features → GLOBAL override → CUSTOMER override → LICENSE override → INSTALLATION override.
 * Expired overrides are ignored. A time-limited grant carries its expiry into the signed token so the
 * desktop app turns the feature off on time even while offline.
 */
export async function resolveFeatures(ctx: { plan: any; customerId: string; licenseId: string; installationId?: string | null }, now = Date.now()) {
  const planFeatures = parseJson<string[]>(ctx.plan.features_json, []);
  const all = planFeatures.includes('*');
  const result: Record<string, ResolvedFeature> = {};
  for (const k of FEATURE_KEYS) result[k] = { enabled: all || planFeatures.includes(k), expiresAt: null, source: 'PLAN' };

  const overrides = await knex('feature_overrides').where((q) => {
    q.where({ scope: 'GLOBAL' })
      .orWhere({ scope: 'CUSTOMER', scope_id: ctx.customerId })
      .orWhere({ scope: 'LICENSE', scope_id: ctx.licenseId });
    if (ctx.installationId) q.orWhere({ scope: 'INSTALLATION', scope_id: ctx.installationId });
  });
  const order = ['GLOBAL', 'CUSTOMER', 'LICENSE', 'INSTALLATION'];
  overrides.sort((a: any, b: any) => order.indexOf(a.scope) - order.indexOf(b.scope));
  for (const o of overrides) {
    if (!(o.feature_key in result)) continue;
    if (o.expires_at && Date.parse(o.expires_at) <= now) continue;
    result[o.feature_key] = { enabled: bool(o.enabled), expiresAt: bool(o.enabled) ? o.expires_at || null : null, source: o.scope };
  }
  return result;
}

export async function noticesFor(installation: any, license: any) {
  const now = nowIso();
  const rows = await knex('notices')
    .where('starts_at', '<=', now)
    .andWhere((q) => q.whereNull('ends_at').orWhere('ends_at', '>', now))
    .andWhere((q) => q.where({ target_scope: 'ALL' })
      .orWhere({ target_scope: 'CUSTOMER', target_id: installation.customer_id })
      .orWhere({ target_scope: 'LICENSE', target_id: license.id })
      .orWhere({ target_scope: 'INSTALLATION', target_id: installation.id }))
    .orderBy('created_at', 'desc')
    .limit(10);
  return rows.map((n: any) => ({ id: n.id, title: n.title, message: n.message, level: n.level, createdAt: n.created_at }));
}

/**
 * Whether version a is older than b. A "+N" is an update of the same version, newer than the version without it:
 * 1.2.3 < 1.2.3+1 < 1.2.3+2 < 1.2.4 (clients still see 1.2.3).
 */
export function versionLt(a: string, b: string) {
  const parts = (v: string) => {
    const [main, update] = v.split('+');
    const p = main.split('.').map(Number);
    return [p[0] || 0, p[1] || 0, p[2] || 0, Number(update) || 0];
  };
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i];
  }
  return false;
}

/** Build the signed entitlement token and accompanying (unsigned, informational) data for an installation. */
export async function issueForInstallation(installationId: string) {
  const installation = await knex('installations').where({ id: installationId }).first();
  if (!installation) throw new Error('installation not found');
  const license = await knex('licenses').where({ id: installation.license_id }).first();
  const plan = await knex('plans').where({ id: license.plan_id }).first();
  const customer = await knex('customers').where({ id: license.customer_id }).first();
  const settings = await getSettings();
  const now = Date.now();

  const graceDays = Math.max(1, Number(settings.offline_grace_days) || 7);
  let expMs = now + graceDays * DAY_MS;
  if (bool(installation.force_revalidate)) expMs = Math.min(expMs, now + DAY_MS);

  const features = await resolveFeatures({ plan, customerId: customer.id, licenseId: license.id, installationId: installation.id }, now);
  const payload = {
    v: 1,
    iid: installation.id,
    lid: license.id,
    cid: customer.id,
    customerName: customer.business_name || customer.name,
    licenseKeyHint: String(license.license_key).slice(-4),
    type: license.type,
    plan: { code: plan.code, name: plan.name },
    status: customer.status === 'SUSPENDED' && effectiveLicenseStatus(license, now) !== 'REVOKED'
      ? 'SUSPENDED'
      : effectiveLicenseStatus(license, now),
    installationStatus: installation.status,
    licenseExpiresAt: license.expires_at || null,
    features: Object.fromEntries(Object.entries(features).map(([k, f]) => [k, { enabled: f.enabled, expiresAt: f.expiresAt }])),
    maxDevices: license.max_devices,
    graceDays,
    iat: new Date(now).toISOString(),
    exp: new Date(expMs).toISOString(),
    jti: crypto.randomUUID(),
  };

  // Offered to computers on an older version; after a rollback (an older version put live on purpose) to every
  // computer on another version, so they all go back to it
  const appVersion = installation.app_version || '0.0.0';
  const live = settings.latest_version;
  const rollback = settings.rollback === '1';
  const update = live && appVersion !== live && (versionLt(appVersion, live) || rollback)
    ? {
      latestVersion: live,
      message: settings.update_message || `Version ${live} is available.`,
      url: settings.update_url || undefined,
      mandatory: rollback
        ? settings.min_supported_version === live
        : !!settings.min_supported_version && versionLt(appVersion, settings.min_supported_version),
    }
    : null;

  return { token: signToken(payload), payload, notices: await noticesFor(installation, license), update, serverTime: new Date(now).toISOString() };
}
