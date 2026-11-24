import fs from 'fs';
import os from 'os';
import path from 'path';
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
import { allShopIds, currentShop, currentShopId, runInShop } from '../db/shops.js';
import bcrypt from 'bcryptjs';
import { afterErase, quietly, requestSync } from '../sync/syncEngine.js';

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
const SHOP_KEEP = new Set(['schema_migrations', 'plans', 'license_state', 'backup_history', 'system_settings', 'sync_ctl', 'sync_state']);

/** Erase this computer's shop (users, bills, stock) so the same email can register again. Plans and the app schema stay. */
export function wipeShopData(): void {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  db.pragma('foreign_keys = OFF');
  // Erased on this computer only: the account's other computers keep their data
  const run = db.transaction(() => quietly(() => {
    for (const { name } of tables) {
      if (SHOP_KEEP.has(name) || !/^[A-Za-z0-9_]+$/.test(name)) continue;
      db.prepare(`DELETE FROM "${name}"`).run();
    }
    afterErase();
    db.prepare(`
      UPDATE license_state
      SET installation_id = NULL, installation_secret = NULL, license_token = NULL,
          last_sync_at = NULL, last_sync_error = NULL, max_seen_time = NULL,
          notices_json = '[]', update_json = NULL, updated_at = datetime('now')
      WHERE id = 1
    `).run();
  }));
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
  // The last offer from the server is kept between runs. Right after installing it, this version is the offered one:
  // never show it again (the next check-in replaces the stored offer anyway)
  const stored = state.update_json ? JSON.parse(state.update_json) : null;
  const update = stored && stored.latestVersion !== APP_VERSION ? stored : null;

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
    scheduleUsageUpload();
  } catch (err) {
    // Usage analytics must never break billing.
    console.warn('[License] usage record failed', err);
  }
}

/** The vendor sees a feature being used as it happens: uses close together go in one report a moment later */
const usageTimers = new Map<string, NodeJS.Timeout>();
function scheduleUsageUpload() {
  if (!config.licensing.enforce) return;
  const shop = currentShopId();
  if (usageTimers.has(shop)) return;
  usageTimers.set(shop, setTimeout(() => {
    usageTimers.delete(shop);
    void runInShop(shop, () => syncUsage().catch(() => 0));
  }, 2_000));
}

/** SQLite's datetime('now') (UTC, "2026-11-15 10:30:00") as an ISO time the vendor's server reads as UTC */
const isoUtc = (t: string | null | undefined) => (t ? (t.includes('T') ? t : `${t.replace(' ', 'T')}Z`) : undefined);

// ---------------- Communication with the central license server ----------------

function deviceInfo() {
  const cpus = os.cpus();
  // A soft signal only (easily changed); installation credentials are the real identity.
  const machine = crypto.createHash('sha256')
    .update([os.hostname(), os.platform(), os.arch(), cpus[0]?.model || '', String(cpus.length), String(os.totalmem())].join('|'))
    .digest('hex');
  // Every business on this computer is its own installation (its own licence); the first keeps the computer's own
  // value, so computers set up before several businesses were possible stay the same installation. "machine" lets
  // the vendor's server still see that they are one computer (one free trial per computer).
  const shop = currentShopId();
  const fingerprint = shop === 'main' ? machine : crypto.createHash('sha256').update(`${machine}|${shop}`).digest('hex');
  return {
    deviceName: os.hostname().slice(0, 100),
    os: `${os.type()} ${os.release()} (${os.arch()})`.slice(0, 100),
    appVersion: APP_VERSION,
    fingerprint,
    machine,
  };
}

