import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { config, APP_VERSION } from './config/index.js';
import routes from './routes.js';
import { errorHandler } from './lib/http.js';
import { embeddedClientHandler } from './lib/embeddedClient.js';
import { db } from './db/connection.js';
import { getSchemaVersion } from './db/migrations.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  if (config.isDev) {
    // Vite dev server runs on a different port during development only.
    app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
  }

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(express.json({ limit: '5mb' }));

  if (config.isDev && process.env.NODE_ENV !== 'test') {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        if (req.path.startsWith('/api')) {
          console.log(`[API] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
        }
      });
      next();
    });
  }

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', name: 'Apna Billing API', version: APP_VERSION, time: new Date().toISOString() });
  });

  // Public, unauthenticated system info used by the first-run setup and license screens.
  app.get('/api/v1/system/info', (req, res) => {
    const businesses = (db.prepare('SELECT COUNT(*) AS c FROM businesses').get() as { c: number }).c;
    res.json({
      version: APP_VERSION,
      schemaVersion: getSchemaVersion(db),
      demoMode: config.demoMode,
      singleTenant: config.singleTenant,
      setupRequired: businesses === 0,
      licenseEnforced: config.licensing.enforce,
    });
  });

  app.use('/api/v1', routes);

  app.use('/api', (req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', message: `No API route for ${req.method} ${req.originalUrl}` });
  });

  // Serve the built client (desktop / production). Unknown non-API paths fall back to index.html.
  const embeddedClient = embeddedClientHandler();
  const indexHtml = path.join(config.clientDistDir, 'index.html');
  if (embeddedClient) {
    app.use(embeddedClient);
  } else if (fs.existsSync(indexHtml)) {
    app.use(express.static(config.clientDistDir, { index: false, maxAge: '1h' }));
    app.get('*', (req, res) => res.sendFile(indexHtml));
  } else if (process.env.APNA_EMBEDDED === '1') {
    // Desktop shell opened the window on this server but the UI bundle is missing — fail clearly
    // instead of Express's blank "Cannot GET /".
    console.error(`[apna] Client UI not found at ${indexHtml}. Run the client build (or npm run dev:app) again.`);
    app.get('*', (_req, res) => {
      res.status(503).type('html').send(
        '<!doctype html><meta charset="utf-8"><title>Apna Billing</title>'
        + '<body style="font-family:system-ui;padding:2rem">'
        + '<h1>Apna Billing UI is missing</h1>'
        + '<p>The local server started, but the client files were not found.</p>'
        + `<pre>${indexHtml}</pre>`
        + '<p>From the Billing folder run <code>npm run build</code> in <code>client</code>, then restart the app.</p>'
        + '</body>',
      );
    });
  }

  app.use(errorHandler(config.isDev));
  return app;
}
