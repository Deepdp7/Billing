import path from 'path';
import { runtimeOptions } from '../config/runtime.js';

const cache = new Map<string, unknown>();

/**
 * Load a compiled module (a native library, `.dll`) shipped next to the packaged engine, by its file path.
 * `process.dlopen` loads a Node-API addon from any file name, so these ship as ordinary `.dll` files rather than
 * `.node`. Returns null when running from source (development, tests), where callers fall back to node_modules or
 * the TypeScript implementation.
 */
export function loadNativeModule<T>(file: string): T | null {
  const dir = runtimeOptions().nativeDir;
  if (!dir) return null;
  const full = path.join(dir, file);
  if (!cache.has(full)) {
    const mod: { exports: unknown } = { exports: {} };
    process.dlopen(mod as NodeModule, full);
    cache.set(full, mod.exports);
  }
  return cache.get(full) as T;
}
