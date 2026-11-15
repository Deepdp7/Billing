import fs from 'fs';
import path from 'path';
import knexFactory, { Knex } from 'knex';
import { config } from './config.js';

function createKnex(): Knex {
  if (config.databaseUrl) {
    return knexFactory({
      client: 'pg',
      connection: config.databaseUrl,
      pool: { min: 1, max: 10 },
    });
  }
  if (config.isProduction && !config.allowSqliteInProduction) {
    throw new Error('DATABASE_URL (PostgreSQL) is required in production (or set DB_CLIENT=sqlite for a single-server install)');
  }
  fs.mkdirSync(path.dirname(config.sqliteFile), { recursive: true });
  return knexFactory({
    client: 'better-sqlite3',
    connection: { filename: config.sqliteFile },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn: any, done: (err: Error | null, conn: any) => void) => {
        conn.pragma('foreign_keys = ON');
        conn.pragma('journal_mode = WAL');
        done(null, conn);
      },
    },
  });
}

export const knex = createKnex();
export const isPostgres = !!config.databaseUrl;

export const nowIso = () => new Date().toISOString();

/** Normalise booleans (SQLite returns 0/1, PostgreSQL true/false). */
export const bool = (v: unknown) => v === true || v === 1 || v === '1';

export function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
