import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Info, XCircle } from 'lucide-react';

/**
 * In-panel replacements for window.alert / confirm / prompt.
 * Call from anywhere; <DialogHost /> is mounted once in main.tsx.
 *
 *   if (!(await confirmDialog('Suspend this license?', { danger: true }))) return;
 *   const reason = await promptDialog('Reason (recorded in audit log)'); // null when cancelled
 */

export type DialogTone = 'info' | 'success' | 'warning' | 'error';

interface BaseOptions {
  title?: string;
  tone?: DialogTone;
}
export interface ConfirmOptions extends BaseOptions {
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}
export interface PromptOptions extends ConfirmOptions {
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  /** Field label shown above the input. */
  label?: string;
}

type Request =
  | { id: number; kind: 'alert'; message: string; opts: BaseOptions; resolve: (v: void) => void }
  | { id: number; kind: 'confirm'; message: string; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { id: number; kind: 'prompt'; message: string; opts: PromptOptions; resolve: (v: string | null) => void };

let queue: Request[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => queue;
const push = (req: Request) => { queue = [...queue, req]; emit(); };
const finish = (id: number) => { queue = queue.filter((r) => r.id !== id); emit(); };

export const showAlert = (message: string, opts: BaseOptions = {}) =>
  new Promise<void>((resolve) => push({ id: nextId++, kind: 'alert', message, opts, resolve }));
export const confirmDialog = (message: string, opts: ConfirmOptions = {}) =>
  new Promise<boolean>((resolve) => push({ id: nextId++, kind: 'confirm', message, opts, resolve }));
export const promptDialog = (message: string, opts: PromptOptions = {}) =>
  new Promise<string | null>((resolve) => push({ id: nextId++, kind: 'prompt', message, opts, resolve }));

const TONES: Record<DialogTone, { icon: React.ElementType; ring: string }> = {
  info: { icon: Info, ring: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
  success: { icon: CheckCircle2, ring: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  warning: { icon: AlertTriangle, ring: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' },
  error: { icon: XCircle, ring: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' },
};

const inputCls = 'mt-1 w-full bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20';

function DialogBox({ req }: { req: Request }) {
  const [value, setValue] = useState(req.kind === 'prompt' ? req.opts.defaultValue ?? '' : '');
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const isAsk = req.kind !== 'alert';
  const o = req.opts as PromptOptions;
  const danger = isAsk && !!o.danger;
  const tone: DialogTone = o.tone || (danger ? 'warning' : 'info');
  const Glyph = req.kind === 'confirm' && !o.tone && !danger ? HelpCircle : TONES[tone].icon;
  const heading = o.title || (req.kind === 'confirm' ? (danger ? 'Are you sure?' : 'Please confirm') : req.kind === 'prompt' ? 'Enter details' : 'Notice');
  const blocked = req.kind === 'prompt' && !!o.required && !value.trim();

  const close = (ok: boolean) => {
    finish(req.id);
    if (req.kind === 'alert') req.resolve();
    else if (req.kind === 'confirm') req.resolve(ok);
    else req.resolve(ok ? value : null);
  };

  useEffect(() => {
    (req.kind === 'prompt' ? inputRef.current : okRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && isAsk) close(false); }}>
      <form role="dialog" aria-modal="true" onSubmit={(e) => { e.preventDefault(); if (!blocked) close(true); }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-5 flex gap-4">
          <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${TONES[tone].ring}`}><Glyph className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">{heading}</h3>
            {req.message && <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-line break-words">{req.message}</p>}
            {req.kind === 'prompt' && (
              <label className="block mt-3">
                {o.label && <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">{o.label}</span>}
                {o.multiline
                  ? <textarea ref={inputRef} rows={3} className={inputCls} value={value} placeholder={o.placeholder} onChange={(e) => setValue(e.target.value)} />
                  : <input ref={inputRef} className={inputCls} value={value} placeholder={o.placeholder} onChange={(e) => setValue(e.target.value)} />}
              </label>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          {isAsk && (
            <button type="button" onClick={() => close(false)}
              className="px-3 py-1.5 rounded-lg border text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700 transition">
              {o.cancelText || 'Cancel'}
            </button>
          )}
          <button ref={okRef} type="submit" disabled={blocked}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold text-white transition disabled:opacity-50 disabled:cursor-not-allowed ${danger ? 'bg-rose-600 hover:bg-rose-700 border-rose-600' : 'bg-indigo-600 hover:bg-indigo-700 border-indigo-600'}`}>
            {req.kind === 'alert' ? 'OK' : o.confirmText || (danger ? 'Yes, continue' : 'OK')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function DialogHost() {
  const pending = useSyncExternalStore(subscribe, snapshot);
  return pending[0] ? <DialogBox key={pending[0].id} req={pending[0]} /> : null;
}
