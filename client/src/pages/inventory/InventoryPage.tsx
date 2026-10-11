import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { Product } from '../../types/index.js';
import { formatDateTime } from '../../lib/utils.js';
import { 
  Warehouse, AlertTriangle, ArrowUpDown, PlusCircle, 
  MinusCircle, History, CheckCircle, X, Search 
} from 'lucide-react';

export const InventoryPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'levels' | 'movements'>('levels');
  const [search, setSearch] = useState('');
  
  // Adjustment Modal
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [changeQty, setChangeQty] = useState('');
  const [adjustType, setAdjustType] = useState<'ADD' | 'REMOVE'>('ADD');
  const [reason, setReason] = useState('RESTOCK');
  const [notes, setNotes] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    loadInventory();
  }, []);

  const loadInventory = async () => {
    try {
      const [prodRes, alertRes, movRes] = await Promise.all([
        api.getProducts({ limit: 200 }),
        api.getLowStockAlerts(),
        api.getStockMovements(),
      ]);
      setProducts(prodRes.data);
      setAlerts(alertRes.data);
      setMovements(movRes.data);
    } catch (err) {
      console.error('Failed to load inventory', err);
    }
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId || !changeQty) return;

    const qtyNumber = parseFloat(changeQty);
    const finalChange = adjustType === 'ADD' ? Math.abs(qtyNumber) : -Math.abs(qtyNumber);

    try {
      await api.adjustStock({
        productId: selectedProductId,
        changeQuantity: finalChange,
        reason,
        notes,
      });
      setStatusMsg('Stock adjusted and audit ledger updated successfully!');
      setTimeout(() => setStatusMsg(''), 4000);
      setIsAdjustModalOpen(false);
      setChangeQty('');
      setNotes('');
      loadInventory();
    } catch (err: any) {
      alert(err.message || 'Stock adjustment failed');
    }
  };

  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
            Inventory & Stock Control
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time stock ledger, manual audit adjustments, and automated low-stock warnings
          </p>
        </div>

        <button
          onClick={() => {
            setSelectedProductId(products[0]?.id || '');
            setIsAdjustModalOpen(true);
          }}
          className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-md shadow-emerald-500/25 transition active:scale-95 self-start sm:self-auto"
        >
          <ArrowUpDown className="w-4 h-4" />
          <span>Manual Stock Adjustment</span>
        </button>
      </div>

      {statusMsg && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs rounded-xl flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Low Stock Warning Banner */}
      {alerts.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800/80 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200">
              Low Stock Alert ({alerts.length} Items Require Reorder)
            </h4>
            <div className="flex flex-wrap gap-2 pt-1">
              {alerts.map((a) => (
                <span
                  key={a.id}
                  className="text-[11px] font-semibold bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-lg shadow-xs"
                >
                  {a.name}: <b>{a.stock_quantity} {a.unit}</b> left (Min: {a.low_stock_threshold})
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('levels')}
          className={`pb-2.5 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'levels'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Warehouse className="w-4 h-4" />
          <span>Stock Levels ({products.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('movements')}
          className={`pb-2.5 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'movements'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Movement Audit Ledger</span>
        </button>
      </div>

      {activeTab === 'levels' && (
        <div className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search items by name or SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500 shadow-sm"
            />
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold">
                  <th className="p-3.5">Product Name</th>
                  <th className="p-3.5">SKU</th>
                  <th className="p-3.5">Category</th>
                  <th className="p-3.5 text-center">Unit</th>
                  <th className="p-3.5 text-center">Current Stock</th>
                  <th className="p-3.5 text-center">Reorder Threshold</th>
                  <th className="p-3.5 text-center">Health Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredProducts.map((p) => {
                  const isLow = p.stock_quantity <= p.low_stock_threshold;
                  const isOut = p.stock_quantity <= 0;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                      <td className="p-3.5 font-bold text-slate-900 dark:text-white">{p.name}</td>
                      <td className="p-3.5 font-mono text-slate-500">{p.sku}</td>
                      <td className="p-3.5 text-slate-600 dark:text-slate-300">{p.category_name || 'General'}</td>
                      <td className="p-3.5 text-center">{p.unit}</td>
                      <td className="p-3.5 text-center font-bold font-mono text-slate-900 dark:text-white">
                        {p.stock_quantity}
                      </td>
                      <td className="p-3.5 text-center text-slate-500">{p.low_stock_threshold}</td>
                      <td className="p-3.5 text-center">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isOut
                              ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                              : isLow
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                        >
                          {isOut ? 'Out of Stock' : isLow ? 'Low Stock' : 'Adequate'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'movements' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold">
                <th className="p-3.5">Timestamp</th>
                <th className="p-3.5">Product</th>
                <th className="p-3.5">Type</th>
                <th className="p-3.5 text-right">Change</th>
                <th className="p-3.5 text-right">New Balance</th>
                <th className="p-3.5">Reason / Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {movements.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                  <td className="p-3.5 text-slate-400">{formatDateTime(m.created_at)}</td>
                  <td className="p-3.5 font-semibold text-slate-800 dark:text-slate-200">{m.product_name}</td>
                  <td className="p-3.5">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {m.movement_type}
                    </span>
                  </td>
                  <td className={`p-3.5 text-right font-mono font-bold ${m.change_quantity > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {m.change_quantity > 0 ? `+${m.change_quantity}` : m.change_quantity}
                  </td>
                  <td className="p-3.5 text-right font-mono font-bold">{m.resulting_quantity}</td>
                  <td className="p-3.5 text-slate-500">{m.notes || m.reference_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual Stock Adjustment Modal */}
      {isAdjustModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Record Stock Adjustment
              </h3>
              <button onClick={() => setIsAdjustModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Select Product *</label>
                <select
                  required
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Current: {p.stock_quantity} {p.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Operation</label>
                  <div className="grid grid-cols-2 gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setAdjustType('ADD')}
                      className={`py-1 text-xs font-bold rounded-lg transition ${
                        adjustType === 'ADD' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      + Add
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjustType('REMOVE')}
                      className={`py-1 text-xs font-bold rounded-lg transition ${
                        adjustType === 'REMOVE' ? 'bg-red-600 text-white shadow-sm' : 'text-slate-500'
                      }`}
                    >
                      - Remove
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Quantity *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="e.g. 10"
                    value={changeQty}
                    onChange={(e) => setChangeQty(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Reason Code</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="RESTOCK">Supplier Restock / Inward</option>
                  <option value="DAMAGED">Damaged / Broken / Spillage</option>
                  <option value="EXPIRED">Expired Batch</option>
                  <option value="AUDIT">Inventory Audit Discrepancy</option>
                  <option value="RETURN">Customer Return</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Notes / Audit Remarks</label>
                <input
                  type="text"
                  placeholder="Optional explanatory notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md transition"
                >
                  Apply Stock Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
