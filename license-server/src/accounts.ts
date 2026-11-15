import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { knex, nowIso } from './db.js';
import { getSettings } from './entitlements.js';
import { HttpError } from './lib.js';
import { pushRefresh } from './realtime.js';

/**
 * Shop sign-in accounts (the email and password a shop signs in to the billing app with), kept so the vendor can see
 * and change them, plus the email codes for "Forgot password". Passwords are stored encrypted (AES-256-GCM) with a key
 * derived from the server's signing key, never in plain text, and are shown only to an owner (audit-logged).
 */

let secretKey: Buffer | null = null;
function key(): Buffer {
  if (!secretKey) secretKey = Buffer.from(crypto.hkdfSync('sha256', config.signingKeyPem, 'apna-billing', 'stored-secrets/v1', 32));
  return secretKey;
}

export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed || !sealed.startsWith('v1:')) return null;
  try {
    const raw = Buffer.from(sealed.slice(3), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export type PasswordSource = 'SIGNUP' | 'LOGIN' | 'SHOP' | 'RESET' | 'ADMIN';

/** What the Admin Panel shows about a customer's sign-in (never the password itself) */
export function accountSummary(c: any) {
  return {
    email: c.app_email || null,
    hasPassword: !!c.app_password_enc,
    passwordAt: c.app_password_at || null,
    passwordBy: c.app_password_by || null,
    rev: Number(c.app_account_rev || 0),
  };
}

/** Removes the stored sign-in from a customer row before it is sent to the Admin Panel */
export function publicCustomer<T extends Record<string, any>>(c: T) {
  const { app_password_enc, ...rest } = c;
  return { ...rest, app_password_set: !!app_password_enc };
}

/** A change every computer of the customer takes over at its next licence check (pushed at once to those online) */
export async function changeAccount(customerId: string, change: { email?: string; password?: string; by: PasswordSource }) {
  const customer = await knex('customers').where({ id: customerId }).first();
  if (!customer) throw new HttpError(404, 'NOT_FOUND', 'Customer not found');
  const patch: Record<string, unknown> = { app_account_rev: Number(customer.app_account_rev || 0) + 1, updated_at: nowIso() };
  if (change.email) patch.app_email = change.email;
  if (change.password) {
    patch.app_password_enc = sealSecret(change.password);
    patch.app_password_at = nowIso();
    patch.app_password_by = change.by;
  }
  await knex('customers').where({ id: customerId }).update(patch);
  return (await pushRefresh({ scope: 'CUSTOMER', id: customerId }, 'ACCOUNT_CHANGED')) > 0;
}

// ---------------- Email (password-reset codes) ----------------

export const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_from'];

/** Settings → Email in the Admin Panel; SMTP_* environment variables are the fallback */
async function mailSettings() {
  const s = await getSettings();
  const host = s.smtp_host || process.env.SMTP_HOST || '';
  const user = s.smtp_user || process.env.SMTP_USER || '';
  const pass = openSecret(s.smtp_pass_enc) || process.env.SMTP_PASS || '';
  const port = Number(s.smtp_port || process.env.SMTP_PORT || 587);
  const secure = (s.smtp_secure || process.env.SMTP_SECURE || (port === 465 ? '1' : '0')) === '1';
  const from = s.smtp_from || process.env.SMTP_FROM || user;
  return { host, user, pass, port, secure, from };
}

export async function emailConfigured(): Promise<boolean> {
  const m = await mailSettings();
  return !!(m.host && m.from);
}

/** Tests only: with the mail server set to "test-outbox", emails are kept here instead of being sent */
export const testOutbox: Array<{ to: string; subject: string; text: string }> = [];

export async function sendMail(to: string, subject: string, text: string, html: string) {
  const m = await mailSettings();
  if (!m.host || !m.from) {
    throw new HttpError(503, 'EMAIL_NOT_SET_UP', 'Email is not set up on the server yet. Contact Apna Billing support.');
  }
  if (m.host === 'test-outbox' && process.env.NODE_ENV === 'test') {
    testOutbox.push({ to, subject, text });
    return;
  }
  const transport = nodemailer.createTransport({
    host: m.host, port: m.port, secure: m.secure, auth: m.user ? { user: m.user, pass: m.pass } : undefined,
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000,
  });
  try {
    await transport.sendMail({ from: m.from.includes('<') ? m.from : `"Apna Billing" <${m.from}>`, to, subject, text, html });
  } catch (err: any) {
    console.error('[mail] sending failed:', err?.message || err);
    throw new HttpError(502, 'EMAIL_FAILED', `The email could not be sent (${String(err?.message || 'mail server error').slice(0, 160)}).`);
  }
}

export function codeEmail(code: string, businessName: string | null) {
  const text = `Your Apna Billing password reset code is ${code}.\n\nIt is valid for 10 minutes. If you did not ask to reset your password, ignore this email: your password stays the same.`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:460px;margin:auto;padding:24px;color:#0f172a">
  <div style="font-size:20px;font-weight:700;color:#059669">Apna Billing</div>
  <p style="font-size:15px">Use this code to reset the password${businessName ? ` of <b>${escapeHtml(businessName)}</b>` : ''}:</p>
  <div style="font-size:34px;font-weight:700;letter-spacing:8px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:14px 0;text-align:center">${code}</div>
  <p style="font-size:13px;color:#64748b">It is valid for 10 minutes. If you did not ask to reset your password, ignore this email: your password stays the same.</p>
</div>`;
  return { text, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
