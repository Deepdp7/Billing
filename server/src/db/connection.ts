import { currentShop, initShops } from './shops.js';
import type { SqliteDatabase } from './sqlite.js';

initShops();

/**
 * The database of the business the current request belongs to (see shops.ts): every module keeps using `db` as
 * before, and each call goes to the right business's file.
 */
export const db: SqliteDatabase = new Proxy({} as SqliteDatabase, {
  get(_target, prop) {
    const real = currentShop().db as any;
    const value = real[prop];
    return typeof value === 'function' ? value.bind(real) : value;
  },
  set(_target, prop, value) {
    (currentShop().db as any)[prop] = value;
    return true;
  },
});
