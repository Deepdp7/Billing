import React, { useCallback, useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Select as ModernSelect, type SelectProps } from './Select';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export function fmtDate(iso?: string | null, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return withTime
    ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtAgo(iso?: string | null) {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const fmtINR = (paise?: number | null) =>
  paise === null || paise === undefined ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);

export function daysLeft(iso?: string | null) {
  if (!iso) return null;
  return Math.ceil((Date.parse(iso) - Date.now()) / 86400000);
}

/** Load data, exposing loading/error/reload. Live admin events refresh the data without flashing the page. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], opts?: { live?: boolean }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const live = opts?.live !== false;
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      setData(await fn());
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      if (!silent) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!live) return;
    const onLive = () => { void load(true); };
    window.addEventListener('apna:admin-refresh', onLive);
    return () => window.removeEventListener('apna:admin-refresh', onLive);
  }, [load, live]);
  return { data, error, loading, reload: () => load(), setData };
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white font-['Outfit']">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className }: { title?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm', className)}>
      {(title || actions) && (
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Stat({ label, value, hint, tone = 'slate', onClick }: { label: string; value: React.ReactNode; hint?: string; tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'indigo'; onClick?: () => void }) {
  const tones = {
    slate: 'text-slate-900 dark:text-white',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    rose: 'text-rose-600 dark:text-rose-400',
    indigo: 'text-indigo-600 dark:text-indigo-300',
  };
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={cx('text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm', onClick && 'hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow transition')}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx('text-2xl font-bold mt-1 font-["Outfit"]', tones[tone])}>{value}</div>
      {hint && <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>}
    </button>
  );
}

const chip = (light: string, dark: string) => `${light} ${dark}`;
const BADGE: Record<string, string> = {
  ACTIVE: chip('bg-emerald-50 text-emerald-700 border-emerald-200', 'dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'),
  PAID: chip('bg-indigo-50 text-indigo-700 border-indigo-200', 'dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30'),
  TRIAL: chip('bg-sky-50 text-sky-700 border-sky-200', 'dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30'),
  SUSPENDED: chip('bg-amber-50 text-amber-700 border-amber-200', 'dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'),
  EXPIRED: chip('bg-rose-50 text-rose-700 border-rose-200', 'dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30'),
  REVOKED: chip('bg-slate-800 text-white border-slate-800', 'dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600'),
  DEACTIVATED: chip('bg-slate-100 text-slate-500 border-slate-200', 'dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'),
  DISABLED: chip('bg-slate-100 text-slate-500 border-slate-200', 'dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'),
  INFO: chip('bg-sky-50 text-sky-700 border-sky-200', 'dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30'),
  WARNING: chip('bg-amber-50 text-amber-700 border-amber-200', 'dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'),
  CRITICAL: chip('bg-rose-50 text-rose-700 border-rose-200', 'dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30'),
  UPDATE: chip('bg-indigo-50 text-indigo-700 border-indigo-200', 'dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30'),
  ON: chip('bg-emerald-50 text-emerald-700 border-emerald-200', 'dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'),
  OFF: chip('bg-rose-50 text-rose-700 border-rose-200', 'dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30'),
};

export function Badge({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wide whitespace-nowrap',
      BADGE[value] || 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700', className)}>
      {value.replace(/_/g, ' ')}
    </span>
  );
}

type BtnTone = 'primary' | 'secondary' | 'danger' | 'ghost' | 'warning';
export function Button({ tone = 'secondary', busy, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone; busy?: boolean }) {
  const tones: Record<BtnTone, string> = {
    primary: 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600',
    secondary: 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600',
    warning: 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500',
    ghost: 'bg-transparent hover:bg-slate-100 text-slate-600 border-transparent dark:hover:bg-slate-800 dark:text-slate-300',
  };
  return (
    <button {...rest} disabled={rest.disabled || busy}
      className={cx('inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed', tones[tone], className)}>
      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400 mt-0.5">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20';

export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Select = (p: SelectProps) => <ModernSelect {...p} className={cx(inputCls, p.className)} />;
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, p.className)} />;

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-h-[90vh] flex flex-col', wide ? 'max-w-3xl' : 'max-w-md')}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-3">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'success'; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className={cx('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
      tone === 'error'
        ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-200'
        : 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-200')}>
      {tone === 'error' ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

export function Table({ columns, rows, empty = 'Nothing to show', onRow }: {
  columns: Array<{ key: string; label: string; render?: (r: any) => React.ReactNode; className?: string }>;
  rows: any[] | null | undefined;
  empty?: string;
  onRow?: (r: any) => void;
}) {
  return (
    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 dark:bg-slate-950/70 text-slate-500 dark:text-slate-400 uppercase text-[10px] tracking-wide">
          <tr>{columns.map((c) => <th key={c.key} className={cx('text-left font-bold px-3 py-2 whitespace-nowrap', c.className)}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {(!rows || rows.length === 0) && (
            <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">{rows ? empty : 'Loading…'}</td></tr>
          )}
          {rows?.map((r, i) => (
            <tr key={r.id || i} onClick={onRow ? () => onRow(r) : undefined} className={cx(onRow && 'cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-500/10')}>
              {columns.map((c) => <td key={c.key} className={cx('px-3 py-2 align-middle', c.className)}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Run an action with busy state and a result message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (success) setMsg({ tone: 'success', text: success });
      return true;
    } catch (e: any) {
      setMsg({ tone: 'error', text: e.message || 'Action failed' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, msg, setMsg, run };
}
