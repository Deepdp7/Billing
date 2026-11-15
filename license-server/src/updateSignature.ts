import crypto from 'crypto';
import fs from 'fs';

/**
 * Verifies a Tauri updater signature (minisign format), exactly as the desktop app does before installing.
 *
 * - The public key (tauri.conf.json plugins.updater.pubkey) is base64 of a minisign public-key file:
 *     "untrusted comment: …\n" + base64("Ed" | keyId[8] | ed25519PublicKey[32])
 * - A ".sig" file is base64 of a minisign signature file:
 *     "untrusted comment: …\n" + base64(alg[2] | keyId[8] | signature[64]) + "\n"
 *     "trusted comment: …\n"   + base64(globalSignature[64])
 *   alg "ED" signs BLAKE2b-512(file); "Ed" signs the file itself. The global signature covers signature + trusted comment.
 */

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function decodeBox(b64: string): string[] {
  const text = Buffer.from(b64.trim(), 'base64').toString('utf8');
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function parsePublicKey(b64: string): { keyId: Buffer; key: crypto.KeyObject } {
  const lines = decodeBox(b64);
  const raw = Buffer.from(lines.find((l) => !l.startsWith('untrusted comment:')) || '', 'base64');
  if (raw.length !== 42 || raw.subarray(0, 2).toString() !== 'Ed') throw new Error('Updater public key is not a minisign Ed25519 key');
  const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw.subarray(10)]), format: 'der', type: 'spki' });
  return { keyId: raw.subarray(2, 10), key };
}

export interface SignatureCheck { ok: boolean; reason?: string }

export async function verifyUpdateSignature(filePath: string, signatureB64: string, publicKeyB64: string): Promise<SignatureCheck> {
  let pub;
  try { pub = parsePublicKey(publicKeyB64); } catch (e: any) { return { ok: false, reason: e.message }; }
  let lines: string[];
  try { lines = decodeBox(signatureB64); } catch { return { ok: false, reason: 'The .sig file is not readable' }; }
  const sigLine = lines.find((l) => !l.includes(':'));
  const trustedIdx = lines.findIndex((l) => l.startsWith('trusted comment:'));
  if (!sigLine || trustedIdx < 0 || !lines[trustedIdx + 1]) return { ok: false, reason: 'The .sig file is not a minisign signature' };
  const sig = Buffer.from(sigLine, 'base64');
  if (sig.length !== 74) return { ok: false, reason: 'The .sig file is not a minisign signature' };
  const alg = sig.subarray(0, 2).toString();
  if (!sig.subarray(2, 10).equals(pub.keyId)) return { ok: false, reason: 'Signed with a different update key than this server expects' };

  let message: Buffer;
  if (alg === 'ED') {
    const hash = crypto.createHash('blake2b512');
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(filePath).on('data', (c) => hash.update(c)).on('end', () => resolve()).on('error', reject);
    });
    message = hash.digest();
  } else if (alg === 'Ed') {
    message = fs.readFileSync(filePath);
  } else {
    return { ok: false, reason: `Unknown signature algorithm ${alg}` };
  }
  if (!crypto.verify(null, message, pub.key, sig.subarray(10))) return { ok: false, reason: 'The signature does not match this installer file' };

  const trustedComment = lines[trustedIdx].slice('trusted comment:'.length).trim();
  const global = Buffer.from(lines[trustedIdx + 1], 'base64');
  if (!crypto.verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trustedComment)]), pub.key, global)) {
    return { ok: false, reason: 'The signature comment was altered' };
  }
  return { ok: true };
}
