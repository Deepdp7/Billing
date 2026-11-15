/**
 * In the desktop shell, block WebView/browser chrome shortcuts (reload, zoom, DevTools, …)
 * so the window feels like a native app. Keep normal editing shortcuts (copy/paste/select-all/undo).
 */

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function shouldBlockKey(e: KeyboardEvent): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt = e.altKey;

  // Reload / hard reload
  if (key === 'F5') return true;
  if (ctrl && (key === 'r' || key === 'R')) return true;

  // DevTools / view source
  if (key === 'F12') return true;
  if (ctrl && shift && (key === 'i' || key === 'j' || key === 'c' || key === 'k')) return true;
  if (ctrl && key === 'u') return true;

  // Zoom
  if (ctrl && (key === '+' || key === '=' || key === '-' || key === '_' || key === '0' || e.code === 'NumpadAdd' || e.code === 'NumpadSubtract')) {
    return true;
  }

  // Browser chrome: new window/tab, close tab, find-in-page chrome, history, downloads, print-as-browser
  if (ctrl && (key === 'n' || key === 't' || key === 'w' || key === 'f' || key === 'g' || key === 'h' || key === 'j' || key === 'd' || key === 'e' || key === 's')) {
    // Allow Ctrl+S only if we later add an in-app save; for now block browser Save Page.
    return true;
  }
  // Ctrl+P is used for invoice printing in the app — leave it alone.
  if (ctrl && shift && (key === 'n' || key === 't' || key === 'w' || key === 'delete' || key === 'Backspace')) return true;

  // History navigation
  if (alt && (key === 'ArrowLeft' || key === 'ArrowRight' || key === '←' || key === '→')) return true;
  if (key === 'BrowserBack' || key === 'BrowserForward' || key === 'BrowserRefresh') return true;

  // Backspace must not navigate away when focus is not in a field
  if (key === 'Backspace' && !isEditableTarget(e.target) && !ctrl && !alt) return true;

  return false;
}

export function installDesktopShield(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!shouldBlockKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  // Block WebView context menu on the page chrome; keep it on form fields so feel stays normal.
  window.addEventListener(
    'contextmenu',
    (e) => {
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
    },
    true,
  );

  // Dropping a file into WebView2 must not navigate the window away.
  window.addEventListener('dragover', (e) => e.preventDefault(), true);
  window.addEventListener('drop', (e) => e.preventDefault(), true);

  // Soften accidental history gestures; vertical scroll / form feel stay enabled.
  window.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
    },
    { passive: false, capture: true },
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false, capture: true },
  );
}
