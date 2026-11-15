import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

/**
 * Must be called before importing any server module: configuration is read at import time.
 * Each test file gets an isolated temporary data directory and database.
 */
export function setupTestEnv(opts: { enforceLicense?: boolean; dbFile?: string } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apna-test-'));
  process.env.NODE_ENV = 'test';
  process.env.APNA_DATA_DIR = dir;
  process.env.DB_PATH = opts.dbFile || path.join(dir, 'test.db');
  process.env.APNA_DEMO_MODE = '0';
  process.env.APNA_SINGLE_TENANT = '1';
  process.env.APNA_LICENSE_ENFORCE = opts.enforceLicense ? '1' : '0';
  process.env.APNA_LICENSE_SERVER_URL = process.env.APNA_LICENSE_SERVER_URL || 'http://127.0.0.1:1';
  process.env.JWT_SECRET = 'test-secret-'.padEnd(64, 'x');
  return dir;
}

export async function startTestServer() {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  let token = '';

  async function request(method: string, url: string, body?: unknown, raw = false) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (raw) return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) } as any;
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data } as { status: number; data: any };
  }

  return {
    server,
    base,
    setToken: (t: string) => { token = t; },
    get: (url: string) => request('GET', url),
    getRaw: (url: string) => request('GET', url, undefined, true),
    post: (url: string, body?: unknown) => request('POST', url, body ?? {}),
    put: (url: string, body?: unknown) => request('PUT', url, body ?? {}),
    del: (url: string) => request('DELETE', url),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export type TestClient = Awaited<ReturnType<typeof startTestServer>>;

/** Register the single business for this install and log in as its owner. */
export async function setupBusiness(api: TestClient, overrides: Record<string, unknown> = {}) {
  const res = await api.post('/auth/register', {
    ownerName: 'Test Owner', email: 'owner@test.local', password: 'password123',
    businessName: 'Test Traders', category: 'GROCERY', state: 'Maharashtra', gstin: '27AABCT1234A1Z5', ...overrides,
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.data)}`);
  api.setToken(res.data.token);
  return res.data;
}

export async function createProduct(api: TestClient, p: Record<string, unknown> = {}) {
  const res = await api.post('/app/products', {
    name: 'Product', sku: `SKU-${Math.random().toString(36).slice(2, 8)}`, salePricePaise: 10000, purchasePricePaise: 7000,
    taxRate: 18, stockQuantity: 10, ...p,
  });
  if (res.status !== 201) throw new Error(`product failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.product;
}
