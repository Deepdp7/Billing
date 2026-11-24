/** A shop's own look on its bills (see server/src/services/brandingService.ts) */
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
  /** Stamp-pad ink (#rrggbb), or "original" to print an uploaded picture in its own colours */
  stampInk: string;
  /** Round seal: round the top (empty = business name), round the bottom (empty = city, state), the middle word */
  stampTop: string;
  stampBottom: string;
  stampCenter: string;
  /** The bill's date in the middle of the seal */
  stampDate: boolean;
  /** Beside the signature, or large and faint across the bill */
  stampPlace: 'signature' | 'watermark';
  /** Ink strength 20..100 (%) */
  stampStrength: number;
  stampSize: 's' | 'm' | 'l';
  stampOnReceipt: boolean;
}

export const DEFAULT_BRANDING: Branding = {
  logo: null, color: '#059669', tagline: '', website: '', signature: null, stamp: null, upiId: '', upiPayee: '', showUpiQr: true,
  bankName: '', bankAccountName: '', bankAccountNumber: '', bankIfsc: '', bankBranch: '', showBank: true, logoOnReceipt: true,
  stampMode: 'off', stampInk: '#1e3a8a', stampTop: '', stampBottom: '', stampCenter: 'AUTHORISED', stampDate: false,
  stampPlace: 'signature', stampStrength: 85, stampSize: 'm', stampOnReceipt: true,
};

/** Stamp-pad inks, as a shop knows them */
export const STAMP_INKS: Array<{ ink: string; name: string }> = [
  { ink: '#1e3a8a', name: 'Blue' }, { ink: '#b91c1c', name: 'Red' }, { ink: '#166534', name: 'Green' },
  { ink: '#6d28d9', name: 'Violet' }, { ink: '#111827', name: 'Black' },
];

/** Words often put in the middle of a seal */
export const STAMP_WORDS = ['AUTHORISED', 'PAID', 'RECEIVED', 'ORIGINAL', 'VERIFIED'];

/** Colours a shop can pick with one click (the custom picker allows any other) */
export const BRAND_COLORS = ['#059669', '#0d9488', '#0284c7', '#2563eb', '#4f46e5', '#7c3aed', '#c026d3', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#334155'];

/** A darker shade of the brand colour for text on white (amount 0..1) */
export function shade(hex: string, amount = 0.2): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.round(v * (1 - amount)));
  return `#${[f(n >> 16), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** UPI "scan to pay" link: any UPI app opens it with the shop, the amount and the bill number filled in */
export function upiLink(b: Pick<Branding, 'upiId' | 'upiPayee'>, payeeFallback: string, amountPaise: number, billNumber: string): string {
  const params = new URLSearchParams({ pa: b.upiId, pn: (b.upiPayee || payeeFallback || 'Shop').slice(0, 50), am: (amountPaise / 100).toFixed(2), cu: 'INR', tn: `Bill ${billNumber}`.slice(0, 50) });
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
}

const MAX_BYTES = 12 * 1024 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This file is not a picture the app can read. Use PNG, JPG, WebP or SVG.')); };
    img.src = url;
  });
}

/**
 * A picture the shop picked, made ready to store: scaled to fit maxW × maxH (never enlarged) and saved as WebP, which
 * keeps transparent backgrounds and stays small (a logo is typically 20–80 KB). `clearWhite` turns a white or
 * light-grey background transparent: a signature or stamp photographed on white paper then sits cleanly on the bill.
 */
export async function preparePicture(file: File, maxW: number, maxH: number, clearWhite = false): Promise<string> {
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|svg|gif|bmp)$/i.test(file.name)) throw new Error('Pick a picture: PNG, JPG, WebP or SVG.');
  if (file.size > MAX_BYTES) throw new Error('This picture is larger than 12 MB. Pick a smaller one.');
  const img = await loadImage(file);
  // SVGs without a size report 0: draw them at the largest allowed size
  const w0 = img.naturalWidth || maxW;
  const h0 = img.naturalHeight || maxH;
  const scale = Math.min(1, maxW / w0, maxH / h0);
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  if (clearWhite) {
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const light = Math.min(px[i], px[i + 1], px[i + 2]);
      // Paper (light) disappears; ink keeps its colour, with a soft edge in between
      if (light >= 225) px[i + 3] = 0;
      else if (light >= 170) px[i + 3] = Math.round(px[i + 3] * ((225 - light) / 55));
    }
    ctx.putImageData(data, 0, 0);
  }
  let out = canvas.toDataURL('image/webp', 0.92);
  if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/png');
  if (out.length > 780_000) out = canvas.toDataURL('image/webp', 0.75);
  if (out.length > 780_000) throw new Error('This picture is too detailed to store. Try a simpler or smaller one.');
  return out;
}
