import path from 'path';
import sea from 'node:sea';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { runtimeOptions } from '../config/runtime.js';

/**
 * Inside the sealed engine the built client is embedded in the executable (Node single-executable assets, listed in
 * the "client/manifest.json" asset by tauri/scripts/prepare.cjs) instead of lying in the install folder.
 * Returns URL path -> file contents, or null when running from source.
 */
function embeddedClientFiles(): Map<string, Buffer> | null {
  if (!runtimeOptions().sealed || !sea.isSea()) return null;
  const files = new Map<string, Buffer>();
  const list = JSON.parse(sea.getAsset('client/manifest.json', 'utf8') as string) as string[];
  for (const urlPath of list) files.set(urlPath, Buffer.from(sea.getAsset(`client${urlPath}`) as ArrayBuffer));
  return files;
}

/** Same behaviour as express.static + index.html fallback for the client served from disk. */
export function embeddedClientHandler(): RequestHandler | null {
  const files = embeddedClientFiles();
  const index = files?.get('/index.html');
  if (!files || !index) return null;
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let urlPath: string;
    try {
      urlPath = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    const file = files.get(urlPath);
    if (file) {
      res.type(path.extname(urlPath));
      res.setHeader('Cache-Control', urlPath === '/index.html' ? 'public, max-age=0' : 'public, max-age=3600');
      res.send(file);
      return;
    }
    res.type('html');
    res.setHeader('Cache-Control', 'public, max-age=0');
    res.send(index);
  };
}
