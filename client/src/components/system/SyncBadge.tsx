import React, { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';

interface SyncStatus { enabled: boolean; joined: boolean; pending: number; state: 'synced' | 'syncing' | 'offline' | 'error' | 'off'; lastSyncAt: string | null; error: string | null; live?: boolean }

/**
 * Whether this business's data is in step with the account's other computers: Synced / Syncing / Offline (changes
 * waiting, sent on their own once back online) / a problem. Updated live from the engine's event stream.
 */
export const SyncBadge: React.FC = () => {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  useEffect(() => {
    let alive = true;
    api.getSyncStatus().then((s) => { if (alive) setStatus(s); }).catch(() => {});
    const onStatus = (e: Event) => setStatus((e as CustomEvent).detail as SyncStatus);
    window.addEventListener('apna:sync-status', onStatus);
    return () => { alive = false; window.removeEventListener('apna:sync-status', onStatus); };
  }, []);
  if (!status?.enabled || !status.joined) return null;

  const view = {
    synced: { icon: Cloud, text: 'Synced', cls: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900' },
    syncing: { icon: RefreshCw, text: 'Syncing', cls: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-900' },
    offline: { icon: CloudOff, text: status.pending ? `Offline · ${status.pending} waiting` : 'Offline', cls: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900' },
    error: { icon: AlertTriangle, text: 'Sync problem', cls: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900' },
    off: null,
  }[status.state];
  if (!view) return null;
  const Icon = view.icon;
  const title = status.state === 'synced'
    ? `Your data is the same on all your computers${status.lastSyncAt ? ` (last sync ${new Date(status.lastSyncAt).toLocaleTimeString()})` : ''}. `
      + (status.live ? 'Live link on: changes arrive within a second.' : 'Live link reconnecting: changes are checked every 3 seconds.')
    : status.state === 'offline'
      ? 'No connection to the Apna Billing server. Your work is saved here and is sent to your other computers as soon as the connection is back.'
      : status.state === 'error' ? `Sync will be tried again on its own. ${status.error || ''}` : 'Sending and receiving changes…';
  return (
    <span title={title} className={`hidden md:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${view.cls}`}>
      <Icon className={`h-3.5 w-3.5 ${status.state === 'syncing' ? 'animate-spin' : ''}`} />
      {view.text}
    </span>
  );
};
