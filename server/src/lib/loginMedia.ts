import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream';
import type { Request, Response, RequestHandler } from 'express';
import { runtimeOptions } from '../config/runtime.js';

/**
 * The sign-in screen's videos and pictures, as they are kept in the installed app.
 *
 * In the install folder there is no .mp4 (or .webp) file to copy or open in a player: each one is stored as an encrypted
 * file under an opaque name (AES-256-CTR, a fresh random IV per file). The engine decrypts it while it serves it, in
 * ranges, so the video still starts at once and can be looped like any plain file. The key is derived from the
 * database key the desktop shell hands to the engine at every start, so it exists nowhere on disk.
 *
 * This keeps the files out of reach of anyone browsing the install folder. A person who runs the app can still see the
 * pictures (they are on the screen), so this is not copy protection against someone determined; it also means the
 * decrypted video is never cached on disk by the window ("no-store").
 *
 * The same module encrypts at build time (tauri/scripts/prepare.cjs, from server/dist) and decrypts in the engine, so
 * the two cannot drift apart.
 */

// Header: magic, then 8 bytes that only the right key reproduces, then the IV. Files encrypted with another key (a build
// whose key does not match the app's) are refused with a log line instead of being served as noise, which would
// leave a black screen with no clue why.
const MAGIC = Buffer.from('APNK');
const CHECK = 8;
const HEADER = MAGIC.length + CHECK + 16;
const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webp': 'image/webp' };

/**
 * AES key for the media files, from the database key (64 hex characters): the key the desktop shell hands the engine
 * at start, which is HMAC-SHA256(data key, "apna-billing/sqlite/v1") (tauri/src-tauri/src/lib.rs, database_key), NOT
 * the data key itself. The build makes the same database key in tauri/scripts/prepare.cjs (shellDatabaseKey).
 */
export function deriveMediaKey(dbKeyHex: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(dbKeyHex)) throw new Error('Invalid key');
  return crypto.createHmac('sha256', Buffer.from(dbKeyHex, 'hex')).update('apna-login-media-v1').digest();
}

/** The name a file is stored under in the install folder: it says nothing about what is inside */
export function storedName(name: string): string {
  return `${crypto.createHash('sha256').update(`apna-login-media:${name}`).digest('hex').slice(0, 32)}.dat`;
}

/** The IV advanced by `block` 16-byte blocks: where the keystream stands at that byte offset (CTR counts big-endian) */
function counterAt(iv: Buffer, block: number): Buffer {
  const n = (BigInt('0x' + iv.toString('hex')) + BigInt(block)) & ((1n << 128n) - 1n);
  return Buffer.from(n.toString(16).padStart(32, '0'), 'hex');
}

/** The 8 bytes in the header that tell whether a key is the one the file was made with */
const keyCheck = (key: Buffer) => crypto.createHmac('sha256', key).update('apna-login-media-check').digest().subarray(0, CHECK);

/** Encrypts a whole file: header (magic + key check + IV) followed by the encrypted bytes */
export function encryptMedia(plain: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
  return Buffer.concat([MAGIC, keyCheck(key), iv, cipher.update(plain), cipher.final()]);
}

/** Decrypts a whole file made by encryptMedia (used by tests and checks; the engine serves ranges instead) */
export function decryptMedia(stored: Buffer, key: Buffer): Buffer {
  if (stored.length < HEADER || !stored.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an encrypted media file');
  if (!stored.subarray(MAGIC.length, MAGIC.length + CHECK).equals(keyCheck(key))) throw new Error('Encrypted with another key');
  const decipher = crypto.createDecipheriv('aes-256-ctr', key, stored.subarray(MAGIC.length + CHECK, HEADER));
  return Buffer.concat([decipher.update(stored.subarray(HEADER)), decipher.final()]);
}

/** One byte range of a file of `size` bytes: null = the whole file, 'bad' = cannot be satisfied (416) */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'bad' | null {
  const m = header && !header.includes(',') ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (!m[1] && !m[2])) return null; // none, several ranges or not understood: the whole file
  let start: number;
  let end: number;
  if (!m[1]) {
    const last = Number(m[2]);
    if (!last) return 'bad';
    start = Math.max(0, size - last);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start >= size || start > end ? 'bad' : { start, end };
}

/** Serves /login-media/<name>.mp4 (or .webp) from the encrypted files in `dir`, decrypting as it goes */
export function encryptedMediaHandler(dir: string): RequestHandler {
  let cached: { hex: string; key: Buffer } | null = null;
  const keyNow = (): Buffer | null => {
    const hex = runtimeOptions().dbKey;
    if (!hex) return null;
    if (!cached || cached.hex !== hex) cached = { hex, key: deriveMediaKey(hex) };
    return cached.key;
  };
  const notFound = (res: Response) => { res.status(404).end(); };
  let warned = false;

  return (req: Request, res: Response) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
    let name: string;
    try {
      name = decodeURIComponent(req.path.slice(1));
    } catch {
      return notFound(res);
    }
    const type = TYPES[path.extname(name).toLowerCase()];
    const key = keyNow();
    if (!type || !key || !/^[A-Za-z0-9._-]{1,120}$/.test(name) || name.includes('..')) return notFound(res);

    const file = path.join(dir, storedName(name));
    let fd: number;
    let size: number;
    const head = Buffer.alloc(HEADER);
    try {
      fd = fs.openSync(file, 'r');
      size = fs.fstatSync(fd).size;
      if (size < HEADER || fs.readSync(fd, head, 0, HEADER, 0) !== HEADER) throw new Error('short');
    } catch {
      return notFound(res);
    }
    fs.closeSync(fd);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) return notFound(res);
    if (!head.subarray(MAGIC.length, MAGIC.length + CHECK).equals(keyCheck(key))) {
      if (!warned) {
        warned = true;
        console.error('[login-media] the sign-in videos were encrypted with another key than this app has: not served (rebuild the app)');
      }
      return notFound(res);
    }
    const iv = head.subarray(MAGIC.length + CHECK);
    const total = size - HEADER;

    res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // The window must not keep a decrypted copy of its own on disk (it is served from this computer, so it is quick)
    res.setHeader('Cache-Control', 'no-store');

    const range = parseRange(req.headers.range, total);
    if (range === 'bad') {
      res.status(416).setHeader('Content-Range', `bytes */${total}`);
      res.end();
      return;
    }
    const { start, end } = range || { start: 0, end: total - 1 };
    res.status(range ? 206 : 200);
    if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD' || total === 0) {
      res.end();
      return;
    }

    // Start the keystream at the block holding `start`, then step over the bytes of that block that are not wanted
    const decipher = crypto.createDecipheriv('aes-256-ctr', key, counterAt(iv, Math.floor(start / 16)));
    if (start % 16) decipher.update(Buffer.alloc(start % 16));
    pipeline(fs.createReadStream(file, { start: HEADER + start, end: HEADER + end, highWaterMark: 256 * 1024 }), decipher, res, () => { /* a closed window is normal */ });
  };
}
