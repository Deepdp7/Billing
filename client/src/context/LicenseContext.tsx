import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { FEATURE_LABELS } from '../lib/features.js';
import { showToast } from '../components/ui/dialogs.js';

export interface SystemInfo {
  version: string;
  schemaVersion: number;
  demoMode: boolean;
  singleTenant: boolean;
  setupRequired: boolean;
  licenseEnforced: boolean;
}

export interface LicenseStatus {
  mode: string;
  enforced: boolean;
  canWrite: boolean;
  message: string;
  features: Record<string, boolean>;
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
  /** Live link to the license server: when connected, Admin Panel changes apply within seconds. */
  realtime?: { connected: boolean; since: string | null };
  /** Internet check done by the local server; the app is locked while `requireOnline` and offline. */
  connectivity?: { online: boolean; since: string; serverReachable: boolean };
  requireOnline?: boolean;
}

interface Ctx {
  system: SystemInfo | null;
  license: LicenseStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** True when the feature is enabled (always true when licensing is not enforced). */
  hasFeature: (key?: string) => boolean;
  /** Features an administrator just turned off on this open screen. */
  adminLocked: (key?: string) => boolean;
}

const SESSION_NOTICE_KEY = 'apna_billing_session_notice';

/** Structured notice shown after admin wipe / deactivate / local erase. */
export interface SessionNotice {
  title: string;
  body: string;
  backupFile?: string;
  hint?: string;
}

/**
 * Why the user was signed out (shown on sign-in, setup or activation). Kept until they sign in or register: after a
 * sign-out the app can pass through the sign-in screen before settling on setup, and both should be able to show it.
 */
function parseLegacyNotice(raw: string): SessionNotice {
  const backupMatch = raw.match(/A backup was saved first:\s*(.+?)\s*\(restore it from/i);
  const backupFile = backupMatch?.[1]?.trim();
  if (/administrator removed this shop/i.test(raw)) {
    return {
      title: 'Shop removed by administrator',
      body: 'This shop was erased from this computer after your administrator removed it.',
      backupFile,
      hint: backupFile
        ? 'Restore later from Backup & Restore → Restore from file. You can sign up again with the same email.'
        : 'You can sign up again with the same email.',
    };
  }
  if (/deactivated by your administrator/i.test(raw)) {
    return {
      title: 'This computer was deactivated',
      body: 'Your administrator deactivated this installation. You have been signed out, and the saved login on this computer was cleared.',
    };
  }
  return { title: 'Notice', body: raw, backupFile };
}

export function takeSessionNotice(): SessionNotice | null {
  try {
    const raw = sessionStorage.getItem(SESSION_NOTICE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.title === 'string' && typeof parsed.body === 'string') {
        return parsed as SessionNotice;
      }
    } catch {
      // Older builds stored a plain string.
    }
    return parseLegacyNotice(raw);
  } catch {
    return null;
  }
}

export function clearSessionNotice(): void {
  try { sessionStorage.removeItem(SESSION_NOTICE_KEY); } catch { /* storage blocked */ }
}

function storeSessionNotice(notice: SessionNotice) {
  try {
    localStorage.clear();
    sessionStorage.setItem(SESSION_NOTICE_KEY, JSON.stringify(notice));
  } catch {
    // Storage can be blocked; the sign-out event still runs.
  }
}

/** Drop the saved login on this computer and leave the app. A customer removal also clears the shop file. */
function endLocalSession(reason?: string, erased?: boolean, backupFile?: string) {
  const restoreHint = backupFile
    ? 'Restore later from Backup & Restore → Restore from file. You can sign up again with the same email.'
    : 'You can sign up again with the same email.';

  const notice: SessionNotice = reason === 'INSTALLATION_DEACTIVATED'
    ? {
        title: 'This computer was deactivated',
        body: 'Your administrator deactivated this installation. You have been signed out, and the saved login on this computer was cleared.',
      }
    : reason === 'CUSTOMER_DELETED' && erased === false
      ? {
          title: 'Shop removed by administrator',
          body: 'Your administrator removed this shop and you have been signed out. Your data is still on this computer because a safety backup could not be saved.',
        }
      : reason === 'CUSTOMER_DELETED'
        ? {
            title: 'Shop removed by administrator',
            body: 'This shop was erased from this computer after your administrator removed it.',
            backupFile: backupFile || undefined,
            hint: restoreHint,
          }
        : {
            title: 'Shop data erased',
            body: 'The shop on this computer was erased. Only Apna Billing data was removed.',
            backupFile: backupFile || undefined,
            hint: restoreHint,
          };

  storeSessionNotice(notice);
  window.dispatchEvent(new CustomEvent('apna:session-ended'));
}

