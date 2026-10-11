import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { 
  Barcode, 
  Printer, 
  Settings2, 
  Layers, 
  CheckCircle2, 
  Sparkles,
  Download,
  Search
} from 'lucide-react';

export const BarcodeGeneratorPage: React.FC = () => {
  const { user } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [copies, setCopies] = useState<number>(24);
  const [sheetLayout, setSheetLayout] = useState<'24_a4' | '40_a4' | 'thermal_single'>('24_a4');
  
  // Customization toggles
  const [showBusinessName, setShowBusinessName] = useState(true);
  const [showProductName, setShowProductName] = useState(true);
  const [showSku, setShowSku] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showMrp, setShowMrp] = useState(true);
  const [customHeader, setCustomHeader] = useState('');

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const res = await api.getProducts({ limit: 100 });
      setProducts(res.data);
      if (res.data.length > 0) {
        setSelectedProductId(res.data[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch products', err);
    } finally {
      setLoading(false);
    }
  };

  const selectedProduct = products.find(p => p.id === selectedProductId) || products[0];

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header (Hidden during print) */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Barcode className="w-7 h-7 text-indigo-600" />
            Barcode & Sticker Label Designer
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Design and print custom barcode stickers formatted for standard A4 sticker sheets or thermal roll printers.
          </p>
        </div>

        <button
          onClick={handlePrint}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-medium shadow-sm transition"
        >
          <Printer className="w-4 h-4" />
          Print Label Sheet
        </button>
      </div>

      {/* Control Panel (Hidden during print) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:hidden">
        {/* Product Selection */}
        <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 font-semibold text-gray-900">
            <Layers className="w-4 h-4 text-indigo-600" />
            <h3>1. Select Item & Quantity</h3>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Choose Product</label>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            >
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku || p.barcode || 'No SKU'}) - ₹{(p.sale_price_paise / 100).toFixed(2)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Sticker Copies to Print</label>
            <input
              type="number"
              min={1}
              max={120}
              value={copies}
              onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Sheet Format Layout</label>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => { setSheetLayout('24_a4'); setCopies(24); }}
                className={`text-left px-3 py-2 rounded-xl border text-xs font-medium transition ${
                  sheetLayout === '24_a4'
                    ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 font-semibold'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Standard A4 (24 Labels - 3 cols × 8 rows)
              </button>
              <button
                type="button"
                onClick={() => { setSheetLayout('40_a4'); setCopies(40); }}
                className={`text-left px-3 py-2 rounded-xl border text-xs font-medium transition ${
                  sheetLayout === '40_a4'
                    ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 font-semibold'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Compact A4 (40 Labels - 4 cols × 10 rows)
              </button>
              <button
                type="button"
                onClick={() => { setSheetLayout('thermal_single'); setCopies(5); }}
                className={`text-left px-3 py-2 rounded-xl border text-xs font-medium transition ${
                  sheetLayout === 'thermal_single'
                    ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 font-semibold'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Thermal Roll (50mm × 25mm Individual Sticker)
              </button>
            </div>
          </div>
        </div>

        {/* Content Customization */}
        <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 font-semibold text-gray-900">
            <Settings2 className="w-4 h-4 text-indigo-600" />
            <h3>2. Sticker Content & Fields</h3>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Custom Top Header / Store Text</label>
            <input
              type="text"
              placeholder={user?.businessName || 'Apna Store'}
              value={customHeader}
              onChange={(e) => setCustomHeader(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>

          <div className="space-y-2.5 pt-1">
            <label className="flex items-center gap-2.5 text-xs font-medium text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showBusinessName}
                onChange={(e) => setShowBusinessName(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
              />
              Include Store Branding Name
            </label>
            <label className="flex items-center gap-2.5 text-xs font-medium text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showProductName}
                onChange={(e) => setShowProductName(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
              />
              Show Product Title
            </label>
            <label className="flex items-center gap-2.5 text-xs font-medium text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showSku}
                onChange={(e) => setShowSku(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
              />
              Show SKU / Item Code
            </label>
            <label className="flex items-center gap-2.5 text-xs font-medium text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showPrice}
                onChange={(e) => setShowPrice(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
              />
              Show Selling Price (₹)
            </label>
            <label className="flex items-center gap-2.5 text-xs font-medium text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showMrp}
                onChange={(e) => setShowMrp(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
              />
              Show MRP Comparison Strike
            </label>
          </div>
        </div>

        {/* Live Sticker Sample Preview */}
        <div className="bg-white rounded-2xl border border-gray-200/80 p-5 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 font-semibold text-gray-900 mb-3">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <h3>Single Sticker Preview</h3>
            </div>
            
            {selectedProduct ? (
              <div className="border-2 border-dashed border-indigo-200 rounded-xl p-3 bg-indigo-50/20 text-center flex flex-col items-center justify-center max-w-[220px] mx-auto">
                {showBusinessName && (
                  <p className="text-[10px] uppercase font-bold tracking-wider text-gray-700 truncate w-full">
                    {customHeader || user?.businessName || 'Apna Store'}
                  </p>
                )}
                {showProductName && (
                  <p className="text-xs font-semibold text-gray-900 truncate w-full mt-0.5">
                    {selectedProduct.name}
                  </p>
                )}
                {showSku && (
                  <p className="text-[9px] text-gray-500">
                    SKU: {selectedProduct.sku}
                  </p>
                )}

                {/* Simulated Barcode */}
                <div className="my-2 bg-white px-2 py-1 rounded border border-gray-200">
                  <div className="flex items-end justify-center gap-[2px] h-9">
                    {[3, 1, 4, 1, 5, 2, 4, 1, 3, 2, 1, 4, 2, 3, 1, 4, 1, 2, 3].map((height, i) => (
                      <div
                        key={i}
                        className="bg-black"
                        style={{
                          width: i % 2 === 0 ? '2px' : '1.5px',
                          height: `${height * 6 + 10}px`,
                        }}
                      />
                    ))}
                  </div>
                  <p className="text-[9px] font-mono tracking-widest text-gray-800 mt-0.5">
                    {selectedProduct.barcode || selectedProduct.sku || '890123456789'}
                  </p>
                </div>

                <div className="flex items-center justify-center gap-2">
                  {showPrice && (
                    <span className="text-xs font-bold text-gray-900">
                      ₹{(selectedProduct.sale_price_paise / 100).toFixed(2)}
                    </span>
                  )}
                  {showMrp && selectedProduct.mrp_paise > 0 && (
                    <span className="text-[10px] text-gray-400 line-through">
                      MRP ₹{(selectedProduct.mrp_paise / 100).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-8">Select a product to preview</p>
            )}
          </div>

          <p className="text-[11px] text-gray-400 text-center">
            Ready to print on standard laser or inkjet adhesive sticker sheets.
          </p>
        </div>
      </div>

      {/* Sheet Print Layout */}
      <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-sm print:p-0 print:border-none print:shadow-none">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 print:hidden flex items-center justify-between">
          <span>Print Sheet Preview ({copies} Stickers)</span>
          <span className="text-xs font-normal text-gray-400">Layout: {sheetLayout.toUpperCase()}</span>
        </h3>

        <div className={`grid gap-3 ${
          sheetLayout === '24_a4' 
            ? 'grid-cols-3' 
            : sheetLayout === '40_a4' 
            ? 'grid-cols-4' 
            : 'grid-cols-1 max-w-xs mx-auto'
        }`}>
          {Array.from({ length: copies }).map((_, index) => (
            <div
              key={index}
              className="border border-gray-300 rounded-lg p-2.5 text-center flex flex-col items-center justify-between bg-white print:border-gray-400"
              style={{ minHeight: sheetLayout === '24_a4' ? '120px' : '90px' }}
            >
              {showBusinessName && (
                <p className="text-[9px] uppercase font-bold text-gray-800 truncate w-full leading-tight">
                  {customHeader || user?.businessName || 'Apna Store'}
                </p>
              )}
              {showProductName && selectedProduct && (
                <p className="text-[10px] font-semibold text-gray-900 truncate w-full leading-tight mt-0.5">
                  {selectedProduct.name}
                </p>
              )}
              {showSku && selectedProduct && (
                <p className="text-[8px] text-gray-500 font-mono">
                  {selectedProduct.sku}
                </p>
              )}

              {/* Barcode Lines */}
              <div className="my-1 flex items-end justify-center gap-[2px] h-7">
                {[2, 1, 3, 1, 4, 2, 3, 1, 2, 4, 1, 3, 2, 1, 3, 1, 4, 2].map((height, i) => (
                  <div
                    key={i}
                    className="bg-black"
                    style={{
                      width: '1.5px',
                      height: `${height * 4 + 8}px`,
                    }}
                  />
                ))}
              </div>
              <p className="text-[8px] font-mono tracking-wider text-gray-800 leading-none">
                {selectedProduct?.barcode || selectedProduct?.sku || '890123456789'}
              </p>

              <div className="flex items-center justify-center gap-1.5 mt-1 leading-none">
                {showPrice && selectedProduct && (
                  <span className="text-[10px] font-bold text-gray-900">
                    ₹{(selectedProduct.sale_price_paise / 100).toFixed(2)}
                  </span>
                )}
                {showMrp && selectedProduct && selectedProduct.mrp_paise > 0 && (
                  <span className="text-[8px] text-gray-400 line-through">
                    MRP: ₹{(selectedProduct.mrp_paise / 100).toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
