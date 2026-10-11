import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { CreditNote, DebitNote } from '../../types/index.js';
import { formatINR, formatDate } from '../../lib/utils.js';
import { 
  RotateCcw, ArrowDownLeft, ArrowUpRight, Search, 
  Plus, Printer, CheckCircle, AlertTriangle, Eye, 
  X, RefreshCw, ShoppingCart, Truck, ShieldCheck, 
  Coins, FileText, Calendar, Building, HelpCircle 
} from 'lucide-react';

export const ReturnsRefundsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'sales' | 'purchases'>('sales');
  
  // Lists
  const [salesReturns, setSalesReturns] = useState<CreditNote[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<DebitNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Modals
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState(false);
  const [viewVoucher, setViewVoucher] = useState<{ type: 'credit' | 'debit'; data: any } | null>(null);

  // Sales Return Form State
  const [invSearchQuery, setInvSearchQuery] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [lookedUpInvoice, setLookedUpInvoice] = useState<any>(null);
  const [salesReturnItems, setSalesReturnItems] = useState<Array<{
    productId?: string;
    productName: string;
    sku?: string;
    soldQty: number;
    availableQty: number;
    returnQty: number;
    unitPricePaise: number;
    taxRate: number;
  }>>([]);
  const [salesRefundMode, setSalesRefundMode] = useState<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'STORE_CREDIT'>('CASH');
  const [salesReason, setSalesReason] = useState<string>('CUSTOMER_CHANGE_MIND');
  const [salesNotes, setSalesNotes] = useState('');

  // Purchase Return Form State
  const [purSearchQuery, setPurSearchQuery] = useState('');
  const [purLookupLoading, setPurLookupLoading] = useState(false);
  const [purLookupError, setPurLookupError] = useState('');
  const [lookedUpPurchase, setLookedUpPurchase] = useState<any>(null);
  const [purReturnItems, setPurReturnItems] = useState<Array<{
    productId?: string;
    productName: string;
    purchasedQty: number;
    availableQty: number;
    returnQty: number;
    unitPricePaise: number;
    taxRate: number;
  }>>([]);
  const [purRefundMode, setPurRefundMode] = useState<'ADJUST_PAYABLE' | 'CASH' | 'BANK_TRANSFER'>('ADJUST_PAYABLE');
  const [purReason, setPurReason] = useState<string>('DAMAGED_GOODS');
  const [purNotes, setPurNotes] = useState('');

  useEffect(() => {
    loadData();
  }, [search]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [salesRes, purRes] = await Promise.all([
        api.getSalesReturns({ search: search || undefined }),
        api.getPurchaseReturns({ search: search || undefined }),
      ]);
      setSalesReturns(salesRes.data || []);
      setPurchaseReturns(purRes.data || []);
    } catch (err: any) {
      console.error('Failed to load returns', err);
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Lookup Invoice for Sales Return
  const handleLookupInvoice = async () => {
    if (!invSearchQuery.trim()) return;
    setLookupLoading(true);
    setLookupError('');
    setLookedUpInvoice(null);
    setSalesReturnItems([]);

    try {
      const res = await api.lookupInvoiceForReturn(invSearchQuery.trim());
      const { invoice, items } = res.data;
      setLookedUpInvoice(invoice);
      setSalesReturnItems(
        items.map((it: any) => ({
          productId: it.product_id,
          productName: it.product_name,
          sku: it.sku,
          soldQty: it.quantity,
          availableQty: it.availableQty,
          returnQty: 0, // default 0 to let merchant pick
          unitPricePaise: it.unit_price_paise,
          taxRate: it.tax_rate,
        }))
      );
    } catch (err: any) {
      setLookupError(err.message || 'Invoice not found or invalid');
    } finally {
      setLookupLoading(false);
    }
  };

  // Lookup Purchase for Purchase Return
  const handleLookupPurchase = async () => {
    if (!purSearchQuery.trim()) return;
    setPurLookupLoading(true);
    setPurLookupError('');
    setLookedUpPurchase(null);
    setPurReturnItems([]);

    try {
      const res = await api.lookupPurchaseForReturn(purSearchQuery.trim());
      const { purchase, items } = res.data;
      setLookedUpPurchase(purchase);
      setPurReturnItems(
        items.map((it: any) => ({
          productId: it.product_id,
          productName: it.product_name,
          purchasedQty: it.quantity,
          availableQty: it.availableQty,
          returnQty: 0,
          unitPricePaise: it.unit_price_paise,
          taxRate: it.tax_rate,
        }))
      );
    } catch (err: any) {
      setPurLookupError(err.message || 'Purchase invoice not found');
    } finally {
      setPurLookupLoading(false);
    }
  };

  // Submit Sales Return
  const handleSubmitSalesReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    const activeItems = salesReturnItems.filter(it => it.returnQty > 0);
    if (!activeItems.length) {
      alert('Please specify a return quantity of at least 1 item.');
      return;
    }

    try {
      const payload = {
        invoiceId: lookedUpInvoice?.id,
        invoiceNumber: lookedUpInvoice?.invoice_number || invSearchQuery,
        customerId: lookedUpInvoice?.customer_id,
        customerName: lookedUpInvoice?.customer_name || 'Walk-in Customer',
        customerPhone: lookedUpInvoice?.customer_phone || '',
        refundMode: salesRefundMode,
        reason: salesReason,
        notes: salesNotes,
        items: activeItems.map(it => ({
          productId: it.productId,
          productName: it.productName,
          sku: it.sku,
          quantity: it.returnQty,
          unitPricePaise: it.unitPricePaise,
          taxRate: it.taxRate,
        })),
      };

      const res = await api.createSalesReturn(payload);
      showNotification('success', res.message || 'Sales Return processed successfully!');
      setIsSalesModalOpen(false);
      resetSalesForm();
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to submit sales return');
    }
  };

  // Submit Purchase Return
  const handleSubmitPurchaseReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    const activeItems = purReturnItems.filter(it => it.returnQty > 0);
    if (!activeItems.length) {
      alert('Please specify a return quantity of at least 1 item.');
      return;
    }

    try {
      const payload = {
        purchaseId: lookedUpPurchase?.id,
        purchaseNumber: lookedUpPurchase?.purchase_number || purSearchQuery,
        supplierId: lookedUpPurchase?.supplier_id,
        supplierName: lookedUpPurchase?.supplier_name || 'Supplier',
        supplierPhone: lookedUpPurchase?.supplier_phone || '',
        refundMode: purRefundMode,
        reason: purReason,
        notes: purNotes,
        items: activeItems.map(it => ({
          productId: it.productId,
          productName: it.productName,
          quantity: it.returnQty,
          unitPricePaise: it.unitPricePaise,
          taxRate: it.taxRate,
        })),
      };

      const res = await api.createPurchaseReturn(payload);
      showNotification('success', res.message || 'Purchase Return processed successfully!');
      setIsPurchaseModalOpen(false);
      resetPurchaseForm();
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to submit purchase return');
    }
  };

  const resetSalesForm = () => {
    setInvSearchQuery('');
    setLookedUpInvoice(null);
    setSalesReturnItems([]);
    setLookupError('');
    setSalesNotes('');
  };

  const resetPurchaseForm = () => {
    setPurSearchQuery('');
    setLookedUpPurchase(null);
    setPurReturnItems([]);
    setPurLookupError('');
    setPurNotes('');
  };

  // View voucher detail
  const handleOpenVoucher = async (type: 'credit' | 'debit', id: string) => {
    try {
      if (type === 'credit') {
        const res = await api.getSalesReturnById(id);
        setViewVoucher({ type: 'credit', data: res.data });
      } else {
        const res = await api.getPurchaseReturnById(id);
        setViewVoucher({ type: 'debit', data: res.data });
      }
    } catch (err: any) {
      alert('Failed to load voucher details');
    }
  };

  // Aggregate stats
  const totalCreditPaise = salesReturns.reduce((sum, item) => sum + (item.total_refund_paise || 0), 0);
  const totalDebitPaise = purchaseReturns.reduce((sum, item) => sum + (item.total_paise || 0), 0);
  const totalSalesReturnCount = salesReturns.length;
  const totalPurReturnCount = purchaseReturns.length;

  // Active sales return summary calculations
  const salesSummary = salesReturnItems.reduce((acc, it) => {
    const lineSubtotal = it.returnQty * it.unitPricePaise;
    const lineTax = Math.round((lineSubtotal * it.taxRate) / 100);
    return {
      subtotal: acc.subtotal + lineSubtotal,
      tax: acc.tax + lineTax,
      total: acc.total + lineSubtotal + lineTax,
    };
  }, { subtotal: 0, tax: 0, total: 0 });

  // Active purchase return summary calculations
  const purSummary = purReturnItems.reduce((acc, it) => {
    const lineSubtotal = it.returnQty * it.unitPricePaise;
    const lineTax = Math.round((lineSubtotal * it.taxRate) / 100);
    return {
      subtotal: acc.subtotal + lineSubtotal,
      tax: acc.tax + lineTax,
      total: acc.total + lineSubtotal + lineTax,
    };
  }, { subtotal: 0, tax: 0, total: 0 });

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-600 dark:text-rose-400">
              <RotateCcw className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
              Returns & Refunds Manager
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            GST-compliant Sales Credit Notes & Purchase Debit Notes with atomic inventory restock and ledger reversal
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsSalesModalOpen(true)}
            className="flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white shadow-md shadow-rose-600/20 transition active:scale-95"
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>New Sales Return</span>
          </button>

          <button
            onClick={() => setIsPurchaseModalOpen(true)}
            className="flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-md shadow-indigo-600/20 transition active:scale-95"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>New Purchase Return</span>
          </button>
        </div>
      </div>

      {notification && (
        <div className={`p-4 rounded-xl flex items-center gap-2.5 text-xs font-semibold ${
          notification.type === 'success' 
            ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300' 
            : 'bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300'
        }`}>
          {notification.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
            <span>Sales Returns (Credit Notes)</span>
            <div className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-600">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-rose-600 dark:text-rose-400">
            {formatINR(totalCreditPaise)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {totalSalesReturnCount} credit vouchers issued
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
            <span>Purchase Returns (Debit Notes)</span>
            <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-indigo-600 dark:text-indigo-400">
            {formatINR(totalDebitPaise)}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {totalPurReturnCount} debit notes to suppliers
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
            <span>Inventory Synchronization</span>
            <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-white">
            Auto-Restock
          </div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 font-semibold">
            Realtime stock movements synced
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
            <span>Refund Modes Supported</span>
            <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-white">
            Cash / UPI / Ledger
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Instant store credit / balance offset
          </div>
        </div>
      </div>

      {/* Navigation Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl">
          <button
            onClick={() => setActiveTab('sales')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'sales'
                ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ArrowDownLeft className="w-3.5 h-3.5" />
            <span>Sales Returns (Credit Notes)</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 font-mono">
              {salesReturns.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('purchases')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'purchases'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Purchase Returns (Debit Notes)</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-mono">
              {purchaseReturns.length}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 px-2">
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={activeTab === 'sales' ? "Search credit note, invoice or customer..." : "Search debit note, bill or supplier..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-rose-500"
            />
          </div>

          <button
            onClick={loadData}
            title="Refresh list"
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Table View */}
      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400 flex flex-col items-center gap-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading returns records...</span>
        </div>
      ) : activeTab === 'sales' ? (
        /* ================= SALES RETURNS TABLE ================= */
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          {salesReturns.length === 0 ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center text-rose-500">
                <RotateCcw className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">No Sales Returns Found</p>
              <p className="text-xs text-slate-500 max-w-sm">
                Customers haven't returned any billed items yet, or search returned no matches.
              </p>
              <button
                onClick={() => setIsSalesModalOpen(true)}
                className="mt-2 text-xs font-bold px-4 py-2 rounded-xl bg-rose-600 text-white"
              >
                + Process First Sales Return
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Credit Note #</th>
                    <th className="py-3 px-4">Orig. Invoice</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Return Date</th>
                    <th className="py-3 px-4">Reason</th>
                    <th className="py-3 px-4">Refund Mode</th>
                    <th className="py-3 px-4 text-right">Total Refund</th>
                    <th className="py-3 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {salesReturns.map((cn) => (
                    <tr key={cn.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                      <td className="py-3.5 px-4 font-mono font-bold text-rose-600 dark:text-rose-400">
                        {cn.credit_note_number}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                        {cn.invoice_number}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white">{cn.customer_name}</div>
                        {cn.customer_phone && (
                          <div className="text-[10px] text-slate-400">{cn.customer_phone}</div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {formatDate(cn.return_date)}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {cn.reason || 'RETURN'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900">
                          {cn.refund_mode}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-slate-900 dark:text-white font-mono">
                        {formatINR(cn.total_refund_paise)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => handleOpenVoucher('credit', cn.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition font-semibold text-[11px]"
                        >
                          <Printer className="w-3 h-3" />
                          <span>View Voucher</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* ================= PURCHASE RETURNS TABLE ================= */
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          {purchaseReturns.length === 0 ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-500">
                <ArrowUpRight className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">No Purchase Returns Found</p>
              <p className="text-xs text-slate-500 max-w-sm">
                No items have been returned to vendors or suppliers yet.
              </p>
              <button
                onClick={() => setIsPurchaseModalOpen(true)}
                className="mt-2 text-xs font-bold px-4 py-2 rounded-xl bg-indigo-600 text-white"
              >
                + Issue Purchase Debit Note
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Debit Note #</th>
                    <th className="py-3 px-4">Orig. Bill #</th>
                    <th className="py-3 px-4">Supplier</th>
                    <th className="py-3 px-4">Return Date</th>
                    <th className="py-3 px-4">Reason</th>
                    <th className="py-3 px-4">Adjustment Mode</th>
                    <th className="py-3 px-4 text-right">Debit Total</th>
                    <th className="py-3 px-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {purchaseReturns.map((dn) => (
                    <tr key={dn.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                      <td className="py-3.5 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {dn.debit_note_number}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300">
                        {dn.purchase_number}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white">
                        {dn.supplier_name}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        {formatDate(dn.return_date)}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {dn.reason || 'DAMAGED'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900">
                          {dn.refund_mode}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold text-slate-900 dark:text-white font-mono">
                        {formatINR(dn.total_paise)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => handleOpenVoucher('debit', dn.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition font-semibold text-[11px]"
                        >
                          <Printer className="w-3 h-3" />
                          <span>View Voucher</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: NEW SALES RETURN (CREDIT NOTE) */}
      {/* ========================================================================= */}
      {isSalesModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-rose-50 dark:bg-rose-950/60 text-rose-600 rounded-xl">
                  <ArrowDownLeft className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white font-['Outfit']">
                    Create Sales Return (Credit Note)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Restocks selected goods & reverses customer balance or issues instant refund
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setIsSalesModalOpen(false); resetSalesForm(); }}
                className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step 1: Lookup Invoice */}
            <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
                1. Lookup Original Invoice Number
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. INV-1001, INV-1002"
                  value={invSearchQuery}
                  onChange={(e) => setInvSearchQuery(e.target.value)}
                  className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-rose-500 font-mono"
                />
                <button
                  type="button"
                  onClick={handleLookupInvoice}
                  disabled={lookupLoading}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {lookupLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>Find Invoice</span>
                </button>
              </div>

              {lookupError && (
                <div className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{lookupError}</span>
                </div>
              )}

              {lookedUpInvoice && (
                <div className="mt-2 p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-emerald-200 dark:border-emerald-900/60 flex flex-wrap items-center justify-between text-xs gap-2">
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white">Customer: </span>
                    <span className="text-slate-600 dark:text-slate-300">{lookedUpInvoice.customer_name}</span>
                    {lookedUpInvoice.customer_phone && <span className="text-slate-400"> ({lookedUpInvoice.customer_phone})</span>}
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white">Total Billed: </span>
                    <span className="font-mono text-emerald-600 font-bold">{formatINR(lookedUpInvoice.total_paise)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Step 2: Line items selection */}
            {salesReturnItems.length > 0 && (
              <form onSubmit={handleSubmitSalesReturn} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
                    2. Choose Items to Return & Quantity
                  </label>
                  <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                    {salesReturnItems.map((item, idx) => (
                      <div key={idx} className="p-3 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 dark:text-white truncate">{item.productName}</div>
                          <div className="text-[10px] text-slate-400">
                            Rate: {formatINR(item.unitPricePaise)} + {item.taxRate}% GST | Sold: {item.soldQty} | Can return: <span className="text-emerald-500 font-bold">{item.availableQty}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-slate-400">Return Qty:</label>
                          <input
                            type="number"
                            min="0"
                            max={item.availableQty}
                            step="any"
                            value={item.returnQty}
                            onChange={(e) => {
                              const val = Math.min(item.availableQty, Math.max(0, Number(e.target.value) || 0));
                              const updated = [...salesReturnItems];
                              updated[idx].returnQty = val;
                              setSalesReturnItems(updated);
                            }}
                            className="w-16 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-center font-bold text-rose-600 dark:text-rose-400 text-xs focus:outline-none focus:border-rose-500"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Step 3: Refund Configuration */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Refund Mode
                    </label>
                    <select
                      value={salesRefundMode}
                      onChange={(e: any) => setSalesRefundMode(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-rose-500"
                    >
                      <option value="CASH">Cash Refund</option>
                      <option value="UPI">UPI Refund</option>
                      <option value="BANK_TRANSFER">Bank Transfer</option>
                      <option value="STORE_CREDIT">Store Credit / Deduct Due Balance</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Return Reason
                    </label>
                    <select
                      value={salesReason}
                      onChange={(e) => setSalesReason(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-rose-500"
                    >
                      <option value="CUSTOMER_CHANGE_MIND">Customer Changed Mind</option>
                      <option value="DEFECTIVE">Defective / Damaged Item</option>
                      <option value="WRONG_ITEM">Wrong Item Handed</option>
                      <option value="EXPIRED">Near Expiry / Expired</option>
                      <option value="OTHER">Other Reason</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Notes / Remarks
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Seal opened or sealed box returned"
                    value={salesNotes}
                    onChange={(e) => setSalesNotes(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-rose-500"
                  />
                </div>

                {/* Calculation summary banner */}
                <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-2xl flex items-center justify-between text-xs">
                  <div>
                    <div className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold">Total Credit Refund:</div>
                    <div className="text-[10px] text-slate-400">
                      Subtotal: {formatINR(salesSummary.subtotal)} | Tax Reversal: {formatINR(salesSummary.tax)}
                    </div>
                  </div>
                  <div className="text-xl font-black text-rose-600 dark:text-rose-400 font-mono">
                    {formatINR(salesSummary.total)}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => { setIsSalesModalOpen(false); resetSalesForm(); }}
                    className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={salesSummary.total <= 0}
                    className="px-5 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30 transition disabled:opacity-50"
                  >
                    Confirm & Restock Stock
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: NEW PURCHASE RETURN (DEBIT NOTE) */}
      {/* ========================================================================= */}
      {isPurchaseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 rounded-xl">
                  <ArrowUpRight className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white font-['Outfit']">
                    Issue Purchase Return (Debit Note)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Deducts items from warehouse stock & reduces supplier payable debt
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setIsPurchaseModalOpen(false); resetPurchaseForm(); }}
                className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step 1: Lookup Purchase Bill */}
            <div className="space-y-2 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
                1. Lookup Purchase Invoice Bill Number
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. PUR-001, PO-99"
                  value={purSearchQuery}
                  onChange={(e) => setPurSearchQuery(e.target.value)}
                  className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
                />
                <button
                  type="button"
                  onClick={handleLookupPurchase}
                  disabled={purLookupLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {purLookupLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>Find Bill</span>
                </button>
              </div>

              {purLookupError && (
                <div className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{purLookupError}</span>
                </div>
              )}

              {lookedUpPurchase && (
                <div className="mt-2 p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-indigo-200 dark:border-indigo-900/60 flex flex-wrap items-center justify-between text-xs gap-2">
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white">Supplier: </span>
                    <span className="text-slate-600 dark:text-slate-300">{lookedUpPurchase.supplier_name}</span>
                  </div>
                  <div>
                    <span className="font-bold text-slate-900 dark:text-white">Purchase Amount: </span>
                    <span className="font-mono text-indigo-600 font-bold">{formatINR(lookedUpPurchase.total_paise)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Step 2: Line items selection */}
            {purReturnItems.length > 0 && (
              <form onSubmit={handleSubmitPurchaseReturn} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
                    2. Choose Items to Return to Vendor & Quantity
                  </label>
                  <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                    {purReturnItems.map((item, idx) => (
                      <div key={idx} className="p-3 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 dark:text-white truncate">{item.productName}</div>
                          <div className="text-[10px] text-slate-400">
                            Purchase Rate: {formatINR(item.unitPricePaise)} + {item.taxRate}% GST | Purchased: {item.purchasedQty} | Available: <span className="text-indigo-500 font-bold">{item.availableQty}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-slate-400">Return Qty:</label>
                          <input
                            type="number"
                            min="0"
                            max={item.availableQty}
                            step="any"
                            value={item.returnQty}
                            onChange={(e) => {
                              const val = Math.min(item.availableQty, Math.max(0, Number(e.target.value) || 0));
                              const updated = [...purReturnItems];
                              updated[idx].returnQty = val;
                              setPurReturnItems(updated);
                            }}
                            className="w-16 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-center font-bold text-indigo-600 dark:text-indigo-400 text-xs focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Step 3: Refund Configuration */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Adjustment Mode
                    </label>
                    <select
                      value={purRefundMode}
                      onChange={(e: any) => setPurRefundMode(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="ADJUST_PAYABLE">Adjust Supplier Payable (Reduce Debt)</option>
                      <option value="CASH">Cash Received from Vendor</option>
                      <option value="BANK_TRANSFER">Bank Transfer / NEFT</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      Return Reason
                    </label>
                    <select
                      value={purReason}
                      onChange={(e) => setPurReason(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="DAMAGED_GOODS">Damaged / Broken Goods</option>
                      <option value="WRONG_DELIVERY">Wrong Product Delivered</option>
                      <option value="SHORT_EXPIRY">Short Expiry Received</option>
                      <option value="QUALITY_ISSUE">Poor Quality / Substandard</option>
                      <option value="OTHER">Other Reason</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Notes / Remarks
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Courier dispatch tracking or vendor agreement notes"
                    value={purNotes}
                    onChange={(e) => setPurNotes(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Calculation summary banner */}
                <div className="p-3.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 rounded-2xl flex items-center justify-between text-xs">
                  <div>
                    <div className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold">Total Debit Amount:</div>
                    <div className="text-[10px] text-slate-400">
                      Subtotal: {formatINR(purSummary.subtotal)} | Tax: {formatINR(purSummary.tax)}
                    </div>
                  </div>
                  <div className="text-xl font-black text-indigo-600 dark:text-indigo-400 font-mono">
                    {formatINR(purSummary.total)}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => { setIsPurchaseModalOpen(false); resetPurchaseForm(); }}
                    className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={purSummary.total <= 0}
                    className="px-5 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition disabled:opacity-50"
                  >
                    Confirm & Deduct Stock
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: VIEW & PRINT VOUCHER MODAL */}
      {/* ========================================================================= */}
      {viewVoucher && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-slate-700 dark:text-slate-300" />
                <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                  {viewVoucher.type === 'credit' ? 'Sales Credit Note Voucher' : 'Purchase Debit Note Voucher'}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl text-xs font-bold flex items-center gap-1.5 hover:opacity-90 transition"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Voucher</span>
                </button>
                <button 
                  onClick={() => setViewVoucher(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Area */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700/80 text-xs space-y-4 font-sans">
              <div className="flex justify-between items-start border-b border-slate-200 dark:border-slate-700 pb-3">
                <div>
                  <div className="text-base font-extrabold text-slate-900 dark:text-white font-['Outfit']">
                    {viewVoucher.data.business?.name || 'Apna Billing Store'}
                  </div>
                  {viewVoucher.data.business?.gstin && (
                    <div className="text-[11px] text-slate-500 font-mono">
                      GSTIN: {viewVoucher.data.business.gstin}
                    </div>
                  )}
                  <div className="text-[11px] text-slate-400">
                    {viewVoucher.data.business?.address} {viewVoucher.data.business?.city}
                  </div>
                </div>

                <div className="text-right">
                  <div className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider inline-block ${
                    viewVoucher.type === 'credit' 
                      ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300' 
                      : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
                  }`}>
                    {viewVoucher.type === 'credit' ? 'CREDIT NOTE' : 'DEBIT NOTE'}
                  </div>
                  <div className="font-mono font-bold text-sm text-slate-900 dark:text-white mt-1">
                    {viewVoucher.type === 'credit' ? viewVoucher.data.credit_note_number : viewVoucher.data.debit_note_number}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Date: {formatDate(viewVoucher.data.return_date)}
                  </div>
                </div>
              </div>

              {/* Reference Details */}
              <div className="grid grid-cols-2 gap-4 text-[11px] pb-2 border-b border-slate-200 dark:border-slate-700">
                <div>
                  <div className="text-slate-400 font-medium">
                    {viewVoucher.type === 'credit' ? 'Customer Details:' : 'Supplier Details:'}
                  </div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {viewVoucher.type === 'credit' ? viewVoucher.data.customer_name : viewVoucher.data.supplier_name}
                  </div>
                  {(viewVoucher.data.customer_phone || viewVoucher.data.supplier_phone) && (
                    <div className="text-slate-400">
                      Phone: {viewVoucher.data.customer_phone || viewVoucher.data.supplier_phone}
                    </div>
                  )}
                </div>

                <div className="text-right">
                  <div className="text-slate-400 font-medium">Original Reference:</div>
                  <div className="font-mono font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {viewVoucher.type === 'credit' ? `Inv: ${viewVoucher.data.invoice_number}` : `Bill: ${viewVoucher.data.purchase_number}`}
                  </div>
                  <div className="text-slate-400 mt-0.5">
                    Mode: <span className="font-semibold text-slate-700 dark:text-slate-300">{viewVoucher.data.refund_mode}</span>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] font-bold text-slate-400 border-b border-slate-200 dark:border-slate-700 uppercase">
                      <th className="py-1.5">Item Name</th>
                      <th className="py-1.5 text-center">Qty</th>
                      <th className="py-1.5 text-right">Rate</th>
                      <th className="py-1.5 text-right">Tax</th>
                      <th className="py-1.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {viewVoucher.data.items?.map((it: any, i: number) => (
                      <tr key={i}>
                        <td className="py-2 text-slate-800 dark:text-slate-200 font-medium">{it.product_name}</td>
                        <td className="py-2 text-center font-bold text-slate-700 dark:text-slate-300">{it.quantity}</td>
                        <td className="py-2 text-right font-mono">{formatINR(it.unit_price_paise)}</td>
                        <td className="py-2 text-right font-mono">{formatINR(it.tax_paise)}</td>
                        <td className="py-2 text-right font-mono font-bold text-slate-900 dark:text-white">{formatINR(it.total_paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Total & Summary */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <div className="text-[11px] text-slate-400 italic">
                  Reason: {viewVoucher.data.reason} {viewVoucher.data.notes ? `(${viewVoucher.data.notes})` : ''}
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-slate-400">Total Voucher Value</div>
                  <div className="text-base font-black text-slate-900 dark:text-white font-mono">
                    {formatINR(viewVoucher.type === 'credit' ? viewVoucher.data.total_refund_paise : viewVoucher.data.total_paise)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
