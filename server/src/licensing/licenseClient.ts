import os from 'os';
import crypto from 'crypto';
import { db } from '../db/connection.js';
import { config, APP_VERSION } from '../config/index.js';
import { localDate } from '../lib/dates.js';
import { HttpError } from '../lib/http.js';
import { FEATURE_KEYS, FeatureKey } from './features.js';
import { LicensePayload, verifyLicenseToken, TokenError } from './token.js';
import { LICENSE_PUBLIC_KEY_PEM } from './publicKey.js';
import { emitLicenseChanged } from './events.js';
import { nativeLicenseCore } from './nativeCore.js';
import { createBackup } from '../services/backupService.js';

export type LicenseMode =
  | 'DISABLED' // enforcement off (development only)
  | 'UNLICENSED'
  | 'ACTIVE'
  | 'GRACE_EXPIRED' // has not reached the server within the offline grace period
  | 'EXPIRED'
  | 'SUSPENDED'
  | 'REVOKED'
  | 'DEACTIVATED'
  | 'CLOCK_TAMPERED'
  | 'INVALID';

const CLOCK_TOLERANCE_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const MESSAGES: Record<LicenseMode, string> = {
  DISABLED: 'License enforcement is disabled (development mode).',
  UNLICENSED: 'Activate a trial or enter a license key to start using Apna Billing.',
  ACTIVE: 'License active.',
  GRACE_EXPIRED: 'Could not verify your license for too long. Connect to the internet to continue billing. Your data is safe and viewable.',
  EXPIRED: 'Your license has expired. Renew to continue billing. Your data remains available in read-only mode.',
  SUSPENDED: 'This license or device has been suspended. Contact support. Your data remains available in read-only mode.',
  REVOKED: 'This license has been revoked. Contact support. Your data remains available in read-only mode.',
  DEACTIVATED: 'This device has been deactivated. Activate again with a valid license.',
  CLOCK_TAMPERED: 'Your computer clock appears to be set in the past. Correct the date and time, then connect to the internet.',
  INVALID: 'The stored license could not be verified. Re-activate the application.',
};

let publicKeyPem = LICENSE_PUBLIC_KEY_PEM;
/** Test hook only — production builds always use the embedded key. */
export function __setPublicKeyForTests(pem: string) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Not allowed');
  publicKeyPem = pem;
}

interface StateRow {
  installation_id: string | null;
  installation_secret: string | null;
  license_token: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  max_seen_time: string | null;
  notices_json: string;
  update_json: string | null;
}

function getState(): StateRow {
  db.prepare('INSERT OR IGNORE INTO license_state (id) VALUES (1)').run();
  return db.prepare('SELECT * FROM license_state WHERE id = 1').get() as StateRow;
}

/** Installation credentials for authenticated calls (the live push channel), or null when not activated. */
export function getCredentials(): { id: string; secret: string } | null {
  const s = getState();
  return s.installation_id && s.installation_secret ? { id: s.installation_id, secret: s.installation_secret } : null;
}

export function licenseServerUrl(): string {
  return config.licensing.serverUrl;
}

// Backup history and the backup-folder setting survive an erase so the safety backup stays listed and restorable.
const SHOP_KEEP = new Set(['schema_migrations', 'plans', 'license_state', 'backup_history', 'system_settings']);

