import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { UtensilsCrossed, Plus, Clock, Check, Users, ChefHat, X } from 'lucide-react';

export const RestaurantPage: React.FC = () => {
  const [tables, setTables] = useState<any[]>([]);
  const [kots, setKots] = useState<any[]>([]);
  const [isAddTableOpen, setIsAddTableOpen] = useState(false);
  const [tableNum, setTableNum] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [activeTab, setActiveTab] = useState<'tables' | 'kots'>('tables');

  useEffect(() => {
    loadRestaurantData();
  }, []);

  const loadRestaurantData = async () => {
    try {
      const [tRes, kRes] = await Promise.all([
        api.getRestaurantTables(),
        api.getKots(),
      ]);
      setTables(tRes.data);
      setKots(kRes.data);
    } catch (err) {
      console.error('Failed to load restaurant data', err);
    }
  };

  const handleStatusChange = async (id: string, current: string) => {
    const cycle = { VACANT: 'OCCUPIED', OCCUPIED: 'BILLED', BILLED: 'VACANT' } as any;
    const next = cycle[current] || 'VACANT';
    try {
      await api.updateTableStatus(id, next);
      loadRestaurantData();
    } catch (err: any) {
      alert(err.message || 'Failed to update table');
    }
  };

  const handleKotStatus = async (id: string, current: string) => {
    const cycle = { PENDING: 'PREPARING', PREPARING: 'READY', READY: 'SERVED', SERVED: 'SERVED' } as any;
    const next = cycle[current] || 'PREPARING';
    try {
      await api.updateKotStatus(id, next);
      loadRestaurantData();
    } catch (err: any) {
      alert(err.message || 'Failed to update KOT');
    }
  };

  const handleAddTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableNum) return;
    try {
      await api.createRestaurantTable({ tableNumber: tableNum, capacity: Number(capacity) });
      setIsAddTableOpen(false);
      setTableNum('');
      loadRestaurantData();
    } catch (err: any) {
      alert(err.message || 'Failed to add table');
    }
  };

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
            Restaurant Dining & KOT Operations
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time table visual grid, Kitchen Order Tickets (KOT), and dining statuses
          </p>
        </div>

        <button
          onClick={() => setIsAddTableOpen(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-md transition self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add Dining Table</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('tables')}
          className={`pb-2.5 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'tables'
              ? 'border-amber-500 text-amber-600 dark:text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <UtensilsCrossed className="w-4 h-4" />
          <span>Dine-in Floor Layout ({tables.length} Tables)</span>
        </button>

        <button
          onClick={() => setActiveTab('kots')}
          className={`pb-2.5 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'kots'
              ? 'border-amber-500 text-amber-600 dark:text-amber-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <ChefHat className="w-4 h-4" />
          <span>Kitchen Order Tickets (KOT Display)</span>
        </button>
      </div>

      {/* Table Visual Grid */}
      {activeTab === 'tables' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {tables.map((t) => {
            const isVacant = t.status === 'VACANT';
            const isOccupied = t.status === 'OCCUPIED';
            const isBilled = t.status === 'BILLED';

            return (
              <div
                key={t.id}
                className={`p-5 rounded-2xl border transition shadow-sm flex flex-col justify-between h-40 ${
                  isVacant
                    ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                    : isOccupied
                    ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800'
                    : 'bg-purple-50/50 dark:bg-purple-950/20 border-purple-300 dark:border-purple-800'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{t.table_number}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      isVacant ? 'bg-emerald-100 text-emerald-800' :
                      isOccupied ? 'bg-amber-100 text-amber-800' : 'bg-purple-100 text-purple-800'
                    }`}>
                      {t.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-2">
                    <Users className="w-3.5 h-3.5" />
                    <span>Capacity: {t.capacity} Guests</span>
                  </div>
                </div>

                <button
                  onClick={() => handleStatusChange(t.id, t.status)}
                  className="w-full py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 text-slate-700 dark:text-slate-200 transition"
                >
                  Change Status (Click)
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* KOT Display */}
      {activeTab === 'kots' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {kots.length > 0 ? (
            kots.map((k) => (
              <div key={k.id} className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-xs text-amber-600 dark:text-amber-400">{k.kot_number}</span>
                  <span className="text-xs font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">{k.table_number}</span>
                </div>

                <div className="space-y-1 text-xs">
                  {k.items?.map((item: any, i: number) => (
                    <div key={i} className="flex justify-between font-medium">
                      <span>{item.name || item.productName}</span>
                      <span className="font-bold text-slate-900 dark:text-white">x{item.qty || item.quantity}</span>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase text-slate-400">{k.status}</span>
                  <button
                    onClick={() => handleKotStatus(k.id, k.status)}
                    className="text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-lg transition"
                  >
                    Advance Status
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-3 text-center py-12 text-xs text-slate-400">
              No active KOTs in the kitchen queue. KOTs generate automatically when taking dining orders.
            </div>
          )}
        </div>
      )}

      {/* Add Table Modal */}
      {isAddTableOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">Add Dining Table</h3>
              <button onClick={() => setIsAddTableOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddTable} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Table Identifier *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. T5 - Terrace"
                  value={tableNum}
                  onChange={(e) => setTableNum(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Guest Capacity</label>
                <input
                  type="number"
                  min="1"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddTableOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-md transition"
                >
                  Add Table
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
