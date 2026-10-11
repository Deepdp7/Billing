import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { ClothingProduct, ClothingVariant, GarmentExchange } from '../../types/index.js';
import { formatINR, formatDate } from '../../lib/utils.js';
import { 
  Shirt, RefreshCw, Plus, Search, Tag, 
  ArrowLeftRight, CheckCircle, AlertTriangle, 
  Layers, Package, Edit2, X, Barcode, Check, ChevronDown, ChevronRight
} from 'lucide-react';

export const ClothingFashionPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'matrix' | 'exchanges'>('matrix');
  const [products, setProducts] = useState<ClothingProduct[]>([]);
  const [exchanges, setExchanges] = useState<GarmentExchange[]>([]);
  const [summary, setSummary] = useState<any>({ totalStyles: 0, totalVariants: 0, totalStock: 0, totalExchanges: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Expanded style rows
  const [expandedStyles, setExpandedStyles] = useState<Record<string, boolean>>({});

  // Modals
  const [isAddStyleModalOpen, setIsAddStyleModalOpen] = useState(false);
  const [isExchangeModalOpen, setIsExchangeModalOpen] = useState(false);
  const [editStockModal, setEditStockModal] = useState<{ variant: ClothingVariant } | null>(null);
  const [newStockInput, setNewStockInput] = useState('');

  // Add Style Form State
  const [styleName, setStyleName] = useState('');
  const [baseSku, setBaseSku] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('500');
  const [salePrice, setSalePrice] = useState('999');
  const [mrp, setMrp] = useState('1299');
  const [taxRate, setTaxRate] = useState('5');
  const [fabric, setFabric] = useState('100% Pure Cotton');
  const [selectedSizes, setSelectedSizes] = useState<string[]>(['S', 'M', 'L', 'XL']);
  const [colorsInput, setColorsInput] = useState('Navy Blue, Black, White');
  const [stockPerVariant, setStockPerVariant] = useState('10');

  // Exchange Form State
  const [exchangeInvNum, setExchangeInvNum] = useState('');
  const [exchangeCustName, setExchangeCustName] = useState('Walk-in Customer');
  const [exchangeCustPhone, setExchangeCustPhone] = useState('');
  const [returnedStyle, setReturnedStyle] = useState('');
  const [returnedSize, setReturnedSize] = useState('M');
  const [returnedColor, setReturnedColor] = useState('Navy Blue');
  const [issuedStyle, setIssuedStyle] = useState('');
  const [issuedSize, setIssuedSize] = useState('L');
  const [issuedColor, setIssuedColor] = useState('Navy Blue');
  const [exchangeReason, setExchangeReason] = useState('WRONG_SIZE');
  const [priceDiff, setPriceDiff] = useState('0');
  const [exchangeNotes, setExchangeNotes] = useState('');

  const commonSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '30', '32', '34', '36', '38', '40'];

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [prodRes, exchRes, sumRes] = await Promise.all([
        api.getClothingProducts(),
        api.getGarmentExchanges(),
        api.getClothingSummary(),
      ]);
      setProducts(prodRes.data || []);
      setExchanges(exchRes.data || []);
      setSummary(sumRes.data || {});

      // Expand all styles by default for easy viewing
      const initExp: Record<string, boolean> = {};
      (prodRes.data || []).forEach((p: any) => { initExp[p.id] = true; });
      setExpandedStyles(initExp);

      if (prodRes.data?.length > 0) {
        setReturnedStyle(prodRes.data[0].name);
        setIssuedStyle(prodRes.data[0].name);
      }
    } catch (err: any) {
      console.error('Failed to load clothing data', err);
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  const toggleExpand = (id: string) => {
    setExpandedStyles(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSize = (sz: string) => {
    setSelectedSizes(prev => 
      prev.includes(sz) ? prev.filter(s => s !== sz) : [...prev, sz]
    );
  };

  // Submit Add Style
  const handleCreateStyle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!styleName || !baseSku || !selectedSizes.length) {
      alert('Please fill product name, base SKU, and select at least one size.');
      return;
    }

    const colors = colorsInput.split(',').map(c => c.trim()).filter(Boolean);
    if (!colors.length) {
      alert('Please specify at least one color.');
      return;
    }

    try {
      const payload = {
        name: styleName,
        baseSku: baseSku.toUpperCase(),
        purchasePricePaise: Math.round(Number(purchasePrice) * 100),
        salePricePaise: Math.round(Number(salePrice) * 100),
        mrpPaise: Math.round(Number(mrp) * 100),
        taxRate: Number(taxRate) || 5,
        fabric,
        sizes: selectedSizes,
        colors,
        initialStockPerVariant: Number(stockPerVariant) || 0,
      };

      const res = await api.createClothingProduct(payload);
      showNotification('success', res.message || 'Apparel style and matrix created!');
      setIsAddStyleModalOpen(false);
      resetAddStyleForm();
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create apparel matrix');
    }
  };

  const resetAddStyleForm = () => {
    setStyleName('');
    setBaseSku('');
    setPurchasePrice('500');
    setSalePrice('999');
    setMrp('1299');
    setFabric('100% Pure Cotton');
    setSelectedSizes(['S', 'M', 'L', 'XL']);
    setColorsInput('Navy Blue, Black, White');
    setStockPerVariant('10');
  };

  // Update variant stock
  const handleUpdateStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editStockModal) return;

    try {
      await api.updateVariantStock(editStockModal.variant.id, Number(newStockInput) || 0);
      showNotification('success', 'Variant stock updated successfully!');
      setEditStockModal(null);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to update variant stock');
    }
  };

  // Submit Exchange
  const handleCreateExchange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exchangeInvNum || !returnedStyle || !issuedStyle) {
      alert('Please provide original invoice number and styles.');
      return;
    }

    // Lookup variant ids if available
    const retProduct = products.find(p => p.name === returnedStyle);
    const retVariant = retProduct?.variants?.find(v => v.size === returnedSize && v.color.toLowerCase() === returnedColor.toLowerCase());

    const issProduct = products.find(p => p.name === issuedStyle);
    const issVariant = issProduct?.variants?.find(v => v.size === issuedSize && v.color.toLowerCase() === issuedColor.toLowerCase());

    try {
      const payload = {
        originalInvoiceNumber: exchangeInvNum,
        customerName: exchangeCustName,
        customerPhone: exchangeCustPhone,
        returnedVariantId: retVariant?.id,
        returnedProductName: returnedStyle,
        returnedSize,
        returnedColor,
        returnedQuantity: 1,
        issuedVariantId: issVariant?.id,
        issuedProductName: issuedStyle,
        issuedSize,
        issuedColor,
        issuedQuantity: 1,
        priceDifferencePaise: Math.round(Number(priceDiff) * 100),
        reason: exchangeReason,
        notes: exchangeNotes,
      };

      const res = await api.createGarmentExchange(payload);
      showNotification('success', res.message || 'Garment exchange completed!');
      setIsExchangeModalOpen(false);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to process exchange');
    }
  };

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.sku.toLowerCase().includes(search.toLowerCase()) ||
    p.variants?.some(v => v.color.toLowerCase().includes(search.toLowerCase()) || v.size.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 rounded-xl text-purple-600 dark:text-purple-400">
              <Shirt className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
              Clothing & Fashion Matrix
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Sizes & colors apparel matrix, barcode tagging, and dedicated product size exchange desk (PRD §5)
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsExchangeModalOpen(true)}
            className="flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-md shadow-amber-600/20 transition active:scale-95"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>Garment Exchange Desk</span>
          </button>

          <button
            onClick={() => setIsAddStyleModalOpen(true)}
            className="flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-md shadow-purple-600/20 transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>+ New Apparel Style & Matrix</span>
          </button>
        </div>
      </div>

      {notification && (
        <div className={`p-4 rounded-xl flex items-center gap-2.5 text-xs font-semibold ${
          notification.type === 'success' 
            ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300' 
            : 'bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300'
        }`}>
          {notification.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
            <span>Apparel Styles</span>
            <div className="p-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/50 text-purple-600">
              <Shirt className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-white">
            {summary.totalStyles || products.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Active clothing designs & catalogs
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
            <span>Size x Color Matrix SKUs</span>
            <div className="p-1.5 rounded-lg bg-pink-50 dark:bg-pink-950/50 text-pink-600">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-purple-600 dark:text-purple-400">
            {summary.totalVariants || 0} SKUs
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Combinations with individual barcodes
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
            <span>Warehouse Stock</span>
            <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
            {summary.totalStock || 0} Pcs
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Realtime variant stock count
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
            <span>Garment Exchanges</span>
            <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600">
              <ArrowLeftRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-amber-600 dark:text-amber-400 font-mono">
            {summary.totalExchanges || exchanges.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Size swaps & trial counter logs
          </div>
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'matrix'
                ? 'bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-sm font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Shirt className="w-3.5 h-3.5" />
            <span>Apparel Matrix & Stock</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 font-mono">
              {products.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('exchanges')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'exchanges'
                ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-sm font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>Size Exchange Desk</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 font-mono">
              {exchanges.length}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 px-2">
          <div className="relative min-w-[240px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={activeTab === 'matrix' ? "Filter style, size, color or SKU..." : "Search exchange logs..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-purple-500"
            />
          </div>

          <button
            onClick={loadData}
            title="Refresh list"
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400 flex flex-col items-center gap-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading apparel catalog & variants...</span>
        </div>
      ) : activeTab === 'matrix' ? (
        /* ================= APPAREL STYLES & VARIANT MATRIX ================= */
        <div className="space-y-4">
          {filteredProducts.length === 0 ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
              <Shirt className="w-12 h-12 text-purple-400" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">No Apparel Styles Found</p>
              <p className="text-xs text-slate-500 max-w-sm">
                Create your first clothing style with automated Size x Color variant matrix.
              </p>
              <button
                onClick={() => setIsAddStyleModalOpen(true)}
                className="mt-2 text-xs font-bold px-4 py-2 rounded-xl bg-purple-600 text-white"
              >
                + Add Apparel Style
              </button>
            </div>
          ) : (
            filteredProducts.map((prod) => {
              const isExpanded = expandedStyles[prod.id] ?? true;
              return (
                <div key={prod.id} className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                  {/* Style Header Bar */}
                  <div 
                    onClick={() => toggleExpand(prod.id)}
                    className="p-4 bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:bg-slate-100/60 dark:hover:bg-slate-800/80 transition"
                  >
                    <div className="flex items-center gap-3">
                      <button className="p-1 text-slate-400">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-extrabold text-sm text-slate-900 dark:text-white font-['Outfit']">
                            {prod.name}
                          </h3>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-300 font-bold border border-purple-200 dark:border-purple-800">
                            Base SKU: {prod.sku}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-3">
                          <span>HSN: {prod.hsn_code || '6109'}</span>
                          <span>GST: {prod.tax_rate}%</span>
                          <span>Base Price: <strong className="text-slate-700 dark:text-slate-300">{formatINR(prod.sale_price_paise)}</strong></span>
                          <span>MRP: <strong className="line-through text-slate-400">{formatINR(prod.mrp_paise)}</strong></span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <span className="text-slate-400 text-[11px]">Matrix Variants: </span>
                        <strong className="text-purple-600 dark:text-purple-400 font-bold">{prod.variants?.length || 0}</strong>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-400 text-[11px]">Total Stock: </span>
                        <strong className="text-emerald-600 dark:text-emerald-400 font-mono font-bold">{prod.stock_quantity} Pcs</strong>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Matrix Table */}
                  {isExpanded && (
                    <div className="overflow-x-auto p-2">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            <th className="py-2.5 px-3">Size</th>
                            <th className="py-2.5 px-3">Color</th>
                            <th className="py-2.5 px-3">Variant SKU</th>
                            <th className="py-2.5 px-3">Barcode</th>
                            <th className="py-2.5 px-3 text-center">Stock</th>
                            <th className="py-2.5 px-3 text-right">Selling Price</th>
                            <th className="py-2.5 px-3 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                          {prod.variants?.map((v) => (
                            <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                              <td className="py-2.5 px-3">
                                <span className="px-2 py-0.5 rounded-lg text-xs font-black bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-mono">
                                  {v.size}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-2.5 h-2.5 rounded-full bg-purple-500 shrink-0" />
                                  <span>{v.color}</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                {v.variant_sku}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400 flex items-center gap-1">
                                <Barcode className="w-3.5 h-3.5 text-slate-400" />
                                <span>{v.barcode || 'N/A'}</span>
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <span className={`px-2 py-0.5 rounded-full font-mono font-bold text-xs ${
                                  v.stock_quantity <= 5 
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' 
                                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                }`}>
                                  {v.stock_quantity}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                                {formatINR(v.sale_price_paise)}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <button
                                  onClick={() => {
                                    setEditStockModal({ variant: v });
                                    setNewStockInput(String(v.stock_quantity));
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-purple-50 dark:hover:bg-purple-950 hover:text-purple-600 transition"
                                >
                                  <Edit2 className="w-3 h-3" />
                                  <span>Adjust Stock</span>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* ================= GARMENT EXCHANGE LOGS ================= */
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          {exchanges.length === 0 ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
              <ArrowLeftRight className="w-12 h-12 text-amber-500" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">No Garment Exchanges Recorded</p>
              <p className="text-xs text-slate-500 max-w-sm">
                Handle customer size or color trial swaps seamlessly from the exchange counter.
              </p>
              <button
                onClick={() => setIsExchangeModalOpen(true)}
                className="mt-2 text-xs font-bold px-4 py-2 rounded-xl bg-amber-600 text-white"
              >
                + Process First Size Exchange
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Exchange #</th>
                    <th className="py-3 px-4">Orig. Invoice</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Returned Item</th>
                    <th className="py-3 px-4">Issued Replacement</th>
                    <th className="py-3 px-4">Reason</th>
                    <th className="py-3 px-4 text-right">Price Diff</th>
                    <th className="py-3 px-4">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {exchanges.map((ex) => (
                    <tr key={ex.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                      <td className="py-3.5 px-4 font-mono font-bold text-amber-600 dark:text-amber-400">
                        {ex.exchange_number}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                        {ex.original_invoice_number}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white">{ex.customer_name}</div>
                        {ex.customer_phone && <div className="text-[10px] text-slate-400">{ex.customer_phone}</div>}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-rose-600 dark:text-rose-400">
                          {ex.returned_product_name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Size: <strong>{ex.returned_size}</strong> | Color: {ex.returned_color}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-emerald-600 dark:text-emerald-400">
                          {ex.issued_product_name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Size: <strong>{ex.issued_size}</strong> | Color: {ex.issued_color}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {ex.reason}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {formatINR(ex.price_difference_paise)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        {formatDate(ex.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: ADD APPAREL STYLE & VARIANT MATRIX */}
      {/* ========================================================================= */}
      {isAddStyleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-purple-50 dark:bg-purple-950/60 text-purple-600 rounded-xl">
                  <Shirt className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white font-['Outfit']">
                    Create Apparel Style & Variant Matrix
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Automatically produces Size x Color SKU combinations with unique barcodes
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsAddStyleModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateStyle} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Apparel Style Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Slim Fit Cotton Oxford Shirt"
                    value={styleName}
                    onChange={(e) => setStyleName(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Base SKU Code *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. SHIRT-OXF, POLO-DRY"
                    value={baseSku}
                    onChange={(e) => setBaseSku(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono uppercase focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Purchase Price (₹)</label>
                  <input
                    type="number"
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Selling Price (₹)</label>
                  <input
                    type="number"
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">MRP Tag (₹)</label>
                  <input
                    type="number"
                    value={mrp}
                    onChange={(e) => setMrp(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Fabric / Material</label>
                  <input
                    type="text"
                    value={fabric}
                    onChange={(e) => setFabric(e.target.value)}
                    placeholder="e.g. 100% Egyptian Cotton"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Initial Stock per Variant</label>
                  <input
                    type="number"
                    min="0"
                    value={stockPerVariant}
                    onChange={(e) => setStockPerVariant(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Sizes Selector */}
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Select Garment Sizes *
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {commonSizes.map((sz) => {
                    const isSel = selectedSizes.includes(sz);
                    return (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => toggleSize(sz)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition ${
                          isSel
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        {sz}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Colors List */}
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Colors (comma-separated) *
                </label>
                <input
                  type="text"
                  value={colorsInput}
                  onChange={(e) => setColorsInput(e.target.value)}
                  placeholder="e.g. Navy Blue, Jet Black, Maroon, Olive"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                />
              </div>

              {/* Total Combinations Preview */}
              <div className="p-3 bg-purple-50 dark:bg-purple-950/40 rounded-xl border border-purple-200 dark:border-purple-900 flex justify-between items-center text-xs">
                <div>
                  <span className="font-bold text-purple-700 dark:text-purple-300">Matrix Matrix SKUs to Generate: </span>
                  <span className="font-mono font-bold text-purple-900 dark:text-purple-100">
                    {selectedSizes.length} sizes × {colorsInput.split(',').filter(Boolean).length} colors = {selectedSizes.length * colorsInput.split(',').filter(Boolean).length} SKUs
                  </span>
                </div>
                <div className="font-mono font-black text-purple-600 dark:text-purple-400">
                  Total Initial Stock: {selectedSizes.length * colorsInput.split(',').filter(Boolean).length * (Number(stockPerVariant) || 0)} Pcs
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddStyleModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30 transition"
                >
                  Generate Style Matrix
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: GARMENT SIZE / COLOR EXCHANGE */}
      {/* ========================================================================= */}
      {isExchangeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-50 dark:bg-amber-950/60 text-amber-600 rounded-xl">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white font-['Outfit']">
                    Size / Color Exchange Counter
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Customer returns wrong size/color and takes replacement with instant stock rebalance
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsExchangeModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateExchange} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Original Sales Invoice # *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. ZT-1002, INV-1001"
                    value={exchangeInvNum}
                    onChange={(e) => setExchangeInvNum(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Customer Name</label>
                  <input
                    type="text"
                    value={exchangeCustName}
                    onChange={(e) => setExchangeCustName(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                  />
                </div>
              </div>

              {/* Returned Item Box */}
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-2xl space-y-2">
                <div className="font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                  <span>1. Customer Returned Garment (Restocks +1)</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-3">
                    <input
                      type="text"
                      required
                      placeholder="Style Name"
                      value={returnedStyle}
                      onChange={(e) => setReturnedStyle(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">Returned Size</label>
                    <input
                      type="text"
                      required
                      value={returnedSize}
                      onChange={(e) => setReturnedSize(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-center font-bold text-xs"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400">Returned Color</label>
                    <input
                      type="text"
                      required
                      value={returnedColor}
                      onChange={(e) => setReturnedColor(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Issued Item Box */}
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-2xl space-y-2">
                <div className="font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <span>2. Replacement Garment Handed to Customer (Deducts -1)</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-3">
                    <input
                      type="text"
                      required
                      placeholder="Replacement Style Name"
                      value={issuedStyle}
                      onChange={(e) => setIssuedStyle(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">New Size Handed</label>
                    <input
                      type="text"
                      required
                      value={issuedSize}
                      onChange={(e) => setIssuedSize(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-center font-bold text-xs"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400">New Color Handed</label>
                    <input
                      type="text"
                      required
                      value={issuedColor}
                      onChange={(e) => setIssuedColor(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Exchange Reason</label>
                  <select
                    value={exchangeReason}
                    onChange={(e) => setExchangeReason(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                  >
                    <option value="WRONG_SIZE">Wrong Size / Fit Issue</option>
                    <option value="COLOR_MISMATCH">Color Change Requested</option>
                    <option value="DEFECT">Defective Stitching / Button</option>
                    <option value="GIFT_EXCHANGE">Gift Exchange by Recipient</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Price Difference (₹)</label>
                  <input
                    type="number"
                    value={priceDiff}
                    onChange={(e) => setPriceDiff(e.target.value)}
                    placeholder="0 if same price, +amount if upgraded"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsExchangeModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/30 transition"
                >
                  Confirm Size Exchange
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: QUICK ADJUST VARIANT STOCK */}
      {/* ========================================================================= */}
      {editStockModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-sm w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-sm text-slate-900 dark:text-white">
                Adjust Variant Stock
              </h3>
              <button onClick={() => setEditStockModal(null)} className="p-1 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateStock} className="space-y-4 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl space-y-1">
                <div className="text-[11px] text-slate-400">Variant SKU:</div>
                <div className="font-mono font-bold text-slate-900 dark:text-white">
                  {editStockModal.variant.variant_sku}
                </div>
                <div className="text-[11px] text-purple-600 dark:text-purple-400 font-semibold">
                  Size: {editStockModal.variant.size} | Color: {editStockModal.variant.color}
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  New Stock Count (Pcs)
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={newStockInput}
                  onChange={(e) => setNewStockInput(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-mono font-bold focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditStockModal(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-purple-600 text-white"
                >
                  Save Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
