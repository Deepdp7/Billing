import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodError, ZodTypeAny } from 'zod';

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', message, details);
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

/** Validate `data` against a zod schema, throwing a 400 with field-level messages on failure. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = issues[0];
    throw new HttpError(400, 'VALIDATION_ERROR', first ? `${first.path || 'request'}: ${first.message}` : 'Invalid request', issues);
  }
  return result.data;
}

/** Wrap async handlers so rejected promises reach the Express error handler. */
export const asyncHandler = (fn: (req: any, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

export function errorHandler(isDev: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      console.error('[Error]', err);
      if (!res.writableEnded) res.end();
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: err.issues[0]?.message || 'Invalid request', details: err.issues });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ code: 'INVALID_JSON', message: 'Request body is not valid JSON' });
      return;
    }
    if (typeof err?.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      res.status(409).json({ code: 'CONSTRAINT_VIOLATION', message: 'The change conflicts with existing data', details: isDev ? err.message : undefined });
      return;
    }
    console.error('[Error]', err);
    res.status(err?.status || 500).json({
      code: err?.code && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR',
      message: isDev ? (err?.message || 'An unexpected error occurred') : 'An unexpected error occurred',
      details: isDev ? err?.stack : undefined,
    });
  };
}
