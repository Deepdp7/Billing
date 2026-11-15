import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { knex, nowIso, bool } from '../db.js';
import { ah, parse, HttpError, audit, verifyTotp } from '../lib.js';
import { config } from '../config.js';
import { getSettings, setSetting, versionLt } from '../entitlements.js';
import { pushRefresh, isConnected } from '../realtime.js';
import { verifyUpdateSignature } from '../updateSignature.js';

/**
 * Admin Panel → "App Updates": upload a signed desktop installer, then publish it to every client.
 * Files live in UPDATES_DIR (/home/apna-billing/updates on the VPS) and are served at /updates/.
 * Publishing writes latest.json (read by the app's updater) and pushes "update available" to every open app.
 * Every change that reaches clients asks for the admin's password again (and the 2FA code when enabled).
 */

type Guard = (req: Request, res: Response, next: NextFunction) => void;
const VERSION = /^\d+\.\d+\.\d+$/;
const fileFor = (version: string) => `ApnaBilling-${version}-setup.exe`;
const latestFile = () => path.join(config.updatesDir, 'latest.json');
const pausedFile = () => path.join(config.updatesDir, 'latest.json.paused');

function publicKey(): string {
  try { return fs.readFileSync(config.updaterPublicKeyFile, 'utf8').trim(); } catch { return ''; }
}

// 400, not 401: a mistyped password must not sign the admin out of the panel.
async function confirmPassword(req: any, password: string, totp?: string) {
  const a = await knex('admin_users').where({ id: req.admin.id }).first();
  if (!a || !bcrypt.compareSync(password || '', a.password_hash)) throw new HttpError(400, 'PASSWORD_INCORRECT', 'Password is incorrect');
  if (bool(a.totp_enabled) && !verifyTotp(a.totp_secret, totp || '')) throw new HttpError(400, 'TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator app');
}

function writeAtomic(file: string, data: string) {
  fs.writeFileSync(`${file}.tmp`, data);
  fs.renameSync(`${file}.tmp`, file);
}

function publicBase(req: Request): string {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

/** The first time the page opens, adopt a release published earlier by the command-line tool. */
async function adoptExistingRelease() {
  if ((await knex('app_releases').count({ c: '*' }))[0].c as any > 0) return;
  const file = fs.existsSync(latestFile()) ? latestFile() : fs.existsSync(pausedFile()) ? pausedFile() : '';
  if (!file) return;
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const p = m.platforms?.['windows-x86_64'];
    const name = path.basename(new URL(p.url).pathname);
    const local = path.join(config.updatesDir, name);
    if (!VERSION.test(m.version) || !fs.existsSync(local)) return;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex');
    await knex('app_releases').insert({
      id: crypto.randomUUID(), version: m.version, file_name: name, size_bytes: fs.statSync(local).size, sha256: hash,
      signature: p.signature, notes: m.notes || null, status: 'PUBLISHED', uploaded_by: 'release tool',
      uploaded_at: m.pub_date || nowIso(), published_at: m.pub_date || nowIso(),
    });
  } catch { /* not a manifest we understand; ignore */ }
}

