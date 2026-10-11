import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { formatINR } from '../../lib/utils.js';
import { 
  BarChart3, FileSpreadsheet, TrendingUp, TrendingDown, 
  DollarSign, Calculator, Download, RefreshCw 
} from 'lucide-react';

export const ReportsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'pnl' | 'gst'>('pnl');
  const [pnlData, setPnlData] = useState<any>(null);
  const [gstData, setGstData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      setLoading(true);
      const [pnl, gst] = await Promise.all([
        api.getProfitAndLoss(),
        api.getGstSummary(),
      ]);
      setPnlData(pnl);
      setGstData(gst);
    } catch (err) {
      console.error('Failed to load reports', err);
    } finally {
      setLoading(false);
    }
  };

  const isProfitable = (pnlData?.netProfitPaise || 0) >= 0;

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
            Financial Reports & Tax Intelligence
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Audit-grade Profit & Loss statements, GSTR-1 sales tax summaries, and HSN breakdowns
          </p>
        </div>

        <button
          onClick={loadReports}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition shadow-sm self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Recalculate</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('pnl')}
          className={`pb-2.5 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'pnl'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Calculator className="w-4 h-4" />
          <span>Profit & Loss Statement (P&L)</span>
        </button>

        <button
          onClick={() => setActiveTab('gst')}
          className={`pb-2.5 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'gst'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>GST Compliance Summary (GSTR-1)</span>
        </button>
      </div>

      {/* 1. Profit & Loss Statement */}
      {activeTab === 'pnl' && (
        <div className="space-y-6">
          {/* Net Profit Hero Pill */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Calculated Business Net Profit
              </span>
              <div className={`text-3xl font-black mt-1 ${isProfitable ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                {formatINR(pnlData?.netProfitPaise || 0)}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Net Sales minus Cost of Goods Sold and Operating Overheads
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Gross Profit</span>
                <span className="font-mono font-bold text-sm text-slate-900 dark:text-white">
                  {formatINR(pnlData?.grossProfitPaise || 0)}
                </span>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">Total Overheads</span>
                <span className="font-mono font-bold text-sm text-red-600 dark:text-red-400">
                  -{formatINR(pnlData?.totalExpensePaise || 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Detailed Financial Breakdown Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wider">
              Financial Breakdown Summary
            </h3>

            <div className="space-y-3 text-xs divide-y divide-slate-100 dark:divide-slate-800">
              <div className="flex justify-between items-center py-2 font-semibold">
                <span className="text-slate-700 dark:text-slate-200">1. Total Net Sales Turnover (Revenue)</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">{formatINR(pnlData?.revenuePaise || 0)}</span>
              </div>

              <div className="flex justify-between items-center py-2 text-slate-500 dark:text-slate-400">
                <span>2. Less: Cost of Goods Sold (Purchase Value of items sold)</span>
                <span className="font-mono text-red-500">-{formatINR(pnlData?.cogsPaise || 0)}</span>
              </div>

              <div className="flex justify-between items-center py-2 font-bold text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/40 px-3 rounded-lg">
                <span>Gross Trading Profit</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400">{formatINR(pnlData?.grossProfitPaise || 0)}</span>
              </div>

              <div className="pt-3 space-y-2">
                <span className="font-bold text-slate-700 dark:text-slate-300 block">3. Operating Expenses Breakdown:</span>
                {pnlData?.expenses?.map((exp: any, idx: number) => (
                  <div key={idx} className="flex justify-between text-slate-500 pl-4">
                    <span>• {exp.category}</span>
                    <span className="font-mono">-{formatINR(exp.total_paise)}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center pt-3 text-sm font-black bg-emerald-50/50 dark:bg-emerald-950/30 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800">
                <span className="text-slate-900 dark:text-white">NET PROFIT / (LOSS)</span>
                <span className={isProfitable ? 'text-emerald-600 dark:text-emerald-400 font-mono' : 'text-red-500 font-mono'}>
                  {formatINR(pnlData?.netProfitPaise || 0)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. GST Compliance Summary */}
      {activeTab === 'gst' && (
        <div className="space-y-6">
          {/* GST Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Taxable Value</span>
              <div className="text-xl font-black text-slate-900 dark:text-white mt-1">
                {formatINR(gstData?.summary?.taxable_value_paise || 0)}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase">CGST Collected</span>
              <div className="text-xl font-black text-slate-900 dark:text-white mt-1">
                {formatINR(gstData?.summary?.cgst_paise || 0)}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase">SGST Collected</span>
              <div className="text-xl font-black text-slate-900 dark:text-white mt-1">
                {formatINR(gstData?.summary?.sgst_paise || 0)}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Total GST Output</span>
              <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                {formatINR((gstData?.summary?.cgst_paise || 0) + (gstData?.summary?.sgst_paise || 0) + (gstData?.summary?.igst_paise || 0))}
              </div>
            </div>
          </div>

          {/* HSN-wise Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden p-5 space-y-4">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              HSN-wise Summary of Outward Supplies (GSTR-1 Format)
            </h3>

            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-semibold">
                  <th className="pb-3">HSN Code</th>
                  <th className="pb-3 text-center">Tax Rate %</th>
                  <th className="pb-3 text-center">Total Quantity</th>
                  <th className="pb-3 text-right">Taxable Turnover</th>
                  <th className="pb-3 text-right">Tax Amount</th>
                  <th className="pb-3 text-right">Total Invoice Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {gstData?.hsnSummary?.map((h: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 font-mono font-bold text-slate-900 dark:text-white">{h.hsn_code || 'Unspecified'}</td>
                    <td className="py-3 text-center font-bold">{h.tax_rate}%</td>
                    <td className="py-3 text-center">{h.total_quantity}</td>
                    <td className="py-3 text-right font-mono">{formatINR(h.taxable_value_paise)}</td>
                    <td className="py-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">{formatINR(h.tax_amount_paise)}</td>
                    <td className="py-3 text-right font-mono font-bold text-slate-900 dark:text-white">{formatINR(h.total_value_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
