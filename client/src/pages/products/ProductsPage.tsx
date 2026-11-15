import React, { useState, useEffect, useRef } from 'react';
import { api, downloadFile, type ProductOptions } from '../../lib/api.js';
import { CatalogListsManager, type ListTab } from './CatalogListsManager.js';
import { domainFieldsFor } from './domainFields.js';
import { useAuth } from '../../context/AuthContext.js';
import { Product, Category } from '../../types/index.js';
import { formatINR, paiseToRupees, rupeesToPaise } from '../../lib/utils.js';
import { 
  Package, Plus, Search, Edit2, Trash2, Barcode, 
  Tag, AlertTriangle, X, Check, RefreshCw, Upload, List, Settings2
} from 'lucide-react';

// Units and GST rates offered until the shop's own lists load (Categories & Units); anything else can be typed ("Custom…")
const UNITS: { value: string; label: string }[] = [
  { value: 'pcs', label: 'Pieces (pcs)' }, { value: 'kg', label: 'Kilograms (kg)' }, { value: 'gm', label: 'Grams (gm)' },
  { value: 'ltr', label: 'Litres (ltr)' }, { value: 'ml', label: 'Millilitres (ml)' }, { value: 'mtr', label: 'Metres (mtr)' },
  { value: 'pkt', label: 'Packet (pkt)' }, { value: 'box', label: 'Box' }, { value: 'dozen', label: 'Dozen' }, { value: 'pair', label: 'Pair' },
  { value: 'set', label: 'Set' }, { value: 'strip', label: 'Strip' }, { value: 'bottle', label: 'Bottle' }, { value: 'bag', label: 'Bag' },
  { value: 'portion', label: 'Portion' }, { value: 'plate', label: 'Plate' }, { value: 'hour', label: 'Hour' }, { value: 'job', label: 'Job / Service' },
];
const GST_RATES = ['0', '0.25', '3', '5', '12', '18', '28'];
const CUSTOM = '__custom';
const NEW_CATEGORY = '__new_category';
const SUGGESTED = '__suggested:';

/** A file as base64 (for the import) */
const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});
import { confirmDialog, promptDialog, showAlert } from '../../components/ui/dialogs.js';
import { Select } from '../../components/ui/Select.js';
import { findProductByCode, scanBeep, takeScanIntent, useScanner } from '../../lib/scanner.js';

