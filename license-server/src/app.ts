import express from 'express';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import clientRoutes from './routes/client.js';
import adminRoutes from './routes/admin.js';
import { errorHandler } from './lib.js';
import { knex } from './db.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (config.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // Optional CORS for running the Admin Panel from a different origin during development.
  if (config.corsOrigins.length > 0) {
    app.use('/api/admin', (req, res, next) => {
      const origin = req.headers.origin;
      if (origin && config.corsOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
      }
      next();
    });
  }

  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', async (req, res) => {
    try {
      await knex.raw('select 1');
      res.json({ status: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'db_unavailable' });
    }
  });

  // Signed desktop-app updates. Installers are verified by the app with its updater public key, not by trust in this server.
  app.use('/updates', express.static(config.updatesDir, { index: false, dotfiles: 'deny', maxAge: 0 }));
  // Missing update files must be a plain 404 (not the Admin Panel page), e.g. while an update is paused.
  app.use('/updates', (req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'No such update file' }));

  app.use('/api/client/v1', clientRoutes);
  app.use('/api/admin/v1', adminRoutes);
  app.use('/api', (req, res) => res.status(404).json({ code: 'NOT_FOUND', message: 'Unknown endpoint' }));

  const index = path.join(config.adminPanelDir, 'index.html');
  if (fs.existsSync(index)) {
    app.use(express.static(config.adminPanelDir, { index: false }));
    app.get('*', (req, res) => res.sendFile(index));
  }

  app.use(errorHandler);
  return app;
}
