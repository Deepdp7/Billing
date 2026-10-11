import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { Pill, AlertTriangle, Calendar, ShieldAlert, CheckCircle, Search } from 'lucide-react';

export const PharmacyPage: React.FC = () => {
  const [batches, setBatches] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadExpiry();
  }, []);

  const loadExpiry = async () => {
    try {
      const res = await api.getPharmacyExpiry();
      setBatches(res.data);
    } catch (err) {
      console.error('Failed to load pharmacy batches', err);
    }
  };

  const filtered = batches.filter(
    (b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.batchNo.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
          Pharmacy Batch & Expiry Control
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Drug composition tracking, batch serialization, and automated shelf-life expiry alerts
        </p>
      </div>

      {/* Filter */}
      <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-w-md">
        <input
          type="text"
          placeholder="Search by drug name or batch code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Batches Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold">
              <th className="p-3.5">Medicine Name</th>
              <th className="p-3.5">Batch Code</th>
              <th className="p-3.5">Salt / Composition</th>
              <th className="p-3.5 text-center">Stock On-Hand</th>
              <th className="p-3.5 text-center">Expiry Date</th>
              <th className="p-3.5 text-center">Compliance Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {filtered.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                <td className="p-3.5 font-bold text-slate-900 dark:text-white">{b.name}</td>
                <td className="p-3.5 font-mono font-bold text-blue-600 dark:text-blue-400">{b.batchNo}</td>
                <td className="p-3.5 text-slate-600 dark:text-slate-300">{b.composition}</td>
                <td className="p-3.5 text-center font-mono font-bold text-slate-900 dark:text-white">{b.stockQuantity} strips</td>
                <td className="p-3.5 text-center font-mono text-slate-700 dark:text-slate-300">{b.expiryDate}</td>
                <td className="p-3.5 text-center">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Valid & Dispense Ready
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
