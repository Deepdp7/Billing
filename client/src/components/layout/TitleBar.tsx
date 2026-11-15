import React from 'react';
import { desktop, isDesktopApp } from '../../lib/desktop';
import { maximizeButton, titleBarMouseDown, useWindowState } from '../../lib/windowState';

/** Window chrome for the billing app: emerald in the light theme, neutral grey in the dark one. Hidden in a normal browser. */
export function DesktopFrame({ children }: { children: React.ReactNode }) {
  if (!isDesktopApp()) return <>{children}</>;
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#022c22] dark:bg-slate-950">
      <BillingTitleBar />
      {/* App shell fills only the space *under* the title bar — never h-screen / 100vh. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[rgb(var(--slate-50))] dark:bg-slate-950">
        {children}
      </div>
    </div>
  );
}

function run(action: () => Promise<unknown>) {
  void action().catch((err) => console.error('[titlebar]', err));
}

function BillingTitleBar() {
  const { maximized, fullscreen } = useWindowState();

  return (
    <header onMouseDownCapture={titleBarMouseDown(fullscreen)} className="relative z-40 h-10 shrink-0 flex items-center select-none text-emerald-50 bg-gradient-to-r from-emerald-800 via-emerald-900 to-[#022c22] border-b border-emerald-950/40 dark:bg-none dark:bg-slate-900 dark:border-slate-800 dark:text-slate-100">
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3 min-w-0">
        <span data-tauri-drag-region className="w-4 h-4 rounded bg-emerald-400 text-[10px] font-black text-emerald-950 grid place-items-center">₹</span>
        <span data-tauri-drag-region className="text-xs font-semibold tracking-tight font-['Outfit'] truncate">Apna Billing</span>
        <span data-tauri-drag-region className="text-[9px] uppercase tracking-[0.14em] text-emerald-200/60 dark:text-slate-400">Desk</span>
      </div>
      <div data-tauri-drag-region className="flex-1 h-full min-w-[1rem]" />
      <div className="flex items-stretch h-full">
        <button type="button" aria-label="Minimize" onClick={() => run(desktop.minimize)}
          className="grid w-11 place-items-center text-emerald-50/90 hover:bg-white/10 transition-colors dark:text-slate-300">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="M5 12h14" /></svg>
        </button>
        <button type="button" aria-label={fullscreen ? 'Exit full screen' : maximized ? 'Restore' : 'Maximize'} onClick={() => run(() => maximizeButton(fullscreen))}
          className="grid w-11 place-items-center text-emerald-50/90 hover:bg-white/10 transition-colors dark:text-slate-300">
          {fullscreen
            ? <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
            : maximized
            ? <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M8 8h10v10H8z" /><path d="M6 16V6h10" /></svg>
            : <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg>}
        </button>
        <button type="button" aria-label="Close" onClick={() => run(desktop.close)}
          className="grid w-11 place-items-center text-emerald-50/90 hover:bg-rose-600 hover:text-white transition-colors dark:text-slate-300">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    </header>
  );
}
