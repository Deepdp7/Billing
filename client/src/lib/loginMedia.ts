import { ShoppingCart, Pill, Shirt, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { LOGIN_MEDIA } from './loginMedia.generated.js';

/**
 * The sign-in screen's background: one clip per kind of shop (made by scripts/encode-login-videos.mjs from the owner's
 * own clips, with the PLRMS sign-in settings), each with its words and a poster. The files are listed in
 * loginMedia.generated.ts and served at /login-media/ (see server/src/app.ts; in the installed app they are encrypted
 * there).
 */
export interface LoginClip {
  id: string;
  category: string;
  Icon: LucideIcon;
  headline: string;
  subline: string;
  /** The clip (1080p, 24 fps, exactly LOGIN_TIMING.clipMs long) */
  video: string;
  /** Its first picture */
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
 * The timing, as on the PLRMS sign-in page: every clip is exactly clipMs long and plays once; the next one fades in over
 * fadeMs, so the next shot is already moving while this one ends (nothing loops). The fade starts SPARE_MS earlier
 * than it strictly has to: on a slow computer the next clip can take a moment to start, and the one going out must
 * still be moving (not standing on its last frame) until it has faded away. Each shop is on screen for showMs.
 */
const SPARE_MS = 500;
export const LOGIN_TIMING = {
  clipMs: LOGIN_MEDIA.clipMs,
  fadeMs: LOGIN_MEDIA.fadeMs,
  showMs: LOGIN_MEDIA.clipMs - LOGIN_MEDIA.fadeMs - SPARE_MS,
};

/** Shown when there are no clips at all (the screen then has just its dark background) */
export const FALLBACK_WORDS = { headline: 'Bill in seconds.', subline: 'GST billing, stock and payments for your shop, on every counter.' };
