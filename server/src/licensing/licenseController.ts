import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../db/connection.js';
import { config } from '../config/index.js';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { asyncHandler, parse, HttpError } from '../lib/http.js';
import { AuthTokenPayload } from '../types/index.js';
import * as license from './licenseClient.js';
import { licenseEvents } from './events.js';
import { realtimeStatus } from './realtime.js';
import { checkConnectivityNow, connectivityStatus } from './connectivity.js';
import { FEATURE_KEYS } from './features.js';
import { logAudit } from '../services/auditService.js';

/**
 * Activation is open before first setup (no business yet). Afterwards only the business owner may
 * activate, replace or deactivate the license.
 */
function ownerOrFirstRun(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const hasBusiness = (db.prepare('SELECT COUNT(*) AS c FROM businesses').get() as any).c > 0;
  if (!hasBusiness) return next();
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const user = jwt.verify(header.slice(7), config.jwtSecret) as AuthTokenPayload;
      if (user.role === 'BUSINESS_OWNER' || user.role === 'SUPER_ADMIN') {
        req.user = user;
        return next();
      }
    } catch {
      // fall through
    }
  }
  res.status(403).json({ code: 'OWNER_REQUIRED', message: 'Only the business owner can change the license' });
}

export function getStatus(req: Request, res: Response): void {
  res.json({ ...license.computeStatus(), realtime: realtimeStatus(), connectivity: connectivityStatus(), requireOnline: config.licensing.enforce });
}

export const checkConnectivity = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await checkConnectivityNow());
});

/**
 * Live stream for the UI: a bare "license" ping whenever the local license state changes (e.g. the vendor changed
 * a feature and the push-triggered sync finished). Carries no data; the UI re-reads /license/status.
 */
export function streamEvents(req: Request, res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const write = (chunk: string) => {
    if (!res.writableEnded && !res.destroyed) res.write(chunk);
  };
  write('retry: 3000\n\n');
  const onChange = (e: { source: string; sessionEnded?: boolean; reason?: string; reasons?: string[] }) =>
    write(`event: license\ndata: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => write(': ping\n\n'), 25_000);
  licenseEvents.on('changed', onChange);
  req.on('close', () => {
    clearInterval(ping);
    licenseEvents.off('changed', onChange);
  });
}

const trialSchema = z.object({
  name: z.string().trim().min(2, 'Your name is required').max(120),
  businessName: z.string().trim().min(2, 'Business name is required').max(150),
  email: z.string().trim().email('A valid email is required').max(150),
  phone: z.string().trim().max(20).optional(),
});

export const startTrial = [ownerOrFirstRun, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const input = parse(trialSchema, req.body);
  const status = await license.startTrial(input);
  logAudit({ userId: req.user?.userId, action: 'LICENSE_TRIAL_STARTED', entityType: 'LICENSE', details: { plan: status.license?.plan.code } });
  res.status(201).json(status);
})];

export const activate = [ownerOrFirstRun, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { licenseKey } = parse(z.object({ licenseKey: z.string().trim().min(10, 'Enter a valid license key').max(64) }), req.body);
  const status = await license.activateLicense(licenseKey);
  logAudit({ userId: req.user?.userId, action: 'LICENSE_ACTIVATED', entityType: 'LICENSE', details: { plan: status.license?.plan.code } });
  res.status(201).json(status);
})];

export const deactivate = [ownerOrFirstRun, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const status = await license.deactivateInstallation();
  logAudit({ userId: req.user?.userId, action: 'LICENSE_DEACTIVATED', entityType: 'LICENSE' });
  res.json(status);
})];

export const sync = asyncHandler(async (req: Request, res: Response) => {
  const status = await license.syncLicense('manual');
  license.syncUsage().catch(() => undefined);
  res.json(status);
});

/** Usage events for features that run in the UI/desktop shell (e.g. PDF export). */
export function trackUsage(req: Request, res: Response): void {
  const { feature } = parse(z.object({ feature: z.enum(FEATURE_KEYS) }), req.body);
  const status = license.computeStatus();
  if (status.enforced && !status.features[feature]) {
    throw new HttpError(403, 'FEATURE_DISABLED', 'This feature is not enabled for your license');
  }
  license.recordUsage(feature);
  res.json({ ok: true });
}

export function getUsage(req: Request, res: Response): void {
  res.json({ data: license.getUsageSummary() });
}
