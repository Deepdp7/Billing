import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Barcode, Printer, Settings2, Layers, Sparkles, PackageSearch } from 'lucide-react';
import { Select } from '../../components/ui/Select.js';
import { canEncode } from '../../lib/code128.js';
import { BarcodeSvg } from '../../components/ui/BarcodeSvg.js';
import { findProductByCode, scanBeep, takeScanIntent, useScanner } from '../../lib/scanner.js';
import { PrintPortal } from '../../components/system/PrintPortal.js';
import { showAlert } from '../../components/ui/dialogs.js';

type Layout = '24_a4' | '40_a4' | 'thermal_single';

/** Sticker sizes in millimetres, so the preview, the PDF and the printed sheet match real sticker paper. */
const LAYOUTS: Record<Layout, { label: string; hint: string; cols: number; perPage: number; w: number; h: number; copies: number }> = {
  '24_a4': { label: 'A4 sheet · 24 stickers', hint: '3 × 8 · 70 × 37 mm', cols: 3, perPage: 24, w: 70, h: 37.125, copies: 24 },
  '40_a4': { label: 'A4 sheet · 40 stickers', hint: '4 × 10 · 52.5 × 29.7 mm', cols: 4, perPage: 40, w: 52.5, h: 29.7, copies: 40 },
  thermal_single: { label: 'Thermal roll', hint: 'one 50 × 25 mm sticker at a time', cols: 1, perPage: 1, w: 50, h: 25, copies: 5 },
};

const card = 'bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm';
const fieldLabel = 'block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5';
const inputCls = 'w-full px-3 py-2 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500';
const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

const Sticker: React.FC<{ product: any; header: string; code: string; layout: Layout; show: Record<string, boolean> }> = ({ product, header, code, layout, show }) => {
  const small = layout !== '24_a4';
  return (
    <div className="h-full w-full flex flex-col items-center justify-center text-center text-black overflow-hidden" style={{ padding: small ? '1.2mm 1.6mm' : '2mm 2.5mm' }}>
      {show.business && header && (
        <div className="w-full truncate font-bold uppercase tracking-wide leading-tight" style={{ fontSize: small ? '5.5pt' : '6.5pt' }}>{header}</div>
      )}
      {show.name && (
        <div className="w-full truncate font-semibold leading-tight" style={{ fontSize: small ? '6.5pt' : '8pt' }}>{product.name}</div>
      )}
      {code ? (
        <>
          <BarcodeSvg value={code} className="w-full" />
          <div className="font-mono leading-none tracking-wider" style={{ fontSize: small ? '5.5pt' : '6.5pt', marginTop: '0.4mm' }}>{code}</div>
        </>
      ) : (
        <div className="text-[7pt] text-slate-500 my-1">No barcode or SKU</div>
      )}
      {show.sku && product.sku && product.sku !== code && (
        <div className="font-mono leading-tight text-slate-600" style={{ fontSize: '5.5pt' }}>SKU {product.sku}</div>
      )}
      {(show.price || (show.mrp && product.mrp_paise > product.sale_price_paise)) && (
        <div className="flex items-baseline justify-center gap-1.5 leading-tight" style={{ marginTop: '0.5mm' }}>
          {show.price && <span className="font-black" style={{ fontSize: small ? '8pt' : '10pt' }}>{rupees(product.sale_price_paise)}</span>}
          {show.mrp && product.mrp_paise > product.sale_price_paise && (
            <span className="text-slate-500 line-through" style={{ fontSize: small ? '5.5pt' : '6.5pt' }}>MRP {rupees(product.mrp_paise)}</span>
          )}
        </div>
      )}
    </div>
  );
};

