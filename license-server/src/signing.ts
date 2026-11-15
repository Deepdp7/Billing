import crypto from 'crypto';
import { config } from './config.js';

let privateKey: crypto.KeyObject | null = null;

function key(): crypto.KeyObject {
  if (!privateKey) {
    privateKey = crypto.createPrivateKey(config.signingKeyPem);
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('License signing key must be Ed25519');
  }
  return privateKey;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Token = base64url(JSON) "." base64url(Ed25519 signature). Verified offline by the desktop app's embedded public key. */
export function signToken(payload: object): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = crypto.sign(null, Buffer.from(body, 'utf8'), key());
  return `${body}.${b64url(sig)}`;
}

export function publicKeyPem(): string {
  return crypto.createPublicKey(key()).export({ type: 'spki', format: 'pem' }) as string;
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function randomSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Human-friendly license key: APNA-XXXX-XXXX-XXXX-XXXX (no ambiguous characters). */
export function generateLicenseKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `APNA-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}`;
}

/** Constant-time comparison of hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
