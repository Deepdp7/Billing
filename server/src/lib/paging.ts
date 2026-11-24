/**
 * Paging for lists that can be very long (a mall store: a million bills, a hundred thousand products). Counting every
 * matching row on every page took longer than fetching the page, and the app does not show the count, so:
 *  - a search is not counted at all: one row more than the page is fetched, to know whether there are more;
 *  - a plain list is counted up to COUNT_CAP (exact below it, "more than" above it).
 */
import type Database from 'better-sqlite3-multiple-ciphers';

export const COUNT_CAP = 10_000;

export interface Paging { total: number; page: number; limit: number; totalPages: number; hasMore: boolean; totalCapped?: boolean }

/** Rows matching `fromWhere` ("FROM ... WHERE ..."), counted up to COUNT_CAP */
export function cappedCount(db: Database.Database, fromWhere: string, params: unknown[]): { total: number; capped: boolean } {
  const c = (db.prepare(`SELECT COUNT(*) AS c FROM (SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1})`).get(...params) as { c: number }).c;
  return { total: Math.min(c, COUNT_CAP), capped: c > COUNT_CAP };
}

/** For a page fetched with LIMIT limit + 1: the rows to show and the paging */
export function pageOf<T>(rows: T[], page: number, limit: number, counted?: { total: number; capped: boolean }): { data: T[]; pagination: Paging } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const total = counted ? counted.total : (page - 1) * limit + data.length + (hasMore ? 1 : 0);
  return {
    data,
    pagination: { total, page, limit, totalPages: Math.max(page, Math.ceil(total / limit)), hasMore: counted ? page * limit < total || counted.capped : hasMore,
      ...(counted?.capped ? { totalCapped: true } : {}) },
  };
}
