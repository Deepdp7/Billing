import React from 'react';
import { desktop, isDesktopApp } from '../lib/desktop';
import { maximizeButton, titleBarMouseDown, useWindowState } from '../lib/windowState';

/** Indigo window chrome for the license console. Hidden in a normal browser. */
export function DesktopFrame({ children }: { children: React.ReactNode }) {
  if (!isDesktopApp()) return <>{children}</>;
  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-100 dark:bg-slate-950">
      <AdminTitleBar />
      <div className="flex-1 min-h-0 overflow-hidden bg-slate-100 dark:bg-slate-950">{children}</div>
    </div>
  );
}

function run(action: () => Promise<unknown>) {
  void action().catch((err) => console.error('[titlebar]', err));
}

function AdminTitleBar() {
  const { maximized, fullscreen } = useWindowState();

  return (
    <header onMouseDownCapture={titleBarMouseDown(fullscreen)} className="h-14 shrink-0 flex items-center select-none text-slate-100 bg-slate-900 border-b border-slate-800">
      <div data-tauri-drag-region className="flex items-center gap-2.5 pl-3.5">
        <span data-tauri-drag-region className="w-5 h-5 rounded-md bg-indigo-500 grid place-items-center text-[10px] text-white">◆</span>
        <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight font-['Outfit']">Apna Admin</span>
        <span data-tauri-drag-region className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Console</span>
      </div>
      <div data-tauri-drag-region className="flex-1 h-full" />
      <div className="mr-2 flex items-center gap-1">
        <button type="button" aria-label="Minimize" onClick={() => run(desktop.minimize)}
          className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M5 12h14" /></svg>
        </button>
        <button type="button" aria-label={fullscreen ? 'Exit full screen' : maximized ? 'Restore' : 'Maximize'} onClick={() => run(() => maximizeButton(fullscreen))}
          className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10">
          {fullscreen
            ? <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
            : maximized
            ? <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M8 8h10v10H8z" /><path d="M6 16V6h10" /></svg>
            : <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="6" y="6" width="12" height="12" rx="1.2" /></svg>}
        </button>
        <button type="button" aria-label="Close" onClick={() => run(desktop.close)}
          className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-rose-600 hover:text-white">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    </header>
  );
}
