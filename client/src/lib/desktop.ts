type Internals = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  transformCallback?: (cb: (payload: unknown) => void, once?: boolean) => number;
  metadata?: { currentWindow?: { label?: string } };
};

function internals(): Internals | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__ ?? null;
}

export function isDesktopApp(): boolean {
  return internals() !== null;
}

function windowLabel(): string {
  return internals()?.metadata?.currentWindow?.label || 'main';
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const api = internals();
  if (!api) return Promise.reject(new Error('Desktop window is not available'));
  return api.invoke<T>(cmd, { label: windowLabel(), ...args });
}

export const desktop = {
  /** Download the signed update from the server, install it and restart the app (the shell verifies the signature). */
  installUpdate: () => invoke<void>('apna_install_update'),
  /** The first real screen is drawn: the window appears now (it stays hidden until then, so it never shows empty) */
  ready: () => invoke<void>('apna_ready').catch(() => {}),
  /** Remembered by the desktop app on disk, so the next start (start screen included) opens in this theme */
  saveTheme: (theme: 'light' | 'dark') => { if (isDesktopApp()) void invoke<void>('apna_set_theme', { theme }).catch(() => {}); },
  minimize: () => invoke<void>('plugin:window|minimize'),
  toggleMaximize: () => invoke<void>('plugin:window|toggle_maximize'),
  close: () => invoke<void>('plugin:window|close'),
  isMaximized: () => invoke<boolean>('plugin:window|is_maximized'),
  maximize: () => invoke<void>('plugin:window|maximize'),
  isFullscreen: () => invoke<boolean>('plugin:window|is_fullscreen'),
  setFullscreen: (value: boolean) => invoke<void>('plugin:window|set_fullscreen', { value }),
  /** Zoom of the whole page (1 = 100%) */
  setZoom: (value: number) => invoke<void>('plugin:webview|set_webview_zoom', { value }),
  onResized: (cb: () => void) => {
    const api = internals();
    if (!api?.transformCallback) return Promise.resolve(() => {});
    const handler = api.transformCallback(() => cb());
    return api.invoke<number>('plugin:event|listen', {
      event: 'tauri://resize',
      target: { kind: 'Any' },
      handler,
    }).then((id) => () => {
      void api.invoke('plugin:event|unlisten', { event: 'tauri://resize', eventId: id });
    });
  },
};
