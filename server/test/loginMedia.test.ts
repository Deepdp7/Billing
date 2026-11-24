import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { configureRuntime } from '../src/config/runtime.js';
import { decryptMedia, deriveMediaKey, encryptMedia, encryptedMediaHandler, parseRange, storedName } from '../src/lib/loginMedia.js';

const DB_KEY = crypto.randomBytes(32).toString('hex');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apna-media-'));
let server: http.Server;
let base = '';

// A pretend video: an MP4 start ("ftyp") followed by random bytes, an odd length so no block boundary lines up with the end
const video = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), crypto.randomBytes(100_001)]);
const picture = Buffer.concat([Buffer.from('RIFF'), crypto.randomBytes(5_000)]);

before(async () => {
  configureRuntime({ dbKey: DB_KEY });
  const key = deriveMediaKey(DB_KEY);
  fs.writeFileSync(path.join(dir, storedName('1-grocery-1080.abcd1234.mp4')), encryptMedia(video, key));
  fs.writeFileSync(path.join(dir, storedName('1-grocery.abcd1234.webp')), encryptMedia(picture, key));
  const app = express();
  app.use('/login-media', encryptedMediaHandler(dir), (_req, res) => { res.status(404).end(); });
  server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/login-media/`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const get = async (name: string, range?: string, method = 'GET') => {
  const res = await fetch(base + name, { method, headers: range ? { Range: range } : {} });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
};

test('nothing on disk can be opened as a video, and the same file is encrypted differently each time', () => {
  const key = deriveMediaKey(DB_KEY);
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 2);
  assert.ok(files.every((f) => /^[0-9a-f]{32}\.dat$/.test(f)), files.join(', '));
  const onDisk = fs.readFileSync(path.join(dir, storedName('1-grocery-1080.abcd1234.mp4')));
  assert.equal(onDisk.indexOf('ftyp'), -1, 'no MP4 marker in the stored file');
  assert.equal(onDisk.indexOf(video.subarray(100, 140)), -1, 'no stretch of the video in the stored file');
  assert.notDeepEqual(encryptMedia(video, key), encryptMedia(video, key));
  assert.deepEqual(decryptMedia(onDisk, key), video);
  assert.throws(() => decryptMedia(Buffer.from('not encrypted at all, just text'), key));
});

test('the whole file comes back exactly, as a video / picture, never cached on disk', async () => {
  const v = await get('1-grocery-1080.abcd1234.mp4');
  assert.equal(v.status, 200);
  assert.equal(v.headers.get('content-type'), 'video/mp4');
  assert.equal(v.headers.get('accept-ranges'), 'bytes');
  assert.equal(v.headers.get('cache-control'), 'no-store');
  assert.deepEqual(v.body, video);
  const p = await get('1-grocery.abcd1234.webp');
  assert.equal(p.headers.get('content-type'), 'image/webp');
  assert.deepEqual(p.body, picture);
});

test('every kind of byte range is right, also across the 16-byte blocks of the cipher', async () => {
  const last = video.length - 1;
  const cases: Array<[string, number, number]> = [
    ['bytes=0-0', 0, 0], ['bytes=0-999', 0, 999], ['bytes=15-16', 15, 16], ['bytes=16-31', 16, 31], ['bytes=17-1000', 17, 1000],
    ['bytes=31-33', 31, 33], ['bytes=4096-', 4096, last], ['bytes=65537-70000', 65537, 70000], [`bytes=${last}-${last}`, last, last],
    [`bytes=${last - 20}-`, last - 20, last], ['bytes=-500', last - 499, last], [`bytes=50-${last + 5000}`, 50, last],
  ];
  for (const [header, from, to] of cases) {
    const r = await get('1-grocery-1080.abcd1234.mp4', header);
    assert.equal(r.status, 206, header);
    assert.equal(r.headers.get('content-range'), `bytes ${from}-${to}/${video.length}`, header);
    assert.deepEqual(r.body, video.subarray(from, to + 1), header);
  }
  // many random ranges (what a video player does when it jumps around)
  for (let i = 0; i < 60; i++) {
    const from = crypto.randomInt(0, video.length);
    const to = Math.min(video.length - 1, from + crypto.randomInt(0, 20_000));
    const r = await get('1-grocery-1080.abcd1234.mp4', `bytes=${from}-${to}`);
    assert.deepEqual(r.body, video.subarray(from, to + 1), `bytes=${from}-${to}`);
  }
});

test('ranges that cannot be met, HEAD, and several ranges at once', async () => {
  const bad = await get('1-grocery-1080.abcd1234.mp4', `bytes=${video.length}-`);
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get('content-range'), `bytes */${video.length}`);
  assert.equal((await get('1-grocery-1080.abcd1234.mp4', 'bytes=-0')).status, 416);
  const head = await get('1-grocery-1080.abcd1234.mp4', undefined, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(video.length));
  assert.equal(head.body.length, 0);
  // several ranges are not supported: the whole file is sent (browsers ask for one range at a time)
  assert.deepEqual((await get('1-grocery-1080.abcd1234.mp4', 'bytes=0-9,20-29')).body, video);
  assert.deepEqual(parseRange('bytes=abc', 100), null);
  assert.deepEqual(parseRange('bytes=10-5', 100), 'bad');
  assert.deepEqual(parseRange('bytes=5-', 100), { start: 5, end: 99 });
});

test('anything else is a plain 404: missing files, odd names, other types, other methods, no key', async () => {
  for (const name of ['nope.mp4', '1-grocery.abcd1234.gif', '..%2Fapp.mp4', '%2e%2e%2f1-grocery.mp4', 'a%00.mp4', '.mp4', '1-grocery-1080.abcd1234.MP3']) {
    assert.equal((await get(name)).status, 404, name);
  }
  assert.equal((await get('1-grocery-1080.abcd1234.mp4', undefined, 'POST')).status, 404);
  // A file that is not one of ours (stored under a valid name) is refused, not served
  fs.writeFileSync(path.join(dir, storedName('fake.mp4')), Buffer.from('this is just a text file pretending to be a video'));
  assert.equal((await get('fake.mp4')).status, 404);
  // Started without the shell's key: nothing can be decrypted
  configureRuntime({});
  assert.equal((await get('1-grocery-1080.abcd1234.mp4')).status, 404);
  // Another key (an app built with another key than the files): refused, never served as noise (that was a black
  // screen with no clue why)
  configureRuntime({ dbKey: crypto.randomBytes(32).toString('hex') });
  const wrong = await get('1-grocery-1080.abcd1234.mp4');
  assert.equal(wrong.status, 404, 'files made with another key are not served');
  assert.equal(wrong.body.length, 0);
  assert.throws(() => decryptMedia(fs.readFileSync(path.join(dir, storedName('1-grocery-1080.abcd1234.mp4'))), deriveMediaKey(crypto.randomBytes(32).toString('hex'))), /another key/);
  configureRuntime({ dbKey: DB_KEY });
  assert.deepEqual((await get('1-grocery-1080.abcd1234.mp4')).body, video);
});
