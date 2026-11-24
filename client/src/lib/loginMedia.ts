import { ShoppingCart, Pill, Shirt, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { LOGIN_MEDIA } from './loginMedia.generated.js';

/**
 * The sign-in screen's background: ONE looping video of the four kinds of shop one after another (each dissolving into
 * the next, the last into the first), made by scripts/encode-login-videos.mjs from the owner's own clips, and one poster
 * per shop. Each shop has its words. The files are listed in loginMedia.generated.ts and served at /login-media/ (see
 * server/src/app.ts; in the installed app they are encrypted there).
 */
export interface LoginClip {
  id: string;
  category: string;
  Icon: LucideIcon;
  headline: string;
  subline: string;
  /** The first clean picture of this shop's stretch of the video */
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

export const LOGIN_CLIPS: LoginClip[] = LOGIN_MEDIA.clips.flatMap((c) => (WORDS[c.id] ? [{ ...c, ...WORDS[c.id] }] : []));

/**
 * The video's layout in time: it starts in the middle of the dissolve from the last shop into the first, and shop k has
 * the screen from k * segment to (k + 1) * segment seconds (its dissolve into the next shop is centred on the boundary).
 */
export const LOGIN_VIDEO = {
  file: LOGIN_MEDIA.video,
  segment: LOGIN_MEDIA.segmentSeconds,
  overlap: LOGIN_MEDIA.overlapSeconds,
  duration: LOGIN_MEDIA.durationSeconds,
};

/** Shown when there are no clips at all (the screen then has just its dark background) */
export const FALLBACK_WORDS = { headline: 'Bill in seconds.', subline: 'GST billing, stock and payments for your shop, on every counter.' };
