import { useCallback, useEffect, useState } from 'react';
import { WifiOff, Loader2, DownloadCloud, Sparkles } from 'lucide-react';
import { useLicense } from '../../context/LicenseContext.js';
import { api } from '../../lib/api.js';
import { desktop, isDesktopApp } from '../../lib/desktop.js';

/**
 * Full-screen lock while the computer has no internet (licensed builds only).
 * Windows' own "network lost" signal locks instantly; the local server's internet check covers Wi-Fi that is
 * connected but has no internet. The lock lifts by itself as soon as the connection is back. Nothing on the screen
 * underneath is lost (an open bill stays as it was).
 */
export function OfflineLock() {
  const { license, refresh } = useLicense();
  const [browserOnline, setBrowserOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const goOffline = () => setBrowserOnline(false);
    const goOnline = async () => {
      setBrowserOnline(true);
      // Ask the local server to re-check now instead of waiting for its next round.
      try { await api.checkConnectivity(); } catch { /* local server busy; its own check follows */ }
      void refresh();
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [refresh]);

  const retry = useCallback(async () => {
    setChecking(true);
    try { await api.checkConnectivity(); } catch { /* ignore */ }
    await refresh();
    setChecking(false);
  }, [refresh]);

  const required = !!license?.requireOnline;
  const offline = required && (!browserOnline || license?.connectivity?.online === false);
  if (!offline) return null;

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="offline-title"
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center shadow-2xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/15">
          <WifiOff className="h-8 w-8 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 id="offline-title" className="text-xl font-bold text-slate-900 dark:text-white font-['Outfit']">No internet connection</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Apna Billing needs the internet to work. Please connect this computer to Wi-Fi, a LAN cable or mobile data.
        </p>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Your data is safe on this computer. This screen closes by itself as soon as the internet is back.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Waiting for the internet…
        </div>
        <button type="button" onClick={retry} disabled={checking}
          className="mt-5 rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
    </div>
  );
}

const DISMISS_KEY = 'apna_update_later';

/**
 * "Update available" popup. Shown as soon as the vendor publishes a version (pushed over the live link) and again
 * every time the app opens. Optional updates offer Install now / Later; required ones cannot be skipped.
 */
export function UpdatePrompt() {
  const { license } = useLicense();
  const update = license?.update;
  const [dismissed, setDismissed] = useState<string>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) || ''; } catch { return ''; }
  });
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');

  if (!update?.latestVersion) return null;
  const required = !!update.mandatory;
  if (!required && dismissed === update.latestVersion) return null;

  const later = () => {
    try { sessionStorage.setItem(DISMISS_KEY, update.latestVersion); } catch { /* storage blocked */ }
    setDismissed(update.latestVersion);
  };

  const install = async () => {
    setError('');
    if (!isDesktopApp()) {
      if (update.url) window.open(update.url, '_blank', 'noopener');
      else setError('Install the new version from the desktop app.');
      return;
    }
    setInstalling(true);
    try {
      await desktop.installUpdate(); // closes and restarts the app when the update is installed
    } catch (err: any) {
      setError(String(err?.message || err || 'The update could not be installed. Please try again.'));
      setInstalling(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="update-title"
      className="fixed inset-0 z-[1900] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${required ? 'bg-rose-100 dark:bg-rose-500/15' : 'bg-emerald-100 dark:bg-emerald-500/15'}`}>
            {required ? <DownloadCloud className="h-6 w-6 text-rose-600 dark:text-rose-400" /> : <Sparkles className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />}
          </div>
          <div className="min-w-0">
            <h2 id="update-title" className="text-lg font-bold text-slate-900 dark:text-white font-['Outfit']">
              {required ? 'Update required' : 'Update available'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Version {update.latestVersion} · you have {license?.appVersion}
            </p>
            <p className="mt-3 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-line">
              {update.message || 'A new version of Apna Billing is ready.'}
            </p>
            {required && (
              <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">This update must be installed to keep using Apna Billing.</p>
            )}
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              The app restarts after installing. Your data stays on this computer and is backed up before any change.
            </p>
            {error && <p className="mt-3 rounded-lg bg-rose-50 dark:bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{error}</p>}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          {!required && (
            <button type="button" onClick={later} disabled={installing}
              className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
              Later
            </button>
          )}
          <button type="button" onClick={install} disabled={installing}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
            {installing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Downloading and installing…</> : 'Install now'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mount once inside the license provider so both guards cover every screen (sign-in, setup and the app). */
export function AppGuards() {
  return (
    <>
      <UpdatePrompt />
      <OfflineLock />
    </>
  );
}

