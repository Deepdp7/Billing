import { licenseServerUrl, syncLicense } from './licenseClient.js';
import { licenseEvents } from './events.js';

/**
 * Is this computer on the internet? The app requires it (the UI shows a full-screen "connect to the internet" lock
 * while offline and removes it the moment the connection is back).
 *
 * Probes the license server every few seconds. If that fails, a public connectivity-check URL decides whether the
 * internet is down (lock) or only the license server is (no lock: a vendor outage must not stop every shop).
 * Two failed rounds in a row are needed to go offline; one success is enough to come back.
 */

const ONLINE_EVERY_MS = 4_000;
const OFFLINE_EVERY_MS = 1_500;
const TIMEOUT_MS = 2_500;
const DEFAULT_PUBLIC_CHECKS = ['https://www.msftconnecttest.com/connecttest.txt', 'https://1.1.1.1/cdn-cgi/trace'];
// Tests can point the public check elsewhere (ignored inside the desktop app).
const PUBLIC_CHECKS = !process.env.APNA_EMBEDDED && process.env.APNA_CONNECTIVITY_URLS
  ? process.env.APNA_CONNECTIVITY_URLS.split(',').map((u) => u.trim()).filter(Boolean)
  : DEFAULT_PUBLIC_CHECKS;

let online = true;
let since = new Date().toISOString();
let serverReachable = true;
let failures = 0;
let timer: NodeJS.Timeout | null = null;
let running = false;

export function connectivityStatus() {
  return { online, since, serverReachable };
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'GET', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function probe(): Promise<boolean> {
  serverReachable = await reachable(`${licenseServerUrl()}/api/health`);
  if (serverReachable) return true;
  const results = await Promise.all(PUBLIC_CHECKS.map(reachable));
  return results.some(Boolean);
}

function set(value: boolean) {
  if (online === value) return;
  online = value;
  since = new Date().toISOString();
  licenseEvents.emit('changed', { source: 'connectivity', online: value, at: since });
  // Back online: pick up anything the vendor changed meanwhile.
  if (value) void syncLicense('push');
}

async function tick() {
  if (!running) return;
  const ok = await probe();
  if (ok) {
    failures = 0;
    set(true);
  } else if (++failures >= 2) {
    set(false);
  }
  if (running) timer = setTimeout(tick, online ? ONLINE_EVERY_MS : OFFLINE_EVERY_MS);
}

export function startConnectivityMonitor(): void {
  if (running) return;
  running = true;
  void tick();
}

export function stopConnectivityMonitor(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Check right now (the UI calls this when Windows reports the network is back, so the lock lifts at once). */
export async function checkConnectivityNow(): Promise<ReturnType<typeof connectivityStatus>> {
  const ok = await probe();
  failures = ok ? 0 : Math.max(failures, 2);
  set(ok);
  return connectivityStatus();
}
