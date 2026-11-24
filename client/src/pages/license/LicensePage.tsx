import React, { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, Sparkles, RefreshCw, Lock, AlertTriangle, CheckCircle2, WifiOff, Download, Zap } from 'lucide-react';
import { api, type LicenseDevices } from '../../lib/api.js';
import { takeSessionNotice, useLicense, versionLabel, type SessionNotice } from '../../context/LicenseContext.js';
import { useAuth } from '../../context/AuthContext.js';
import { FEATURE_LABELS } from '../../lib/features.js';
import { confirmDialog } from '../../components/ui/dialogs.js';
import { ThemeSwitch } from '../../components/ThemeSwitch.js';
import { SessionNoticeBanner } from '../../components/system/SessionNoticeBanner.js';

const inputCls = 'w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500';

/** After sign-in, when this account has not purchased: start a free trial or enter a license key. */
export const LicenseActivationPage: React.FC = () => {
  const { license, refresh } = useLicense();
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<'trial' | 'key'>('trial');
  const [form, setForm] = useState({
    name: user?.name || '',
    businessName: user?.businessName || '',
    email: user?.email || '',
    phone: user?.phone || '',
  });
  const [licenseKey, setLicenseKey] = useState('');
  // The email has an account (and licence) already: its password connects this computer to it
  const [joinPassword, setJoinPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<SessionNotice | null>(null);
  useEffect(() => {
    setNotice(takeSessionNotice());
    // Why signing in did not use the account's licence on this computer (device limit, no internet, …)
    try {
      const why = JSON.parse(sessionStorage.getItem('apna_license_join') || 'null');
      sessionStorage.removeItem('apna_license_join');
      if (why?.message) setError(why.message);
    } catch { /* nothing kept */ }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (joinPassword !== null) await api.joinAccountLicense(joinPassword);
      else if (tab === 'trial') await api.startTrial({ ...form, phone: form.phone || undefined });
      else await api.activateLicense(licenseKey);
      await refresh();
    } catch (err: any) {
      if (err.code === 'ACCOUNT_PASSWORD_NEEDED' && joinPassword === null) setJoinPassword('');
      setError(err.message || 'Activation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-100 text-slate-900 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-emerald-950 dark:text-white flex items-center justify-center p-4">
      <div className="absolute top-4 right-4 z-20"><ThemeSwitch /></div>
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8 items-center">
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <Zap className="w-6 h-6 fill-white" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold font-['Outfit']">Apna Billing</h1>
              <p className="text-xs text-emerald-300">Desktop billing & business management</p>
            </div>
          </div>
          <SessionNoticeBanner notice={notice} />
          <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
            Your billing data is kept on this computer and stays the same on every computer you sign in to with this account. Work
            done while offline is sent on its own once the connection is back.
          </p>
          {license && license.mode !== 'UNLICENSED' && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />{license.message}
            </div>
          )}
          {user && (
            <button type="button" onClick={() => logout()} className="text-xs font-semibold text-slate-400 hover:text-white">
              Signed in as {user.email}. Sign out
            </button>
          )}
        </div>

        <form onSubmit={submit} className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 text-xs font-semibold">
            <button type="button" onClick={() => setTab('trial')} className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 ${tab === 'trial' ? 'btn-brand' : 'text-slate-500 dark:text-slate-400'}`}>
              <Sparkles className="w-3.5 h-3.5" />Start free trial
            </button>
            <button type="button" onClick={() => setTab('key')} className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1.5 ${tab === 'key' ? 'btn-brand' : 'text-slate-500 dark:text-slate-400'}`}>
              <KeyRound className="w-3.5 h-3.5" />I have a license key
            </button>
          </div>

          {error && <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{error}</div>}

          {joinPassword !== null ? (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400">Your account's licence is used on this computer too (one more device on it).</p>
              <input className={inputCls} required autoFocus type="password" placeholder="Account password" value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)} />
              <button type="button" className="text-xs font-semibold text-slate-500 hover:text-emerald-600" onClick={() => { setJoinPassword(null); setError(''); }}>
                Back
              </button>
            </>
          ) : tab === 'trial' ? (
            <>
              <p className="text-xs text-slate-400">Try every core feature free. No payment details needed.</p>
              <input className={inputCls} required minLength={2} placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className={inputCls} required minLength={2} placeholder="Business name" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
              <input className={inputCls} required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className={inputCls} placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </>
          ) : (
            <>
              <p className="text-xs text-slate-400">Enter the key you received after purchase, e.g. APNA-XXXX-XXXX-XXXX-XXXX.</p>
              <input className={`${inputCls} font-mono uppercase tracking-wider`} required placeholder="APNA-XXXX-XXXX-XXXX-XXXX" value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value.toUpperCase())} />
            </>
          )}
          <button type="submit" disabled={busy} className="btn-brand w-full rounded-lg py-2 text-sm font-bold flex items-center justify-center gap-2">
            {busy && <RefreshCw className="w-4 h-4 animate-spin" />}
            {joinPassword !== null ? 'Use my licence here' : tab === 'trial' ? 'Start my free trial' : 'Activate'}
          </button>
          {joinPassword === null && (
            <button type="button" className="w-full text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
              onClick={() => { setJoinPassword(''); setError(''); }}>
              Already using Apna Billing on another computer? Use that account's licence
            </button>
          )}
          <p className="text-[10px] text-slate-500 text-center">Your business data is kept on this computer and synced securely (encrypted connection, encrypted storage) with your other computers on the same account through the Apna Billing server.</p>
        </form>
      </div>
    </div>
  );
};

