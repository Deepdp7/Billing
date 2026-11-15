// Mirror of server/src/services/invoiceCalculator.ts so the POS preview matches the saved invoice exactly. Keep in sync.
/**
 * Pure GST invoice calculator. All money values are integer paise; no floating-point amounts are stored.
 *
 * Order of operations per line:
 *   gross        = round(quantity × unit price)
 *   net          = gross − line discount
 *   bill share   = bill-level discount distributed pro-rata over line nets (exact, largest-remainder)
 *   final        = net − bill share
 * Tax-exclusive pricing: taxable = final,                         tax = round(taxable × rate / 100)
 * Tax-inclusive pricing: taxable = round(final × 100 / (100+rate)), tax = final − taxable
 *
 * Discounts are applied before GST, so tax is charged on the discounted value.
 * Intra-state tax is split into CGST + SGST (SGST takes the smaller half on odd paise); inter-state is IGST.
 * Invariant: totalPaise = subtotalPaise − discountPaise + taxPaise + roundOffPaise.
 */

export interface CalcItemInput {
  quantity: number;
  unitPricePaise: number;
  discountPaise?: number;
  taxRate: number;
}

export interface CalcOptions {
  billDiscountPaise?: number;
  pricesIncludeTax?: boolean;
  isInterState?: boolean;
  roundOff?: boolean;
}

export interface CalcLine {
  grossPaise: number;
  lineDiscountPaise: number;
  billDiscountPaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

export interface CalcResult {
  lines: CalcLine[];
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
}

export class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculationError';
  }
}

const isInt = (n: number) => Number.isInteger(n);

/** Split `amount` across `weights` proportionally with integer results that sum exactly to `amount`. */
export function distributeProRata(amount: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (amount === 0 || totalWeight === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / totalWeight);
  const shares = raw.map((r) => Math.floor(r));
  let remainder = amount - shares.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    shares[order[k].i] += 1;
  }
  return shares;
}

export function calculateInvoice(items: CalcItemInput[], opts: CalcOptions = {}): CalcResult {
  if (!Array.isArray(items) || items.length === 0) throw new CalculationError('Invoice must contain at least one item');

  const billDiscount = opts.billDiscountPaise ?? 0;
  if (!isInt(billDiscount) || billDiscount < 0) throw new CalculationError('Bill discount must be a non-negative whole number of paise');

  const nets: number[] = [];
  const pre = items.map((item, idx) => {
    const n = idx + 1;
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new CalculationError(`Line ${n}: quantity must be greater than zero`);
    if (Math.round(item.quantity * 1000) / 1000 !== item.quantity) throw new CalculationError(`Line ${n}: quantity supports at most 3 decimal places`);
    if (!isInt(item.unitPricePaise) || item.unitPricePaise < 0) throw new CalculationError(`Line ${n}: price must be a non-negative whole number of paise`);
    if (!Number.isFinite(item.taxRate) || item.taxRate < 0 || item.taxRate > 100) throw new CalculationError(`Line ${n}: tax rate must be between 0 and 100`);
    const lineDiscount = item.discountPaise ?? 0;
    if (!isInt(lineDiscount) || lineDiscount < 0) throw new CalculationError(`Line ${n}: discount must be a non-negative whole number of paise`);

    const gross = Math.round(item.quantity * item.unitPricePaise);
    if (lineDiscount > gross) throw new CalculationError(`Line ${n}: discount exceeds line amount`);
    const net = gross - lineDiscount;
    nets.push(net);
    return { gross, lineDiscount, net, taxRate: item.taxRate };
  });

  const netTotal = nets.reduce((a, b) => a + b, 0);
  if (billDiscount > netTotal) throw new CalculationError('Bill discount exceeds invoice amount');
  const shares = distributeProRata(billDiscount, nets);

  const lines: CalcLine[] = pre.map((p, i) => {
    const final = p.net - shares[i];
    let taxable: number;
    let tax: number;
    if (opts.pricesIncludeTax) {
      taxable = Math.round((final * 100) / (100 + p.taxRate));
      tax = final - taxable;
    } else {
      taxable = final;
      tax = Math.round((taxable * p.taxRate) / 100);
    }
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (opts.isInterState) {
      igst = tax;
    } else {
      sgst = Math.floor(tax / 2);
      cgst = tax - sgst;
    }
    return {
      grossPaise: p.gross,
      lineDiscountPaise: p.lineDiscount,
      billDiscountPaise: shares[i],
      discountPaise: p.lineDiscount + shares[i],
      taxablePaise: taxable,
      taxPaise: tax,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: igst,
      totalPaise: taxable + tax,
    };
  });

  const sum = (f: (l: CalcLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  const taxablePaise = sum((l) => l.taxablePaise);
  const discountPaise = sum((l) => l.discountPaise);
  const taxPaise = sum((l) => l.taxPaise);
  const preRound = taxablePaise + taxPaise;
  const roundOffPaise = opts.roundOff ? Math.round(preRound / 100) * 100 - preRound : 0;

  return {
    lines,
    subtotalPaise: taxablePaise + discountPaise,
    discountPaise,
    taxablePaise,
    taxPaise,
    cgstPaise: sum((l) => l.cgstPaise),
    sgstPaise: sum((l) => l.sgstPaise),
    igstPaise: sum((l) => l.igstPaise),
    roundOffPaise,
    totalPaise: preRound + roundOffPaise,
  };
}
