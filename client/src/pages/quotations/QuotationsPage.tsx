import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { Product } from '../../types/index.js';
import { formatINR, formatDate, rupeesToPaise } from '../../lib/utils.js';
import { 
  FileText, Plus, ArrowRightCircle, CheckCircle, 
  Trash2, X 
} from 'lucide-react';

export const QuotationsPage: React.FC<{ onNavigateToInvoices: () => void }> = ({ onNavigateToInvoices }) => {
  const [quotes, setQuotes] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [quoteItems, setQuoteItems] = useState<Array<{ productName: string; quantity: number; unitPriceRupees: string; taxRate: number }>>([]);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    loadQuotations();
  }, []);

  const loadQuotations = async () => {
    try {
      const [qRes, pRes] = await Promise.all([
        api.getQuotations(),
        api.getProducts({ limit: 100 }),
      ]);
      setQuotes(qRes.data);
      setProducts(pRes.data);
    } catch (err) {
      console.error('Failed to load quotations', err);
    }
  };

  const handleCreateQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName || !quoteItems.length) {
      alert('Please enter client name and add at least one line item');
      return;
    }

    try {
      await api.createQuotation({
        customerName,
        customerPhone,
        validUntil,
        items: quoteItems.map((it) => ({
          productName: it.productName,
          quantity: it.quantity,
          unitPricePaise: rupeesToPaise(it.unitPriceRupees),
          taxRate: it.taxRate,
        })),
      });
      setIsModalOpen(false);
      setCustomerName('');
      setQuoteItems([]);
      setStatusMsg('Estimate quotation created successfully!');
      setTimeout(() => setStatusMsg(''), 4000);
      loadQuotations();
    } catch (err: any) {
      alert(err.message || 'Failed to create quotation');
    }
  };

  const handleConvert = async (id: string, num: string) => {
    if (!window.confirm(`Convert estimate "${num}" into an official GST Tax Invoice now?`)) return;

    try {
      await api.convertQuotationToInvoice(id);
      setStatusMsg(`Estimate ${num} converted to Tax Invoice!`);
      setTimeout(() => setStatusMsg(''), 4000);
      loadQuotations();
    } catch (err: any) {
      alert(err.message || 'Failed to convert');
    }
  };

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
            Quotations & Proforma Estimates
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Create client proposals and convert them to GST Tax Invoices in one click
          </p>
        </div>

        <button
          onClick={() => {
            setQuoteItems([]);
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-md transition self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Quotation / Estimate</span>
        </button>
      </div>

      {statusMsg && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs rounded-xl flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Quotations List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold">
              <th className="p-3.5">Estimate #</th>
              <th className="p-3.5">Client Name</th>
              <th className="p-3.5">Valid Until</th>
              <th className="p-3.5 text-right">Taxable</th>
              <th className="p-3.5 text-right">Estimate Total</th>
              <th className="p-3.5 text-center">Status</th>
              <th className="p-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {quotes.length > 0 ? (
              quotes.map((q) => (
                <tr key={q.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                  <td className="p-3.5 font-mono font-bold text-slate-900 dark:text-white">{q.quotation_number}</td>
                  <td className="p-3.5 font-semibold text-slate-800 dark:text-slate-200">{q.customer_name}</td>
                  <td className="p-3.5 text-slate-400">{q.valid_until ? formatDate(q.valid_until) : 'Open'}</td>
                  <td className="p-3.5 text-right font-mono text-slate-600 dark:text-slate-300">{formatINR(q.subtotal_paise)}</td>
                  <td className="p-3.5 text-right font-mono font-bold text-slate-900 dark:text-white">{formatINR(q.total_paise)}</td>
                  <td className="p-3.5 text-center">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      q.status === 'CONVERTED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                    }`}>
                      {q.status}
                    </span>
                  </td>
                  <td className="p-3.5 text-right">
                    {q.status !== 'CONVERTED' ? (
                      <button
                        onClick={() => handleConvert(q.id, q.quotation_number)}
                        className="text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-lg transition inline-flex items-center gap-1"
                      >
                        <span>Convert to Invoice</span>
                        <ArrowRightCircle className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <span className="text-[10px] text-emerald-600 font-bold">Invoiced</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  No estimates created yet. Click "New Quotation / Estimate" to prepare a proposal.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* New Quotation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">Prepare Quotation</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateQuotation} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Prospective Client *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Apex Hospital Ltd"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Valid Until Date</label>
                  <input
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Add items */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Pick Products</label>
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                  {products.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setQuoteItems([...quoteItems, { productName: p.name, quantity: 1, unitPriceRupees: String(p.sale_price_paise / 100), taxRate: p.tax_rate }])}
                      className="px-2 py-0.5 text-[10px] font-medium bg-white dark:bg-slate-700 hover:bg-emerald-50 hover:text-emerald-600 rounded border border-slate-200 dark:border-slate-600"
                    >
                      + {p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Items */}
              <div className="space-y-2">
                <label className="block font-semibold text-slate-700 dark:text-slate-300">Quote Line Items ({quoteItems.length})</label>
                {quoteItems.map((it, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
                    <span className="flex-1 font-semibold truncate text-slate-800 dark:text-slate-200">{it.productName}</span>
                    <input
                      type="number"
                      min="1"
                      value={it.quantity}
                      onChange={(e) => {
                        const next = [...quoteItems];
                        next[idx].quantity = Number(e.target.value) || 1;
                        setQuoteItems(next);
                      }}
                      className="w-16 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 text-center font-bold"
                    />
                    <input
                      type="number"
                      value={it.unitPriceRupees}
                      onChange={(e) => {
                        const next = [...quoteItems];
                        next[idx].unitPriceRupees = e.target.value;
                        setQuoteItems(next);
                      }}
                      className="w-20 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 text-right font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setQuoteItems(quoteItems.filter((_, i) => i !== idx))}
                      className="text-red-500 hover:bg-red-50 p-1 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-500 hover:bg-slate-100 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md transition"
                >
                  Save Quotation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