/** Shown in place of a page the moment that feature is no longer allowed. */
export const FeatureLocked: React.FC<{ feature: string; lockedByAdmin?: boolean; onOpenLicense: () => void }> = ({ feature, lockedByAdmin, onOpenLicense }) => (
  <div className="max-w-lg mx-auto mt-16 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-sm">
    <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center mb-3"><Lock className="w-6 h-6 text-amber-600" /></div>
    <h2 className="text-lg font-bold">
      {lockedByAdmin ? `${FEATURE_LABELS[feature] || feature} is locked by your administrator` : `${FEATURE_LABELS[feature] || feature} is not included in your license`}
    </h2>
    <p className="text-sm text-slate-500 mt-1">
      {lockedByAdmin
        ? 'It was turned off from the Admin Panel just now. This screen updates on its own if they turn it back on. Your existing data is safe.'
        : 'Contact your Apna Billing provider to enable it. Your existing data is safe.'}
    </p>
    <button onClick={onOpenLicense} className="mt-4 text-sm font-semibold text-emerald-600 hover:underline">View license details</button>
  </div>
);

/** Covers the whole app the moment an administrator suspends or revokes access. It goes away on its own when they restore it. */
export const WorkspaceHold: React.FC = () => {
  const { license, system } = useLicense();
  const { user, switchBusiness } = useAuth();
  const held = license?.enforced && (license.mode === 'SUSPENDED' || license.mode === 'REVOKED');
  if (!held) return null;
  // Only this business is held: the others on this computer stay open to switch to
  const others = (system?.businesses || []).filter((b) => b.id !== (user?.shopId || 'main'));
  const revoked = license?.mode === 'REVOKED';
  return (
    <div className="fixed inset-0 z-[1020] flex items-center justify-center bg-slate-950/75 p-6 backdrop-blur-sm">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-950/40">
          <Lock className="h-6 w-6 text-amber-600" />
        </div>
        <h2 className="text-lg font-bold">{revoked ? 'This license was revoked' : 'Paused by your administrator'}</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{license?.message}</p>
        <p className="mt-3 text-xs text-slate-500">This happened on its own. You do not need to refresh or click anything. Billing stays stopped until access is restored, and your invoices and stock remain on this computer.</p>
        {others.length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Your other businesses on this computer are not affected:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {others.map((b) => (
                <button key={b.id} type="button" onClick={() => switchBusiness(b.id)}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Open {b.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/** Full license details inside the app. */
export const LicensePage: React.FC = () => {
  const { license, system, refresh } = useLicense();
  const { user } = useAuth();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [key, setKey] = useState('');
  const isOwner = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';


  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      await refresh();
      setMsg({ ok: true, text: ok });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || 'Failed' });
    } finally {
      setBusy('');
    }
  };

  if (!license) return <div className="text-sm text-slate-500">Loading license…</div>;
  const l = license.license;
  const features = Object.entries(license.features);
  const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm';

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="w-7 h-7 text-emerald-600" />License & Subscription</h1>
          <p className="text-sm text-slate-500">App version {versionLabel(license.appVersion)}{system ? ` · database schema v${system.schemaVersion}` : ''}</p>
        </div>
        <button onClick={() => run('sync', api.syncLicense, 'License verified with the server')} disabled={!!busy}
          className="btn-brand flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl">
          <RefreshCw className={`w-4 h-4 ${busy === 'sync' ? 'animate-spin' : ''}`} />Check now
        </button>
      </div>

      {msg && <div className={`p-3 rounded-xl text-sm border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>{msg.text}</div>}

      <div className={`p-4 rounded-xl border flex items-start gap-3 ${license.canWrite ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-200' : 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200'}`}>
        {license.canWrite ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
        <div className="text-sm"><div className="font-bold">{license.mode.replace(/_/g, ' ')}</div><div>{license.message}</div></div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className={card}>
          <div className="text-xs uppercase font-bold text-slate-400 mb-2">Plan</div>
          {l ? (
            <div className="space-y-1 text-sm">
              <div className="text-lg font-bold">{l.plan.name} <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{l.type}</span></div>
              <div>Licensed to <b>{l.customerName}</b></div>
              <div>Key ending <span className="font-mono">…{l.licenseKeyHint}</span></div>
              <div>Device limit: {l.maxDevices}</div>
            </div>
          ) : <div className="text-sm text-slate-500">Not activated</div>}
        </div>
        <div className={card}>
          <div className="text-xs uppercase font-bold text-slate-400 mb-2">Validity</div>
          {l ? (
            <div className="space-y-1 text-sm">
              <div>Expires: <b>{l.expiresAt ? new Date(l.expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Never (lifetime)'}</b></div>
              {l.daysRemaining !== null && <div className={l.daysRemaining <= 7 ? 'text-amber-600 font-semibold' : ''}>{l.daysRemaining} day{l.daysRemaining === 1 ? '' : 's'} remaining</div>}
            </div>
          ) : '—'}
        </div>
        <div className={card}>
          <div className="text-xs uppercase font-bold text-slate-400 mb-2 flex items-center gap-1"><WifiOff className="w-3.5 h-3.5" />Offline allowance</div>
          <div className="space-y-1 text-sm">
            <div>Last verified: <b>{license.offline.lastSyncAt ? new Date(license.offline.lastSyncAt).toLocaleString('en-IN') : 'never'}</b></div>
            {license.offline.daysRemaining !== null && <div>Works offline for {license.offline.daysRemaining} more day(s)</div>}
            {license.offline.lastSyncError && <div className="text-xs text-amber-600">Last check failed: {license.offline.lastSyncError}</div>}
            {license.realtime && (
              <div className="flex items-center gap-1.5 text-xs mt-1">
                <span className={`w-2 h-2 rounded-full ${license.realtime.connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                {license.realtime.connected ? 'Live updates: connected — changes apply instantly' : 'Live updates: offline — changes apply at the next check'}
              </div>
            )}
          </div>
        </div>
      </div>

      {license.update && (
        <div className="p-4 rounded-xl border bg-indigo-50 border-indigo-200 text-indigo-900 text-sm flex items-start gap-3">
          <Download className="w-5 h-5 shrink-0" />
          <div><b>Update available: version {versionLabel(license.update.latestVersion)}</b>{license.update.mandatory && ' (required)'}<div>{license.update.message}</div>
            {license.update.url && <a className="underline font-semibold" href={license.update.url} target="_blank" rel="noreferrer">Download</a>}</div>
        </div>
      )}

      {license.notices.length > 0 && (
        <div className={card}>
          <div className="text-xs uppercase font-bold text-slate-400 mb-2">Messages from your provider</div>
          <div className="space-y-2">{license.notices.map((n) => <div key={n.id} className="text-sm"><b>{n.title}</b> — {n.message}</div>)}</div>
        </div>
      )}

      <div className={card}>
        <div className="text-xs uppercase font-bold text-slate-400 mb-3">Features in your license</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
          {features.map(([k, on]) => (
            <div key={k} className="flex items-center gap-2 text-sm">
              {on ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Lock className="w-4 h-4 text-slate-300" />}
              <span className={on ? '' : 'text-slate-400'}>{FEATURE_LABELS[k] || k}</span>
              {on && license.featureExpiry[k] && <span className="text-[10px] text-amber-600">until {new Date(license.featureExpiry[k]!).toLocaleDateString('en-IN')}</span>}
            </div>
          ))}
        </div>
      </div>

      {isOwner && license.installationId && <LicenseDevicesCard card={card} />}

      {isOwner && (
        <div className={card}>
          <div className="text-xs uppercase font-bold text-slate-400 mb-3">Change license</div>
          <div className="flex flex-wrap gap-2">
            <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="APNA-XXXX-XXXX-XXXX-XXXX"
              className="flex-1 min-w-[240px] font-mono bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
            <button disabled={!!busy || !key} onClick={() => run('activate', () => api.activateLicense(key), 'License activated')}
              className="btn-brand text-sm font-semibold px-4 py-2 rounded-lg">Activate key</button>
            {license.installationId && (
              <button disabled={!!busy} onClick={async () => { if ((await confirmDialog('Deactivate this computer? Billing stops until you activate again. Your data stays on this computer.', { danger: true }))) run('deactivate', api.deactivateLicense, 'This computer has been deactivated'); }}
                className="border border-rose-300 text-rose-600 text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">Deactivate this computer</button>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">To move to a new computer, deactivate here first to free the device slot. Installation ID: <span className="font-mono">{license.installationId || '—'}</span></p>
        </div>
      )}
    </div>
  );
};

/** The computers using this licence; the owner can sign another one out (it frees a device slot, its data stays) */
const LicenseDevicesCard: React.FC<{ card: string }> = ({ card }) => {
  const [data, setData] = useState<LicenseDevices | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => api.licenseDevices().then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message || 'Could not load the computers'));
  useEffect(() => { void load(); }, []);
  const signOut = async (d: LicenseDevices['devices'][number]) => {
    if (!(await confirmDialog(`Sign ${d.deviceName} out of this licence? It stops billing until it is activated again, and frees one device slot. Its data stays on that computer.`, { danger: true }))) return;
    setBusy(d.id);
    try { setData(await api.signOutDevice(d.id)); } catch (e: any) { setError(e.message || 'Could not sign it out'); } finally { setBusy(''); }
  };
  const active = data?.devices.filter((d) => d.status !== 'DEACTIVATED') || [];
  return (
    <div className={card}>
      <div className="text-xs uppercase font-bold text-slate-400 mb-3 flex items-center justify-between">
        <span>Computers on this licence</span>
        {data?.maxDevices != null && <span className="normal-case font-semibold text-slate-500">{active.length} of {data.maxDevices} in use</span>}
      </div>
      {error && <div className="text-xs text-rose-600 mb-2">{error}</div>}
      {!data && !error && <div className="text-sm text-slate-500">Loading…</div>}
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {data?.devices.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-semibold">{d.deviceName}{d.thisComputer && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">THIS COMPUTER</span>}</div>
              <div className="text-[11px] text-slate-500">
                {d.uninstalledAt ? 'Uninstalled' : d.status === 'ACTIVE' ? 'Active' : d.status === 'DEACTIVATED' ? 'Signed out' : d.status}
                {d.lastSeenAt && ` · last seen ${new Date(d.lastSeenAt).toLocaleString('en-IN')}`} · version {d.appVersion}
              </div>
            </div>
            {!d.thisComputer && d.status !== 'DEACTIVATED' && (
              <button disabled={!!busy} onClick={() => void signOut(d)}
                className="border border-rose-300 text-rose-600 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50">
                {busy === d.id ? 'Signing out…' : 'Sign out'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

function isTrialLicense(license: ReturnType<typeof useLicense>['license']): boolean {
  const lic = license?.license;
  if (!license?.enforced || !lic) return false;
  if (lic.type === 'TRIAL') return true;
  // Fallback if an older server left type=PAID after switching the plan back to trial.
  const code = lic.plan?.code || '';
  const name = lic.plan?.name || '';
  return /trial/i.test(code) || /free\s*trial/i.test(name);
}

/** Dashboard control for an account that is still inside its free trial. Paid accounts do not see it. */
export const TrialActivateCard: React.FC = () => {
  const { license, refresh } = useLicense();
  const { user } = useAuth();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  if (!isTrialLicense(license)) return null;
  const isOwner = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';
  const days = license!.license!.daysRemaining;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = key.trim();
    if (!trimmed) {
      setOk('');
      setError('Enter a license key to activate this account.');
      return;
    }
    setBusy(true);
    setError('');
    setOk('');
    try {
      await api.activateLicense(trimmed);
      await refresh();
      setKey('');
      setOk('License activated. This computer is no longer on the free trial.');
    } catch (err: any) {
      setError(err.message || 'Activation failed');
    } finally {
      setBusy(false);
    }
  };
  const cardTone = error
    ? 'border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900'
    : ok
      ? 'border-emerald-200 dark:border-emerald-900 bg-gradient-to-r from-emerald-50 to-white dark:from-emerald-950/40 dark:to-slate-900'
      : 'border-emerald-200 dark:border-emerald-900 bg-gradient-to-r from-emerald-50 to-white dark:from-emerald-950/40 dark:to-slate-900';
  return (
    <form noValidate onSubmit={submit} className={`rounded-2xl border p-4 sm:p-5 shadow-sm ${cardTone}`}>
      <div className="flex flex-col lg:flex-row lg:items-end gap-4">
        <div className="flex items-start gap-3 lg:max-w-sm lg:shrink-0">
          <div className={`p-2.5 rounded-xl text-white shrink-0 ${error ? 'bg-rose-600' : 'bg-emerald-600'}`}>
            {error ? <AlertTriangle className="w-5 h-5" /> : <KeyRound className="w-5 h-5" />}
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Free trial</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {days !== null ? `${days} day${days === 1 ? '' : 's'} left. ` : ''}
              Enter a purchased license key to activate this account.
            </p>
          </div>
        </div>
        {isOwner ? (
          <div className="flex-1 flex flex-col sm:flex-row gap-2 sm:items-center">
            <input
              value={key}
              onChange={(e) => {
                setKey(e.target.value.toUpperCase());
                if (error) setError('');
              }}
              placeholder="APNA-XXXX-XXXX-XXXX-XXXX"
              aria-invalid={!!error}
              aria-describedby={error ? 'trial-activate-error' : undefined}
              className={`flex-1 min-w-0 font-mono uppercase tracking-wide bg-white dark:bg-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none transition-colors ${
                error
                  ? 'border border-rose-300 dark:border-rose-700 focus:border-rose-500'
                  : 'border border-slate-300 dark:border-slate-700 focus:border-emerald-500'
              }`}
            />
            <button
              type="submit"
              disabled={busy}
              className="btn-brand shrink-0 text-sm font-bold px-5 py-2.5 rounded-xl disabled:opacity-60"
            >
              {busy ? 'Activating…' : 'Activate'}
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Ask the business owner to enter the license key.</p>
        )}
      </div>
      {error && (
        <div
          id="trial-activate-error"
          role="alert"
          className="mt-4 flex gap-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-3"
        >
          <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs font-semibold text-rose-800 dark:text-rose-200">Could not activate this key</p>
            <p className="text-xs text-rose-700/90 dark:text-rose-300/90 leading-relaxed">{error}</p>
          </div>
        </div>
      )}
      {ok && !error && (
        <div role="status" className="mt-4 flex gap-3 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed">{ok}</p>
        </div>
      )}
    </form>
  );
};

/** Slim banner at the top of the app for read-only mode, expiring trials, notices and updates. */
export const LicenseBanner: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const { license } = useLicense();
  const [dismissed, setDismissed] = useState<string[]>([]);
  if (!license || !license.enforced) return null;
  const items: Array<{ id: string; tone: string; text: string }> = [];
  if (!license.canWrite) items.push({ id: 'mode', tone: 'bg-amber-500 text-white', text: `Read-only mode: ${license.message}` });
  const days = license.license?.daysRemaining;
  if (license.canWrite && days !== null && days !== undefined && days <= 5) {
    items.push({ id: 'expiry', tone: 'bg-amber-100 text-amber-900', text: `${license.license?.type === 'TRIAL' ? 'Trial' : 'License'} ends in ${days} day${days === 1 ? '' : 's'}. Contact your provider to continue without interruption.` });
  }
  if (license.canWrite && license.offline.daysRemaining !== null && license.offline.daysRemaining <= 2) {
    items.push({ id: 'offline', tone: 'bg-amber-100 text-amber-900', text: `Connect to the internet within ${license.offline.daysRemaining} day(s) so your license can be verified.` });
  }
  for (const n of license.notices) items.push({ id: n.id, tone: n.level === 'CRITICAL' ? 'bg-rose-600 text-white' : 'bg-indigo-50 text-indigo-900', text: `${n.title}: ${n.message}` });
  if (license.update) items.push({ id: 'update', tone: 'bg-indigo-600 text-white', text: `Version ${versionLabel(license.update.latestVersion)} is available. ${license.update.message || ''}` });
  const visible = items.filter((i) => !dismissed.includes(i.id));
  if (visible.length === 0) return null;
  return (
    <div className="no-print">
      {visible.map((i) => (
        <div key={i.id} className={`px-6 py-1.5 text-xs font-medium flex items-center gap-3 ${i.tone}`}>
          <span className="flex-1">{i.text}</span>
          <button onClick={onOpen} className="underline font-semibold">Details</button>
          {i.id !== 'mode' && <button onClick={() => setDismissed([...dismissed, i.id])} aria-label="Dismiss">✕</button>}
        </div>
      ))}
    </div>
  );
};