/** Erase this computer's shop (users, bills, stock) so the same email can register again. Plans and the app schema stay. */
export function wipeShopData(): void {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  db.pragma('foreign_keys = OFF');
  const run = db.transaction(() => {
    for (const { name } of tables) {
      if (SHOP_KEEP.has(name) || !/^[A-Za-z0-9_]+$/.test(name)) continue;
      db.prepare(`DELETE FROM "${name}"`).run();
    }
    db.prepare(`
      UPDATE license_state
      SET installation_id = NULL, installation_secret = NULL, license_token = NULL,
          last_sync_at = NULL, last_sync_error = NULL, max_seen_time = NULL,
          notices_json = '[]', update_json = NULL, updated_at = datetime('now')
      WHERE id = 1
    `).run();
  });
  try {
    run();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  cache = null;
}

/**
 * Erase this computer's shop, but only after a verified backup of it has been saved (kind PRE_ERASE, in the backup
 * folder). If that backup cannot be saved nothing is erased and `erased` is false.
 */
export async function backupThenWipe(why: string, beforeWipe?: () => Promise<void>): Promise<{ erased: boolean; backupFile?: string; error?: string }> {
  const hasShop = (db.prepare('SELECT COUNT(*) AS c FROM businesses').get() as { c: number }).c > 0;
  let backupFile: string | undefined;
  if (hasShop) {
    try {
      const b = await createBackup({ kind: 'PRE_ERASE', notes: `Saved automatically before this shop was erased (${why})` });
      backupFile = b.file_path;
    } catch (err: any) {
      console.error(`[License] Shop NOT erased: the safety backup failed (${err?.message || err}).`);
      return { erased: false, error: err?.message || String(err) };
    }
  }
  if (beforeWipe) await beforeWipe();
  wipeShopData();
  return { erased: true, backupFile };
}

/**
 * The vendor deleted this customer: sign out and erase the shop after a safety backup. If the backup fails the data is
 * kept, the app stays signed out, and recoverIfVendorRemovedShop() tries again on the next start.
 */
async function eraseRemovedShop(): Promise<void> {
  const r = await backupThenWipe('CUSTOMER_DELETED');
  if (!r.erased) {
    saveState({ installation_id: null, installation_secret: null, license_token: null, last_sync_error: 'CUSTOMER_DELETED', notices_json: '[]', update_json: null });
  }
  emitLicenseChanged('session-ended', { sessionEnded: true, reason: 'CUSTOMER_DELETED', erased: r.erased, backupFile: r.backupFile });
}

function saveState(patch: Partial<StateRow>) {
  getState();
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  db.prepare(`UPDATE license_state SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = 1`)
    .run(...keys.map((k) => (patch as any)[k]));
  cache = null;
}

export interface LicenseStatus {
  mode: LicenseMode;
  enforced: boolean;
  canWrite: boolean;
  message: string;
  features: Record<FeatureKey, boolean>;
  featureExpiry: Record<string, string | null>;
  installationId: string | null;
  license: null | {
    type: 'TRIAL' | 'PAID';
    plan: { code: string; name: string };
    customerName: string;
    licenseKeyHint: string;
    status: string;
    installationStatus: string;
    expiresAt: string | null;
    daysRemaining: number | null;
    maxDevices: number;
  };
  offline: { lastSyncAt: string | null; lastSyncError: string | null; validUntil: string | null; daysRemaining: number | null; graceDays: number | null };
  notices: Array<{ id: string; title: string; message: string; level: string }>;
  update: null | { latestVersion: string; message?: string; url?: string; mandatory?: boolean };
  appVersion: string;
}

let cache: { key: string; at: number; status: LicenseStatus } | null = null;

function allFeatures(value: boolean): Record<FeatureKey, boolean> {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, value])) as Record<FeatureKey, boolean>;
}

interface Evaluation {
  mode: LicenseMode; // effective mode (DISABLED when not enforced)
  enforced: boolean;
  canWrite: boolean;
  payload: LicensePayload | null;
  features: Record<FeatureKey, boolean>;
  featureExpiry: Record<string, string | null>;
  storeMaxSeenTime: string | null;
}

/** Verify a token with the license public key: in compiled code inside the packaged engine, else in TypeScript. */
function verifyToken(token: string): LicensePayload {
  const core = nativeLicenseCore();
  if (!core) return verifyLicenseToken(token, publicKeyPem);
  try {
    return JSON.parse(core.verifyLicenseToken(token));
  } catch (err: any) {
    const [code, ...rest] = String(err?.message || 'TOKEN_MALFORMED').split(': ');
    throw new TokenError(code, rest.join(': ') || 'License token is invalid');
  }
}

