import type { Branding } from './branding.js';

/**
 * What a bill looks like when it is printed or saved as PDF, chosen in the print window for each bill: the paper (80 mm
 * or 58 mm receipt, A5, A4), the kind of document (tax invoice, bill of supply, cash memo, estimate, delivery challan),
 * and whether the logo, signature, stamp, UPI code and bank details are on it. It starts from the shop's settings
 * (Logo & Branding) and the kind of business; the last choice is remembered on this computer (each counter has its
 * own printer), and "Shop settings" goes back to them.
 */

export type Paper = 'thermal80' | 'thermal58' | 'a5' | 'a4';
export type DocKind = 'auto' | 'tax-invoice' | 'bill-of-supply' | 'cash-memo' | 'estimate' | 'challan';
export type StampChoice = 'off' | 'seal' | 'image';

export interface PrintOptions {
  paper: Paper;
  kind: DocKind;
  logo: boolean;
  signature: boolean;
  stamp: StampChoice;
  stampPlace: 'signature' | 'watermark';
  upiQr: boolean;
  bank: boolean;
  /** How many copies, each labelled (original / duplicate / triplicate) */
  copies: 1 | 2 | 3;
}

export const PAPERS: Array<{ value: Paper; label: string; hint: string }> = [
  { value: 'thermal80', label: '80 mm', hint: 'Receipt printer' },
  { value: 'thermal58', label: '58 mm', hint: 'Small receipt printer' },
  { value: 'a5', label: 'A5', hint: 'Half page' },
  { value: 'a4', label: 'A4', hint: 'Full page' },
];

export const DOC_KINDS: Array<{ value: DocKind; label: string; hint: string }> = [
  { value: 'auto', label: 'Automatic', hint: 'Tax invoice with a GSTIN, invoice without' },
  { value: 'tax-invoice', label: 'Tax invoice', hint: 'GST registered sellers' },
  { value: 'bill-of-supply', label: 'Bill of supply', hint: 'Composition scheme or GST-exempt goods' },
  { value: 'cash-memo', label: 'Cash memo', hint: 'Simple retail bill' },
  { value: 'estimate', label: 'Estimate', hint: 'A quote: not a tax invoice' },
  { value: 'challan', label: 'Delivery challan', hint: 'Goods only, no prices' },
];

export const isReceipt = (p: Paper) => p === 'thermal80' || p === 'thermal58';

export function docTitle(kind: DocKind, hasGstin: boolean): string {
  switch (kind) {
    case 'tax-invoice': return 'Tax Invoice';
    case 'bill-of-supply': return 'Bill of Supply';
    case 'cash-memo': return 'Cash Memo';
    case 'estimate': return 'Estimate';
    case 'challan': return 'Delivery Challan';
    default: return hasGstin ? 'Tax Invoice' : 'Invoice';
  }
}

/** The label of each copy: what Indian GST rules ask on a page bill; on receipts, whose copy it is */
export function copyLabel(index: number, copies: number, paper: Paper): string {
  if (isReceipt(paper)) return copies === 1 ? '' : index === 0 ? 'Customer copy' : index === 1 ? 'Shop copy' : 'Office copy';
  return ['Original for recipient', 'Duplicate for transporter', 'Triplicate for supplier'][index] || '';
}

/** Paper and copies that suit each kind of business (the shop can change them in the print window) */
const BY_CATEGORY: Record<string, Pick<PrintOptions, 'paper' | 'copies'>> = {
  GROCERY: { paper: 'thermal80', copies: 1 },
  RESTAURANT: { paper: 'thermal80', copies: 1 },
  CLOTHING: { paper: 'thermal80', copies: 1 },
  PHARMACY: { paper: 'a5', copies: 1 },
  WHOLESALE: { paper: 'a4', copies: 2 },
  MANUFACTURING: { paper: 'a4', copies: 2 },
  SERVICE: { paper: 'a4', copies: 1 },
  SCHOOL: { paper: 'a5', copies: 1 },
};

/** The shop's settings and the kind of business, before anything is changed for a bill */
export function defaultPrintOptions(brand: Branding, category?: string | null, hasLogo = !!brand.logo): PrintOptions {
  const fit = BY_CATEGORY[String(category || '').toUpperCase()] || { paper: 'thermal80', copies: 1 };
  return {
    paper: fit.paper,
    kind: 'auto',
    logo: hasLogo && (isReceipt(fit.paper) ? brand.logoOnReceipt : true),
    signature: !!brand.signature && !isReceipt(fit.paper),
    stamp: brand.stampMode === 'image' && !brand.stamp ? 'off' : brand.stampMode,
    stampPlace: brand.stampPlace,
    upiQr: brand.showUpiQr && !!brand.upiId,
    bank: brand.showBank && !!brand.bankAccountNumber,
    copies: fit.copies,
  };
}

const key = (shop: string) => `apna_print_options:${shop}`;

/** The last choice on this computer for this business, or null */
export function savedPrintOptions(shop: string): PrintOptions | null {
  try {
    const raw = localStorage.getItem(key(shop));
    return raw ? (JSON.parse(raw) as PrintOptions) : null;
  } catch {
    return null;
  }
}

export function savePrintOptions(shop: string, o: PrintOptions | null): void {
  try {
    if (o) localStorage.setItem(key(shop), JSON.stringify(o));
    else localStorage.removeItem(key(shop));
  } catch { /* private window: not remembered */ }
}

/**
 * The options as they can apply to this shop: nothing that was never uploaded or set up (no picture stamp without a
 * stamp picture, no signature without one, no UPI code without a UPI ID, no bank box without an account).
 */
export function usable(o: PrintOptions, brand: Branding, hasLogo: boolean): PrintOptions {
  return {
    ...o,
    logo: o.logo && hasLogo,
    signature: o.signature && !!brand.signature,
    stamp: o.stamp === 'image' && !brand.stamp ? 'off' : o.stamp,
    upiQr: o.upiQr && !!brand.upiId,
    bank: o.bank && !!brand.bankAccountNumber,
  };
}

/** The branding as this print uses it (the A4 / A5 sheet and the receipt read it like the saved one) */
export function brandForPrint(brand: Branding, o: PrintOptions): Branding {
  return {
    ...brand,
    signature: o.signature ? brand.signature : null,
    stampMode: o.stamp,
    stampPlace: o.stampPlace,
    showUpiQr: o.upiQr,
    showBank: o.bank,
    stampOnReceipt: o.stamp !== 'off',
  };
}
