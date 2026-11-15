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

/** Calls `cb` with the payload of every `event` sent by the desktop app; resolves to a function that stops it. */
function listen<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  const api = internals();
  if (!api?.transformCallback) return Promise.resolve(() => {});
  const handler = api.transformCallback((e) => cb((e as { payload: T }).payload));
  return api.invoke<number>('plugin:event|listen', { event, target: { kind: 'Any' }, handler }).then((id) => () => {
    void api.invoke('plugin:event|unlisten', { event, eventId: id });
  });
}

export const desktop = {
  minimize: () => invoke<void>('plugin:window|minimize'),
  toggleMaximize: () => invoke<void>('plugin:window|toggle_maximize'),
  close: () => invoke<void>('plugin:window|close'),
  isMaximized: () => invoke<boolean>('plugin:window|is_maximized'),
  maximize: () => invoke<void>('plugin:window|maximize'),
  isFullscreen: () => invoke<boolean>('plugin:window|is_fullscreen'),
  setFullscreen: (value: boolean) => invoke<void>('plugin:window|set_fullscreen', { value }),
  /** Zoom of the whole page (1 = 100%) */
  setZoom: (value: number) => invoke<void>('plugin:webview|set_webview_zoom', { value }),
  onResized: (cb: () => void) => listen('tauri://resize', () => cb()),
  /** The first real page is drawn: the Admin app's window appears now (hidden until then, so it never shows empty) */
  ready: () => invoke<void>('app_ready').catch(() => {}),
  /** Remembered by the Admin app on disk, so the next launch opens (start screen included) in this theme */
  saveTheme: (theme: 'light' | 'dark') => { if (isDesktopApp()) void invoke<void>('admin_set_theme', { theme }).catch(() => {}); },
};

export interface ReleaseFile { name: string; size: number; modified: number }
export interface ReleaseInfo {
  repo: string;
  found: boolean;
  clientVersion: string;
  adminVersion: string;
  studio: boolean;
  running: string | null;
  files: ReleaseFile[];
}
export type ReleaseAction =
  | 'build-client' | 'prepare-client' | 'sign-client' | 'build-admin' | 'prepare-admin' | 'deploy-server' | 'reset-updates';
export interface ReleaseRun {
  action: ReleaseAction;
  version?: string;
  vpsPassword?: string;
}

/** Builds and installers, run on this PC by the Admin app (admin-tauri/src-tauri/src/release.rs). */
export const release = {
  info: () => invoke<ReleaseInfo>('release_info'),
  run: (run: ReleaseRun) => invoke<void>('release_run', { ...run }),
  /** A built installer or .sig from the releases folder, to upload like a hand-picked file */
  file: async (name: string) => new File([await invoke<ArrayBuffer>('release_file', { name })], name),
  answer: (confirm: boolean) => invoke<void>('release_answer', { confirm }),
  stop: () => invoke<void>('release_stop'),
  /** 'releases', 'file:<name>', 'studio-client', 'studio-admin' or 'studio-setup' */
  open: (target: string) => invoke<void>('release_open', { target }),
  onOutput: (cb: (text: string) => void) => listen<string>('release-output', cb),
  onDone: (cb: (done: { title: string; code: number }) => void) => listen<{ title: string; code: number }>('release-done', cb),
};
