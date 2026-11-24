import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import type { AddressInfo } from 'net';
import { setupTestEnv } from './helpers.js';

const dir = setupTestEnv({ enforceLicense: true });

// The vendor's signing key, and a stranger's
const vendor = crypto.generateKeyPairSync('ed25519');
const stranger = crypto.generateKeyPairSync('ed25519');
const pem = vendor.publicKey.export({ type: 'spki', format: 'pem' }) as string;
const signed = (doc: string, key = vendor.privateKey) => crypto.sign(null, Buffer.from(doc), key).toString('base64');
const docFor = (url: string, issuedAt: string) => JSON.stringify({ v: 1, url, issuedAt });

// What the public copies serve right now
const served: Record<string, string> = {};
const site = http.createServer((req, res) => {
  const body = served[req.url || ''];
  if (body === undefined) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/plain' }).end(body);
});
let src = '';
let addr: typeof import('../src/licensing/serverAddress.js');
let config: any;

before(async () => {
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  src = `http://127.0.0.1:${(site.address() as AddressInfo).port}/servers.json`;
  addr = await import('../src/licensing/serverAddress.js');
  config = (await import('../src/config/index.js')).config;
  config.licensing.serverUrl = 'https://72.61.231.155:7443';
});
after(() => { site.close(); });

const publish = (doc: string, sig: string) => { served['/servers.json'] = doc; served['/servers.json.sig'] = sig; };

test('the app follows only a newer address signed by the vendor, keeps it, and uses it after a restart', async () => {
  // nothing published: stays
  assert.equal(await addr.checkServerDirectory(pem, [src]), false);

  // signed by someone else, or edited after signing: ignored
  publish(docFor('https://6.6.6.6:7443', '2026-11-25T10:00:00Z'), signed(docFor('https://6.6.6.6:7443', '2026-11-25T10:00:00Z'), stranger.privateKey));
  assert.equal(await addr.checkServerDirectory(pem, [src]), false);
  const good = docFor('https://5.5.5.5:7443', '2026-11-25T10:00:00Z');
  publish(good.replace('5.5.5.5', '6.6.6.6'), signed(good));
  assert.equal(await addr.checkServerDirectory(pem, [src]), false);
  assert.equal(config.licensing.serverUrl, 'https://72.61.231.155:7443');

  // not https, or not an address: ignored even when signed
  const plain = docFor('http://5.5.5.5:7000', '2026-11-25T10:00:00Z');
  publish(plain, signed(plain));
  assert.equal(await addr.checkServerDirectory(pem, [src]), false);

  // the vendor's new address: followed and kept
  publish(good, signed(good));
  assert.equal(await addr.checkServerDirectory(pem, [src]), true);
  assert.equal(config.licensing.serverUrl, 'https://5.5.5.5:7443');
  assert.ok(fs.existsSync(path.join(dir, 'server-address.json')));

  // an older one published later (or replayed) never replaces it
  const older = docFor('https://4.4.4.4:7443', '2026-11-20T10:00:00Z');
  publish(older, signed(older));
  assert.equal(await addr.checkServerDirectory(pem, [src]), false);
  assert.equal(config.licensing.serverUrl, 'https://5.5.5.5:7443');

  // after a restart the kept address is used, its signature checked again
  config.licensing.serverUrl = 'https://72.61.231.155:7443';
  addr.resetServerAddressForTests();
  addr.loadServerAddress(pem);
  assert.equal(config.licensing.serverUrl, 'https://5.5.5.5:7443');
  // a kept file that was edited by hand is not used
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'server-address.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'server-address.json'), JSON.stringify({ ...saved, doc: saved.doc.replace('5.5.5.5', '6.6.6.6') }));
  config.licensing.serverUrl = 'https://72.61.231.155:7443';
  addr.loadServerAddress(pem);
  assert.equal(config.licensing.serverUrl, 'https://72.61.231.155:7443');
});
