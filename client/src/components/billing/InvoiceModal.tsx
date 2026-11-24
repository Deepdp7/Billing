import React, { useEffect, useMemo, useState } from 'react';
import { Invoice } from '../../types/index.js';
import { formatINR } from '../../lib/utils.js';
import { saveAsPdf } from '../../lib/api.js';
import { A4Invoice } from './A4Invoice.js';
import { canEncode } from '../../lib/code128.js';
import { BarcodeSvg } from '../ui/BarcodeSvg.js';
import { QrSvg } from '../ui/QrSvg.js';
import { Branding, DEFAULT_BRANDING, upiLink } from '../../lib/branding.js';
import { DigitalStamp, STAMP_PX, stampDate } from './DigitalStamp.js';
import { PrintPortal } from '../system/PrintPortal.js';
import { useAuth } from '../../context/AuthContext.js';
import {
  DOC_KINDS, PAPERS, brandForPrint, copyLabel, defaultPrintOptions, docTitle, isReceipt, savePrintOptions, savedPrintOptions, usable,
  type PrintOptions,
} from '../../lib/printOptions.js';
import { Printer, Download, X, CheckCircle, RotateCcw } from 'lucide-react';

interface InvoiceModalProps {
  invoice: Invoice | null;
  onClose: () => void;
}

/** A5: the A4 layout at this width, shrunk onto the half page (136 mm printable = 512 px at 0.8) */
const A5_WIDTH = 640;
const A5_ZOOM = 0.8;

