import { createRequire } from 'module';
import path from 'path';
import { runtimeOptions } from '../config/runtime.js';

const cache = new Map<string, unknown>();

/**
 * Load a compiled module shipped next to the packaged engine (APNA native folder). Returns null when running from
 * source (development, tests), where callers fall back to node_modules or the TypeScript implementation.
 */
export function loadNativeModule<T>(file: string): T | null {
  const dir = runtimeOptions().nativeDir;
  if (!dir) return null;
  const full = path.join(dir, file);
  if (!cache.has(full)) cache.set(full, createRequire(process.execPath)(full));
  return cache.get(full) as T;
}
