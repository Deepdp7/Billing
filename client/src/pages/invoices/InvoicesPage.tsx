import React, { useState, useEffect } from 'react';
import { api, downloadFile } from '../../lib/api.js';
import { Invoice } from '../../types/index.js';
import { formatINR, formatDate } from '../../lib/utils.js';
import { InvoiceModal } from '../../components/billing/InvoiceModal.js';
import { 
  Search, Printer, FileText, 
  CheckCircle, AlertCircle, RefreshCw, IndianRupee, Copy, Download, FileCheck2, Trash2
} from 'lucide-react';
import { confirmDialog } from '../../components/ui/dialogs.js';
import { findProductByCode, scanBeep, takeScanIntent, useScanner } from '../../lib/scanner.js';
import { Select } from '../../components/ui/Select.js';

import { useLiveRefresh } from '../../lib/live.js';
export const InvoicesPage: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // A scanned bill number (printed as a barcode on every bill) opens that bill; any other code searches the list
  const openScannedBill = async (code: string) => {
    const match = (await api.getInvoices({ search: code, limit: 5 }).catch(() => null))?.data
      ?.find((i: any) => String(i.invoice_number).toLowerCase() === code.toLowerCase());
    scanBeep(!!match);
    if (match) setSelectedInvoice((await api.getInvoiceById(match.id)).invoice);
    else setSearch(code);
  };
  useScanner((code) => { void openScannedBill(code); return true; });
  useEffect(() => {
    const intent = takeScanIntent('open-bill');
    if (intent) void openScannedBill(intent.code);
  }, []);
  const [actionMsg, setActionMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState('CASH');
  const [payRef, setPayRef] = useState('');
  const [cancelling, setCancelling] = useState<Invoice | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [refundMode, setRefundMode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadInvoices();
  }, [search, statusFilter, paymentStatus, fromDate, toDate]);

  const flash = (msg: string) => {
    setActionMsg(msg);
    setErrorMsg('');
    setTimeout(() => setActionMsg(''), 4000);
  };

  // Another computer of this account changed something: the lists reload quietly
  useLiveRefresh(() => { void loadInvoices(true); });
  const loadInvoices = async (quiet?: unknown) => {
    try {
      if (quiet !== true) setLoading(true);
      const res = await api.searchInvoices({
        search: search || undefined,
        status: statusFilter || undefined,
        paymentStatus: paymentStatus || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        limit: 200,
      });
      setInvoices(res.data);
    } catch (err) {
      console.error('Failed to load invoices', err);
    } finally {
      setLoading(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    try {
      await api.cancelInvoiceWithReason(cancelling.id, cancelReason, refundMode || undefined);
      await api.deleteInvoice(cancelling.id);
      flash(`Bill ${cancelling.invoice_number} deleted: stock restored, payments reversed, and removed from history.`);
      setCancelling(null);
      setCancelReason('');
      loadInvoices();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to delete invoice');
    } finally {
      setBusy(false);
    }
  };

  const deleteFromHistory = async (inv: Invoice) => {
    if (inv.status === 'ISSUED') {
      setCancelling(inv);
      setCancelReason('');
      setRefundMode('');
      return;
    }
    if (!(await confirmDialog(`Permanently delete ${inv.invoice_number} from history?`, { danger: true }))) return;
    try {
      if (inv.status === 'DRAFT') await api.deleteDraft(inv.id);
      else await api.deleteInvoice(inv.id);
      flash(`Bill ${inv.invoice_number} deleted.`);
      loadInvoices();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to delete');
    }
  };

  const confirmPayment = async () => {
    if (!paying) return;
    setBusy(true);
    try {
      await api.recordInvoicePayment(paying.id, { amountPaise: Math.round((parseFloat(payAmount) || 0) * 100), mode: payMode, reference: payRef || undefined });
      flash(`Payment recorded against ${paying.invoice_number}.`);
      setPaying(null);
      loadInvoices();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record payment');
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (inv: Invoice) => {
    try {
      const r = await api.duplicateInvoice(inv.id);
      flash(`Draft copy ${r.invoice.invoice_number} created from ${inv.invoice_number}. Filter by status "Draft" to issue it.`);
      loadInvoices();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to duplicate');
    }
  };

  const issueDraft = async (inv: Invoice) => {
    try {
      const r = await api.issueDraft(inv.id, { paymentMode: 'CASH' });
      flash(`Draft issued as invoice ${r.invoice.invoice_number}.`);
      loadInvoices();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to issue draft');
    }
  };

  const deleteDraft = async (inv: Invoice) => {
    if (!(await confirmDialog('Delete this draft?', { danger: true }))) return;
    try {
      await api.deleteDraft(inv.id);
      flash('Draft deleted.');
      loadInvoices();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to delete draft');
    }
  };

  const exportList = async (format: 'csv' | 'xlsx') => {
    try {
      const q = new URLSearchParams();
      if (fromDate) q.append('fromDate', fromDate);
      if (toDate) q.append('toDate', toDate);
      q.append('format', format);
      await downloadFile(`/app/reports/invoices/export?${q.toString()}`, `invoices.${format}`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Export failed');
    }
  };

  const inputCls = 'bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500';

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
            Invoice History & Ledgers
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Audit-compliant sales invoice log with instant thermal/A4 re-printing and stock rollback
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
        <button onClick={() => exportList('xlsx')} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition shadow-sm">
          <Download className="w-3.5 h-3.5" /><span>Excel</span>
        </button>
        <button onClick={() => exportList('csv')} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition shadow-sm">
          <Download className="w-3.5 h-3.5" /><span>CSV</span>
        </button>
        <button
          onClick={loadInvoices}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition shadow-sm self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
        </div>
      </div>

      {actionMsg && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs rounded-xl flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{actionMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-300 text-xs rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg('')}>✕</button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px] relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by invoice number, customer name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
        >
          <option value="">All Statuses</option>
          <option value="ISSUED">Issued (Valid)</option>
          <option value="DRAFT">Draft</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
        <Select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className={inputCls}>
          <option value="">Any payment</option>
          <option value="PAID">Paid</option>
          <option value="PARTIAL">Partially paid</option>
          <option value="UNPAID">Unpaid</option>
        </Select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={inputCls} title="From date" />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={inputCls} title="To date" />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold">
                <th className="p-3.5">Invoice #</th>
                <th className="p-3.5">Date</th>
                <th className="p-3.5">Customer</th>
                <th className="p-3.5 text-right">Taxable</th>
                <th className="p-3.5 text-right">GST</th>
                <th className="p-3.5 text-right">Grand Total</th>
                <th className="p-3.5 text-center">Payment</th>
                <th className="p-3.5 text-center">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {invoices.length > 0 ? (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="p-3.5 font-mono font-bold text-slate-900 dark:text-slate-100">
                      {inv.invoice_number}
                    </td>
                    <td className="p-3.5 text-slate-500 dark:text-slate-400">
                      {formatDate(inv.invoice_date)}
                    </td>
                    <td className="p-3.5">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{inv.customer_name}</div>
                      {inv.customer_phone && <span className="text-[10px] text-slate-400">{inv.customer_phone}</span>}
                    </td>
                    <td className="p-3.5 text-right font-mono text-slate-600 dark:text-slate-300">
                      {formatINR(inv.subtotal_paise - inv.discount_paise)}
                    </td>
                    <td className="p-3.5 text-right font-mono text-slate-600 dark:text-slate-300">
                      {formatINR(inv.tax_paise)}
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {formatINR(inv.total_paise)}
                    </td>
                    <td className="p-3.5 text-center">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {inv.payment_mode}
                      </span>
                      {inv.status === 'ISSUED' && inv.payment_status !== 'PAID' && (
                        <div className="text-[10px] font-bold text-amber-600 mt-0.5">{inv.payment_status} · due {formatINR(inv.total_paise - inv.amount_paid_paise)}</div>
                      )}
                    </td>
                    <td className="p-3.5 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          inv.status === 'ISSUED'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : inv.status === 'DRAFT'
                            ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={async () => {
                            const full = await api.getInvoiceById(inv.id);
                            setSelectedInvoice(full.invoice);
                          }}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-emerald-600 transition"
                          title="View / Print Receipt"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        {inv.status === 'ISSUED' && inv.payment_status !== 'PAID' && (
                          <button
                            onClick={() => { setPaying(inv); setPayAmount(((inv.total_paise - inv.amount_paid_paise) / 100).toFixed(2)); setPayMode('CASH'); setPayRef(''); }}
                            className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950 text-slate-400 hover:text-emerald-600 transition"
                            title="Receive Payment"
                          >
                            <IndianRupee className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {inv.status !== 'DRAFT' && (
                          <button onClick={() => duplicate(inv)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-indigo-600 transition" title="Duplicate as Draft">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {inv.status === 'DRAFT' && (
                          <button onClick={() => issueDraft(inv)} className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition" title="Issue draft (cash)">
                            <FileCheck2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => (inv.status === 'DRAFT' ? deleteDraft(inv) : deleteFromHistory(inv))}
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 text-slate-400 hover:text-red-600 transition"
                          title={inv.status === 'ISSUED' ? 'Delete bill (restores stock)' : 'Delete from history'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    No invoices match your search criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {paying && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 w-full max-w-sm space-y-3 shadow-2xl">
            <h3 className="font-bold text-sm">Receive payment — {paying.invoice_number}</h3>
            <p className="text-xs text-slate-500">Balance due {formatINR(paying.total_paise - paying.amount_paid_paise)}</p>
            <input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className={`${inputCls} w-full`} placeholder="Amount ₹" />
            <Select value={payMode} onChange={(e) => setPayMode(e.target.value)} className={`${inputCls} w-full`}>
              {['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'WALLET'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </Select>
            <input value={payRef} onChange={(e) => setPayRef(e.target.value)} className={`${inputCls} w-full`} placeholder="Reference (UPI ref, cheque no.) — optional" />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setPaying(null)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300">Cancel</button>
              <button disabled={busy} onClick={confirmPayment} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50">Record payment</button>
            </div>
          </div>
        </div>
      )}

      {cancelling && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 w-full max-w-sm space-y-3 shadow-2xl">
            <h3 className="font-bold text-sm">Delete bill {cancelling.invoice_number}?</h3>
            <p className="text-xs text-slate-500">Stock is restored, payments are reversed, and the bill is removed from history. This cannot be undone.</p>
            <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} className={`${inputCls} w-full`} placeholder="Reason for deletion (optional)" />
            {cancelling.amount_paid_paise > 0 && (
              <Select value={refundMode} onChange={(e) => setRefundMode(e.target.value)} className={`${inputCls} w-full`}>
                <option value="">Refund {formatINR(cancelling.amount_paid_paise)} via original mode</option>
                {['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'].map((m) => <option key={m} value={m}>Refund via {m.replace('_', ' ')}</option>)}
                {cancelling.customer_id && <option value="CUSTOMER_CREDIT">Don't refund now (keep as customer's advance)</option>}
              </Select>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setCancelling(null)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300">Keep bill</button>
              <button disabled={busy} onClick={confirmCancel} className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold disabled:opacity-50">Delete bill</button>
            </div>
          </div>
        </div>
      )}

      {selectedInvoice && (
        <InvoiceModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  );
};