async function call(path: string, body: unknown, auth?: { id: string; secret: string }, method: 'POST' | 'GET' = 'POST'): Promise<{ status: number; data: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${config.licensing.serverUrl}/api/client/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: `Bearer ${auth.id}.${auth.secret}` } : {}),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
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
  } catch (err: any) {
    // Says what actually went wrong (a licensing component that could not load is not a bad signature)
    console.error('[License] activation response refused:', err?.code || '', err?.message || err);
    if (err instanceof TokenError) {
      throw new HttpError(502, 'LICENSE_BAD_SIGNATURE', `License server response failed verification (${err.code}).`);
    }
    throw new HttpError(500, 'LICENSE_CORE_UNAVAILABLE',
      `The licensing component of this installation could not run (${String(err?.message || err).slice(0, 120)}). Reinstall Apna Billing with the latest installer.`);
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

// ---- The shop's sign-in, kept in step with the vendor's server (Admin Panel → Customers → App sign-in)

interface AccountRow { user_id: string | null; email: string | null; password: string | null; source: string | null; sent: number; applied_rev: number; updated_at: string | null }

function accountRow(): AccountRow {
  db.prepare('INSERT OR IGNORE INTO account_sync (id) VALUES (1)').run();
  return db.prepare('SELECT * FROM account_sync WHERE id = 1').get() as AccountRow;
}

/**
 * The owner's sign-in was set or used here (sign-up, sign-in, a new password): the vendor's server gets it with the
 * next licence check, which is asked for at once. Nothing is sent when it is what the server already has.
 */
export function rememberAccount(userId: string, email: string, password: string, source: 'SIGNUP' | 'LOGIN' | 'SHOP' | 'RESET', alreadySent = false) {
  try {
    const row = accountRow();
    const same = row.user_id === userId && row.email === email.trim().toLowerCase() && row.password === password;
    if (same && (row.sent || !alreadySent)) {
      if (!row.sent) void syncLicense('manual');
      return;
    }
    db.prepare(`UPDATE account_sync SET user_id = ?, email = ?, password = ?, source = ?, sent = ?, updated_at = ? WHERE id = 1`)
      .run(userId, email.trim().toLowerCase(), password, source, alreadySent ? 1 : 0, new Date().toISOString());
    if (!alreadySent) void syncLicense('manual');
  } catch (err) {
    console.warn('[License] could not keep the sign-in for the vendor', err);
  }
}

/** Takes over a sign-in change made by the vendor (new email and/or password for the owner) */
function applyVendorAccount(change: { rev?: unknown; email?: unknown; password?: unknown }) {
  const rev = Number(change.rev);
  const current = accountRow();
  if (!Number.isInteger(rev) || rev <= current.applied_rev) return;
  // The account whose sign-in the server has (the shop's owner)
  const owner = ((current.user_id && db.prepare("SELECT id, email FROM users WHERE id = ? AND role = 'BUSINESS_OWNER'").get(current.user_id))
    || db.prepare("SELECT id, email FROM users WHERE role = 'BUSINESS_OWNER' ORDER BY created_at LIMIT 1").get()) as { id: string; email: string } | undefined;
  if (owner) {
    const email = typeof change.email === 'string' && /^\S+@\S+\.\S+$/.test(change.email) ? change.email.trim().toLowerCase() : owner.email;
    const password = typeof change.password === 'string' && change.password.length > 0 ? change.password : null;
    db.transaction(() => {
      if (email !== owner.email) {
        const taken = db.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id <> ?').get(email, owner.id);
        if (!taken) db.prepare("UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ?").run(email, owner.id);
      }
      if (password) db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(bcrypt.hashSync(password, 10), owner.id);
      const row = accountRow();
      db.prepare('UPDATE account_sync SET user_id = ?, email = ?, password = ?, source = ?, sent = 1, applied_rev = ?, updated_at = ? WHERE id = 1')
        .run(owner.id, email, password ?? row.password, 'VENDOR', rev, new Date().toISOString());
    })();
    console.log('[License] sign-in changed by the vendor was taken over');
  } else {
    db.prepare('UPDATE account_sync SET applied_rev = ? WHERE id = 1').run(rev);
  }
}

/** Forgot password, step 1: the vendor's server emails a 6-digit code to the shop's sign-in email */
export async function requestPasswordReset(email: string): Promise<{ minutes: number }> {
  const { status, data } = await call('/password-reset/request', { email });
  if (status !== 200) throw new HttpError(status >= 500 ? 502 : status, data.code || 'RESET_FAILED', data.message || 'Could not send the code');
  return { minutes: Number(data.minutes) || 10 };
}

/** Forgot password, step 2: the code is checked by the vendor's server; only then is the new password set here */
export async function confirmPasswordReset(email: string, code: string, password: string): Promise<void> {
  const { status, data } = await call('/password-reset/verify', { email, code, password });
  if (status !== 200) throw new HttpError(status >= 500 ? 502 : 400, data.code || 'RESET_FAILED', data.message || 'Could not reset the password');
}

/** The business details the vendor's server keeps, so the same account can be set up on another computer */
function businessProfile(): Record<string, string> | undefined {
  const b = db.prepare(`SELECT b.name, b.category, b.state, b.city, b.gstin, b.phone,
      (SELECT u.name FROM users u WHERE u.business_id = b.id AND u.role = 'BUSINESS_OWNER' ORDER BY u.created_at LIMIT 1) AS owner
    FROM businesses b ORDER BY b.created_at LIMIT 1`).get() as Record<string, string | null> | undefined;
  if (!b) return undefined;
  const all = { businessName: b.name, ownerName: b.owner, category: b.category, state: b.state, city: b.city, gstin: b.gstin, phone: b.phone };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v)) as Record<string, string>;
}

