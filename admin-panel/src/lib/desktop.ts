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
  minimize: () => invoke<void>('plugin:window|minimize'),
  toggleMaximize: () => invoke<void>('plugin:window|toggle_maximize'),
  close: () => invoke<void>('plugin:window|close'),
  isMaximized: () => invoke<boolean>('plugin:window|is_maximized'),
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
