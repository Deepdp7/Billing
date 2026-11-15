import React from 'react';
import { Invoice } from '../../types/index.js';
import { formatDate, formatINR } from '../../lib/utils.js';
import { canEncode } from '../../lib/code128.js';
import { BarcodeSvg } from '../ui/BarcodeSvg.js';

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function belowThousand(n: number) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** Indian numbering in words: 128350 → "One Lakh Twenty Eight Thousand Three Hundred Fifty" */
function inWords(n: number): string {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n / 100000) % 100);
  const thousand = Math.floor((n / 1000) % 100);
  const rest = n % 1000;
  return [
    crore ? `${inWords(crore)} Crore` : '',
    lakh ? `${belowHundred(lakh)} Lakh` : '',
    thousand ? `${belowHundred(thousand)} Thousand` : '',
    rest ? belowThousand(rest) : '',
  ].filter(Boolean).join(' ');
}

/** ₹1,283.50 → "Rupees One Thousand Two Hundred Eighty Three and Fifty Paise Only" */
export function amountInWords(paise: number) {
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  return `Rupees ${inWords(rupees)}${p ? ` and ${belowHundred(p)} Paise` : ''} Only`;
}

const STATUS_TONE: Record<string, string> = {
  PAID: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  PARTIAL: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  UNPAID: 'bg-rose-50 text-rose-700 ring-rose-600/20',
};

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-1">{children}</div>
);

