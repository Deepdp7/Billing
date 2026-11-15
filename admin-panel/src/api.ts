const BASE = '/api/admin/v1';
const TOKEN_KEY = 'apna_admin_token';

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) {
    super(message);
  }
}

// Session-scoped storage: the admin token disappears when the browser tab/session ends.
export const session = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string) => { try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } },
  // Signed out: nothing loaded for this sign-in stays in memory
  clear: () => { forgetRemembered(); try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = session.get();
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    session.clear();
    onUnauthorized();
  }
  if (!res.ok) throw new ApiError(data.message || `Request failed (${res.status})`, data.code || 'ERROR', res.status);
  return data as T;
}

// ---- Remembered answers: a page shows what was last loaded from the same address at once, and refreshes it in the
// background (useAsync). Main pages are loaded ahead right after sign-in (prefetch), so they open with data.
const remembered = new Map<string, unknown>();
let lastGet: { path: string; promise: Promise<unknown> } | null = null;

export const get = <T = any>(p: string): Promise<T> => {
  const promise = api<T>('GET', p).then((d) => {
    remembered.delete(p);
    remembered.set(p, d);
    if (remembered.size > 300) remembered.delete(remembered.keys().next().value as string);
    return d;
  });
  lastGet = { path: p, promise };
  return promise;
};

/** Starts `fn` and returns its promise, with the last answer from the same address when `fn` is exactly one get() */
export function startGet<T>(fn: () => Promise<T>): { promise: Promise<T>; cached: T | undefined } {
  lastGet = null;
  const promise = fn();
  promise.catch(() => {}); // awaited by the caller; this only stops an early failure being reported as unhandled
  const seen = lastGet as { path: string; promise: Promise<unknown> } | null; // set by get() inside fn
  const cached = seen && seen.promise === promise ? (remembered.get(seen.path) as T | undefined) : undefined;
  return { promise, cached };
}

/** Loads these addresses in the background, so their pages open with data */
export function prefetch(paths: string[]) {
  for (const p of paths) void get(p).catch(() => {});
}

function forgetRemembered() {
  remembered.clear();
}
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const put = <T = any>(p: string, b: unknown = {}) => api<T>('PUT', p, b);
export const del = <T = any>(p: string, b?: unknown) => api<T>('DELETE', p, b);

export const qs = (o: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};
