import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AuthTokenPayload, UserRole } from '../types/index.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthTokenPayload;
  businessId?: string;
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication token required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthTokenPayload;
    req.user = decoded;
    if (decoded.businessId) {
      req.businessId = decoded.businessId;
    }
    next();
  } catch (err) {
    res.status(401).json({ code: 'INVALID_TOKEN', message: 'Token is invalid or expired' });
    return;
  }
}

export function requireTenant(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    return;
  }

  if (req.user.role === 'SUPER_ADMIN') {
    // If admin is inspecting a specific business via header or query param
    const overrideBiz = (req.headers['x-business-id'] as string) || (req.query.businessId as string);
    if (overrideBiz) {
      req.businessId = overrideBiz;
    }
    next();
    return;
  }

  if (!req.user.businessId) {
    res.status(403).json({ code: 'TENANT_REQUIRED', message: 'Business tenancy context required' });
    return;
  }

  req.businessId = req.user.businessId;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      });
      return;
    }
    next();
  };
}
