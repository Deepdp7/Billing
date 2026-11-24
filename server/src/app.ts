import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { config, APP_VERSION } from './config/index.js';
import routes from './routes.js';
import { errorHandler } from './lib/http.js';
import { embeddedClientHandler } from './lib/embeddedClient.js';
import { runtimeOptions } from './config/runtime.js';
import { encryptedMediaHandler } from './lib/loginMedia.js';
import jwt from 'jsonwebtoken';
import { requestSync } from './sync/syncEngine.js';
import { db } from './db/connection.js';
import { getSchemaVersion } from './db/migrations.js';
import { activeShopId, currentShopId, listShops, runInShop, shopExists } from './db/shops.js';
import type { AuthTokenPayload } from './types/index.js';

/**
 * Picks the business (database file, see db/shops.ts) a request works on: the one in the signed-in user's token;
 * without a token (sign-in screen, first start) the one asked for (?shop=) or else the one in use. A token whose
 * business is no longer on this computer is refused.
 */
function selectShop(req: express.Request, res: express.Response, next: express.NextFunction) {
  let shop: string | undefined;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      shop = (jwt.verify(header.slice(7), config.jwtSecret) as AuthTokenPayload).shopId || 'main';
    } catch { /* an invalid token is answered by the route's own check */ }
    if (shop && !shopExists(shop)) {
      res.status(401).json({ code: 'INVALID_TOKEN', message: 'This business is no longer on this computer' });
      return;
    }
  }
  if (!shop && typeof req.query.shop === 'string' && shopExists(req.query.shop)) shop = req.query.shop;
  runInShop(shop || activeShopId(), next);
}

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
  app.use('/api', selectShop);
  // Whatever a request changed goes to the account's other computers right after it (the triggers noted it)
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const shop = currentShopId();
      res.on('finish', () => requestSync(shop));
    }
    next();
  });

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
      // Nothing set up yet on this computer (the first sign-up screen); otherwise the businesses to sign in to
      setupRequired: businesses === 0 && listShops().length === 0,
      businesses: listShops().map((s) => ({ id: s.id, name: s.name, category: s.category })),
      licenseEnforced: config.licensing.enforce,
    });
  });

  app.use('/api/v1', routes);

  app.use('/api', (req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', message: `No API route for ${req.method} ${req.originalUrl}` });
  });

  // The sign-in screen's background videos. A video must be read in ranges to start playing at once and to be looped,
  // which the files embedded in the engine cannot do, so they are files next to it. In the packaged app they are
  // encrypted (nothing in the install folder can be opened as a video; see lib/loginMedia.ts) and decrypted here as
  // they are served; from source they are the plain files of the client build. A missing file is a plain 404, never
  // the app's page.
  const sealed = !!runtimeOptions().sealed;
  const mediaDir = sealed ? path.join(path.dirname(process.execPath), 'login-media') : path.join(config.clientDistDir, 'login-media');
  if (fs.existsSync(mediaDir)) {
    app.use('/login-media',
      sealed
        ? encryptedMediaHandler(mediaDir)
        : express.static(mediaDir, { index: false, maxAge: '365d', immutable: true, acceptRanges: true, dotfiles: 'ignore' }),
      (_req, res) => { res.status(404).end(); });
  }

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
