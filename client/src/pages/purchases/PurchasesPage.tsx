import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { Product } from '../../types/index.js';
import { formatINR, formatDate, rupeesToPaise } from '../../lib/utils.js';
import { 
  Truck, Plus, Search, CheckCircle, PackagePlus, 
  Building2, X, PlusCircle, Trash2 
} from 'lucide-react';

export const PurchasesPage: React.FC = () => {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeTab, setActiveTab] = useState<'bills' | 'suppliers'>('bills');
  
  // Add Supplier Modal
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [suppName, setSuppName] = useState('');
  const [suppPhone, setSuppPhone] = useState('');
  const [suppGstin, setSuppGstin] = useState('');
  const [suppAddress, setSuppAddress] = useState('');

  // Record Purchase Modal
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [purchaseItems, setPurchaseItems] = useState<Array<{ productId: string; productName: string; quantity: number; unitPriceRupees: string; taxRate: number }>>([]);
  const [amountPaidRupees, setAmountPaidRupees] = useState('');
  const [notes, setNotes] = useState('');
  
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [supRes, purRes, prodRes] = await Promise.all([
        api.getSuppliers(),
        api.getPurchases(),
        api.getProducts({ limit: 100 }),
      ]);
      setSuppliers(supRes.data);
      setPurchases(purRes.data);
      setProducts(prodRes.data);
    } catch (err) {
      console.error('Failed to load purchases data', err);
    }
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suppName.trim()) return;

    try {
      await api.createSupplier({
        name: suppName,
        phone: suppPhone,
        gstin: suppGstin,
        address: suppAddress,
      });
      setIsSupplierModalOpen(false);
      setSuppName('');
      setSuppPhone('');
      setSuppGstin('');
      setSuppAddress('');
      setStatusMsg('Supplier added successfully!');
      setTimeout(() => setStatusMsg(''), 4000);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to add supplier');
    }
  };

  const addItemToPurchase = (prod: Product) => {
    setPurchaseItems((prev) => [
      ...prev,
      {
        productId: prod.id,
        productName: prod.name,
        quantity: 10,
        unitPriceRupees: String(prod.purchase_price_paise / 100),
        taxRate: prod.tax_rate,
      },
    ]);
  };

  const handleRecordPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierId || !billNumber || !purchaseItems.length) {
      alert('Please select supplier, invoice number, and add at least one item');
      return;
    }

    const supplierObj = suppliers.find((s) => s.id === selectedSupplierId);

    try {
      await api.createPurchase({
        supplierId: selectedSupplierId,
        supplierName: supplierObj?.name || 'Wholesale Supplier',
        purchaseNumber: billNumber,
        items: purchaseItems.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          quantity: it.quantity,
          unitPricePaise: rupeesToPaise(it.unitPriceRupees),
          taxRate: it.taxRate,
        })),
        amountPaidPaise: rupeesToPaise(amountPaidRupees || '0'),
        notes,
      });
      setIsPurchaseModalOpen(false);
      setPurchaseItems([]);
      setBillNumber('');
      setNotes('');
      setStatusMsg('Purchase invoice recorded and product stock automatically updated!');
      setTimeout(() => setStatusMsg(''), 4000);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to record purchase');
    }
  };

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
            Purchases & Supplier Management
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Record goods received notes (GRN), purchase invoices, and track supplier payables
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsSupplierModalOpen(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition shadow-sm"
          >
            <Building2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>Add Supplier</span>
          </button>

          <button
            onClick={() => {
              setSelectedSupplierId(suppliers[0]?.id || '');
              setBillNumber(`PUR-${Date.now().toString().slice(-5)}`);
              setPurchaseItems([]);
              setIsPurchaseModalOpen(true);
            }}
            className="flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition"
          >
            <PackagePlus className="w-4 h-4" />
            <span>Record Inward Purchase</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs rounded-xl flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('bills')}
          className={`pb-2.5 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'bills'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Truck className="w-4 h-4" />
          <span>Purchase Invoices ({purchases.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('suppliers')}
          className={`pb-2.5 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'suppliers'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Suppliers Directory ({suppliers.length})</span>
        </button>
      </div>

      {/* 1. Purchase Invoices List */}
      {activeTab === 'bills' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold">
                <th className="p-3.5">Bill Number</th>
                <th className="p-3.5">Date</th>
                <th className="p-3.5">Supplier Name</th>
                <th className="p-3.5 text-right">Taxable</th>
                <th className="p-3.5 text-right">GST Tax</th>
                <th className="p-3.5 text-right">Bill Total</th>
                <th className="p-3.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {purchases.length > 0 ? (
                purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="p-3.5 font-mono font-bold text-slate-900 dark:text-white">
                      {p.purchase_number}
                    </td>
                    <td className="p-3.5 text-slate-500">{formatDate(p.invoice_date)}</td>
                    <td className="p-3.5 font-semibold text-slate-800 dark:text-slate-200">
                      {p.supplier_name}
                    </td>
                    <td className="p-3.5 text-right font-mono text-slate-600 dark:text-slate-300">
                      {formatINR(p.subtotal_paise)}
                    </td>
                    <td className="p-3.5 text-right font-mono text-slate-600 dark:text-slate-300">
                      {formatINR(p.tax_paise)}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {formatINR(p.total_paise)}
                    </td>
                    <td className="p-3.5 text-center">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        {p.payment_status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No purchase invoices recorded yet. Click "Record Inward Purchase" to restock inventory!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 2. Suppliers Directory */}
      {activeTab === 'suppliers' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold">
                <th className="p-3.5">Supplier Name</th>
                <th className="p-3.5">Phone & Email</th>
                <th className="p-3.5">GSTIN</th>
                <th className="p-3.5">Address</th>
                <th className="p-3.5 text-right">Balance Payable (Dues)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                  <td className="p-3.5 font-bold text-slate-900 dark:text-white">{s.name}</td>
                  <td className="p-3.5">
                    <div className="font-mono text-slate-700 dark:text-slate-300">{s.phone || '-'}</div>
                    {s.email && <div className="text-[10px] text-slate-400">{s.email}</div>}
                  </td>
                  <td className="p-3.5 font-mono text-slate-600 dark:text-slate-300">{s.gstin || '-'}</td>
                  <td className="p-3.5 text-slate-500 truncate max-w-xs">{s.address || '-'}</td>
                  <td className="p-3.5 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                    {formatINR(s.outstanding_balance_paise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Supplier Modal */}
      {isSupplierModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">Add New Supplier / Vendor</h3>
              <button onClick={() => setIsSupplierModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSupplier} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Company / Supplier Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Parle Agro Wholesale Ltd"
                  value={suppName}
                  onChange={(e) => setSuppName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={suppPhone}
                    onChange={(e) => setSuppPhone(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">GSTIN</label>
                  <input
                    type="text"
                    value={suppGstin}
                    onChange={(e) => setSuppGstin(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Warehouse Address</label>
                <input
                  type="text"
                  value={suppAddress}
                  onChange={(e) => setSuppAddress(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSupplierModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md transition"
                >
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Inward Purchase Modal */}
      {isPurchaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Record Inward Goods / Purchase Bill
              </h3>
              <button onClick={() => setIsPurchaseModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRecordPurchase} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Select Supplier *</label>
                  <select
                    required
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Supplier Invoice # *</label>
                  <input
                    type="text"
                    required
                    value={billNumber}
                    onChange={(e) => setBillNumber(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Quick Item Picker */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Add Products to Purchase</label>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                  {products.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addItemToPurchase(p)}
                      className="px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-slate-700 hover:bg-emerald-50 hover:text-emerald-600 rounded-lg border border-slate-200 dark:border-slate-600 transition"
                    >
                      + {p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2">
                <label className="block font-semibold text-slate-700 dark:text-slate-300">Inward Items ({purchaseItems.length})</label>
                {purchaseItems.map((it, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
                    <span className="flex-1 font-semibold truncate text-slate-800 dark:text-slate-200">{it.productName}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Qty:</span>
                      <input
                        type="number"
                        min="1"
                        value={it.quantity}
                        onChange={(e) => {
                          const next = [...purchaseItems];
                          next[idx].quantity = Number(e.target.value) || 1;
                          setPurchaseItems(next);
                        }}
                        className="w-16 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 text-center font-bold"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-400">Rate ₹:</span>
                      <input
                        type="number"
                        value={it.unitPriceRupees}
                        onChange={(e) => {
                          const next = [...purchaseItems];
                          next[idx].unitPriceRupees = e.target.value;
                          setPurchaseItems(next);
                        }}
                        className="w-20 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 text-right font-mono"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setPurchaseItems(purchaseItems.filter((_, i) => i !== idx))}
                      className="text-red-500 hover:bg-red-50 p-1 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Amount Paid Now (₹)</label>
                <input
                  type="number"
                  placeholder="Leave 0 for unpaid credit purchase"
                  value={amountPaidRupees}
                  onChange={(e) => setAmountPaidRupees(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsPurchaseModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md transition"
                >
                  Confirm Inward Purchase & Restock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