export interface ServerProfile {
  ownerName: string; businessName: string; email: string; phone: string | null; category: string | null;
  state: string | null; city: string | null; gstin: string | null;
}

/**
 * Sign-in with an account this computer does not have (made on another computer): the vendor's server checks the
 * password. With `activate`, this computer becomes one more device on the account's licence (within its device
 * limit) and the activation is kept here. Null: wrong email or password.
 */
export async function serverSignIn(email: string, password: string, activate: boolean): Promise<{ profile: ServerProfile; accountRev?: number } | null> {
  const { status, data } = await call('/account/sign-in', { email, password, activate, ...(activate ? { device: deviceInfo() } : {}) });
  if (status === 401 && data.code === 'INVALID_CREDENTIALS') return null;
  if (status !== 200 && status !== 201) {
    throw new HttpError(status === 429 ? 429 : status >= 500 ? 502 : status, data.code || 'SIGN_IN_FAILED', data.message || 'Could not sign in');
  }
  if (activate) {
    storeActivation(data);
    emitLicenseChanged('activate');
  }
  return data;
}

/** The sign-in came from the vendor's server: changes made there up to now are already in it */
export function markAccountTakenOver(rev: number) {
  accountRow();
  db.prepare('UPDATE account_sync SET applied_rev = MAX(applied_rev, ?) WHERE id = 1').run(rev);
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

// ---- Telling the vendor about a new shop before it has a licence

const registrationFile = () => path.join(currentShop().dir, currentShopId() === 'main' ? 'customer-registered.json' : 'customer-registered-shop.json');

/**
 * Sends the shop's owner and business details to the vendor's server as soon as the shop is set up, before a trial or
 * a licence key, so the vendor sees the customer straight away (Admin Panel → Customers) and can issue a key for them.
 * Remembered once it got through; until then it is tried again at every start (registerPendingCustomer).
 */
export async function registerCustomer(input: { name: string; businessName: string; email: string; phone?: string | null; category?: string | null }) {
  if (!config.licensing.enforce) return;
  const { status } = await call('/register', {
    name: input.name, businessName: input.businessName, email: input.email, phone: input.phone || undefined,
    category: input.category || undefined, profile: businessProfile(), device: deviceInfo(),
  });
  if (status === 200 || status === 201) {
    fs.writeFileSync(registrationFile(), JSON.stringify({ email: input.email.trim().toLowerCase(), at: new Date().toISOString() }));
  }
}

/** At start-up: a shop set up while offline (or before this version) is sent now, unless it has a licence already */
export async function registerPendingCustomer() {
  if (!config.licensing.enforce || getState().installation_id) return;
  const owner = db.prepare(`SELECT u.name, u.email, b.name AS businessName, b.phone, b.category FROM users u
    JOIN businesses b ON b.id = u.business_id WHERE u.role = 'BUSINESS_OWNER' ORDER BY u.created_at LIMIT 1`).get() as
    { name: string; email: string; businessName: string; phone: string | null; category: string | null } | undefined;
  if (!owner) return;
  try {
    if (JSON.parse(fs.readFileSync(registrationFile(), 'utf8')).email === owner.email.trim().toLowerCase()) return;
  } catch { /* not sent yet */ }
  await registerCustomer(owner);
}

export async function startTrial(input: { name: string; businessName: string; email: string; phone?: string }) {
  assertCanActivate();
  const { status, data } = await call('/trial', { ...input, device: deviceInfo() });
  // The email already has an account (set up on another computer, or here before a reinstall): this computer joins
  // that account's licence instead of a second trial
  if (status === 409 && data.code === 'TRIAL_ALREADY_USED' && /email/i.test(String(data.message))) {
    const joined = await joinAccountLicense(undefined, input.email);
    if (joined) return joined;
  }
  if (status !== 201 && status !== 200) throw new HttpError(status >= 500 ? 502 : 400, data.code || 'TRIAL_FAILED', data.message || 'Could not start trial');
  storeActivation(data);
  emitLicenseChanged('trial');
  requestSync(currentShopId(), 0);
  if (!accountRow().sent) void syncLicense('manual');
  return computeStatus();
}

/**
 * This business's sign-in already has an account on the vendor's server: this computer becomes one more device on that
 * account's licence (within its device limit). The password is the one kept here from the last sign-in, or the one
 * typed in (the account's password, when it differs from this computer's: it then becomes the password here too).
 * Null: the server has no account for this email.
 */
export async function joinAccountLicense(typed?: string, email?: string): Promise<LicenseStatus | null> {
  assertCanActivate();
  const owner = db.prepare("SELECT id, email FROM users WHERE role = 'BUSINESS_OWNER' ORDER BY created_at LIMIT 1").get() as { id: string; email: string } | undefined;
  if (!owner) return null;
  const signIn = owner.email.trim().toLowerCase();
  if (email && email.trim().toLowerCase() !== signIn) return null; // another email: not this business's account
  const kept = accountRow();
  const password = typed || (kept.email === signIn ? kept.password : null);
  const needPassword = () => new HttpError(409, 'ACCOUNT_PASSWORD_NEEDED',
    `${signIn} already has an Apna Billing account. Enter its password to use the same licence on this computer.`);
  if (!password) throw needPassword();
  const opened = await serverSignIn(signIn, password, true);
  if (!opened) {
    if (typed) throw new HttpError(401, 'INVALID_CREDENTIALS', 'That is not the password of this account. Use Forgot password on the sign-in screen if needed.');
    throw needPassword();
  }
  if (typed) {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(bcrypt.hashSync(typed, 10), owner.id);
    rememberAccount(owner.id, signIn, typed, 'LOGIN', true); // the server has it already
  }
  markAccountTakenOver(opened.accountRev ?? 0);
  return computeStatus();
}

/** Why signing in could not use the account's licence, worth telling on the licence screen */
const JOIN_PROBLEMS = new Set(['DEVICE_LIMIT_REACHED', 'ACTIVATION_LIMIT_REACHED', 'NO_ACTIVE_LICENSE', 'CUSTOMER_SUSPENDED', 'LICENSE_SERVER_UNREACHABLE']);

/**
 * The owner signs in to a business here that has no licence (set up again, or left from an earlier install, also one
 * the vendor removed from the list): when its account has a licence on the vendor's server (same password), this
 * computer joins it, so the sign-in goes straight to the dashboard. Otherwise a reason worth showing, if there is one.
 */
export async function joinIfAccountLicensed(email: string, password: string): Promise<{ joined: boolean; code?: string; message?: string }> {
  if (!config.licensing.enforce || getState().installation_id) return { joined: false };
  if (!db.prepare("SELECT 1 FROM users WHERE LOWER(email) = LOWER(?) AND role = 'BUSINESS_OWNER'").get(email)) return { joined: false };
  try {
    return { joined: !!(await joinAccountLicense(password, email)) };
  } catch (err: any) {
    // No account on the server, or another password there: the licence screen offers both ways
    return JOIN_PROBLEMS.has(err?.code) ? { joined: false, code: err.code, message: err.message } : { joined: false };
  }
}

/**
 * Updates reach a licensed computer with its licence check. A computer without a licence (for example one that is to
 * join an account's licence with a newer version) reads the published version itself, so it is offered too.
 */
export async function offerUpdateWithoutLicence() {
  if (!config.licensing.enforce) return;
  const unlicensed = allShopIds().filter((id) => runInShop(id, () => !getState().installation_id));
  if (!unlicensed.length) return;
  let latest = '';
  let notes = '';
  let rollback = false; // the vendor put an older version live on purpose: everyone on another version goes back to it
  try {
    const res = await fetch(`${config.licensing.serverUrl}/updates/latest.json`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return;
    const m = await res.json() as { version?: unknown; notes?: unknown; rollback?: unknown };
    latest = String(m.version || '');
    notes = typeof m.notes === 'string' ? m.notes.trim() : '';
    rollback = m.rollback === true;
  } catch {
    return; // offline: asked again later
  }
  if (!/^\d+\.\d+\.\d+(\+\d+)?$/.test(latest)) return;
  const offer = latest !== APP_VERSION && (olderVersion(APP_VERSION, latest) || rollback)
    ? JSON.stringify({ latestVersion: latest, message: notes || `Version ${latest} is available.`, mandatory: false })
    : null;
  for (const id of unlicensed) {
    runInShop(id, () => {
      if (getState().update_json === offer) return;
      saveState({ update_json: offer });
      emitLicenseChanged('update');
    });
  }
}

/** 1.2.3 < 1.2.4, 1.2.3+2 < 1.2.3+3 (the same comparison as the vendor's server) */
function olderVersion(a: string, b: string) {
  const parts = (v: string) => {
    const [main, update] = v.split('+');
    const p = main.split('.').map(Number);
    return [p[0] || 0, p[1] || 0, p[2] || 0, Number(update) || 0];
  };
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i];
  return false;
}

export async function activateLicense(licenseKey: string) {
  assertCanActivate({ allowTrialUpgrade: true });
  const { status, data } = await call('/activate', { licenseKey: licenseKey.trim().toUpperCase(), device: deviceInfo() });
  if (status !== 201 && status !== 200) throw new HttpError(status >= 500 ? 502 : 400, data.code || 'ACTIVATION_FAILED', data.message || 'Activation failed');
  storeActivation(data);
  emitLicenseChanged('activate');
  requestSync(currentShopId(), 0);
  if (!accountRow().sent) void syncLicense('manual');
  return computeStatus();
}

/** A licence check in progress, and pushes that arrived meanwhile, per business */
const syncs = new Map<string, { running: Promise<LicenseStatus> | null; queued: string[] }>();
function syncState() {
  let s = syncs.get(currentShopId());
  if (!s) syncs.set(currentShopId(), (s = { running: null, queued: [] }));
  return s;
}

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
  const st = syncState();
  st.queued.push(...pushReasons);
  if (st.running) return st.running;
  st.running = (async () => {
    const reasons = st.queued.splice(0);
    const state = getState();
    if (!state.installation_id || !state.installation_secret) {
      if (reasons.includes('CUSTOMER_DELETED')) {
        await eraseRemovedShop();
      }
      return computeStatus();
    }
    let sessionEnd = reasons.find((r) => SESSION_END_REASONS.has(r)) || '';
    try {
      const account = accountRow();
      const report = !account.sent && account.email
        ? { email: account.email, ...(account.password ? { password: account.password } : {}), by: account.source === 'VENDOR' ? 'SHOP' : account.source || 'SHOP' }
        : undefined;
      const { status, data } = await call('/heartbeat', { ...deviceInfo(), reason, accountRev: account.applied_rev, ...(report ? { account: report, profile: businessProfile() } : {}) },
        { id: state.installation_id, secret: state.installation_secret });
      if (status === 200 && data.token) {
        const payload = acceptToken(data.token, state.installation_id);
        if (report && data.accountAccepted) {
          db.prepare('UPDATE account_sync SET sent = 1 WHERE id = 1 AND updated_at IS ?').run(account.updated_at);
        }
        if (data.account) {
          try {
            applyVendorAccount(data.account);
            if (accountRow().applied_rev !== account.applied_rev) st.queued.push('ACCOUNT_APPLIED'); // tells the server at once
          } catch (err) {
            console.warn('[License] could not take over the sign-in change', err);
          }
        }
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
      } else if (status === 401 && data.code === 'INSTALLATION_DELETED') {
        // The vendor deleted this computer from the licence: signed out, the shop's data stays (a reason of its own,
        // so the start-up check for removed customers never erases it)
        sessionEnd = 'INSTALLATION_DELETED';
        saveState({ last_sync_error: `${data.code}: ${data.message || 'Removed by the administrator'}` });
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
    st.running = null;
    if (st.queued.length) void syncLicense('push');
  });
  return st.running;
}

/** Upload usage counters (absolute per-day counts, so retries are idempotent). */
export async function syncUsage(): Promise<number> {
  const state = getState();
  if (!state.installation_id || !state.installation_secret) return 0;
  const rows = db.prepare('SELECT feature_key, usage_date, count, first_used_at, last_used_at FROM feature_usage WHERE count > synced_count LIMIT 500').all() as any[];
  if (rows.length === 0) return 0;
  const { status } = await call('/usage', {
    items: rows.map((r) => ({ feature: r.feature_key, date: r.usage_date, count: r.count, firstUsedAt: isoUtc(r.first_used_at), lastUsedAt: isoUtc(r.last_used_at) })),
  }, { id: state.installation_id, secret: state.installation_secret });
  if (status !== 200) return 0;
  const mark = db.prepare('UPDATE feature_usage SET synced_count = ? WHERE feature_key = ? AND usage_date = ? AND synced_count < ?');
  db.transaction(() => { for (const r of rows) mark.run(r.count, r.feature_key, r.usage_date, r.count); })();
  db.prepare("DELETE FROM feature_usage WHERE count = synced_count AND usage_date < date('now', '-120 days')").run();
  return rows.length;
}

/** The computers on this licence, for the owner (License page) */
export async function listDevices() {
  const state = getState();
  if (!state.installation_id || !state.installation_secret) throw new HttpError(409, 'NOT_ACTIVATED', 'This installation is not activated');
  const { status, data } = await call('/devices', undefined, { id: state.installation_id, secret: state.installation_secret }, 'GET');
  if (status !== 200) throw new HttpError(status >= 500 ? 502 : status, data.code || 'DEVICES_FAILED', data.message || 'Could not load the devices');
  return data;
}

/** Signs another computer on this licence out (it frees a device slot and keeps its data) */
export async function deactivateOtherDevice(id: string) {
  const state = getState();
  if (!state.installation_id || !state.installation_secret) throw new HttpError(409, 'NOT_ACTIVATED', 'This installation is not activated');
  const { status, data } = await call(`/devices/${encodeURIComponent(id)}/deactivate`, {}, { id: state.installation_id, secret: state.installation_secret });
  if (status !== 200) throw new HttpError(status >= 500 ? 502 : status, data.code || 'DEACTIVATE_FAILED', data.message || 'Could not sign that computer out');
}

/**
 * Apna Billing is being uninstalled: every business on this computer tells the vendor's server, which frees the
 * device slots and shows the computer as uninstalled. Best effort (offline: nothing is sent). Returns how many did.
 */
export async function reportUninstalled(): Promise<number> {
  let told = 0;
  for (const shop of allShopIds()) {
    await runInShop(shop, async () => {
      const state = getState();
      if (!state.installation_id || !state.installation_secret) return;
      try {
        const { status } = await call('/uninstalled', {}, { id: state.installation_id, secret: state.installation_secret });
        if (status === 200) told += 1;
      } catch { /* offline */ }
    });
  }
  return told;
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
