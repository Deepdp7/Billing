import { ShoppingCart, Pill, Shirt, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { LOGIN_MEDIA_FILES } from './loginMedia.generated.js';

/**
 * The sign-in screen's background story: one 8-second clip per kind of shop (made by scripts/encode-login-videos.mjs
 * from the owner's own videos), each with its words. The files are listed in loginMedia.generated.ts and shipped as
 * plain files next to the engine (served at /login-media/, see server/src/app.ts).
 */
export interface LoginClip {
  id: string;
  category: string;
  Icon: LucideIcon;
  headline: string;
  subline: string;
  video1080: string;
  video720: string;
  poster: string;
}

const WORDS: Record<string, Pick<LoginClip, 'category' | 'Icon' | 'headline' | 'subline'>> = {
  grocery: {
    category: 'Grocery', Icon: ShoppingCart,
    headline: 'Bill in seconds.', subline: 'Scan, total and print, even when the internet is down.',
  },
  pharmacy: {
    category: 'Pharmacy', Icon: Pill,
    headline: 'Every batch. Every expiry.', subline: 'Stock that counts itself, with alerts before medicines expire.',
  },
  clothing: {
    category: 'Clothing', Icon: Shirt,
    headline: 'Every size, every colour.', subline: 'All your counters show the same stock, live.',
  },
  restaurant: {
    category: 'Restaurant', Icon: UtensilsCrossed,
    headline: 'Table to KOT to bill.', subline: 'GST invoices done right, UPI paid in one scan.',
  },
};

/** Where the engine serves the files from */
export const LOGIN_MEDIA_URL = '/login-media/';

export const LOGIN_CLIPS: LoginClip[] = LOGIN_MEDIA_FILES.flatMap((f) => (WORDS[f.id] ? [{ ...f, ...WORDS[f.id] }] : []));

/** Shown when there are no clips at all (the screen then has just its dark background) */
export const FALLBACK_WORDS = { headline: 'Bill in seconds.', subline: 'GST billing, stock and payments for your shop, on every counter.' };