export function registerUpdateRoutes(router: Router, requireRole: (min: 'OWNER' | 'ADMIN' | 'SUPPORT' | 'VIEWER') => Guard) {
  router.get('/app-updates', ah(async (_req: Request, res: Response) => {
    fs.mkdirSync(config.updatesDir, { recursive: true });
    await adoptExistingRelease();
    const settings = await getSettings();
    const releases = await knex('app_releases').orderBy('uploaded_at', 'desc');
    const installs = await knex('installations').whereNot('status', 'DEACTIVATED').select('id', 'app_version');
    const byVersion = new Map<string, { version: string; devices: number; online: number }>();
    for (const i of installs) {
      const v = i.app_version || 'unknown';
      const row = byVersion.get(v) || { version: v, devices: 0, online: 0 };
      row.devices += 1;
      if (isConnected(i.id)) row.online += 1;
      byVersion.set(v, row);
    }
    res.json({
      live: {
        version: settings.latest_version || null,
        paused: !settings.latest_version && fs.existsSync(pausedFile()),
        required: !!settings.latest_version && !!settings.min_supported_version && !versionLt(settings.min_supported_version, settings.latest_version),
        minSupported: settings.min_supported_version || null,
        message: settings.update_message || '',
      },
      signingKeyConfigured: !!publicKey(),
      updatesDir: config.updatesDir,
      releases: releases.map((r: any) => ({ ...r, size_bytes: Number(r.size_bytes) })),
      versions: [...byVersion.values()].sort((a, b) => (versionLt(a.version, b.version) ? 1 : -1)),
    });
  }));

  /** Upload: raw .exe body; X-Release-Version and X-Release-Signature (contents of the .sig file) headers. */
  router.post('/app-updates/upload', requireRole('OWNER'), ah(async (req: any, res: Response) => {
    const version = String(req.headers['x-release-version'] || '').trim();
    const signature = String(req.headers['x-release-signature'] || '').trim();
    if (!VERSION.test(version)) throw new HttpError(400, 'BAD_VERSION', 'Version must look like 1.2.3');
    if (!signature) throw new HttpError(400, 'SIGNATURE_REQUIRED', 'Choose the .sig file that was built next to the installer');
    const key = publicKey();
    if (!key) throw new HttpError(500, 'NO_UPDATE_KEY', 'The server has no update public key yet. Run "npm run deploy:server" once from your PC.');
    const existing = await knex('app_releases').where({ version }).first();
    if (existing && existing.status !== 'UPLOADED') throw new HttpError(409, 'VERSION_EXISTS', `Version ${version} was already published. Build a newer version.`);

    fs.mkdirSync(config.updatesDir, { recursive: true });
    const tmp = path.join(config.updatesDir, `.upload-${crypto.randomUUID()}.part`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(tmp);
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > config.maxUploadBytes) { req.destroy(); out.destroy(); reject(new HttpError(413, 'TOO_LARGE', 'Installer is too large')); return; }
          hash.update(chunk);
        });
        req.on('error', reject);
        out.on('error', reject);
        out.on('finish', () => resolve());
        req.pipe(out);
      });
      if (size < 1024) throw new HttpError(400, 'EMPTY', 'That file is empty or not an installer');
      const head = Buffer.alloc(2);
      const fd = fs.openSync(tmp, 'r'); fs.readSync(fd, head, 0, 2, 0); fs.closeSync(fd);
      if (head.toString() !== 'MZ') throw new HttpError(400, 'NOT_EXE', 'That file is not a Windows installer (.exe)');
      const check = await verifyUpdateSignature(tmp, signature, key);
      if (!check.ok) throw new HttpError(400, 'BAD_SIGNATURE', `Signature check failed: ${check.reason}. Pick the .exe and the .sig from the same build (releases folder).`);
      const name = fileFor(version);
      fs.renameSync(tmp, path.join(config.updatesDir, name));
      const row = { file_name: name, size_bytes: size, sha256: hash.digest('hex'), signature, uploaded_by: req.admin.email, uploaded_at: nowIso(), status: 'UPLOADED' };
      if (existing) await knex('app_releases').where({ id: existing.id }).update(row);
      else await knex('app_releases').insert({ id: crypto.randomUUID(), version, ...row });
      await audit(req, 'APP_RELEASE_UPLOADED', 'APP_RELEASE', version, { size, file: name });
      res.status(201).json({ release: await knex('app_releases').where({ version }).first() });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }));

  const confirmSchema = z.object({ password: z.string().min(1, 'Enter your password'), totp: z.string().optional() });

  router.post('/app-updates/:id/publish', requireRole('OWNER'), ah(async (req: any, res: Response) => {
    const input = parse(confirmSchema.extend({ notes: z.string().trim().max(500).optional(), required: z.boolean().default(false) }), req.body);
    await confirmPassword(req, input.password, input.totp);
    const rel = await knex('app_releases').where({ id: req.params.id }).first();
    if (!rel) throw new HttpError(404, 'NOT_FOUND', 'Release not found');
    const newest = (await knex('app_releases').whereIn('status', ['PUBLISHED', 'SUPERSEDED']).whereNot({ id: rel.id }).select('version'))
      .map((r: any) => r.version).reduce((a: string, v: string) => (versionLt(a, v) ? v : a), '0.0.0');
    if (!versionLt(newest, rel.version)) throw new HttpError(409, 'NOT_NEWER', `Apps only install versions newer than ${newest}. Build a higher version number.`);
    if (!fs.existsSync(path.join(config.updatesDir, rel.file_name))) throw new HttpError(409, 'FILE_MISSING', 'The installer file is missing on the server. Upload it again.');

    const notes = input.notes || rel.notes || `Apna Billing ${rel.version}`;
    const url = `${publicBase(req)}/updates/${rel.file_name}`;
    writeAtomic(latestFile(), JSON.stringify({
      version: rel.version, notes, pub_date: nowIso().replace(/\.\d{3}Z$/, 'Z'),
      platforms: { 'windows-x86_64': { signature: rel.signature, url } },
    }, null, 2));
    fs.rmSync(pausedFile(), { force: true });
    await setSetting('latest_version', rel.version);
    await setSetting('update_url', url);
    await setSetting('update_message', notes);
    if (input.required) await setSetting('min_supported_version', rel.version);
    await knex('app_releases').where({ status: 'PUBLISHED' }).update({ status: 'SUPERSEDED' });
    await knex('app_releases').where({ id: rel.id }).update({ status: 'PUBLISHED', notes, published_at: nowIso() });
    await audit(req, 'APP_RELEASE_PUBLISHED', 'APP_RELEASE', rel.version, { required: input.required, notes });
    const reached = await pushRefresh({ scope: 'ALL' }, 'UPDATE_PUBLISHED');
    res.json({ ok: true, version: rel.version, required: input.required, openAppsNotified: reached });
  }));

  router.post('/app-updates/required', requireRole('OWNER'), ah(async (req: any, res: Response) => {
    const input = parse(confirmSchema.extend({ required: z.boolean() }), req.body);
    await confirmPassword(req, input.password, input.totp);
    const settings = await getSettings();
    if (!settings.latest_version) throw new HttpError(409, 'NOTHING_LIVE', 'No update is live right now');
    await setSetting('min_supported_version', input.required ? settings.latest_version : '0.0.0');
    await audit(req, input.required ? 'APP_RELEASE_REQUIRED' : 'APP_RELEASE_OPTIONAL', 'APP_RELEASE', settings.latest_version);
    const reached = await pushRefresh({ scope: 'ALL' }, 'UPDATE_POLICY');
    res.json({ ok: true, openAppsNotified: reached });
  }));

  router.post('/app-updates/pause', requireRole('OWNER'), ah(async (req: any, res: Response) => {
    const input = parse(confirmSchema, req.body);
    await confirmPassword(req, input.password, input.totp);
    if (fs.existsSync(latestFile())) fs.renameSync(latestFile(), pausedFile());
    const settings = await getSettings();
    await setSetting('latest_version', '');
    await audit(req, 'APP_RELEASE_PAUSED', 'APP_RELEASE', settings.latest_version || null);
    const reached = await pushRefresh({ scope: 'ALL' }, 'UPDATE_PAUSED');
    res.json({ ok: true, openAppsNotified: reached });
  }));

  router.post('/app-updates/resume', requireRole('OWNER'), ah(async (req: any, res: Response) => {
    const input = parse(confirmSchema, req.body);
    await confirmPassword(req, input.password, input.totp);
    if (!fs.existsSync(pausedFile())) throw new HttpError(409, 'NOT_PAUSED', 'No paused update to resume');
    const m = JSON.parse(fs.readFileSync(pausedFile(), 'utf8'));
    fs.renameSync(pausedFile(), latestFile());
    await setSetting('latest_version', m.version);
    await audit(req, 'APP_RELEASE_RESUMED', 'APP_RELEASE', m.version);
    const reached = await pushRefresh({ scope: 'ALL' }, 'UPDATE_PUBLISHED');
    res.json({ ok: true, openAppsNotified: reached });
  }));

  router.post('/app-updates/:id/delete', requireRole('OWNER'), ah(async (req: any, res: Response) => {
    const input = parse(confirmSchema, req.body);
    await confirmPassword(req, input.password, input.totp);
    const rel = await knex('app_releases').where({ id: req.params.id }).first();
    if (!rel) throw new HttpError(404, 'NOT_FOUND', 'Release not found');
    if (rel.status === 'PUBLISHED') throw new HttpError(409, 'IS_LIVE', 'This version is live. Publish a newer one (or pause) before deleting it.');
    fs.rmSync(path.join(config.updatesDir, rel.file_name), { force: true });
    await knex('app_releases').where({ id: rel.id }).delete();
    await audit(req, 'APP_RELEASE_DELETED', 'APP_RELEASE', rel.version);
    res.json({ ok: true });
  }));
}
