import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateInvoice, distributeProRata, CalculationError } from '../src/services/invoiceCalculator.js';

test('tax-exclusive line: GST added on top, split CGST/SGST', () => {
  const r = calculateInvoice([{ quantity: 2, unitPricePaise: 10000, taxRate: 18 }]);
  assert.equal(r.taxablePaise, 20000);
  assert.equal(r.taxPaise, 3600);
  assert.equal(r.cgstPaise, 1800);
  assert.equal(r.sgstPaise, 1800);
  assert.equal(r.igstPaise, 0);
  assert.equal(r.totalPaise, 23600);
});

test('inter-state invoice uses IGST only', () => {
  const r = calculateInvoice([{ quantity: 1, unitPricePaise: 10000, taxRate: 12 }], { isInterState: true });
  assert.equal(r.igstPaise, 1200);
  assert.equal(r.cgstPaise + r.sgstPaise, 0);
});

test('odd tax paise: CGST takes the extra paisa, total tax preserved', () => {
  const r = calculateInvoice([{ quantity: 1, unitPricePaise: 1005, taxRate: 5 }]); // 50.25 -> 50
  assert.equal(r.taxPaise, 50);
  const r2 = calculateInvoice([{ quantity: 1, unitPricePaise: 1010, taxRate: 5 }]); // 50.5 -> 51
  assert.equal(r2.taxPaise, 51);
  assert.equal(r2.cgstPaise, 26);
  assert.equal(r2.sgstPaise, 25);
});

test('bill discount is applied before GST (tax on discounted value)', () => {
  const r = calculateInvoice([{ quantity: 1, unitPricePaise: 10000, taxRate: 18 }], { billDiscountPaise: 1000 });
  assert.equal(r.taxablePaise, 9000);
  assert.equal(r.taxPaise, 1620);
  assert.equal(r.totalPaise, 10620);
  assert.equal(r.discountPaise, 1000);
});

test('bill discount is distributed pro-rata across lines with different GST rates, exactly', () => {
  const r = calculateInvoice([
    { quantity: 1, unitPricePaise: 30000, taxRate: 5 },
    { quantity: 1, unitPricePaise: 10000, taxRate: 28 },
  ], { billDiscountPaise: 1001 });
  assert.equal(r.lines[0].billDiscountPaise + r.lines[1].billDiscountPaise, 1001);
  assert.equal(r.lines[0].billDiscountPaise, 751); // 750.75 -> largest remainder gets the extra paisa
  assert.equal(r.lines[1].billDiscountPaise, 250);
});

test('tax-inclusive pricing extracts GST from the price', () => {
  const r = calculateInvoice([{ quantity: 1, unitPricePaise: 11800, taxRate: 18 }], { pricesIncludeTax: true });
  assert.equal(r.taxablePaise, 10000);
  assert.equal(r.taxPaise, 1800);
  assert.equal(r.totalPaise, 11800);
});

test('fractional quantities (loose items) are supported', () => {
  const r = calculateInvoice([{ quantity: 0.75, unitPricePaise: 6000, taxRate: 0 }]);
  assert.equal(r.totalPaise, 4500);
});

test('round-off to nearest rupee is recorded separately', () => {
  const r = calculateInvoice([{ quantity: 1, unitPricePaise: 10049, taxRate: 0 }], { roundOff: true });
  assert.equal(r.roundOffPaise, -49);
  assert.equal(r.totalPaise, 10000);
  const up = calculateInvoice([{ quantity: 1, unitPricePaise: 10050, taxRate: 0 }], { roundOff: true });
  assert.equal(up.roundOffPaise, 50);
  assert.equal(up.totalPaise, 10100);
});

test('line discount reduces taxable value', () => {
  const r = calculateInvoice([{ quantity: 2, unitPricePaise: 5000, discountPaise: 1000, taxRate: 18 }]);
  assert.equal(r.taxablePaise, 9000);
  assert.equal(r.taxPaise, 1620);
});

test('invalid input is rejected, not silently corrected', () => {
  assert.throws(() => calculateInvoice([]), CalculationError);
  assert.throws(() => calculateInvoice([{ quantity: 0, unitPricePaise: 100, taxRate: 0 }]), /quantity/);
  assert.throws(() => calculateInvoice([{ quantity: -5, unitPricePaise: 100, taxRate: 0 }]), /quantity/);
  assert.throws(() => calculateInvoice([{ quantity: 1, unitPricePaise: -1, taxRate: 0 }]), /price/);
  assert.throws(() => calculateInvoice([{ quantity: 1, unitPricePaise: 10.5, taxRate: 0 }]), /price/);
  assert.throws(() => calculateInvoice([{ quantity: 1, unitPricePaise: 100, taxRate: 150 }]), /tax rate/);
  assert.throws(() => calculateInvoice([{ quantity: 1, unitPricePaise: 100, discountPaise: 200, taxRate: 0 }]), /discount exceeds/);
  assert.throws(() => calculateInvoice([{ quantity: 1, unitPricePaise: 100, taxRate: 0 }], { billDiscountPaise: 101 }), /Bill discount/);
  assert.throws(() => calculateInvoice([{ quantity: 1.2345, unitPricePaise: 100, taxRate: 0 }]), /decimal/);
});

test('distributeProRata always sums exactly', () => {
  for (let i = 0; i < 500; i++) {
    const weights = Array.from({ length: 1 + (i % 7) }, (_, k) => ((i * 7919 + k * 104729) % 100000));
    const amount = (i * 37) % 5000;
    const total = weights.reduce((a, b) => a + b, 0);
    const shares = distributeProRata(total === 0 ? 0 : Math.min(amount, total), weights);
    assert.equal(shares.reduce((a, b) => a + b, 0), total === 0 ? 0 : Math.min(amount, total));
    assert.ok(shares.every((s) => s >= 0));
  }
});

test('invariant: total = subtotal − discount + tax + roundOff, all integers, across many random invoices', () => {
  let seed = 42;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const rates = [0, 0.25, 3, 5, 12, 18, 28];
  for (let i = 0; i < 2000; i++) {
    const items = Array.from({ length: 1 + rnd(6) }, () => {
      const qty = (1 + rnd(5000)) / (rnd(2) ? 1000 : 1);
      const price = rnd(200000);
      const gross = Math.round(qty * price);
      return { quantity: qty, unitPricePaise: price, discountPaise: gross > 0 ? rnd(Math.floor(gross / 3) + 1) : 0, taxRate: rates[rnd(rates.length)] };
    });
    const net = items.reduce((a, it) => a + Math.round(it.quantity * it.unitPricePaise) - it.discountPaise, 0);
    const r = calculateInvoice(items, {
      billDiscountPaise: net > 0 ? rnd(Math.floor(net / 4) + 1) : 0,
      pricesIncludeTax: rnd(2) === 1, isInterState: rnd(2) === 1, roundOff: rnd(2) === 1,
    });
    assert.equal(r.totalPaise, r.subtotalPaise - r.discountPaise + r.taxPaise + r.roundOffPaise);
    assert.equal(r.taxPaise, r.cgstPaise + r.sgstPaise + r.igstPaise);
    for (const v of [r.totalPaise, r.taxPaise, r.discountPaise, r.subtotalPaise, r.roundOffPaise]) assert.ok(Number.isInteger(v));
    assert.ok(Math.abs(r.roundOffPaise) <= 50);
  }
});
