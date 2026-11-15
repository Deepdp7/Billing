import { useEffect, useRef } from 'react';

/**
 * Barcode scanners (USB / Bluetooth "keyboard" scanners, every common model) type the code very fast and press Enter.
 * This listens on the whole app and tells a scan apart from a person typing by its speed, so a scan works on any
 * screen without clicking into a box first:
 * - Into a field marked `data-scan-input` (POS scan box, search boxes, the product's barcode field) the code is typed
 *   as usual; `data-scan-input="no-enter"` also keeps the scanner's Enter from submitting the form.
 * - Anywhere else (nothing focused, or a field like the customer's name) the typed characters are taken back out and
 *   the code goes to the screen's scan handler (`useScanner`), the newest screen / pop-up first.
 * Scanners that send no Enter are recognised after a short pause, when no text field is focused.
 */

type Handler = (code: string) => boolean | void;

const MAX_GAP_MS = 45;      // scanners: ~2–30 ms between characters; people: 80 ms and more
const MAX_AVG_GAP_MS = 30;
const MIN_LENGTH = 4;
const NO_ENTER_PAUSE_MS = 120;

const handlers: Handler[] = [];
let fallback: Handler | null = null;
let installed = false;

/** What a scan does when the screen has no use for it (set once, by the app shell). */
export function setScanFallback(handler: Handler | null) {
  fallback = handler;
}

/** Handle scans while this component is on screen. Return true when the code was used (stops older handlers). */
export function useScanner(handler: Handler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const h: Handler = (code) => ref.current(code);
    handlers.push(h);
    return () => {
      const i = handlers.lastIndexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, [enabled]);
}

/** Send a code to the screen's scan handlers, as if it had been scanned (e.g. typed into a scan box). */
export function dispatchScan(code: string): boolean {
  const clean = code.trim();
  if (!clean) return false;
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i](clean) === true) return true;
  }
  return fallback?.(clean) === true;
}

type Field = HTMLInputElement | HTMLTextAreaElement;
const isTextField = (el: EventTarget | null): el is Field =>
  (el instanceof HTMLInputElement && /^(text|search|tel|number|email|url|password|)$/.test(el.type)) || el instanceof HTMLTextAreaElement;

/** Put a React-controlled field back to an earlier value (React only notices changes made through the native setter). */
function restoreField(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function installScanner(): void {
  if (installed) return;
  installed = true;

  let chars = '';
  let times: number[] = [];
  let field: Field | null = null;
  let before = '';
  let pauseTimer: number | undefined;

  const reset = () => { chars = ''; times = []; field = null; window.clearTimeout(pauseTimer); };

  const looksScanned = () => {
    if (chars.length < MIN_LENGTH || new Set(chars).size === 1) return false; // a held-down key repeats one character
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    return gaps.every((g) => g <= MAX_GAP_MS) && gaps.reduce((a, b) => a + b, 0) / gaps.length <= MAX_AVG_GAP_MS;
  };

  const finish = (target: EventTarget | null): boolean => {
    const code = chars.trim();
    const target_ = field;
    const wasBefore = before;
    reset();
    if (target_ && target_.closest('[data-scan-input]')) return false; // the field takes scans itself
    if (target_) restoreField(target_, wasBefore);
    else if (isTextField(target)) return false;
    return dispatchScan(code);
  };

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    const now = performance.now();

    if (e.key === 'Enter' || e.key === 'Tab') {
      if (chars && now - times[times.length - 1] <= 100 && looksScanned()) {
        const keepEnter = !!(field && field.closest('[data-scan-input]') && field.closest('[data-scan-input]')?.getAttribute('data-scan-input') !== 'no-enter');
        const used = finish(e.target);
        if (used || !keepEnter) { e.preventDefault(); e.stopPropagation(); }
        return;
      }
      reset();
      return;
    }
    if (e.key.length !== 1) { if (e.key !== 'Shift') reset(); return; }

    if (!chars || now - times[times.length - 1] > MAX_GAP_MS) {
      reset();
      field = isTextField(e.target) ? e.target : null;
      before = field ? field.value : '';
    }
    chars += e.key;
    times.push(now);

    // Scanner set to send no Enter: a fast burst then a pause, while no text field is focused
    window.clearTimeout(pauseTimer);
    if (!field) {
      pauseTimer = window.setTimeout(() => { if (looksScanned()) finish(null); else reset(); }, NO_ENTER_PAUSE_MS);
    }
  }, true);
}

// ---- Scan → another screen: the shell opens the screen, the screen picks up what to do ----

export type ScanIntent =
  | { kind: 'sell'; code: string }          // POS: add this product to the bill
  | { kind: 'new-product'; code: string }   // Products: new product with this barcode
  | { kind: 'edit-product'; code: string }  // Products: open this product
  | { kind: 'labels'; code: string }        // Barcode labels: print stickers for it
  | { kind: 'open-bill'; code: string };    // Invoices: open this bill

let pending: ScanIntent | null = null;

/** Open a screen and hand it a scan to act on. */
export function openWithScan(page: string, intent: ScanIntent) {
  pending = intent;
  window.dispatchEvent(new CustomEvent('apna:navigate', { detail: page }));
}

/** On a screen's first render: the scan it was opened for, if any (taken once). */
export function takeScanIntent<K extends ScanIntent['kind']>(kind: K): Extract<ScanIntent, { kind: K }> | null {
  if (pending?.kind !== kind) return null;
  const intent = pending as Extract<ScanIntent, { kind: K }>;
  pending = null;
  return intent;
}

/** The product a scanned code belongs to (its barcode, or its SKU). */
export async function findProductByCode(code: string): Promise<any | null> {
  const { api } = await import('./api.js');
  const res = await api.getProducts({ code, limit: 2 });
  return res.data[0] || null;
}

let audio: AudioContext | null = null;
/** A short counter beep after a scan: high = found, low = not found. */
export function scanBeep(ok = true) {
  try {
    audio = audio || new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = ok ? 2400 : 520;
    gain.gain.setValueAtTime(0.06, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (ok ? 0.09 : 0.25));
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + (ok ? 0.1 : 0.26));
  } catch { /* no sound device */ }
}
