/**
 * Values handed over by the desktop shell when it starts the packaged engine (see tauri/sidecar/run-server.cjs).
 * They arrive over the engine's stdin pipe, never from environment variables or files next to the app, and must be
 * set before any other server module is loaded. Development runs and tests leave them empty: the database is then
 * plain SQLite and licensing uses the TypeScript implementation.
 */
export interface RuntimeOptions {
  /** 64 hex characters. When set, the local database and its backups are encrypted with this key. */
  dbKey?: string;
  /** Folder holding the compiled native modules (SQLite engine, licensing core) of the packaged engine. */
  nativeDir?: string;
  /** True inside the sealed single-file engine. */
  sealed?: boolean;
}

let runtime: RuntimeOptions = {};

export function configureRuntime(options: RuntimeOptions): void {
  if (options.dbKey !== undefined && !/^[0-9a-f]{64}$/.test(options.dbKey)) throw new Error('Invalid database key');
  runtime = { ...options };
}

export function runtimeOptions(): Readonly<RuntimeOptions> {
  return runtime;
}