export const BarcodeGeneratorPage: React.FC = () => {
  const { user } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [copies, setCopies] = useState<number>(24);
  const [sheetLayout, setSheetLayout] = useState<Layout>('24_a4');
  const [customHeader, setCustomHeader] = useState('');
  const [show, setShow] = useState({ business: true, name: true, sku: true, price: true, mrp: true });

  useEffect(() => {
    api.getProducts({ limit: 500 })
      .then((res) => {
        setProducts(res.data);
        if (res.data.length > 0) setSelectedProductId(res.data[0].id);
      })
      .catch((err) => console.error('Failed to fetch products', err))
      .finally(() => setLoading(false));
  }, []);

  // A scan picks that product (also when opened from a scan: "Stickers")
  const pickScanned = async (code: string) => {
    const found = products.find((p) => p.barcode === code || p.sku?.toLowerCase() === code.toLowerCase()) || await findProductByCode(code).catch(() => null);
    scanBeep(!!found);
    if (!found) { showAlert(`No product has the code ${code}`); return; }
    setProducts((list) => (list.some((p) => p.id === found.id) ? list : [found, ...list]));
    setSelectedProductId(found.id);
  };
  useScanner((code) => { void pickScanned(code); return true; });
  useEffect(() => {
    if (loading) return;
    const intent = takeScanIntent('labels');
    if (intent) void pickScanned(intent.code);
  }, [loading]);

  const product = products.find((p) => p.id === selectedProductId);
  const rawCode = String(product?.barcode || product?.sku || '').trim();
  const code = canEncode(rawCode) ? rawCode : '';
  const header = customHeader || user?.businessName || '';
  const layout = LAYOUTS[sheetLayout];
  const pages = Array.from({ length: Math.ceil(copies / layout.perPage) }, (_, i) => Math.min(layout.perPage, copies - i * layout.perPage));
  const thermal = sheetLayout === 'thermal_single';

  // The sheets: on screen as a paper preview, and (print) exactly sized for the sticker paper
  const renderSheets = (print: boolean) => (
    <div className={print ? '' : 'flex flex-col items-center gap-6'}>
      {pages.map((count, pageIndex) => (
        <div
          key={pageIndex}
          className={print ? 'overflow-hidden' : 'bg-white shadow-md ring-1 ring-slate-900/5 shrink-0'}
          style={{
            width: thermal ? `${layout.w}mm` : '210mm',
            height: thermal ? `${layout.h}mm` : '297mm',
            boxSizing: 'border-box',
            padding: thermal ? 0 : `${(297 - layout.h * (layout.perPage / layout.cols)) / 2}mm ${(210 - layout.w * layout.cols) / 2}mm`,
            breakAfter: print && pageIndex < pages.length - 1 ? 'page' : 'auto',
          }}
        >
          <div className="grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, ${layout.w}mm)`, gridAutoRows: `${layout.h}mm` }}>
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className={print || thermal ? '' : 'outline outline-1 outline-dashed outline-slate-200'}>
                <Sticker product={product} header={header} code={code} layout={sheetLayout} show={show} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const fields: Array<[keyof typeof show, string]> = [
    ['business', 'Store name on top'],
    ['name', 'Product name'],
    ['sku', 'SKU / item code'],
    ['price', 'Selling price (₹)'],
    ['mrp', 'MRP, struck through (when higher)'],
  ];

  return (
    <div className="space-y-6">
      {/* Paper size for this sheet when printing or saving as PDF */}
      <style>{`@media print { @page { size: ${thermal ? '50mm 25mm' : 'A4'}; margin: 0; } }`}</style>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 no-print">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit'] flex items-center gap-2">
            <Barcode className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            Barcode & Sticker Labels
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Print scannable price stickers on A4 sticker sheets or a thermal label printer.
          </p>
        </div>
        <button
          onClick={() => window.print()}
          disabled={!product}
          className="btn-brand flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition disabled:cursor-not-allowed"
        >
          <Printer className="w-4 h-4" />
          Print {copies} sticker{copies === 1 ? '' : 's'}
        </button>
      </div>

      {!loading && products.length === 0 ? (
        <div className={`${card} no-print flex flex-col items-center text-center py-14`}>
          <PackageSearch className="w-10 h-10 text-slate-300 dark:text-slate-600" />
          <h3 className="mt-3 font-bold text-slate-800 dark:text-slate-100">No products yet</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Add products with a barcode or SKU in the Product Catalog, then print their stickers here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 no-print">
          {/* Product and paper */}
          <div className={`${card} space-y-4`}>
            <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3>1. Product & paper</h3>
            </div>
            <div>
              <label className={fieldLabel}>Product</label>
              <Select value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} className={inputCls} disabled={loading}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.barcode || p.sku || 'no code'} · {rupees(p.sale_price_paise)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className={fieldLabel}>Number of stickers</label>
              <input type="number" min={1} max={400} value={copies}
                onChange={(e) => setCopies(Math.min(400, Math.max(1, parseInt(e.target.value) || 1)))} className={inputCls} />
            </div>
            <div>
              <label className={fieldLabel}>Sticker paper</label>
              <div className="grid gap-2">
                {(Object.keys(LAYOUTS) as Layout[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setSheetLayout(key); setCopies(LAYOUTS[key].copies); }}
                    className={`text-left px-3 py-2 rounded-xl border transition ${
                      sheetLayout === key
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-500/30'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className={`text-xs font-semibold ${sheetLayout === key ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200'}`}>{LAYOUTS[key].label}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{LAYOUTS[key].hint}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* What goes on the sticker */}
          <div className={`${card} space-y-4`}>
            <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <Settings2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3>2. What the sticker shows</h3>
            </div>
            <div>
              <label className={fieldLabel}>Store name on top</label>
              <input type="text" placeholder={user?.businessName || 'Your store name'} value={customHeader}
                onChange={(e) => setCustomHeader(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1">
              {fields.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-sm text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <input type="checkbox" checked={show[key]} onChange={(e) => setShow((s) => ({ ...s, [key]: e.target.checked }))}
                    className="w-4 h-4 rounded accent-emerald-600" />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* One sticker, actual size */}
          <div className={`${card} flex flex-col`}>
            <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h3>Sticker preview</h3>
            </div>
            <div className="flex-1 flex items-center justify-center py-6">
              {product ? (
                <div className="bg-white rounded-md shadow-lg ring-1 ring-slate-900/10 origin-center" style={{ width: `${layout.w}mm`, height: `${layout.h}mm`, transform: `scale(${sheetLayout === '24_a4' ? 1.3 : 1.6})` }}>
                  <Sticker product={product} header={header} code={code} layout={sheetLayout} show={show} />
                </div>
              ) : (
                <p className="text-xs text-slate-400">{loading ? 'Loading products…' : 'Choose a product'}</p>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
              {code
                ? `Barcode ${code} · works with any shop scanner`
                : product ? 'This product has no barcode or SKU. Add one in the Product Catalog to print a barcode.' : ''}
            </p>
          </div>
        </div>
      )}

      {/* The sheets as they will print */}
      {product && (
        <div className={`${card} !p-0 overflow-hidden`}>
          <div className="no-print flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Print preview · {copies} sticker{copies === 1 ? '' : 's'}{!thermal && ` on ${pages.length} sheet${pages.length === 1 ? '' : 's'}`}
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">{layout.label} ({layout.hint})</span>
          </div>
          <div className="bg-slate-100 dark:bg-slate-950/60 p-6 overflow-x-auto">
            {renderSheets(false)}
          </div>
          <PrintPortal><div className="print-area">{renderSheets(true)}</div></PrintPortal>
        </div>
      )}
    </div>
  );
};
