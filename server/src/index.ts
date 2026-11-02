import type { Server } from 'http';
import { AddressInfo } from 'net';
import { config } from './config/index.js';
import { createApp } from './app.js';
import { runSeed } from './db/seed.js';
import { startBackgroundJobs, stopBackgroundJobs } from './jobs.js';

/**
 * Start the local API server. Used by `npm run dev`/`npm start` and by the Electron main process,
 * which passes port 0 to get a free port and then loads http://127.0.0.1:<port>.
 */
export function startServer(port: number = config.port): Promise<{ server: Server; port: number }> {
  if (config.demoMode) {
    runSeed();
  }

  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, config.host, () => {
      const actualPort = (server.address() as AddressInfo).port;
      console.log(`Apna Billing local server running on http://${config.host}:${actualPort}`);
      startBackgroundJobs();
      resolve({ server, port: actualPort });
    });
    server.on('error', reject);
  });
}

export function stopServer(server: Server): Promise<void> {
  stopBackgroundJobs();
  return new Promise((resolve) => server.close(() => resolve()));
}

// Run directly (not when required by Electron or tests).
const isDirectRun = (() => {
  const entry = process.argv[1] || '';
  return /[\\/]index\.(ts|js)$/.test(entry) && !process.env.APNA_EMBEDDED;
})();

if (isDirectRun) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
