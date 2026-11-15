import { desktop, isDesktopApp } from './desktop';

/**
 * The same layout on every screen. The screens are designed on a 2560×1600 display at 150% (a work area of about
 * 1707×1019); on any other screen the whole window is zoomed so the same content fits the same way: a 1366×768 laptop
 * shows what the 2K screen shows, a large 100% monitor does not leave everything small. Ctrl + / Ctrl − / Ctrl 0
 * adjust it further, and that choice is remembered. (Same file in the Admin Panel.)
 */

const DESIGN = { w: 1707, h: 1019 };
const LIMITS = { min: 0.8, max: 1.35 }; // smaller is hard to read; larger wastes the screen
const KEY = 'apna_ui_zoom';

let applied = 1;
// The screen's work area in unzoomed pixels (the page zoom does not change what the page is told)
let screenSize = { w: 0, h: 0 };
let userFactor = 1;

function readUserFactor() {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= 0.6 && v <= 1.6 ? v : 1;
  } catch {
    return 1;
  }
}

function target() {
  const fit = Math.min(screenSize.w / DESIGN.w, screenSize.h / DESIGN.h);
  const base = Math.min(LIMITS.max, Math.max(LIMITS.min, Number.isFinite(fit) && fit > 0 ? fit : 1));
  return Math.round(base * userFactor * 100) / 100;
}

async function apply() {
  const z = target();
  if (Math.abs(z - applied) < 0.005) return;
  applied = z;
  await desktop.setZoom(z).catch(() => {});
}

function measure() {
  screenSize = { w: window.screen.availWidth, h: window.screen.availHeight };
}

/** The window may have moved to another monitor: fit that screen */
function onResize() {
  measure();
  void apply();
}

function setUserFactor(next: number) {
  userFactor = Math.round(Math.min(1.6, Math.max(0.6, next)) * 100) / 100;
  try { localStorage.setItem(KEY, String(userFactor)); } catch { /* private mode */ }
  void apply();
}

export function installUiScale() {
  if (!isDesktopApp()) return;
  measure();
  userFactor = readUserFactor();
  void apply();
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === '=' || e.key === '+') setUserFactor(userFactor + 0.1);
    else if (e.key === '-' || e.key === '_') setUserFactor(userFactor - 0.1);
    else if (e.key === '0') setUserFactor(1);
    else return;
    e.preventDefault();
  }, true);
}
