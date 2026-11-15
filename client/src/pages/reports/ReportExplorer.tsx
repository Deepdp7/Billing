import React, { useEffect, useState } from 'react';
import { Download, Printer, Lock } from 'lucide-react';
import { api, downloadFile, saveAsPdf } from '../../lib/api.js';
import { formatINR } from '../../lib/utils.js';
import { useLicense } from '../../context/LicenseContext.js';
import { Select } from '../../components/ui/Select.js';

const REPORTS: Array<{ type: string; label: string; feature: string; grouped?: boolean }> = [
  { type: 'sales', label: 'Sales (daily / weekly / monthly / yearly)', feature: 'reports_basic', grouped: true },
  { type: 'invoices', label: 'Invoice register', feature: 'reports_basic' },
  { type: 'profit-loss', label: 'Profit & loss', feature: 'reports_basic' },
  { type: 'purchases', label: 'Purchase register', feature: 'reports_basic' },
  { type: 'expenses', label: 'Expenses', feature: 'reports_basic' },
  { type: 'gst-hsn', label: 'GST — HSN summary', feature: 'reports_advanced' },
  { type: 'payments', label: 'Payments by mode', feature: 'reports_advanced' },
  { type: 'cash-flow', label: 'Cash flow', feature: 'reports_advanced', grouped: true },
  { type: 'customer-outstanding', label: 'Customer outstanding (ageing)', feature: 'reports_advanced' },
  { type: 'supplier-outstanding', label: 'Supplier outstanding', feature: 'reports_advanced' },
  { type: 'top-products', label: 'Product-wise sales & profit', feature: 'reports_advanced' },
  { type: 'inventory', label: 'Inventory valuation', feature: 'inventory_analytics' },
];

/** Every report shares one server definition for the on-screen table and the CSV/Excel export. */
export const ReportExplorer: React.FC<{ fromDate: string; toDate: string }> = ({ fromDate, toDate }) => {
  const { hasFeature } = useLicense();
  const [type, setType] = useState('sales');
  const [groupBy, setGroupBy] = useState('day');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const def = REPORTS.find((r) => r.type === type)!;
  const allowed = hasFeature(def.feature);

  useEffect(() => {
    if (!allowed) { setData(null); return; }
    setError('');
    api.getReport(type, { fromDate, toDate, groupBy })
      .then(setData)
      .catch((e) => { setData(null); setError(e.message); });
  }, [type, groupBy, fromDate, toDate, allowed]);

  const exportAs = async (format: 'csv' | 'xlsx') => {
    try {
      const q = new URLSearchParams({ format, groupBy, ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) });
      await downloadFile(`/app/reports/${type}/export?${q.toString()}`, `${type}.${format}`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const cell = (row: any, col: any) => {
    const v = row[col.key];
    if (v === null || v === undefined || v === '') return '—';
    return col.money ? formatINR(v) : String(v);
  };

  const btn = 'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 disabled:opacity-40';
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs">
          {REPORTS.map((r) => <option key={r.type} value={r.type}>{r.label}{hasFeature(r.feature) ? '' : ' (not in license)'}</option>)}
        </Select>
        {def.grouped && (
          <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs">
            <option value="day">Daily</option>
            {type === 'sales' && <option value="week">Weekly</option>}
            <option value="month">Monthly</option>
            {type === 'sales' && <option value="year">Yearly</option>}
          </Select>
        )}
        <div className="flex-1" />
        <button className={btn} disabled={!allowed || !hasFeature('data_export')} onClick={() => exportAs('xlsx')} title={hasFeature('data_export') ? '' : 'Excel export is not in your license'}>
          <Download className="w-3.5 h-3.5" />Excel
        </button>
        <button className={btn} disabled={!allowed || !hasFeature('data_export')} onClick={() => exportAs('csv')}><Download className="w-3.5 h-3.5" />CSV</button>
        <button className={btn} disabled={!allowed || !hasFeature('pdf_export')} onClick={() => saveAsPdf(`${type}-report.pdf`).catch((e) => setError(e.message))}>
          <Printer className="w-3.5 h-3.5" />PDF / Print
        </button>
      </div>

      {!allowed && (
        <div className="p-6 text-center text-sm text-slate-500 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl">
          <Lock className="w-5 h-5 mx-auto mb-2 text-amber-500" />This report is not included in your license.
        </div>
      )}
      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">{error}</div>}

      {data && (
        <div className="print-area bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">{data.title}</h3>
            <span className="text-[11px] text-slate-400">{fromDate || 'beginning'} → {toDate || 'today'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  {data.columns.map((c: any) => <th key={c.key} className={`py-2 px-2 font-bold ${c.money ? 'text-right' : 'text-left'}`}>{c.label.replace(' (₹)', '')}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.rows.map((r: any, i: number) => (
                  <tr key={i}>{data.columns.map((c: any) => <td key={c.key} className={`py-1.5 px-2 ${c.money ? 'text-right font-mono' : ''}`}>{cell(r, c)}</td>)}</tr>
                ))}
                {data.rows.length === 0 && <tr><td colSpan={data.columns.length} className="py-6 text-center text-slate-400">No data for this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