/** Tell the user, without interrupting them, what an update from the vendor changed. */
function announceChanges(before: LicenseStatus | null, after: LicenseStatus) {
  if (!before || !after.enforced || before.installationId !== after.installationId) return;
  const label = (k: string) => FEATURE_LABELS[k] || k;
  const keys = new Set([...Object.keys(before.features || {}), ...Object.keys(after.features || {})]);
  const enabled: string[] = [];
  const disabled: string[] = [];
  keys.forEach((k) => {
    const was = !!before.features?.[k];
    const now = !!after.features?.[k];
    if (!was && now) enabled.push(label(k));
    if (was && !now) disabled.push(label(k));
  });
  if (before.mode !== after.mode) {
    showToast(after.canWrite ? 'License updated' : 'License changed', after.message, after.canWrite ? 'success' : 'warning');
  }
  if (enabled.length) showToast(enabled.length === 1 ? 'Feature enabled' : 'Features enabled', `${enabled.join(', ')} — enabled by your administrator.`, 'success');
  if (disabled.length) showToast(disabled.length === 1 ? 'Feature locked' : 'Features locked', `${disabled.join(', ')} — locked by your administrator.`, 'warning');
  const newNotices = (after.notices || []).filter((n) => !(before.notices || []).some((b) => b.id === n.id));
  newNotices.forEach((n) => showToast(n.title, n.message, n.level === 'CRITICAL' ? 'error' : n.level === 'WARNING' ? 'warning' : 'info', 10000));
}

const LicenseCtx = createContext<Ctx>({ system: null, license: null, loading: true, refresh: async () => {}, hasFeature: () => true, adminLocked: () => false });

export const LicenseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lockedByAdmin, setLockedByAdmin] = useState<string[]>([]);

  const previous = useRef<LicenseStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([api.getSystemInfo(), api.getLicenseStatus()]);
      setSystem(s);
      setLicense(l);
      const before = previous.current;
      announceChanges(before, l);
      if (before && before.installationId === l.installationId) {
        setLockedByAdmin((current) => {
          const next = new Set(current);
          const keys = new Set([...Object.keys(before.features || {}), ...Object.keys(l.features || {})]);
          keys.forEach((k) => {
            const was = !!before.features?.[k];
            const now = !!l.features?.[k];
            if (was && !now) next.add(k);
            if (now) next.delete(k);
          });
          return [...next];
        });
      }
      previous.current = l;
    } catch (err) {
      console.warn('Could not load system/license status', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Fallback: status is cheap (local verification); re-read periodically so time-based expiry shows up.
    const t = setInterval(refresh, 5 * 60 * 1000);

    // Live updates: the local server pings this stream after every license change, including changes the vendor
    // just made in the Admin Panel (pushed to the local server over its live link). EventSource reconnects itself.
    let es: EventSource | null = null;
    let debounce: number | undefined;
    try {
      es = new EventSource('/api/v1/license/events');
      es.addEventListener('license', (ev) => {
        let payload: { sessionEnded?: boolean; reason?: string; erased?: boolean; backupFile?: string } = {};
        try { payload = JSON.parse((ev as MessageEvent).data || '{}'); } catch { payload = {}; }
        if (payload.sessionEnded) {
          endLocalSession(payload.reason, payload.erased, payload.backupFile);
          refresh();
          return;
        }
        window.clearTimeout(debounce);
        debounce = window.setTimeout(refresh, 0);
      });
    } catch {
      // No EventSource (very old engine): the periodic refresh still applies changes.
    }
    return () => {
      clearInterval(t);
      window.clearTimeout(debounce);
      es?.close();
    };
  }, [refresh]);

  const hasFeature = useCallback((key?: string) => {
    if (!key || !license || !license.enforced) return true;
    return !!license.features[key];
  }, [license]);

  const adminLocked = useCallback((key?: string) => !!key && lockedByAdmin.includes(key), [lockedByAdmin]);

  return <LicenseCtx.Provider value={{ system, license, loading, refresh, hasFeature, adminLocked }}>{children}</LicenseCtx.Provider>;
};

export const useLicense = () => useContext(LicenseCtx);
