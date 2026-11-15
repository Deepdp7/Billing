import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, HelpCircle } from 'lucide-react';

/**
 * In-app replacements for window.alert / confirm / prompt.
 * Call from anywhere (no hook needed); <DialogHost /> is mounted once in main.tsx.
 *
 *   showAlert('Saved', { tone: 'success' })
 *   if (!(await confirmDialog('Delete this?', { danger: true }))) return;
 *   const reason = await promptDialog('Reason for cancelling'); // null when cancelled
 */

export type DialogTone = 'info' | 'success' | 'warning' | 'error';

interface BaseOptions {
  title?: string;
  tone?: DialogTone;
}
export interface ConfirmOptions extends BaseOptions {
  confirmText?: string;
  cancelText?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
}
export interface PromptOptions extends ConfirmOptions {
  defaultValue?: string;
  placeholder?: string;
  /** Disable the confirm button until something is typed. */
  required?: boolean;
  multiline?: boolean;
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

function push(req: Request) {
  queue = [...queue, req];
  emit();
}
function finish(id: number) {
  queue = queue.filter((r) => r.id !== id);
  emit();
}

/** Guess a tone from the wording so plain `showAlert(err.message)` calls still look right. */
function inferTone(message: string): DialogTone {
  if (/fail|error|could not|cannot|can't|invalid|denied|not allowed|unable/i.test(message)) return 'error';
  if (/success|saved|created|generated|updated|done|completed/i.test(message)) return 'success';
  if (/please|must|at least|select|required|empty|already/i.test(message)) return 'warning';
  return 'info';
}

export function showAlert(message: string, opts: BaseOptions = {}): Promise<void> {
  return new Promise((resolve) => push({ id: nextId++, kind: 'alert', message: String(message ?? ''), opts, resolve }));
}

export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => push({ id: nextId++, kind: 'confirm', message: String(message ?? ''), opts, resolve }));
}

export function promptDialog(message: string, opts: PromptOptions = {}): Promise<string | null> {
  return new Promise((resolve) => push({ id: nextId++, kind: 'prompt', message: String(message ?? ''), opts, resolve }));
}

const TONES: Record<DialogTone, { icon: React.ElementType; ring: string; title: string }> = {
  info: { icon: Info, ring: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400', title: 'Notice' },
  success: { icon: CheckCircle2, ring: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400', title: 'Done' },
  warning: { icon: AlertTriangle, ring: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400', title: 'Check this' },
  error: { icon: XCircle, ring: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400', title: 'Something went wrong' },
};

function DialogBox({ req }: { req: Request }) {
  const [value, setValue] = useState(req.kind === 'prompt' ? req.opts.defaultValue ?? '' : '');
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  const isAsk = req.kind !== 'alert';
  const danger = isAsk && (req.opts as ConfirmOptions).danger;
  const tone: DialogTone = req.opts.tone || (req.kind === 'alert' ? inferTone(req.message) : danger ? 'warning' : 'info');
  const { icon: Icon, ring, title } = TONES[tone];
  const Glyph = req.kind === 'confirm' && !req.opts.tone && !danger ? HelpCircle : Icon;
  const heading = req.opts.title || (req.kind === 'confirm' ? (danger ? 'Are you sure?' : 'Please confirm') : req.kind === 'prompt' ? 'Enter details' : title);
  const required = req.kind === 'prompt' && req.opts.required;

  const close = (ok: boolean) => {
    finish(req.id);
    if (req.kind === 'alert') req.resolve();
    else if (req.kind === 'confirm') req.resolve(ok);
    else req.resolve(ok ? value : null);
  };

  useEffect(() => {
    (req.kind === 'prompt' ? inputRef.current : okRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmText = req.kind === 'alert' ? 'OK' : (req.opts as ConfirmOptions).confirmText || (danger ? 'Yes, continue' : 'OK');
  const cancelText = isAsk ? (req.opts as ConfirmOptions).cancelText || 'Cancel' : '';

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget && isAsk) close(false); }}>
      <form role="dialog" aria-modal="true" aria-labelledby={`dlg-${req.id}`}
        onSubmit={(e) => { e.preventDefault(); if (!(required && !value.trim())) close(true); }}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="p-5 flex gap-4">
          <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${ring}`}>
            <Glyph className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id={`dlg-${req.id}`} className="text-sm font-bold text-slate-900 dark:text-white">{heading}</h3>
            {req.message && <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-line break-words">{req.message}</p>}
            {req.kind === 'prompt' && (
              req.opts.multiline ? (
                <textarea ref={inputRef} rows={3} value={value} placeholder={req.opts.placeholder} onChange={(e) => setValue(e.target.value)}
                  className="mt-3 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
              ) : (
                <input ref={inputRef} value={value} placeholder={req.opts.placeholder} onChange={(e) => setValue(e.target.value)}
                  className="mt-3 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
              )
            )}
          </div>
        </div>
        <div className="px-5 py-3 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 rounded-b-2xl">
          {isAsk && (
            <button type="button" onClick={() => close(false)}
              className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              {cancelText}
            </button>
          )}
          <button ref={okRef} type="submit" disabled={!!required && !value.trim()}
            className={`px-4 py-2 rounded-lg text-xs font-bold text-white transition disabled:opacity-50 disabled:cursor-not-allowed ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
            {confirmText}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---- Toasts: short, non-blocking notices (they never interrupt billing) ----

interface Toast { id: number; title: string; message: string; tone: DialogTone }
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
const emitToasts = () => toastListeners.forEach((l) => l());
const subscribeToasts = (l: () => void) => { toastListeners.add(l); return () => { toastListeners.delete(l); }; };
const toastSnapshot = () => toasts;
const dismissToast = (id: number) => { toasts = toasts.filter((t) => t.id !== id); emitToasts(); };

export function showToast(title: string, message = '', tone: DialogTone = 'info', ms = 6000): void {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, title, message, tone }];
  emitToasts();
  setTimeout(() => dismissToast(id), ms);
}

function ToastStack() {
  const list = useSyncExternalStore(subscribeToasts, toastSnapshot);
  if (!list.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[1550] flex flex-col gap-2 w-[min(360px,calc(100vw-2rem))]" aria-live="polite">
      {list.map((t) => {
        const { icon: Icon, ring } = TONES[t.tone];
        return (
          <div key={t.id} className="apna-pop flex gap-3 items-start rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3">
            <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${ring}`}><Icon className="w-4 h-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-slate-900 dark:text-white">{t.title}</div>
              {t.message && <div className="mt-0.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 break-words">{t.message}</div>}
            </div>
            <button onClick={() => dismissToast(t.id)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs px-1" aria-label="Dismiss">✕</button>
          </div>
        );
      })}
    </div>
  );
}

/** Renders the oldest pending dialog (others wait their turn) and the toast stack. Mount once at the app root. */
export function DialogHost() {
  const pending = useSyncExternalStore(subscribe, snapshot);
  const current = pending[0];
  return (
    <>
      {current && <DialogBox key={current.id} req={current} />}
      <ToastStack />
    </>
  );
}