import { useLiveRefresh } from '../../lib/live.js';
export const ProductsPage: React.FC = () => {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [options, setOptions] = useState<ProductOptions | null>(null);
  const [manager, setManager] = useState<ListTab | null>(null);
  const unitList = options?.units ?? UNITS;
  const rateList = options ? options.gstRates.map((r) => r.rate) : GST_RATES;
  const domain = domainFieldsFor(user?.businessCategory);
  const [importing, setImporting] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [typingUnit, setTypingUnit] = useState(false);
  const [hsnCode, setHsnCode] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('0');
  const [salePrice, setSalePrice] = useState('0');
  const [mrp, setMrp] = useState('0');
  const [taxRate, setTaxRate] = useState('18');
  const [typingRate, setTypingRate] = useState(false);
  const [stockQuantity, setStockQuantity] = useState('0');
  const [lowStockThreshold, setLowStockThreshold] = useState('5');
  
  // Details for this kind of business (domainFields.ts), kept in the product's extra attributes
  const [details, setDetails] = useState<Record<string, string>>({});

  const [formError, setFormError] = useState('');

  useEffect(() => {
    loadData();
  }, [search, selectedCategory]);

  // Another computer of this account changed something: the lists reload quietly
  useLiveRefresh(() => { void loadData(true); });
  const loadData = async (quiet?: unknown) => {
    try {
      if (quiet !== true) setLoading(true);
      const [prodRes, catRes] = await Promise.all([
        api.getProducts({
          search: search || undefined,
          categoryId: selectedCategory || undefined,
          limit: 200,
        }),
        api.getCategories(),
      ]);
      setProducts(prodRes.data);
      setCategories(catRes.data);
      setSuggestions(catRes.suggestions || []);
      api.getProductOptions().then(setOptions).catch(() => {});
    } catch (err) {
      console.error('Failed to load catalog data', err);
    } finally {
      setLoading(false);
    }
  };

  // Category: an existing one, one that fits this kind of business (made on the spot), or a new name typed in
  const chooseCategory = async (value: string) => {
    if (value !== NEW_CATEGORY && !value.startsWith(SUGGESTED)) {
      setCategoryId(value);
      return;
    }
    const name = value === NEW_CATEGORY
      ? (await promptDialog('Name of the new category', { title: 'New category', placeholder: 'e.g. Cold Drinks', required: true, confirmText: 'Add' }))?.trim()
      : value.slice(SUGGESTED.length);
    if (!name) return;
    const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setCategoryId(existing.id);
      return;
    }
    try {
      const { category } = await api.createCategory({ name });
      setCategories((cs) => [...cs, category].sort((a, b) => a.name.localeCompare(b.name)));
      setSuggestions((list) => list.filter((n) => n.toLowerCase() !== name.toLowerCase()));
      setCategoryId(category.id);
    } catch (err: any) {
      await showAlert(err.message || 'Could not add the category', { tone: 'error' });
    }
  };

  // Products → Import Excel: an .xlsx or .csv with the Export's columns (Export Excel is the template)
  const importFile = async (file: File) => {
    if (file.size > 3_500_000) {
      await showAlert('This file is too large. Import at most about 10,000 products at a time.', { tone: 'warning' });
      return;
    }
    setImporting(true);
    try {
      const r = await api.importProducts(file.name, await fileToBase64(file));
      const lines = [`${r.created} new product${r.created === 1 ? '' : 's'} added, ${r.updated} updated.`];
      if (r.skipped) {
        lines.push('', `${r.skipped} row${r.skipped === 1 ? '' : 's'} skipped:`, ...r.errors.slice(0, 10).map((e) => `Row ${e.row}: ${e.message}`));
        if (r.skipped > 10) lines.push(`…and ${r.skipped - 10} more`);
      }
      await showAlert(lines.join('\n'), { title: 'Import finished', tone: r.skipped ? 'warning' : 'success' });
      await loadData();
    } catch (err: any) {
      await showAlert(err.message || 'The file could not be imported', { title: 'Import failed', tone: 'error' });
    } finally {
      setImporting(false);
    }
  };

  const openAddModal = () => {
    setEditingProduct(null);
    setName('');
    setSku(`SKU-${Date.now().toString().slice(-6)}`);
    setBarcode('');
    setCategoryId(categories[0]?.id || '');
    setUnit(user?.businessCategory === 'RESTAURANT' ? 'portion' : 'pcs');
    setTypingUnit(false);
    setTypingRate(false);
    setHsnCode(user?.businessCategory === 'RESTAURANT' ? '9963' : '9988');
    setPurchasePrice('0');
    setSalePrice('0');
    setMrp('0');
    setTaxRate(user?.businessCategory === 'RESTAURANT' ? '5' : '18');
    setStockQuantity('50');
    setLowStockThreshold('5');
    setDetails(Object.fromEntries((domain?.fields || []).filter((f) => f.initial).map((f) => [f.key, f.initial!])));
    setFormError('');
    setIsModalOpen(true);
  };

  // A scan: with the product form open it fills the barcode; otherwise it opens that product, or a new one with
  // the scanned barcode already filled in
  const onScan = async (code: string) => {
    if (isModalOpen) { setBarcode(code); scanBeep(true); return; }
    const found = await findProductByCode(code).catch(() => null);
    scanBeep(!!found);
    if (found) openEditModal(found);
    else { openAddModal(); setBarcode(code); }
  };
  useScanner((code) => { void onScan(code); return true; });
  // Opened from a scan elsewhere ("Add as new product" / "Edit product"), once the lists have loaded
  useEffect(() => {
    if (loading) return;
    const intent = takeScanIntent('new-product') || takeScanIntent('edit-product');
    if (intent) void onScan(intent.code);
  }, [loading]);

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setName(p.name);
    setSku(p.sku);
    setBarcode(p.barcode || '');
    setCategoryId(p.category_id || '');
    setUnit(p.unit);
    setTypingUnit(!unitList.some((u) => u.value === p.unit));
    setTypingRate(!rateList.includes(String(p.tax_rate)));
    setHsnCode(p.hsn_code || '');
    setPurchasePrice(String(paiseToRupees(p.purchase_price_paise)));
    setSalePrice(String(paiseToRupees(p.sale_price_paise)));
    setMrp(String(paiseToRupees(p.mrp_paise)));
    setTaxRate(String(p.tax_rate));
    setStockQuantity(String(p.stock_quantity));
    setLowStockThreshold(String(p.low_stock_threshold));
    
    const extra = p.extra_attributes || {};
    setDetails(Object.fromEntries((domain?.fields || []).map((f) => [f.key, extra[f.key] === undefined || extra[f.key] === null ? '' : String(extra[f.key])])));

    setFormError('');
    setIsModalOpen(true);
  };

  const handleGenerateBarcode = () => {
    const randomCode = '890' + Math.floor(1000000000 + Math.random() * 9000000000);
    setBarcode(randomCode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!name.trim() || !sku.trim()) {
      setFormError('Product name and SKU are required');
      return;
    }
    if (!unit.trim()) {
      setFormError('Type the unit (e.g. roll, carton), or choose one from the list');
      return;
    }
    const rate = Number(taxRate);
    if (taxRate.trim() === '' || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      setFormError('GST % must be a number from 0 to 100');
      return;
    }

    // The business type's details, on top of what the product already had (nothing else is lost); empty ones go
    const extraAttributes: Record<string, any> = { ...(editingProduct?.extra_attributes || {}) };
    for (const f of domain?.fields || []) {
      const v = (details[f.key] || '').trim();
      if (v) extraAttributes[f.key] = f.type === 'number' ? Number(v) : v;
      else delete extraAttributes[f.key];
    }

    const payload = {
      name,
      sku,
      barcode: barcode || null,
      categoryId: categoryId || null,
      unit,
      hsnCode,
      purchasePricePaise: rupeesToPaise(purchasePrice),
      salePricePaise: rupeesToPaise(salePrice),
      mrpPaise: rupeesToPaise(mrp),
      taxRate: parseFloat(taxRate) || 0,
      stockQuantity: parseFloat(stockQuantity) || 0,
      lowStockThreshold: parseFloat(lowStockThreshold) || 5,
      extraAttributes,
    };

    try {
      if (editingProduct) {
        await api.updateProduct(editingProduct.id, payload);
      } else {
        await api.createProduct(payload);
      }
      setIsModalOpen(false);
      loadData();
      // A unit or GST rate typed in ("Custom…") joins the shop's list, so it is offered next time
      const newUnit = unit.trim() && !unitList.some((u) => u.value.toLowerCase() === unit.trim().toLowerCase());
      const newRate = !rateList.includes(String(Number(taxRate)));
      if (newUnit || newRate) {
        api.saveProductOptions({
          units: newUnit ? [...unitList.map(({ value, label }) => ({ value, label })), { value: unit.trim(), label: unit.trim() }] : undefined,
          gstRates: newRate ? [...rateList.map(Number), Number(taxRate)] : undefined,
        }).then(setOptions).catch(() => {});
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to save product');
    }
  };

  const handleDelete = async (id: string, prodName: string) => {
    if (!(await confirmDialog(`Are you sure you want to deactivate "${prodName}"?`, { danger: true }))) return;
    try {
      await api.deleteProduct(id);
      loadData();
    } catch (err: any) {
      showAlert(err.message || 'Failed to delete product');
    }
  };

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
            Product & Service Catalog
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            SKUs, Barcodes, HSN Tax codes, prices in INR and vertical attributes
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
        <button
          onClick={() => setManager('categories')}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
        >
          <Settings2 className="w-3.5 h-3.5" />
          Categories & Units
        </button>
        <input ref={importInput} type="file" accept=".xlsx,.csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
        <button
          onClick={() => importInput.current?.click()}
          disabled={importing}
          title="Add or update products from an Excel or CSV file (use Export Excel as the template)"
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60"
        >
          {importing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {importing ? 'Importing…' : 'Import Excel'}
        </button>
        <button
          onClick={() => downloadFile('/app/products/export?format=xlsx', 'products.xlsx').catch((err) => showAlert(err.message))}
          className="text-xs font-semibold px-3 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50"
        >
          Export Excel
        </button>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-md shadow-emerald-500/25 transition active:scale-95 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Product</span>
        </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by product name, SKU, barcode, HSN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <Select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold">
                <th className="p-3.5">Item Name</th>
                <th className="p-3.5">SKU / Barcode</th>
                <th className="p-3.5">Category</th>
                <th className="p-3.5 text-center">GST %</th>
                <th className="p-3.5 text-right">MRP</th>
                <th className="p-3.5 text-right">Sale Price</th>
                <th className="p-3.5 text-center">Stock Available</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {products.length > 0 ? (
                products.map((p) => {
                  const isLow = p.stock_quantity <= p.low_stock_threshold;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                      <td className="p-3.5">
                        <div className="font-bold text-slate-900 dark:text-white">{p.name}</div>
                        {domain && (() => {
                          const shown = domain.fields.filter((f) => p.extra_attributes?.[f.key] !== undefined && p.extra_attributes?.[f.key] !== '').slice(0, 3);
                          return shown.length > 0 && (
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                              {shown.map((f) => `${f.label}: ${p.extra_attributes?.[f.key]}`).join(' · ')}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="p-3.5 font-mono">
                        <div className="text-slate-700 dark:text-slate-300 font-semibold">{p.sku}</div>
                        {p.barcode && <div className="text-[10px] text-slate-400">{p.barcode}</div>}
                      </td>
                      <td className="p-3.5 text-slate-500 dark:text-slate-400">
                        {p.category_name || 'General'}
                      </td>
                      <td className="p-3.5 text-center font-bold text-slate-700 dark:text-slate-300">
                        {p.tax_rate}%
                      </td>
                      <td className="p-3.5 text-right font-mono text-slate-400 line-through">
                        {p.mrp_paise > 0 ? formatINR(p.mrp_paise) : '-'}
                      </td>
                      <td className="p-3.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {formatINR(p.sale_price_paise)}
                      </td>
                      <td className="p-3.5 text-center">
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                            isLow
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                        >
                          {p.stock_quantity} {p.unit}
                        </span>
                      </td>
                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEditModal(p)}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-emerald-600 transition"
                            title="Edit Product"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(p.id, p.name)}
                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 text-slate-400 hover:text-red-600 transition"
                            title="Delete Product"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No products found. Click "Add New Product" to populate your catalog!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                {editingProduct ? 'Edit Catalog Product' : 'Add New Product to Catalog'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 text-xs rounded-lg">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Product / Item Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Fortune Sunflower Oil 1L"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">SKU Code *</label>
                  <input
                    type="text"
                    required
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Barcode</label>
                    <button
                      type="button"
                      onClick={handleGenerateBarcode}
                      className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
                    >
                      Generate
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="e.g. 890123456789 (or scan it)"
                    data-scan-input="no-enter"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Category</label>
                  <Select
                    value={categoryId}
                    onChange={(e) => void chooseCategory(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    {suggestions.map((n) => (
                      <option key={`s-${n}`} value={SUGGESTED + n}>＋ {n}</option>
                    ))}
                    <option value={NEW_CATEGORY}>＋ New category…</option>
                  </Select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Unit</label>
                  {typingUnit ? (
                    <div className="flex gap-1">
                      <input
                        type="text"
                        autoFocus
                        maxLength={20}
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        placeholder="e.g. roll, carton"
                        className="w-full min-w-0 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                      <button type="button" title="Choose from the list" onClick={() => { setTypingUnit(false); setUnit('pcs'); }}
                        className="shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 px-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                        <List className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <Select
                      value={unit}
                      onChange={(e) => { if (e.target.value === CUSTOM) { setTypingUnit(true); setUnit(''); } else setUnit(e.target.value); }}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    >
                      {unitList.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                      <option value={CUSTOM}>Custom… (type your own)</option>
                    </Select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">HSN/SAC Code</label>
                  <input
                    type="text"
                    value={hsnCode}
                    onChange={(e) => setHsnCode(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Pricing & GST */}
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Purchase (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">MRP (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={mrp}
                    onChange={(e) => setMrp(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Sale Price (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">GST Tax %</label>
                  {typingRate ? (
                    <div className="flex gap-1">
                      <input
                        type="number"
                        autoFocus
                        min={0}
                        max={100}
                        step="0.01"
                        value={taxRate}
                        onChange={(e) => setTaxRate(e.target.value)}
                        placeholder="e.g. 1.5"
                        className="w-full min-w-0 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                      <button type="button" title="Choose from the list" onClick={() => { setTypingRate(false); setTaxRate('18'); }}
                        className="shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 px-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                        <List className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <Select
                      value={taxRate}
                      onChange={(e) => { if (e.target.value === CUSTOM) { setTypingRate(true); setTaxRate(''); } else setTaxRate(e.target.value); }}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                    >
                      {rateList.map((r) => <option key={r} value={r}>{r === '0' ? '0% (Nil)' : `${r}%`}</option>)}
                      <option value={CUSTOM}>Custom… (type a rate)</option>
                    </Select>
                  )}
                </div>
              </div>

              {/* Stock settings */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Stock Quantity</label>
                  <input
                    type="number"
                    value={stockQuantity}
                    onChange={(e) => setStockQuantity(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Low Stock Alert Threshold</label>
                  <input
                    type="number"
                    value={lowStockThreshold}
                    onChange={(e) => setLowStockThreshold(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Details for this kind of business (domainFields.ts) */}
              {domain && (
                <div className="p-3 rounded-xl border border-emerald-200/70 dark:border-slate-700 bg-emerald-50/50 dark:bg-slate-800/40 space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">{domain.title}</span>
                  <div className="grid grid-cols-2 gap-3">
                    {domain.fields.map((f) => (
                      <div key={f.key}>
                        <label className="block text-[11px] text-slate-600 dark:text-slate-300 mb-1">{f.label}</label>
                        {f.type === 'select' ? (
                          <Select
                            value={details[f.key] || ''}
                            onChange={(e) => setDetails({ ...details, [f.key]: e.target.value })}
                            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                          >
                            <option value="">—</option>
                            {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                          </Select>
                        ) : (
                          <input
                            type={f.type || 'text'}
                            placeholder={f.placeholder}
                            value={details[f.key] || ''}
                            onChange={(e) => setDetails({ ...details, [f.key]: e.target.value })}
                            className={`w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white ${f.mono ? 'font-mono' : ''}`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md transition"
                >
                  {editingProduct ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {manager && options && (
        <CatalogListsManager
          tab={manager}
          onTab={setManager}
          onClose={() => setManager(null)}
          categories={categories}
          options={options}
          onOptions={setOptions}
          onCategoriesChanged={loadData}
        />
      )}
    </div>
  );
};
