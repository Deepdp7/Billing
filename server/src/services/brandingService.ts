import { z } from 'zod';
import { db } from '../db/connection.js';

/**
 * A shop's own look on its bills and in the app: logo (businesses.logo_url), brand colour, tagline, signature and stamp,
 * UPI "scan to pay" and bank details. Kept per business in app_settings (keys "brand.*"), so it is backed up with the
 * shop and reaches its other computers like any other change.
 */
export interface Branding {
  logo: string | null;
  color: string;
  tagline: string;
  website: string;
  signature: string | null;
  stamp: string | null;
  upiId: string;
  upiPayee: string;
  showUpiQr: boolean;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankBranch: string;
  showBank: boolean;
  logoOnReceipt: boolean;
  /** The stamp on bills: none, a round seal drawn by the app, or the shop's own stamp picture */
  stampMode: 'off' | 'seal' | 'image';
  /** Stamp-pad ink colour (#rrggbb), or "original" to print an uploaded picture in its own colours */
  stampInk: string;
  /** Round seal: the text round the top (empty = the business name) and the bottom (empty = city, state) */
  stampTop: string;
  stampBottom: string;
  /** Round seal: the word in the middle (AUTHORISED, PAID, RECEIVED...) */
  stampCenter: string;
  /** The bill's date in the middle of the seal */
  stampDate: boolean;
  /** Beside the signature, or large and faint across the bill (a watermark) */
  stampPlace: 'signature' | 'watermark';
  /** How strong the ink is, 20..100 (%) */
  stampStrength: number;
  stampSize: 's' | 'm' | 'l';
  stampOnReceipt: boolean;
}

type Stored = Omit<Branding, 'logo'>;

const DEFAULTS: Record<keyof Stored, string> = {
  color: '#059669',
  tagline: '',
  website: '',
  signature: '',
  stamp: '',
  upiId: '',
  upiPayee: '',
  showUpiQr: '1',
  bankName: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankIfsc: '',
  bankBranch: '',
  showBank: '1',
  logoOnReceipt: '1',
  // empty: a shop that uploaded a stamp picture before these settings existed keeps it; otherwise no stamp
  stampMode: '',
  stampInk: '#1e3a8a',
  stampTop: '',
  stampBottom: '',
  stampCenter: 'AUTHORISED',
  stampDate: '0',
  stampPlace: 'signature',
  stampStrength: '85',
  stampSize: 'm',
  stampOnReceipt: '1',
};
const BOOLS = new Set(['showUpiQr', 'showBank', 'logoOnReceipt', 'stampDate', 'stampOnReceipt']);
const NUMBERS = new Set(['stampStrength']);
const IMAGES = new Set(['signature', 'stamp']);

/** A picture sent by the app (already resized there): PNG, JPEG or WebP as a data URL, at most ~600 KB */
const image = z.string().max(800_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, 'Use a PNG, JPG or WebP picture')
  .or(z.literal('')).nullable();
const text = (max: number) => z.string().trim().max(max);

export const brandingSchema = z.object({
  logo: image.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour').optional(),
  tagline: text(120).optional(),
  website: text(120).optional(),
  signature: image.optional(),
  stamp: image.optional(),
  upiId: text(100).refine((v) => !v || /^[\w.-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/.test(v), 'A UPI ID looks like shopname@okaxis').optional(),
  upiPayee: text(80).optional(),
  showUpiQr: z.boolean().optional(),
  bankName: text(80).optional(),
  bankAccountName: text(100).optional(),
  bankAccountNumber: text(30).refine((v) => !v || /^[0-9A-Za-z-]{6,30}$/.test(v), 'Account number: digits only').optional(),
  bankIfsc: text(11).transform((v) => v.toUpperCase()).refine((v) => !v || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), 'An IFSC looks like SBIN0001234').optional(),
  bankBranch: text(100).optional(),
  showBank: z.boolean().optional(),
  logoOnReceipt: z.boolean().optional(),
  stampMode: z.enum(['off', 'seal', 'image']).optional(),
  stampInk: z.string().regex(/^(#[0-9a-fA-F]{6}|original)$/, 'Pick an ink colour').optional(),
  stampTop: text(40).optional(),
  stampBottom: text(40).optional(),
  stampCenter: text(16).optional(),
  stampDate: z.boolean().optional(),
  stampPlace: z.enum(['signature', 'watermark']).optional(),
  stampStrength: z.coerce.number().int().min(20, 'Strength is 20 to 100').max(100, 'Strength is 20 to 100').optional(),
  stampSize: z.enum(['s', 'm', 'l']).optional(),
  stampOnReceipt: z.boolean().optional(),
});

export function getBranding(businessId: string): Branding {
  const rows = db.prepare("SELECT key, value FROM app_settings WHERE business_id = ? AND key LIKE 'brand.%'").all(businessId) as Array<{ key: string; value: string }>;
  const map: Record<string, string> = { ...DEFAULTS };
  for (const r of rows) {
    const k = r.key.slice(6);
    if (k in DEFAULTS) map[k] = r.value;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULTS)) {
    out[k] = BOOLS.has(k) ? map[k] === '1' : IMAGES.has(k) ? map[k] || null : NUMBERS.has(k) ? Number(map[k]) || Number(DEFAULTS[k as keyof Stored]) : map[k];
  }
  // Not chosen yet: an uploaded stamp picture is shown as before, otherwise no stamp
  if (!out.stampMode) out.stampMode = out.stamp ? 'image' : 'off';
  // A picture mode without a picture shows nothing (the seal needs no picture)
  if (out.stampMode === 'image' && !out.stamp) out.stampMode = 'off';
  const biz = db.prepare('SELECT logo_url FROM businesses WHERE id = ?').get(businessId) as { logo_url: string | null } | undefined;
  return { ...(out as unknown as Stored), logo: biz?.logo_url || null };
}

/** Saves what was sent (an empty picture removes it). Returns the names of what changed, for the audit log. */
export function updateBranding(businessId: string, input: z.infer<typeof brandingSchema>): string[] {
  const changed: string[] = [];
  const upsert = db.prepare(`
    INSERT INTO app_settings (business_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    WHERE app_settings.value IS NOT excluded.value
  `);
  db.transaction(() => {
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      if (key === 'logo') {
        const r = db.prepare("UPDATE businesses SET logo_url = ?, updated_at = datetime('now') WHERE id = ? AND logo_url IS NOT ?")
          .run(value || null, businessId, value || null);
        if (r.changes) changed.push(key);
        continue;
      }
      if (!(key in DEFAULTS)) continue;
      const stored = BOOLS.has(key) ? (value ? '1' : '0') : String(value ?? '');
      if (upsert.run(businessId, `brand.${key}`, stored).changes) changed.push(key);
    }
  })();
  return changed;
}