/**
 * What the stored license allows at `now`. The packaged engine decides this in its compiled licensing core
 * (native/apna-core, always enforced); the TypeScript version below is its mirror for development and tests.
 */
function evaluateLicense(state: StateRow, now: number): Evaluation {
  const core = nativeLicenseCore();
  if (core) {
    const r = core.evaluateLicense({
      token: state.license_token ?? undefined,
      installationId: state.installation_id ?? undefined,
      maxSeenTime: state.max_seen_time ?? undefined,
      now,
      featureKeys: [...FEATURE_KEYS],
    });
    return {
      mode: r.mode as LicenseMode,
      enforced: true,
      canWrite: r.canWrite,
      payload: r.payloadJson ? JSON.parse(r.payloadJson) : null,
      features: r.features as Record<FeatureKey, boolean>,
      featureExpiry: r.featureExpiry,
      storeMaxSeenTime: r.storeMaxSeenTime ?? null,
    };
  }

  const enforced = config.licensing.enforce;
  let payload: LicensePayload | null = null;
  let mode: LicenseMode = 'ACTIVE';

  if (!state.license_token || !state.installation_id) {
    mode = 'UNLICENSED';
  } else {
    try {
      payload = verifyToken(state.license_token);
      if (payload.iid !== state.installation_id) {
        payload = null;
        mode = 'INVALID';
      }
    } catch (err) {
      mode = 'INVALID';
      if (!(err instanceof TokenError)) console.warn('[License] verification error', err);
    }
  }

  let storeMaxSeenTime: string | null = null;
  if (payload) {
    const iat = Date.parse(payload.iat);
    const maxSeen = Math.max(iat, state.max_seen_time ? Date.parse(state.max_seen_time) : 0);
    if (now + CLOCK_TOLERANCE_MS < maxSeen) {
      mode = 'CLOCK_TAMPERED';
    } else if (payload.installationStatus === 'DEACTIVATED') {
      mode = 'DEACTIVATED';
    } else if (payload.status === 'REVOKED') {
      mode = 'REVOKED';
    } else if (payload.status === 'SUSPENDED' || payload.installationStatus === 'SUSPENDED') {
      mode = 'SUSPENDED';
    } else if (payload.status === 'EXPIRED' || (payload.licenseExpiresAt && now > Date.parse(payload.licenseExpiresAt))) {
      mode = 'EXPIRED';
    } else if (now > Date.parse(payload.exp)) {
      mode = 'GRACE_EXPIRED';
    } else {
      mode = 'ACTIVE';
    }
    // Remember the latest time we have seen, to detect the clock being turned back.
    if (mode !== 'CLOCK_TAMPERED' && now > maxSeen + 60_000) {
      storeMaxSeenTime = new Date(now).toISOString();
    }
  }

  const features = allFeatures(!enforced);
  const featureExpiry: Record<string, string | null> = {};
  if (payload) {
    for (const k of FEATURE_KEYS) {
      const f = payload.features[k];
      const enabled = !!f?.enabled && (!f.expiresAt || now < Date.parse(f.expiresAt));
      if (enforced) features[k] = enabled;
      featureExpiry[k] = f?.expiresAt ?? null;
    }
  }

  return {
    mode: enforced ? mode : 'DISABLED',
    enforced,
    canWrite: !enforced || mode === 'ACTIVE',
    payload,
    features,
    featureExpiry,
    storeMaxSeenTime,
  };
}

