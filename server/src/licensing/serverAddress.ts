import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

/**
 * Where the vendor's server is. Normally the address built into the app. If that server is ever lost and rebuilt on a
 * new VPS (deploy/apna_vps.py restore), the owner publishes the new address, signed with the licence-signing key, at
 * fixed public places (the app's public repository, and a CDN copy of it). An app that cannot reach its server for a
 * while looks there; a correctly signed, newer address is kept (server-address.json in the data folder) and used from
 * then on. Nothing unsigned is followed, and an older address never replaces a newer one. The rebuilt server's
 * certificate is signed by the same certificate authority, so the app's pinned certificate still trusts it.
 */

export const DIRECTORY_SOURCES = [
  'https://raw.githubusercontent.com/Deepdp7/Billing/main/deploy/servers.json',
  'https://cdn.jsdelivr.net/gh/Deepdp7/Billing@main/deploy/servers.json',
];
/** Looked up once the server has not answered for this long, then at most this often */
const UNREACHABLE_FOR_MS = 10 * 60_000;
const CHECK_EVERY_MS = 30 * 60_000;

export interface ServerAddress { v: 1; url: string; issuedAt: string }

const file = () => path.join(config.dataDir, 'server-address.json');
let current: ServerAddress | null = null;
let downSince: number | null = null;
let lastCheck = 0;
let checking = false;

/** The address in `doc` (the exact text that was signed), if `sig` (base64 Ed25519) is the vendor's signature of it */
export function readSigned(doc: string, sig: string, publicKeyPem: string): ServerAddress | null {
  try {
    if (!crypto.verify(null, Buffer.from(doc, 'utf8'), crypto.createPublicKey(publicKeyPem), Buffer.from(sig.trim(), 'base64'))) return null;
    const a = JSON.parse(doc);
    if (a?.v !== 1 || typeof a.url !== 'string' || !/^https:\/\/[^\s/]+(:\d+)?$/.test(a.url) || Number.isNaN(Date.parse(a.issuedAt))) return null;
    return { v: 1, url: a.url, issuedAt: a.issuedAt };
  } catch {
    return null;
  }
}

/** At start: an address followed earlier (signature checked again) replaces the built-in one */
export function loadServerAddress(publicKeyPem: string): void {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const a = readSigned(saved.doc, saved.sig, publicKeyPem);
    if (!a) return;
    current = a;
    config.licensing.serverUrl = a.url;
    console.log(`[License] Using the server address published on ${a.issuedAt.slice(0, 10)}: ${a.url}`);
  } catch { /* none saved: the built-in address */ }
}

async function fetchText(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    if (text.length > 4096) throw new Error('too long');
    return text;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Looks at the published address. Returns true when a newer, correctly signed address was found and is now used.
 * Never throws.
 */
export async function checkServerDirectory(publicKeyPem: string, sources = DIRECTORY_SOURCES): Promise<boolean> {
  if (checking) return false;
  checking = true;
  lastCheck = Date.now();
  try {
    for (const src of sources) {
      try {
        const [doc, sig] = await Promise.all([fetchText(src), fetchText(`${src}.sig`)]);
        const a = readSigned(doc, sig, publicKeyPem);
        if (!a) continue;
        if (a.url === config.licensing.serverUrl) return false;
        if (current && Date.parse(a.issuedAt) <= Date.parse(current.issuedAt)) return false;
        current = a;
        fs.writeFileSync(file(), JSON.stringify({ doc, sig: sig.trim() }));
        config.licensing.serverUrl = a.url;
        console.log(`[License] The vendor's server moved: now ${a.url} (published ${a.issuedAt})`);
        return true;
      } catch { /* that copy is unreachable: the next one */ }
    }
    return false;
  } finally {
    checking = false;
  }
}

/** Every answer from the server */
export function noteServerReachable(): void {
  downSince = null;
}

/** Every failed attempt to reach it: after a while, the published address is looked at */
export function noteServerUnreachable(publicKeyPem: string): void {
  const now = Date.now();
  if (downSince === null) downSince = now;
  if (now - downSince >= UNREACHABLE_FOR_MS && now - lastCheck >= CHECK_EVERY_MS) void checkServerDirectory(publicKeyPem);
}

/** Tests: forget what was followed */
export function resetServerAddressForTests(): void {
  current = null;
  downSince = null;
  lastCheck = 0;
}
