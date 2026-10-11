import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { DashboardStats, Invoice } from '../../types/index.js';
import { formatINR, formatDate, formatDateTime } from '../../lib/utils.js';
import { InvoiceModal } from '../../components/billing/InvoiceModal.js';
import { 
  TrendingUp, ShoppingBag, AlertTriangle, Users, 
  ArrowUpRight, Plus, Eye, UtensilsCrossed, Pill, 
  Shirt, Sparkles, CheckCircle2 
} from 'lucide-react';

interface DashboardPageProps {
  onNavigate: (page: string) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const res = await api.getDashboardStats();
      setStats(res);
    } catch (err) {
      console.error('Failed to load dashboard stats', err);
    } finally {
      setLoading(false);
    }
  };

  const category = user?.businessCategory || 'GROCERY';

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      
      {/* Welcome & Quick Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
              {user?.businessName || 'Business Dashboard'}
            </h1>
            <span className="text-xs font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800">
              {category}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time business performance, billing telemetry & ledger overview
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate('products')}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-500" />
            <span>Add Product</span>
          </button>

          <button
            onClick={() => onNavigate('billing')}
            className="flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md shadow-emerald-500/25 transition active:scale-95"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Create Fast Bill</span>
          </button>
        </div>
      </div>

      {/* Category-Specific Dynamic Hero Widget (§4.1 & §5) */}
      {category === 'RESTAURANT' && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/5 border border-amber-500/20 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500 text-white">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Restaurant Dine-in & KOT Active</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Table billing mode ready with GST 5% Food Services presets.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('billing')}
            className="text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition"
          >
            Open KOT Billing
          </button>
        </div>
      )}

      {category === 'PHARMACY' && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-blue-500/5 border border-blue-500/20 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500 text-white">
              <Pill className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Pharmacy Batch & Expiry Tracking Active</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Medicine batches and drug salt compositions configured.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('products')}
            className="text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg transition"
          >
            View Medicine Batches
          </button>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today's Sales */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Today's Sales</span>
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {formatINR(stats?.today?.salesPaise || 0)}
          </div>
          <div className="text-xs text-slate-400 mt-1 flex items-center gap-1">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {stats?.today?.invoices || 0} Bills
            </span>
            <span>generated today</span>
          </div>
        </div>

        {/* This Month's Sales */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">This Month</span>
            <div className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {formatINR(stats?.month?.salesPaise || 0)}
          </div>
          <div className="text-xs text-slate-400 mt-1 flex items-center gap-1">
            <span className="font-semibold text-teal-600 dark:text-teal-400">
              {stats?.month?.invoices || 0} Invoices
            </span>
            <span>in current billing period</span>
          </div>
        </div>

        {/* Customer Receivables */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Receivables</span>
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {formatINR(stats?.receivablesPaise || 0)}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Outstanding customer credit balance
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Low Stock</span>
            <div className={`p-2 rounded-xl ${
              (stats?.lowStockCount || 0) > 0 
                ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400' 
                : 'bg-slate-50 dark:bg-slate-800 text-slate-400'
            }`}>
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {stats?.lowStockCount || 0}
          </div>
          <div className="text-xs text-slate-400 mt-1 flex items-center justify-between">
            <span>Items below threshold</span>
            <button
              onClick={() => onNavigate('inventory')}
              className="text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:underline"
            >
              View Stock
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Recent Invoices & Top Products */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Recent Invoices Table (2 cols) */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">Recent Sales Invoices</h3>
              <p className="text-xs text-slate-400">Latest transactions saved to database</p>
            </div>
            <button
              onClick={() => onNavigate('invoices')}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-semibold">
                  <th className="pb-3">Invoice #</th>
                  <th className="pb-3">Customer</th>
                  <th className="pb-3 text-right">Amount</th>
                  <th className="pb-3 text-center">Mode</th>
                  <th className="pb-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {stats?.recentInvoices && stats.recentInvoices.length > 0 ? (
                  stats.recentInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                      <td className="py-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                        {inv.invoice_number}
                      </td>
                      <td className="py-3 text-slate-600 dark:text-slate-300">
                        {inv.customer_name}
                      </td>
                      <td className="py-3 text-right font-bold text-slate-900 dark:text-white">
                        {formatINR(inv.total_paise)}
                      </td>
                      <td className="py-3 text-center">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {inv.payment_mode}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={async () => {
                            const full = await api.getInvoiceById(inv.id);
                            setSelectedInvoice(full.invoice);
                          }}
                          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500 transition"
                          title="Print / View Invoice"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      No invoices recorded yet. Click "Create Fast Bill" to generate your first invoice!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Selling Products (1 col) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-5 space-y-4">
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">Top Fast-Moving Products</h3>
            <p className="text-xs text-slate-400">By sales volume</p>
          </div>

          <div className="space-y-3">
            {stats?.topProducts && stats.topProducts.length > 0 ? (
              stats.topProducts.map((prod, idx) => (
                <div key={idx} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
                    <span className="truncate pr-2">{prod.product_name}</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                      {prod.total_sold} sold
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Revenue Generated</span>
                    <span className="font-mono">{formatINR(prod.total_revenue_paise)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-xs text-slate-400">
                Top products will appear here as you create bills.
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Invoice Modal for view/print */}
      {selectedInvoice && (
        <InvoiceModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
        />
      )}

    </div>
  );
};