export function computeStatus(now: number = Date.now()): LicenseStatus {
  const state = getState();
  const cacheKey = `${state.license_token}|${state.installation_id}|${state.max_seen_time}|${Math.floor(now / 30000)}`;
  if (cache && cache.key === cacheKey && Math.abs(now - cache.at) < 30000) return cache.status;

  const notices = JSON.parse(state.notices_json || '[]');
  const update = state.update_json ? JSON.parse(state.update_json) : null;

  const { mode: effectiveMode, enforced, canWrite, payload, features, featureExpiry, storeMaxSeenTime } = evaluateLicense(state, now);
  if (storeMaxSeenTime) db.prepare('UPDATE license_state SET max_seen_time = ? WHERE id = 1').run(storeMaxSeenTime);

  const status: LicenseStatus = {
    mode: effectiveMode,
    enforced,
    canWrite,
    message: MESSAGES[effectiveMode],
    features,
    featureExpiry,
    installationId: state.installation_id,
    license: payload ? {
      type: payload.type,
      plan: payload.plan,
      customerName: payload.customerName,
      licenseKeyHint: payload.licenseKeyHint,
      status: payload.status,
      installationStatus: payload.installationStatus,
      expiresAt: payload.licenseExpiresAt,
      daysRemaining: payload.licenseExpiresAt ? Math.max(0, Math.ceil((Date.parse(payload.licenseExpiresAt) - now) / DAY_MS)) : null,
      maxDevices: payload.maxDevices,
    } : null,
    offline: {
      lastSyncAt: state.last_sync_at,
      lastSyncError: state.last_sync_error,
      validUntil: payload?.exp ?? null,
      daysRemaining: payload ? Math.max(0, Math.ceil((Date.parse(payload.exp) - now) / DAY_MS)) : null,
      graceDays: payload?.graceDays ?? null,
    },
    notices,
    update,
    appVersion: APP_VERSION,
  };
  cache = { key: cacheKey, at: now, status };
  return status;
}

// ---------------- Usage tracking (feature key + date + count only) ----------------

export function recordUsage(feature: FeatureKey | string): void {
  try {
    db.prepare(`
      INSERT INTO feature_usage (feature_key, usage_date, count, first_used_at, last_used_at)
      VALUES (?, ?, 1, datetime('now'), datetime('now'))
      ON CONFLICT(feature_key, usage_date) DO UPDATE SET count = count + 1, last_used_at = datetime('now')
    `).run(feature, localDate());
  } catch (err) {
    // Usage analytics must never break billing.
    console.warn('[License] usage record failed', err);
  }
}

// ---------------- Communication with the central license server ----------------

function deviceInfo() {
  const cpus = os.cpus();
  // A soft signal only (easily changed); installation credentials are the real identity.
  const fingerprint = crypto.createHash('sha256')
    .update([os.hostname(), os.platform(), os.arch(), cpus[0]?.model || '', String(cpus.length), String(os.totalmem())].join('|'))
    .digest('hex');
  return {
    deviceName: os.hostname().slice(0, 100),
    os: `${os.type()} ${os.release()} (${os.arch()})`.slice(0, 100),
    appVersion: APP_VERSION,
    fingerprint,
  };
}

