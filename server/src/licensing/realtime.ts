import { getCredentials, licenseServerUrl, syncLicense } from './licenseClient.js';
import { licenseEvents } from './events.js';
import { currentShopId } from '../db/shops.js';
import { requestSync, setLiveLinkCheck } from '../sync/syncEngine.js';

/**
 * Live link to the license server (Server-Sent Events over an outbound HTTPS request — no inbound port on the
 * customer's PC). When the vendor changes something in the Admin Panel the server sends "refresh" and we re-check
 * the license right away instead of waiting for the next scheduled sync.
 *
 * Pushes carry no entitlements: the only effect is a normal /heartbeat, whose signed token is verified as usual.
 * The link reconnects with backoff after network errors, and a watchdog drops connections that go silent.
 */

const IDLE_TIMEOUT_MS = 75_000; // server pings every 25 s
const MAX_BACKOFF_MS = 60_000;
const NO_CREDENTIALS_POLL_MS = 5_000;

let running = false;
/** Each start has its own number: a loop from before a restart (another business) ends instead of running on */
let generation = 0;
let connected = false;
let connectedSince: string | null = null;
let controller: AbortController | null = null;
let wake: (() => void) | null = null;

export function realtimeStatus(): { connected: boolean; since: string | null } {
  return { connected, since: connectedSince };
}
setLiveLinkCheck(() => connected);

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  connectedSince = value ? new Date().toISOString() : null;
  licenseEvents.emit('changed', { source: value ? 'live-connected' : 'live-disconnected', at: new Date().toISOString(), shop: currentShopId() });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { wake = null; resolve(); }, ms);
    wake = () => { clearTimeout(t); wake = null; resolve(); };
  });
}

function handleBlock(block: string) {
  let event = 'message';
  let data = '';
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  // Another computer of this account changed something: fetch it now
  if (event === 'sync') {
    requestSync(currentShopId(), 0);
    return;
  }
  if (event !== 'refresh') return;
  let reasons: string[] = [];
  try {
    const parsed = data ? JSON.parse(data) : {};
    if (Array.isArray(parsed.reasons)) reasons = parsed.reasons.map(String);
  } catch {
    reasons = [];
  }
  void syncLicense('push', reasons);
}

async function connectOnce(creds: { id: string; secret: string }): Promise<'ok' | 'unauthorized' | 'error'> {
  controller = new AbortController();
  const ctl = controller;
  let watchdog: NodeJS.Timeout | undefined;
  const arm = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => ctl.abort(), IDLE_TIMEOUT_MS);
  };
  try {
    arm();
    const res = await fetch(`${licenseServerUrl()}/api/client/v1/events`, {
      headers: { Authorization: `Bearer ${creds.id}.${creds.secret}`, Accept: 'text/event-stream' },
      signal: ctl.signal,
    });
    if (res.status === 401) return 'unauthorized';
    if (!res.ok || !res.body) return 'error';
    setConnected(true);
    // Catch up on anything changed while we were disconnected.
    void syncLicense('push');
    requestSync(currentShopId(), 0);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      arm();
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const sep = buffer.slice(idx).match(/^\r?\n\r?\n/)![0].length;
        handleBlock(buffer.slice(0, idx));
        buffer = buffer.slice(idx + sep);
      }
    }
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(watchdog);
    setConnected(false);
    if (controller === ctl) controller = null;
  }
}

async function loop(gen: number) {
  let backoff = 1_000;
  const live = () => running && gen === generation;
  while (live()) {
    const creds = getCredentials();
    if (!creds) {
      await sleep(NO_CREDENTIALS_POLL_MS);
      continue;
    }
    const startedAt = Date.now();
    const result = await connectOnce(creds);
    if (!live()) break;
    if (result === 'unauthorized') {
      // Credentials rejected (rotated, removed, or a deleted installation): record it via a normal sync, retry slowly.
      await syncLicense('push');
      backoff = MAX_BACKOFF_MS;
    } else if (Date.now() - startedAt > 30_000) {
      backoff = 1_000; // a long healthy connection ended: reconnect quickly
    }
    await sleep(backoff + Math.floor(Math.random() * 1_000));
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

export function startRealtime(): void {
  if (running) return;
  running = true;
  void loop(++generation);
}

export function stopRealtime(): void {
  running = false;
  controller?.abort();
  wake?.();
}

/** Reconnect now (e.g. right after activation, so the new installation goes live without waiting). */
export function kickRealtime(): void {
  controller?.abort();
  wake?.();
}

// Activation, deactivation or credential changes: reconnect with the current credentials.
licenseEvents.on('changed', (e: { source: string }) => {
  if (running && ['trial', 'activate', 'deactivate'].includes(e.source)) kickRealtime();
});
