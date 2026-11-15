/**
 * Entry point of the local engine started by the desktop shell. Release builds bundle this file with the whole local
 * server into one sealed executable (engine/apna-billing-engine.exe, a Node single-executable application; see
 * scripts/prepare.cjs). Debug builds of the shell run it with "node" straight from the repository.
 *
 * Protocol with the shell:
 *   stdin, first line   JSON {"dbKey": "<64 hex>", "uninstall"?: true}: the database key, never passed through the
 *                       environment; "uninstall" (the uninstaller) only tells the vendor's server and exits
 *   stdout              "APNA_PORT=<n>" once the API listens on 127.0.0.1:<n>; "APNA_UNINSTALLED=<n>" after the report
 *   stdin closes        the shell went away: exit, so no orphan server is left behind
 * Data dir, license server URL and app version come from the environment the shell sets.
 */
const path = require('path');

const sealed = (() => {
  try {
    return require('node:sea').isSea();
  } catch {
    return false;
  }
})();

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (sealed) {
  // The packaged engine always runs as the licensed desktop build: nothing from the environment may switch licensing
  // off, load extra code, attach a debugger or redirect where data lives. Node options are already ignored
  // (execArgvExtension "none" in the engine's build); this is a second line of defence.
  if (process.execArgv.length > 0 || require('inspector').url()) {
    fail('The Apna Billing engine does not accept Node.js options.');
  }
  for (const k of ['APNA_LICENSE_ENFORCE', 'APNA_DEMO_MODE', 'APNA_SINGLE_TENANT', 'DB_PATH', 'JWT_SECRET', 'APNA_BACKUP_DIR',
    'APNA_CLIENT_DIST', 'APNA_CONNECTIVITY_URLS', 'APNA_LICENSE_SYNC_MS', 'PORT', 'HOST']) {
    delete process.env[k];
  }
  process.env.APNA_EMBEDDED = '1';
  process.env.NODE_ENV = 'production';
}

function readHandshake() {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('no startup data from the shell')), 15_000);
    const onData = (chunk) => {
      buffer += chunk;
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      process.stdin.off('data', onData);
      try {
        resolve(JSON.parse(buffer.slice(0, nl)));
      } catch {
        reject(new Error('unreadable startup data from the shell'));
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
  });
}

process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));

readHandshake().then((handshake) => {
  if (sealed && !handshake.dbKey) fail('The Apna Billing engine must be started by Apna Billing.');
  require('../../server/dist/config/runtime.js').configureRuntime({
    dbKey: handshake.dbKey || undefined,
    nativeDir: sealed ? path.join(path.dirname(process.execPath), 'native') : undefined,
    sealed,
  });
  if (handshake.uninstall) {
    // Apna Billing is being uninstalled: tell the vendor's server for every business here, then stop (no server)
    return require('../../server/dist/licensing/licenseClient.js').reportUninstalled().then((told) => {
      console.log(`APNA_UNINSTALLED=${told}`);
      process.exit(0);
    });
  }
  // Always the same address when it is free: the window keeps what it saved (theme, sign-ins, zoom) from one start to
  // the next, since a page's saved settings belong to its address. Another program on that port: any free port.
  const { startServer } = require('../../server/dist/index.js');
  return startServer(47832).catch((err) => (err && err.code === 'EADDRINUSE' ? startServer(0) : Promise.reject(err)));
}).then((started) => {
  if (started) console.log(`APNA_PORT=${started.port}`);
}).catch((err) => {
  fail(`Local server failed to start: ${err && err.stack ? err.stack : err}`);
});