/** The receipt (80 mm or 58 mm receipt printer). Receipt printers print black only: logo and stamp in black. */
const ReceiptSheet: React.FC<{ invoice: Invoice; options: PrintOptions; copy: string }> = ({ invoice, options, copy }) => {
  const inv: any = invoice;
  const business: any = inv.business || {};
  const brand: Branding = brandForPrint({ ...DEFAULT_BRANDING, ...(inv.branding || {}) }, options);
  const narrow = options.paper === 'thermal58';
  const challan = options.kind === 'challan';
  const estimate = options.kind === 'estimate';
  const balanceDue = inv.status === 'ISSUED' ? Math.max(0, invoice.total_paise - invoice.amount_paid_paise) : 0;
  const logo = options.logo ? business.logo_url || brand.logo : null;
  const upiDue = brand.showUpiQr && brand.upiId && !challan && !estimate ? balanceDue : 0;
  const title = docTitle(options.kind, !!business.gstin);
  return (
    <div className={`print-area bg-white text-black rounded-lg shadow-md border border-slate-200 font-mono leading-tight select-text ${narrow ? 'w-[208px] p-2.5 text-[9.5px]' : 'w-80 p-5 text-[11px]'}`}>
      <div className="text-center pb-3 border-b border-dashed border-gray-400 space-y-1">
        {logo && <img src={logo} alt="" className={`mx-auto object-contain grayscale contrast-125 ${narrow ? 'max-h-12 max-w-[140px]' : 'max-h-16 max-w-[180px]'}`} />}
        <h2 className={`font-extrabold uppercase tracking-wide ${narrow ? 'text-[12px]' : 'text-base'}`}>{business.name}</h2>
        {brand.tagline && <p className="text-[10px] italic">{brand.tagline}</p>}
        <p className="text-[10px] text-gray-700">{[business.address, business.city].filter(Boolean).join(', ')}</p>
        {business.gstin && <p className="text-[10px] font-bold">GSTIN: {business.gstin}</p>}
        {business.phone && <p className="text-[10px]">Ph: {business.phone}</p>}
        {brand.website && <p className="text-[10px]">{brand.website}</p>}
        <div className="pt-1 text-[11px] font-bold border-t border-dashed border-gray-300 uppercase">{title}</div>
        {copy && <div className="text-[9px] uppercase tracking-wider">{copy}</div>}
      </div>

      <div className="py-2 border-b border-dashed border-gray-400 space-y-0.5 text-[10px]">
        <div className={narrow ? 'space-y-0.5' : 'flex justify-between'}>
          <div>{challan ? 'Challan' : estimate ? 'Estimate' : 'Bill'} No: <b>{invoice.invoice_number}</b></div>
          <div>Date: {invoice.invoice_date}</div>
        </div>
        <div className={narrow ? 'space-y-0.5' : 'flex justify-between'}>
          <div>Customer: {invoice.customer_name}</div>
          {!challan && !estimate && <div>{invoice.payment_mode}</div>}
        </div>
        {invoice.customer_phone && <div>Ph: {invoice.customer_phone}</div>}
      </div>

      <div className="py-2 border-b border-dashed border-gray-400">
        <table className="w-full text-left text-[10px]">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="py-1">Item</th>
              <th className="text-center">Qty</th>
              {!challan && !narrow && <th className="text-right">Price</th>}
              {!challan && <th className="text-right">Amt</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {invoice.items?.map((it, idx) => (
              <tr key={idx}>
                <td className={`py-1 pr-1 font-medium ${narrow ? 'max-w-[96px]' : 'truncate max-w-[120px]'}`}>
                  {it.product_name}
                  {it.hsn_code && !narrow ? <span className="block text-[8px] text-gray-500">HSN:{it.hsn_code}</span> : null}
                </td>
                <td className="text-center align-top">{it.quantity}</td>
                {!challan && !narrow && <td className="text-right align-top">{formatINR(it.unit_price_paise)}</td>}
                {!challan && <td className="text-right font-bold align-top">{formatINR(it.total_paise)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!challan && (
        <div className="py-2 border-b border-dashed border-gray-400 space-y-1 text-[11px]">
          <div className="flex justify-between"><span>Subtotal:</span><span>{formatINR(invoice.subtotal_paise)}</span></div>
          {invoice.discount_paise > 0 && <div className="flex justify-between text-green-700"><span>Discount:</span><span>-{formatINR(invoice.discount_paise)}</span></div>}
          {invoice.cgst_paise > 0 && <div className="flex justify-between text-gray-600 text-[10px]"><span>CGST:</span><span>{formatINR(invoice.cgst_paise)}</span></div>}
          {invoice.sgst_paise > 0 && <div className="flex justify-between text-gray-600 text-[10px]"><span>SGST:</span><span>{formatINR(invoice.sgst_paise)}</span></div>}
          {invoice.igst_paise > 0 && <div className="flex justify-between text-gray-600 text-[10px]"><span>IGST:</span><span>{formatINR(invoice.igst_paise)}</span></div>}
          {inv.round_off_paise ? <div className="flex justify-between text-gray-600 text-[10px]"><span>Round-off:</span><span>{formatINR(inv.round_off_paise)}</span></div> : null}
          <div className={`flex justify-between font-black pt-1 border-t border-gray-400 ${narrow ? 'text-[12px]' : 'text-sm'}`}>
            <span>{estimate ? 'ESTIMATE TOTAL:' : 'GRAND TOTAL:'}</span><span>{formatINR(invoice.total_paise)}</span>
          </div>
          {!estimate && <div className="flex justify-between text-[10px] text-gray-600 pt-0.5"><span>Paid ({invoice.payment_mode}):</span><span>{formatINR(invoice.amount_paid_paise)}</span></div>}
          {balanceDue > 0 && !estimate && <div className="flex justify-between text-[10px] font-bold"><span>Balance due:</span><span>{formatINR(balanceDue)}</span></div>}
        </div>
      )}
      {challan && (
        <div className="py-2 border-b border-dashed border-gray-400 text-[10px]">
          <div className="flex justify-between font-bold"><span>Total quantity:</span><span>{invoice.items?.reduce((n, it) => n + Number(it.quantity || 0), 0)}</span></div>
          <div className="mt-6 border-t border-gray-400 pt-0.5 text-center">Received by</div>
        </div>
      )}
      {upiDue > 0 && (
        <div className="py-2 border-b border-dashed border-gray-400 flex flex-col items-center gap-1 text-[10px]">
          <QrSvg value={upiLink(brand, business.name, upiDue, invoice.invoice_number)} className={narrow ? 'w-28 h-28' : 'w-32 h-32'} />
          <div className="font-bold">Scan to pay {formatINR(upiDue)} (any UPI app)</div>
          <div>{brand.upiId}</div>
        </div>
      )}
      {inv.status === 'CANCELLED' && <div className="py-2 text-center font-black text-red-600 border-b border-dashed border-gray-400">CANCELLED</div>}

      <div className="pt-3 text-center text-[10px] text-gray-600 space-y-0.5">
        {/* The stamp in black (receipt printers print black only), above the thank-you line */}
        {brand.stampMode !== 'off' && inv.status !== 'CANCELLED' && (
          <div className="flex justify-center pb-1">
            <DigitalStamp brand={brand} businessName={business.name || ''} place={[business.city, business.state].filter(Boolean).join(', ')}
              date={stampDate(invoice.invoice_date)} size={STAMP_PX.receipt[brand.stampSize] * (narrow ? 0.8 : 1)} strength={Math.max(0.7, brand.stampStrength / 100)} rotate={-8} mono />
          </div>
        )}
        {brand.signature && (
          <div className="pb-1">
            <img src={brand.signature} alt="" className="mx-auto h-9 max-w-[150px] object-contain grayscale contrast-150" />
            <div className="text-[9px]">Authorised signatory</div>
          </div>
        )}
        <p className="font-semibold">{estimate ? 'This is an estimate, not a bill.' : inv.footer || 'Thank you for your business!'}</p>
        {inv.terms && !estimate && <p>{inv.terms}</p>}
        {canEncode(invoice.invoice_number) && <BarcodeSvg value={invoice.invoice_number} className={`mx-auto mt-1.5 h-8 ${narrow ? 'w-40' : 'w-48'}`} />}
        <p className="text-[8px] text-gray-400">Powered by Apna Billing</p>
      </div>
    </div>
  );
};

const seg = (on: boolean) => `px-2 py-1 rounded-md text-[11px] font-semibold transition ${on ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`;

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ invoice, onClose }) => {
  const { user } = useAuth();
  const [pdfMsg, setPdfMsg] = useState('');
  const inv: any = invoice || {};
  const business: any = inv.business || {};
  const brand: Branding = { ...DEFAULT_BRANDING, ...(inv.branding || {}) };
  const hasLogo = !!(business.logo_url || brand.logo);
  const shop = user?.shopId || 'main';
  const shopDefaults = useMemo(() => defaultPrintOptions(brand, user?.businessCategory, hasLogo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(brand), user?.businessCategory, hasLogo]);
  const [choice, setChoice] = useState<PrintOptions | null>(() => savedPrintOptions(shop));
  useEffect(() => { savePrintOptions(shop, choice); }, [shop, choice]);

  if (!invoice) return null;
  const o = usable(choice || shopDefaults, brand, hasLogo);
  const set = <K extends keyof PrintOptions>(k: K, v: PrintOptions[K]) => setChoice({ ...o, [k]: v });
  const receipt = isReceipt(o.paper);

  const handlePdf = async () => {
    setPdfMsg('');
    try {
      const r = await saveAsPdf(`${docTitle(o.kind, !!business.gstin).replace(/\s+/g, '-')}-${invoice.invoice_number}.pdf`);
      if (r === 'saved') setPdfMsg('PDF saved');
    } catch (err: any) {
      setPdfMsg(err.message || 'PDF export failed');
    }
  };

  const copies = Array.from({ length: o.copies }, (_, i) => copyLabel(i, o.copies, o.paper));
  const sheets = (forPrint: boolean) => copies.map((label, i) => (
    <div key={i} style={i < copies.length - 1 ? { breakAfter: 'page' } : undefined} className={forPrint ? '' : 'mb-4 last:mb-0'}>
      {receipt ? (
        <ReceiptSheet invoice={invoice} options={o} copy={label} />
      ) : o.paper === 'a5' ? (
        <div style={{ width: A5_WIDTH, zoom: A5_ZOOM }}><A4Invoice invoice={invoice} options={o} copy={label || 'Original for recipient'} compact /></div>
      ) : (
        <A4Invoice invoice={invoice} options={o} copy={label || 'Original for recipient'} />
      )}
    </div>
  ));

  const Toggle = ({ k, label, can, why }: { k: 'logo' | 'signature' | 'upiQr' | 'bank'; label: string; can: boolean; why: string }) => (
    <label className={`flex items-start gap-2 text-xs ${can ? 'cursor-pointer' : 'opacity-50'}`}>
      <input type="checkbox" className="mt-0.5" disabled={!can} checked={o[k]} onChange={(e) => set(k, e.target.checked)} />
      <span><span className="font-semibold text-slate-800 dark:text-slate-200">{label}</span>{!can && <span className="block text-[10px] text-slate-400">{why}</span>}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-[1160px] w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="no-print px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate">{docTitle(o.kind, !!business.gstin)} {invoice.invoice_number}</h3>
          </div>
          <div className="flex items-center gap-2">
            {pdfMsg && <span className="text-[11px] text-slate-500">{pdfMsg}</span>}
            <button onClick={handlePdf}
              className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition">
              <Download className="w-3.5 h-3.5" /><span>PDF</span>
            </button>
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
              <Printer className="w-3.5 h-3.5" /><span>Print{o.copies > 1 ? ` ${o.copies} copies` : ''}</span>
            </button>
            <button onClick={onClose} aria-label="Close"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* What is printed: for this bill, remembered on this computer */}
          <aside className="no-print w-64 shrink-0 overflow-y-auto border-r border-slate-200 dark:border-slate-800 p-4 space-y-4 bg-white dark:bg-slate-900">
            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Paper</div>
              <div className="grid grid-cols-4 gap-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
                {PAPERS.map((p) => <button key={p.value} type="button" className={seg(o.paper === p.value)} onClick={() => setChoice({
                  ...o, paper: p.value,
                  // from a receipt to a page bill (or back) the signature takes that paper's usual choice: on a page, off a receipt
                  signature: isReceipt(p.value) === receipt ? o.signature : !isReceipt(p.value) && !!brand.signature,
                })}>{p.label}</button>)}
              </div>
              <div className="text-[10px] text-slate-400">{PAPERS.find((p) => p.value === o.paper)?.hint}</div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Document</div>
              <select value={o.kind} onChange={(e) => set('kind', e.target.value as PrintOptions['kind'])}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-white">
                {DOC_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <div className="text-[10px] text-slate-400">{DOC_KINDS.find((k) => k.value === o.kind)?.hint}</div>
            </div>

            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">On the bill</div>
              <Toggle k="logo" label="Logo" can={hasLogo} why="Upload a logo in Settings, Logo & Branding" />
              <Toggle k="signature" label="Authorised signature" can={!!brand.signature} why="Upload a signature in Logo & Branding" />
              <Toggle k="upiQr" label='"Scan to pay" UPI code' can={!!brand.upiId} why="Add a UPI ID in Logo & Branding" />
              {!receipt && <Toggle k="bank" label="Bank details" can={!!brand.bankAccountNumber} why="Add bank details in Logo & Branding" />}
            </div>

            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Stamp</div>
              <div className="grid grid-cols-3 gap-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
                <button type="button" className={seg(o.stamp === 'off')} onClick={() => set('stamp', 'off')}>None</button>
                <button type="button" className={seg(o.stamp === 'seal')} onClick={() => set('stamp', 'seal')}>Seal</button>
                <button type="button" disabled={!brand.stamp} className={`${seg(o.stamp === 'image')} disabled:opacity-40`} onClick={() => set('stamp', 'image')}>Picture</button>
              </div>
              {!brand.stamp && <div className="text-[10px] text-slate-400">"Picture" needs your stamp picture in Logo & Branding</div>}
              {o.stamp !== 'off' && !receipt && (
                <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
                  <button type="button" className={seg(o.stampPlace === 'signature')} onClick={() => set('stampPlace', 'signature')}>By signature</button>
                  <button type="button" className={seg(o.stampPlace === 'watermark')} onClick={() => set('stampPlace', 'watermark')}>Watermark</button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Copies</div>
              <div className="grid grid-cols-3 gap-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
                {([1, 2, 3] as const).map((n) => <button key={n} type="button" className={seg(o.copies === n)} onClick={() => set('copies', n)}>{n}</button>)}
              </div>
              <div className="text-[10px] text-slate-400">{receipt ? 'Customer, shop and office copy' : 'Original, duplicate, triplicate'}</div>
            </div>

            {choice && (
              <button type="button" onClick={() => setChoice(null)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                <RotateCcw className="w-3 h-3" />Back to shop settings
              </button>
            )}
            <p className="text-[10px] leading-snug text-slate-400">Changes here are for printing on this computer. The saved stamp, signature and logo are in Settings, Logo & Branding.</p>
          </aside>

          {/* The sheet as it will print */}
          <div className="min-w-0 flex-1 overflow-y-auto p-6 flex justify-center bg-slate-100 dark:bg-slate-950/50">
            <div className={receipt ? '' : o.paper === 'a5' ? '' : 'w-full max-w-[860px]'}>{sheets(false)}</div>
          </div>
        </div>
      </div>
      <PrintPortal>
        {/* Each paper prints on its own page size; receipts keep the receipt printer's own */}
        {o.paper === 'a4' && <style>{'@media print { @page { size: A4; margin: 8mm; } }'}</style>}
        {o.paper === 'a5' && <style>{'@media print { @page { size: A5; margin: 6mm; } }'}</style>}
        {sheets(true)}
      </PrintPortal>
    </div>
  );
};
