import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config/index.js';
import routes from './routes.js';
import { runSeed } from './db/seed.js';

const app = express();

app.use(cors({
  origin: '*',
  credentials: true,
}));

app.use(express.json());

// Request logger for API calls
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api')) {
      console.log(`[API] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Root health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'Apna Billing API', version: '1.0.0', time: new Date().toISOString() });
});

// API routes under /api/v1
app.use('/api/v1', routes);

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[Error]', err);
  res.status(err.status || 500).json({
    code: err.code || 'INTERNAL_ERROR',
    message: err.message || 'An unexpected error occurred',
    details: config.isDev ? err.stack : undefined,
  });
});

// Seed DB on start
runSeed();

app.listen(config.port, () => {
  console.log(`🚀 Apna Billing backend server running on http://localhost:${config.port}`);
});