async function call(path: string, body: unknown, auth?: { id: string; secret: string }): Promise<{ status: number; data: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${config.licensing.serverUrl}/api/client/v1${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: `Bearer ${auth.id}.${auth.secret}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (err: any) {
    throw new HttpError(503, 'LICENSE_SERVER_UNREACHABLE',
      err?.name === 'AbortError' ? 'License server did not respond in time' : 'Could not reach the license server. Check your internet connection.');
  } finally {
    clearTimeout(timer);
  }
}

function acceptToken(token: string, installationId: string): LicensePayload {
  const payload = verifyToken(token);
  if (payload.iid !== installationId) throw new TokenError('TOKEN_MISMATCH', 'License token belongs to another installation');
  return payload;
}

function storeActivation(data: any) {
  if (!data?.installationId || !data?.installationSecret || !data?.token) {
    throw new HttpError(502, 'LICENSE_BAD_RESPONSE', 'License server returned an incomplete response');
  }
  try {
    acceptToken(data.token, data.installationId);
  } catch {
    throw new HttpError(502, 'LICENSE_BAD_SIGNATURE', 'License server response failed signature verification');
  }
  saveState({
    installation_id: data.installationId,
    installation_secret: data.installationSecret,
    license_token: data.token,
    last_sync_at: new Date().toISOString(),
    last_sync_error: null,
    notices_json: JSON.stringify(data.notices || []),
    update_json: data.update ? JSON.stringify(data.update) : null,
  });
}

function looksLikeTrial(s: LicenseStatus): boolean {
  const lic = s.license;
  if (!lic) return false;
  if (lic.type === 'TRIAL') return true;
  // Older change-plan left type=PAID while the plan was still Free Trial.
  return /trial/i.test(lic.plan?.code || '') || /free\s*trial/i.test(lic.plan?.name || '');
}

function assertCanActivate(opts?: { allowTrialUpgrade?: boolean }) {
  const s = computeStatus();
  if (s.installationId && s.mode === 'ACTIVE') {
    if (opts?.allowTrialUpgrade && looksLikeTrial(s)) return;
    throw new HttpError(409, 'ALREADY_ACTIVATED', 'This installation already has an active license. Deactivate it first to change licenses.');
  }
}

export async function startTrial(input: { name: string; businessName: string; email: string; phone?: string }) {
  assertCanActivate();
  const { status, data } = await call('/trial', { ...input, device: deviceInfo() });
  if (status !== 201 && status !== 200) throw new HttpError(status >= 500 ? 502 : 400, data.code || 'TRIAL_FAILED', data.message || 'Could not start trial');
  storeActivation(data);
  emitLicenseChanged('trial');
  return computeStatus();
}

export async function activateLicense(licenseKey: string) {
  assertCanActivate({ allowTrialUpgrade: true });
  const { status, data } = await call('/activate', { licenseKey: licenseKey.trim().toUpperCase(), device: deviceInfo() });
  if (status !== 201 && status !== 200) throw new HttpError(status >= 500 ? 502 : 400, data.code || 'ACTIVATION_FAILED', data.message || 'Activation failed');
  storeActivation(data);
  emitLicenseChanged('activate');
  return computeStatus();
}

let syncing: Promise<LicenseStatus> | null = null;
let queuedReasons: string[] = [];

/** The vendor removed this computer or the whole customer. The signed-in app must stop immediately. */
const SESSION_END_REASONS = new Set(['CUSTOMER_DELETED', 'INSTALLATION_DEACTIVATED']);

async function forgetInstallation(why: string) {
  if (why === 'CUSTOMER_DELETED') {
    await eraseRemovedShop();
    return;
  }
  saveState({
    installation_id: null,
    installation_secret: null,
    license_token: null,
    last_sync_error: why,
    notices_json: '[]',
    update_json: null,
  });
  emitLicenseChanged('session-ended', { sessionEnded: true, reason: why });
}

/**
 * The vendor already removed this customer, but this computer had signed out first (for example after deactivation),
 * so it never received the delete. If the license server no longer knows this computer, erase the leftover shop.
 */
export async function recoverIfVendorRemovedShop(): Promise<void> {
  if (!config.licensing.enforce) return;
  const state = getState();
  if (state.installation_id) return;
  const businesses = (db.prepare('SELECT COUNT(*) AS c FROM businesses').get() as { c: number }).c;
  if (!businesses) return;
  const err = state.last_sync_error || '';
  // Customer delete always clears the shop. After a device deactivation, clear only when the
  // license server no longer knows this computer (the customer was removed afterward).
  if (err === 'CUSTOMER_DELETED') {
    await eraseRemovedShop();
    return;
  }
  if (err !== 'INSTALLATION_DEACTIVATED') return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { status, data } = await call('/device-status', { fingerprint: deviceInfo().fingerprint });
      if (status === 200 && data.known === false) {
        await eraseRemovedShop();
      }
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

/** Revalidate with the server. Never throws for network problems; records the error instead. */
export function syncLicense(reason: 'startup' | 'scheduled' | 'manual' | 'push' = 'scheduled', pushReasons: string[] = []): Promise<LicenseStatus> {
  queuedReasons.push(...pushReasons);
  if (syncing) return syncing;
  syncing = (async () => {
    const reasons = queuedReasons.splice(0);
    const state = getState();
    if (!state.installation_id || !state.installation_secret) {
      if (reasons.includes('CUSTOMER_DELETED')) {
        await eraseRemovedShop();
      }
      return computeStatus();
    }
    let sessionEnd = reasons.find((r) => SESSION_END_REASONS.has(r)) || '';
    try {
      const { status, data } = await call('/heartbeat', { ...deviceInfo(), reason },
        { id: state.installation_id, secret: state.installation_secret });
      if (status === 200 && data.token) {
        const payload = acceptToken(data.token, state.installation_id);
        const patch: Partial<StateRow> = {
          license_token: data.token,
          last_sync_at: new Date().toISOString(),
          last_sync_error: null,
          notices_json: JSON.stringify(data.notices || []),
          update_json: data.update ? JSON.stringify(data.update) : null,
        };
        if (typeof data.newSecret === 'string' && data.newSecret.length >= 32) patch.installation_secret = data.newSecret;
        saveState(patch);
        if (payload.installationStatus === 'DEACTIVATED') sessionEnd = sessionEnd || 'INSTALLATION_DEACTIVATED';
      } else if (status === 401 && data.code === 'INSTALLATION_REMOVED') {
        sessionEnd = 'CUSTOMER_DELETED';
        saveState({ last_sync_error: `${data.code}: ${data.message || 'Installation removed'}` });
      } else if (status === 401) {
        saveState({ last_sync_error: `${data.code || status}: ${data.message || 'License check rejected'}` });
      } else {
        saveState({ last_sync_error: `${data.code || status}: ${data.message || 'License check rejected'}` });
      }
    } catch (err: any) {
      saveState({ last_sync_error: err?.message || 'License server unreachable' });
    }
    if (sessionEnd) {
      await forgetInstallation(sessionEnd);
      return computeStatus();
    }
    emitLicenseChanged(reason, reasons.length ? { reasons } : undefined);
    return computeStatus();
  })().finally(() => {
    syncing = null;
    if (queuedReasons.length) void syncLicense('push');
  });
  return syncing;
}

/** Upload usage counters (absolute per-day counts, so retries are idempotent). */
export async function syncUsage(): Promise<number> {
  const state = getState();
  if (!state.installation_id || !state.installation_secret) return 0;
  const rows = db.prepare('SELECT feature_key, usage_date, count, first_used_at, last_used_at FROM feature_usage WHERE count > synced_count LIMIT 500').all() as any[];
  if (rows.length === 0) return 0;
  const { status } = await call('/usage', {
    items: rows.map((r) => ({ feature: r.feature_key, date: r.usage_date, count: r.count, firstUsedAt: r.first_used_at, lastUsedAt: r.last_used_at })),
  }, { id: state.installation_id, secret: state.installation_secret });
  if (status !== 200) return 0;
  const mark = db.prepare('UPDATE feature_usage SET synced_count = ? WHERE feature_key = ? AND usage_date = ? AND synced_count < ?');
  db.transaction(() => { for (const r of rows) mark.run(r.count, r.feature_key, r.usage_date, r.count); })();
  db.prepare("DELETE FROM feature_usage WHERE count = synced_count AND usage_date < date('now', '-120 days')").run();
  return rows.length;
}

export async function deactivateInstallation() {
  const state = getState();
  if (!state.installation_id || !state.installation_secret) throw new HttpError(409, 'NOT_ACTIVATED', 'This installation is not activated');
  const { status, data } = await call('/deactivate', {}, { id: state.installation_id, secret: state.installation_secret });
  if (status !== 200) throw new HttpError(502, data.code || 'DEACTIVATE_FAILED', data.message || 'Deactivation failed');
  saveState({ installation_id: null, installation_secret: null, license_token: null, last_sync_error: null, notices_json: '[]', update_json: null });
  emitLicenseChanged('deactivate');
  return computeStatus();
}

export function getUsageSummary() {
  return db.prepare(`SELECT feature_key, SUM(count) AS count, MIN(first_used_at) AS first_used_at, MAX(last_used_at) AS last_used_at,
                            SUM(count - synced_count) AS pending_sync
                     FROM feature_usage GROUP BY feature_key ORDER BY count DESC`).all();
}
