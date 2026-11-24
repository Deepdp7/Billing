import React, { useId } from 'react';
import type { Branding } from '../../lib/branding.js';

/**
 * The shop's stamp as it looks on paper: either a round seal the app draws (double ring, the business name round the
 * top, the place round the bottom, a word and optionally the date in the middle) or the shop's own stamp picture,
 * pressed in stamp-pad ink. The impression is slightly tilted and uneven (as a rubber stamp never inks perfectly) and
 * multiplies with the paper like real ink, so text under it stays readable. Drawn as SVG: sharp on screen, in the PDF
 * and on any printer. `mono` prints it in black for receipt printers.
 */
export const DigitalStamp: React.FC<{
  brand: Branding;
  businessName: string;
  place?: string;
  /** The bill's date (shown when the seal is set to show it) */
  date?: string;
  /** Width and height in px */
  size: number;
  /** Ink strength 0..1 (already scaled for a watermark by the caller) */
  strength: number;
  rotate?: number;
  mono?: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({ brand, businessName, place, date, size, strength, rotate = -12, mono, className, style }) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ink = mono ? '#111111' : brand.stampInk === 'original' ? null : brand.stampInk;
  const keepColours = brand.stampMode === 'image' && !ink;
  // A receipt printer has only black dots: grey or speckled ink would come out as dither, so it gets solid black
  const outer: React.CSSProperties = {
    width: size, height: size, transform: `rotate(${rotate}deg)`, opacity: mono ? 1 : Math.max(0, Math.min(1, strength)),
    mixBlendMode: 'multiply', pointerEvents: 'none', ...style,
  };

  // An uneven, slightly worn impression: a few small patches get less ink, the edges wobble a hair
  const grain = mono ? null : (
    <filter id={`${uid}-ink`} x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="7" result="noise" />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.4" xChannelSelector="R" yChannelSelector="G" result="wobble" />
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 2.15" result="holes" />
      <feComposite in="wobble" in2="holes" operator="in" />
    </filter>
  );
  const inked = mono ? undefined : `url(#${uid}-ink)`;

  if (brand.stampMode === 'image') {
    if (!brand.stamp) return null;
    return (
      <svg viewBox="0 0 200 200" className={className} style={outer} aria-hidden="true">
        <defs>
          {grain}
          {/* the picture's dark parts become ink, its light parts paper (an already transparent picture keeps its shape) */}
          <filter id={`${uid}-tint`} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.30 -0.59 -0.11 0 1.15" result="dark" />
            <feComposite in="dark" in2="SourceAlpha" operator="arithmetic" k1="1" result="shape" />
            <feFlood floodColor={ink || '#000'} />
            <feComposite in2="shape" operator="in" />
          </filter>
        </defs>
        <g filter={inked}>
          <image href={brand.stamp} x="4" y="4" width="192" height="192" preserveAspectRatio="xMidYMid meet"
            filter={keepColours ? undefined : `url(#${uid}-tint)`} />
        </g>
      </svg>
    );
  }

  // ---- the round seal
  const top = (brand.stampTop || businessName || '').toUpperCase().slice(0, 40);
  const bottom = (brand.stampBottom || place || '').toUpperCase().slice(0, 40);
  const center = (brand.stampCenter || 'AUTHORISED').toUpperCase().slice(0, 16);
  // Round text gets smaller as it gets longer so it always fits half the ring
  const ringSize = (text: string) => Math.max(9, Math.min(17, 230 / Math.max(1, text.length * 0.78)));
  const centerSize = Math.max(11, Math.min(24, 120 / Math.max(1, center.length * 0.68)));
  const colour = ink || '#1e3a8a';
  return (
    <svg viewBox="0 0 200 200" className={className} style={outer} aria-hidden="true">
      <defs>
        {grain}
        {/* round the top, left to right; round the bottom, also left to right (so it reads the right way up) */}
        <path id={`${uid}-top`} d="M 30,100 A 70,70 0 0 1 170,100" />
        <path id={`${uid}-bottom`} d="M 28,100 A 72,72 0 0 0 172,100" />
      </defs>
      <g filter={inked} fill={colour} stroke={colour}>
        <circle cx="100" cy="100" r="95" fill="none" strokeWidth="4.5" />
        <circle cx="100" cy="100" r="88" fill="none" strokeWidth="1.4" />
        <circle cx="100" cy="100" r="55" fill="none" strokeWidth="1.8" />
        <text fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize={ringSize(top)} letterSpacing="1.2" stroke="none" textAnchor="middle">
          <textPath href={`#${uid}-top`} startOffset="50%">{top}</textPath>
        </text>
        {bottom && (
          <text fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize={Math.min(ringSize(bottom), 14)} letterSpacing="1" stroke="none" textAnchor="middle" dominantBaseline="hanging">
            <textPath href={`#${uid}-bottom`} startOffset="50%">{bottom}</textPath>
          </text>
        )}
        {/* stars between the top and bottom words */}
        <text x="20" y="105" fontSize="13" stroke="none" textAnchor="middle">★</text>
        <text x="180" y="105" fontSize="13" stroke="none" textAnchor="middle">★</text>
        <line x1="62" y1={brand.stampDate && date ? 84 : 86} x2="138" y2={brand.stampDate && date ? 84 : 86} strokeWidth="1.2" />
        <text x="100" y={brand.stampDate && date ? 104 : 108} fontFamily="Arial, Helvetica, sans-serif" fontWeight="800" fontSize={centerSize} letterSpacing="1" stroke="none" textAnchor="middle">
          {center}
        </text>
        {brand.stampDate && date ? (
          <text x="100" y="124" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="11" letterSpacing="0.5" stroke="none" textAnchor="middle">{date}</text>
        ) : null}
        <line x1="62" y1={brand.stampDate && date ? 132 : 116} x2="138" y2={brand.stampDate && date ? 132 : 116} strokeWidth="1.2" />
      </g>
    </svg>
  );
};

/** The seal's date line: "24 NOV 2026" */
export function stampDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}

/** Stamp sizes (px) beside the signature, across an A4 bill, and on an 80 mm receipt */
export const STAMP_PX = {
  signature: { s: 88, m: 108, l: 128 },
  watermark: { s: 280, m: 340, l: 400 },
  receipt: { s: 80, m: 96, l: 112 },
} as const;
