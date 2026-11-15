import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { computeStatus, recordUsage } from './licenseClient.js';
import { featuresForRequest } from './features.js';

const USAGE_GET = /\/(export|stats)$|^\/reports\/|^\/accounting\/|^\/inventory\/valuation/;

/**
 * Enforces the signed license on every /api/v1/app request:
 *  - features disabled by the license server are refused (reads and writes);
 *  - when the license is not ACTIVE (expired, suspended, offline too long…) the app is read-only:
 *    customers can still view and back up their own data, but cannot create new records.
 * Also counts successful feature operations for usage analytics.
 */
export function licenseGuard(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const required = featuresForRequest(req.method, req.path);
  const status = computeStatus();
  const isRead = req.method === 'GET' || req.method === 'HEAD';

  if (status.enforced) {
    const blocked = required.filter((f) => !status.features[f]);
    // Without a verifiable token every feature reads as disabled; still allow reads so data stays accessible.
    if (blocked.length > 0 && status.license) {
      res.status(403).json({
        code: 'FEATURE_DISABLED',
        message: `This feature is not enabled for your license (${blocked.join(', ')}). Contact your provider to enable it.`,
        details: { features: blocked },
      });
      return;
    }
    if (!isRead && !status.canWrite) {
      res.status(402).json({ code: `LICENSE_${status.mode}`, message: status.message, details: { mode: status.mode } });
      return;
    }
  }

  if (required.length > 0 && (!isRead || USAGE_GET.test(req.path))) {
    res.on('finish', () => {
      if (res.statusCode < 400) for (const f of required) recordUsage(f);
    });
  }
  next();
}
