import React, { useEffect, useState } from 'react';
import { Barcode, ShoppingCart, Printer, Pencil, PackagePlus, FileText, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatINR } from '../../lib/utils.js';
import { findProductByCode, openWithScan, setScanFallback } from '../../lib/scanner.js';

type Found = { code: string; loading: boolean; product?: any; bill?: any };

/**
 * What a barcode scan does on a screen that has no use for it (Dashboard, Reports, …): shows the product — price,
 * MRP, stock — with one-click Sell / Print stickers / Edit; a code that is not a product yet can be added as one,
 * and a scanned bill number opens that bill.
 */
export const ScanLookup: React.FC = () => {
  const [found, setFound] = useState<Found | null>(null);

  useEffect(() => {
    setScanFallback((code) => {
      setFound({ code, loading: true });
      (async () => {
        const product = await findProductByCode(code).catch(() => null);
        let bill: any = null;
        if (!product) {
          const res = await api.getInvoices({ search: code, limit: 5 }).catch(() => null);
          bill = res?.data?.find((i: any) => String(i.invoice_number).toLowerCase() === code.toLowerCase()) || null;
        }
        setFound((f) => (f?.code === code ? { code, loading: false, product, bill } : f));
      })();
      return true;
    });
    return () => setScanFallback(null);
  }, []);

  useEffect(() => {
    if (!found) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFound(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [found]);

  if (!found) return null;
  const go = (page: string, intent: Parameters<typeof openWithScan>[1]) => { setFound(null); openWithScan(page, intent); };
  const p = found.product;
  const btn = 'flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition';
  const secondary = `${btn} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700`;

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4" role="dialog" aria-label="Scanned code">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Barcode className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Scanned <span className="font-mono text-slate-700 dark:text-slate-200">{found.code}</span>
          </div>
          <button onClick={() => setFound(null)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4">
          {found.loading ? (
            <p className="text-sm text-slate-500 py-4 text-center">Looking it up…</p>
          ) : p ? (
            <>
              <div className="text-lg font-bold text-slate-900 dark:text-white leading-tight">{p.name}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{[p.category_name, p.sku && `SKU ${p.sku}`].filter(Boolean).join(' · ')}</div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Price</div>
                  <div className="font-bold text-slate-900 dark:text-white">{formatINR(p.sale_price_paise)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">MRP</div>
                  <div className="font-semibold text-slate-700 dark:text-slate-200">{p.mrp_paise ? formatINR(p.mrp_paise) : '—'}</div>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">In stock</div>
                  <div className={`font-bold ${p.track_stock && p.stock_quantity <= (p.low_stock_threshold || 0) ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}>
                    {p.track_stock ? `${p.stock_quantity} ${p.unit || ''}` : '—'}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <button onClick={() => go('billing', { kind: 'sell', code: found.code })} className={`${btn} col-span-3 btn-brand`}>
                  <ShoppingCart className="w-4 h-4" />Sell in POS
                </button>
                <button onClick={() => go('barcodes', { kind: 'labels', code: found.code })} className={`${secondary} col-span-1`}><Printer className="w-3.5 h-3.5" />Stickers</button>
                <button onClick={() => go('products', { kind: 'edit-product', code: found.code })} className={`${secondary} col-span-2`}><Pencil className="w-3.5 h-3.5" />Edit product</button>
              </div>
            </>
          ) : found.bill ? (
            <>
              <div className="text-sm text-slate-600 dark:text-slate-300">
                Bill <b className="text-slate-900 dark:text-white">{found.bill.invoice_number}</b> · {found.bill.customer_name} · {formatINR(found.bill.total_paise)}
              </div>
              <button onClick={() => go('invoices', { kind: 'open-bill', code: found.bill.invoice_number })} className={`${btn} btn-brand w-full mt-4`}>
                <FileText className="w-4 h-4" />Open bill
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300">No product has this code yet.</p>
              <button onClick={() => go('products', { kind: 'new-product', code: found.code })} className={`${btn} btn-brand w-full mt-4`}>
                <PackagePlus className="w-4 h-4" />Add as new product
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