/** The A4 tax invoice: the same sheet on screen, in the PDF and on paper. */
export const A4Invoice: React.FC<{ invoice: Invoice }> = ({ invoice }) => {
  const inv: any = invoice;
  const business: any = inv.business || {};
  const items = invoice.items || [];
  const cancelled = inv.status === 'CANCELLED';
  const interState = invoice.igst_paise > 0 || !!inv.is_inter_state;
  const balanceDue = inv.status === 'ISSUED' ? Math.max(0, invoice.total_paise - invoice.amount_paid_paise) : 0;
  const hasDiscount = items.some((it) => it.discount_paise > 0);
  const taxableOf = (it: any) => it.taxable_paise || it.total_paise - it.tax_paise;
  const title = business.gstin ? 'Tax Invoice' : 'Invoice';
  const address = [business.address, business.city, business.state, business.pincode].filter(Boolean).join(', ');
  const initials = String(business.name || '?').split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();

  // GST summary per rate (what the bill's tax is made of)
  const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const it of items as any[]) {
    const row = byRate.get(it.tax_rate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable += taxableOf(it);
    if (interState) row.igst += it.igst_paise || it.tax_paise;
    else {
      const cgst = it.cgst_paise || Math.floor(it.tax_paise / 2);
      row.cgst += cgst;
      row.sgst += it.sgst_paise || it.tax_paise - cgst;
    }
    byRate.set(it.tax_rate, row);
  }
  const taxRows = [...byRate.entries()].filter(([rate]) => rate > 0).sort((a, b) => a[0] - b[0]);
  const totalQty = items.reduce((s, it) => s + Number(it.quantity || 0), 0);

  return (
    <div className="print-area relative bg-white text-slate-800 w-full rounded-lg shadow-md border border-slate-200 font-sans text-[11.5px] leading-snug select-text overflow-hidden">
      <div className="h-1.5 bg-gradient-to-r from-emerald-600 to-teal-500" />

      {cancelled && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-[24deg] border-4 border-rose-500/40 text-rose-500/40 text-6xl font-black tracking-widest px-6 py-2 rounded-xl">CANCELLED</span>
        </div>
      )}

      <div className="px-9 pt-7 pb-8">
        {/* Seller and title */}
        <div className="flex justify-between items-start gap-6">
          <div className="flex gap-3.5 min-w-0">
            {business.logo_url ? (
              <img src={business.logo_url} alt="" className="w-14 h-14 rounded-xl object-contain border border-slate-200 bg-white shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500 text-white flex items-center justify-center text-xl font-black shrink-0">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-[22px] font-black text-slate-900 leading-tight tracking-tight">{business.name}</h1>
              {address && <p className="text-slate-500 mt-0.5">{address}</p>}
              <p className="text-slate-500 mt-0.5">
                {[business.phone && `Ph: ${business.phone}`, business.email].filter(Boolean).join('  ·  ')}
              </p>
              <p className="mt-1 font-semibold text-slate-700">
                GSTIN: <span className="font-mono tracking-wide">{business.gstin || 'Unregistered'}</span>
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[26px] font-black uppercase tracking-[0.08em] text-emerald-700 leading-none">{title}</div>
            <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-slate-400 mt-1.5">Original for recipient</div>
            {/* The bill number as a barcode: scan it in Returns or Invoices to find this bill */}
            {canEncode(invoice.invoice_number) && <BarcodeSvg value={invoice.invoice_number} className="ml-auto mt-2 h-8 w-40" />}
          </div>
        </div>

        {/* Invoice facts */}
        <div className="mt-6 grid grid-cols-4 rounded-xl border border-slate-200 bg-slate-50 divide-x divide-slate-200">
          {[
            ['Invoice No.', invoice.invoice_number],
            ['Invoice Date', formatDate(invoice.invoice_date)],
            ['Place of Supply', inv.place_of_supply || business.state || '—'],
            inv.due_date && balanceDue > 0 ? ['Due Date', formatDate(inv.due_date)] : ['Payment Mode', invoice.payment_mode],
          ].map(([k, v]) => (
            <div key={k} className="px-4 py-2.5">
              <Label>{k}</Label>
              <div className="font-bold text-slate-900 text-[12.5px] truncate">{v}</div>
            </div>
          ))}
        </div>

        {/* Buyer and payment */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <Label>Bill To</Label>
            <div className="text-[14px] font-bold text-slate-900">{invoice.customer_name}</div>
            {inv.billing_address && <p className="text-slate-500 mt-0.5 whitespace-pre-line">{inv.billing_address}</p>}
            {invoice.customer_phone && <p className="text-slate-500 mt-0.5">Ph: {invoice.customer_phone}</p>}
            {invoice.customer_gstin && <p className="mt-0.5 font-semibold text-slate-700">GSTIN: <span className="font-mono">{invoice.customer_gstin}</span></p>}
            {inv.shipping_address && (
              <div className="mt-2 pt-2 border-t border-dashed border-slate-200">
                <Label>Ship To</Label>
                <p className="text-slate-600 whitespace-pre-line">{inv.shipping_address}</p>
              </div>
            )}
          </div>
          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <div className="flex items-start justify-between">
              <Label>Payment</Label>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${STATUS_TONE[invoice.payment_status] || STATUS_TONE.UNPAID}`}>
                {invoice.payment_status}
              </span>
            </div>
            <div className="mt-1 space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Mode</span><span className="font-semibold text-slate-800">{invoice.payment_mode}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Amount paid</span><span className="font-semibold text-slate-800">{formatINR(invoice.amount_paid_paise)}</span></div>
              {balanceDue > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Balance due</span><span className="font-bold text-rose-600">{formatINR(balanceDue)}</span></div>
              )}
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="mt-5 rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-800 text-white text-[10px] uppercase tracking-wider">
                <th className="py-2.5 pl-4 pr-2 w-8 font-semibold">#</th>
                <th className="py-2.5 px-2 font-semibold">Item</th>
                <th className="py-2.5 px-2 font-semibold text-center">HSN/SAC</th>
                <th className="py-2.5 px-2 font-semibold text-right">Qty</th>
                <th className="py-2.5 px-2 font-semibold text-right">Rate{inv.prices_include_tax ? '*' : ''}</th>
                {hasDiscount && <th className="py-2.5 px-2 font-semibold text-right">Disc.</th>}
                <th className="py-2.5 px-2 font-semibold text-right">Taxable</th>
                <th className="py-2.5 px-2 font-semibold text-right">GST</th>
                <th className="py-2.5 pl-2 pr-4 font-semibold text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any, idx) => (
                <tr key={idx} className="border-t border-slate-100 even:bg-slate-50/70 align-top">
                  <td className="py-2.5 pl-4 pr-2 text-slate-400">{idx + 1}</td>
                  <td className="py-2.5 px-2">
                    <div className="font-semibold text-slate-900">{it.product_name}</div>
                    {it.sku && <div className="text-[9.5px] text-slate-400 font-mono">{it.sku}</div>}
                  </td>
                  <td className="py-2.5 px-2 text-center font-mono text-[10.5px] text-slate-500">{it.hsn_code || '—'}</td>
                  <td className="py-2.5 px-2 text-right font-semibold whitespace-nowrap">
                    {it.quantity}{it.unit ? <span className="font-normal text-slate-400 text-[10px]"> {it.unit}</span> : null}
                  </td>
                  <td className="py-2.5 px-2 text-right whitespace-nowrap">{formatINR(it.unit_price_paise)}</td>
                  {hasDiscount && <td className="py-2.5 px-2 text-right whitespace-nowrap text-emerald-700">{it.discount_paise ? `−${formatINR(it.discount_paise)}` : '—'}</td>}
                  <td className="py-2.5 px-2 text-right whitespace-nowrap">{formatINR(taxableOf(it))}</td>
                  <td className="py-2.5 px-2 text-right whitespace-nowrap">
                    <div>{formatINR(it.tax_paise)}</div>
                    <div className="text-[9.5px] text-slate-400">@ {it.tax_rate}%</div>
                  </td>
                  <td className="py-2.5 pl-2 pr-4 text-right font-bold text-slate-900 whitespace-nowrap">{formatINR(it.total_paise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-600">
                <td className="py-2 pl-4 pr-2" colSpan={3}>{items.length} item{items.length === 1 ? '' : 's'}</td>
                <td className="py-2 px-2 text-right">{Number(totalQty.toFixed(3))}</td>
                <td colSpan={hasDiscount ? 5 : 4} />
              </tr>
            </tfoot>
          </table>
        </div>
        {inv.prices_include_tax ? <p className="mt-1.5 text-[9.5px] text-slate-400">* Rates include GST.</p> : null}

        {/* Words, GST summary, totals */}
        <div className="mt-5 grid grid-cols-[1fr_270px] gap-6 items-start">
          <div className="space-y-4">
            <div>
              <Label>Amount in words</Label>
              <p className="font-semibold text-slate-800 italic">{amountInWords(invoice.total_paise)}</p>
            </div>

            {taxRows.length > 0 && (
              <div>
                <Label>GST summary</Label>
                <table className="w-full text-[10.5px] border border-slate-200 rounded-lg overflow-hidden border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500">
                      <th className="py-1.5 px-2.5 text-left font-semibold">Rate</th>
                      <th className="py-1.5 px-2.5 text-right font-semibold">Taxable</th>
                      {interState ? (
                        <th className="py-1.5 px-2.5 text-right font-semibold">IGST</th>
                      ) : (<>
                        <th className="py-1.5 px-2.5 text-right font-semibold">CGST</th>
                        <th className="py-1.5 px-2.5 text-right font-semibold">SGST</th>
                      </>)}
                    </tr>
                  </thead>
                  <tbody>
                    {taxRows.map(([rate, r]) => (
                      <tr key={rate} className="text-slate-700">
                        <td className="py-1.5 px-2.5 border-t border-slate-100">{rate}%</td>
                        <td className="py-1.5 px-2.5 border-t border-slate-100 text-right">{formatINR(r.taxable)}</td>
                        {interState ? (
                          <td className="py-1.5 px-2.5 border-t border-slate-100 text-right">{formatINR(r.igst)}</td>
                        ) : (<>
                          <td className="py-1.5 px-2.5 border-t border-slate-100 text-right">{formatINR(r.cgst)} <span className="text-slate-400">({rate / 2}%)</span></td>
                          <td className="py-1.5 px-2.5 border-t border-slate-100 text-right">{formatINR(r.sgst)} <span className="text-slate-400">({rate / 2}%)</span></td>
                        </>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <Label>Terms &amp; conditions</Label>
              <p className="text-slate-500 text-[10.5px] whitespace-pre-line">{inv.terms || 'Goods once sold will not be taken back without the original invoice.'}</p>
            </div>
            {invoice.notes && (
              <div>
                <Label>Notes</Label>
                <p className="text-slate-600 text-[10.5px] whitespace-pre-line">{invoice.notes}</p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 space-y-1.5">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-semibold">{formatINR(invoice.subtotal_paise)}</span></div>
              {invoice.discount_paise > 0 && (
                <div className="flex justify-between text-emerald-700"><span>Discount</span><span className="font-semibold">−{formatINR(invoice.discount_paise)}</span></div>
              )}
              {invoice.discount_paise > 0 && (
                <div className="flex justify-between"><span className="text-slate-500">Taxable value</span><span className="font-semibold">{formatINR(invoice.subtotal_paise - invoice.discount_paise)}</span></div>
              )}
              {interState ? (
                <div className="flex justify-between"><span className="text-slate-500">IGST</span><span>{formatINR(invoice.igst_paise)}</span></div>
              ) : (<>
                <div className="flex justify-between"><span className="text-slate-500">CGST</span><span>{formatINR(invoice.cgst_paise)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">SGST</span><span>{formatINR(invoice.sgst_paise)}</span></div>
              </>)}
              {inv.round_off_paise ? (
                <div className="flex justify-between"><span className="text-slate-500">Round-off</span><span>{inv.round_off_paise > 0 ? '+' : '−'}{formatINR(Math.abs(inv.round_off_paise))}</span></div>
              ) : null}
            </div>
            <div className="flex justify-between items-center px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-500 text-white">
              <span className="font-semibold text-[12px]">Total</span>
              <span className="text-[19px] font-black tracking-tight">{formatINR(invoice.total_paise)}</span>
            </div>
            {balanceDue > 0 && (
              <div className="flex justify-between px-4 py-2 bg-rose-50 text-rose-700 font-bold">
                <span>Balance due</span><span>{formatINR(balanceDue)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Thanks and signature */}
        <div className="mt-8 flex justify-between items-end gap-6">
          <div>
            <p className="text-[14px] font-bold text-emerald-700">{inv.footer || 'Thank you for your business!'}</p>
            <p className="text-[9.5px] text-slate-400 mt-1">E. &amp; O.E. · This is a computer-generated invoice.</p>
          </div>
          <div className="text-center w-52 shrink-0">
            <div className="font-bold text-slate-800">For {business.name}</div>
            <div className="h-12" />
            <div className="border-t border-slate-300 pt-1 text-[10px] text-slate-500">Authorised Signatory</div>
          </div>
        </div>
      </div>
    </div>
  );
};
