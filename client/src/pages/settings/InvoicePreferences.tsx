import React, { useEffect, useState } from 'react';
import { Receipt, Check } from 'lucide-react';
import { api } from '../../lib/api.js';

export const InvoicePreferences: React.FC = () => {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getBusinessSettings().then((r) => setS(r.settings)).catch((e) => setError(e.message));
  }, []);

  const save = async () => {
    try {
      const r = await api.updateBusinessSettings({ ...s, defaultCreditDays: Number(s.defaultCreditDays) || 0 });
      setS(r.settings);
      setError('');
      setMsg('Billing preferences saved');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (!s) return error ? <div className="text-xs text-red-600">{error}</div> : null;
  const toggle = (key: string, label: string, hint: string) => (
    <label className="flex items-start gap-2.5 text-xs">
      <input type="checkbox" className="mt-0.5" checked={!!s[key]} onChange={(e) => setS({ ...s, [key]: e.target.checked })} />
      <span><span className="font-semibold text-slate-800 dark:text-slate-200">{label}</span><span className="block text-slate-500">{hint}</span></span>
    </label>
  );
  const input = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500';

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
      <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2"><Receipt className="w-4 h-4 text-emerald-600" />Billing & Invoice Preferences</h3>
      <div className="grid md:grid-cols-2 gap-4">
        {toggle('roundOffEnabled', 'Round off invoice totals', 'Totals are rounded to the nearest rupee; the adjustment is shown on the invoice.')}
        {toggle('pricesIncludeTaxDefault', 'Selling prices include GST', 'Treat product prices as GST-inclusive and extract tax from them.')}
        {toggle('allowNegativeStock', 'Allow selling more than stock on hand', 'When off, a sale that would make stock negative is blocked.')}
        {toggle('enforceCreditLimit', 'Enforce customer credit limits', 'Block credit sales that would exceed a customer\'s credit limit.')}
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <label className="text-xs space-y-1"><span className="font-semibold text-slate-700 dark:text-slate-300">Default credit period (days)</span>
          <input type="number" min={0} max={365} value={s.defaultCreditDays} onChange={(e) => setS({ ...s, defaultCreditDays: e.target.value })} className={input} /></label>
        <label className="text-xs space-y-1 md:col-span-2"><span className="font-semibold text-slate-700 dark:text-slate-300">Invoice footer</span>
          <input value={s.invoiceFooter} onChange={(e) => setS({ ...s, invoiceFooter: e.target.value })} className={input} /></label>
      </div>
      <label className="text-xs space-y-1 block"><span className="font-semibold text-slate-700 dark:text-slate-300">Terms & conditions (printed on invoices)</span>
        <textarea rows={3} value={s.invoiceTerms} onChange={(e) => setS({ ...s, invoiceTerms: e.target.value })} className={input} /></label>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex items-center gap-3">
        <button onClick={save} className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl">Save Preferences</button>
        {msg && <span className="text-xs text-emerald-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" />{msg}</span>}
      </div>
    </div>
  );
};
