import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { desktop, isDesktopApp } from './desktop';

/**
 * Full screen for the desktop window (F11, like a browser). The title bar stays, so its buttons still work: maximize
 * leaves full screen for a maximized window, F11 again goes back to how the window was before. Windows itself does not
 * animate full screen, so the page settles in with a short zoom whenever the window changes between the two.
 * (Same file in the billing app.)
 */

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
let switching = false;

function settle() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  document.getElementById('root')?.animate(
    [{ opacity: 0.5, transform: 'scale(0.985)' }, { opacity: 1, transform: 'none' }],
    { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );
}

async function change(fn: () => Promise<void>) {
  if (switching) return;
  switching = true;
  settle();
  try {
    await fn();
  } catch (err) {
    console.error('[window]', err);
  } finally {
    switching = false;
    changed();
  }
}

export function enterFullscreen() {
  return change(() => desktop.setFullscreen(true));
}

/** Back to how the window was before full screen, or (the maximize button) to a maximized window */
export function exitFullscreen(toMaximized = false) {
  return change(async () => {
    await desktop.setFullscreen(false);
    if (toMaximized && !(await desktop.isMaximized())) await desktop.maximize();
  });
}

export async function toggleFullscreen() {
  if (await desktop.isFullscreen().catch(() => false)) await exitFullscreen();
  else await enterFullscreen();
}

/** F11 anywhere in the app (also while a pop-up is open) */
export function installFullscreenKey() {
  if (!isDesktopApp()) return;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F11' || e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    void toggleFullscreen();
  }, true);
}

/** Whether the window is maximized / full screen, kept current */
export function useWindowState() {
  const [state, setState] = useState({ maximized: false, fullscreen: false });
  useEffect(() => {
    let alive = true;
    const read = () => {
      void Promise.all([desktop.isMaximized().catch(() => false), desktop.isFullscreen().catch(() => false)])
        .then(([maximized, fullscreen]) => { if (alive) setState({ maximized, fullscreen }); });
    };
    read();
    listeners.add(read);
    let stop = () => {};
    desktop.onResized(read).then((unlisten) => { stop = unlisten; }).catch(() => undefined);
    return () => { alive = false; listeners.delete(read); stop(); };
  }, []);
  return state;
}

/** The maximize button: in full screen it goes to a maximized window, otherwise maximize / restore (animated by Windows) */
export async function maximizeButton(fullscreen: boolean) {
  if (fullscreen) return exitFullscreen(true);
  await desktop.toggleMaximize().catch((err) => console.error('[window]', err));
  changed();
}

/**
 * In full screen the title bar cannot move the window (it would drag it out of full screen); a double-click on it goes
 * to a maximized window, like the maximize button. Used as the title bar's onMouseDownCapture.
 */
export function titleBarMouseDown(fullscreen: boolean) {
  return (e: ReactMouseEvent) => {
    if (!fullscreen || !(e.target as HTMLElement).closest('[data-tauri-drag-region]')) return;
    e.stopPropagation();
    if (e.detail === 2) void exitFullscreen(true);
  };
}
