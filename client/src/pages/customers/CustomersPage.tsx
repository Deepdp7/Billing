import React, { useState, useEffect } from 'react';
import { api, downloadFile } from '../../lib/api.js';
import { Customer, Invoice } from '../../types/index.js';
import { formatINR, formatDate, rupeesToPaise } from '../../lib/utils.js';
import { 
  Users, Plus, Search, Phone, Mail, MapPin, 
  CreditCard, Eye, X, Check, Pencil, Trash2, IndianRupee, Download
} from 'lucide-react';
import { confirmDialog, showAlert } from '../../components/ui/dialogs.js';
import { Select } from '../../components/ui/Select.js';

import { useLiveRefresh } from '../../lib/live.js';
export const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Add Customer Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gstin, setGstin] = useState('');
  const [address, setAddress] = useState('');
  const [creditLimitRupees, setCreditLimitRupees] = useState('10000');
  const [custState, setCustState] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Ledger & payments
  const [ledger, setLedger] = useState<any | null>(null);
  const [payCustomer, setPayCustomer] = useState<Customer | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState('CASH');
  const [payRef, setPayRef] = useState('');
  const [notice, setNotice] = useState('');

  // Customer Statement Modal
  const [statementCustomer, setStatementCustomer] = useState<Customer | null>(null);
  const [statementInvoices, setStatementInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    loadCustomers();
  }, [search]);

  // Another computer of this account changed something: the lists reload quietly
  useLiveRefresh(() => { void loadCustomers(true); });
  const loadCustomers = async (quiet?: unknown) => {
    try {
      if (quiet !== true) setLoading(true);
      const res = await api.getCustomers({ search: search || undefined });
      setCustomers(res.data);
    } catch (err) {
      console.error('Failed to load customers', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      const data = {
        name,
        phone,
        email,
        gstin: gstin.trim().toUpperCase(),
        billingAddress: address,
        shippingAddress: shippingAddress || undefined,
        state: custState || undefined,
        creditLimitPaise: rupeesToPaise(creditLimitRupees),
      };
      if (editingId) await api.updateCustomer(editingId, data);
      else await api.createCustomer(data);
      setIsAddModalOpen(false);
      setEditingId(null);
      setName('');
      setPhone('');
      setEmail('');
      setGstin('');
      setAddress('');
      setShippingAddress('');
      setCustState('');
      loadCustomers();
    } catch (err: any) {
      showAlert(err.message || 'Failed to create customer');
    }
  };

  const openEdit = (c: any) => {
    setEditingId(c.id);
    setName(c.name || '');
    setPhone(c.phone || '');
    setEmail(c.email || '');
    setGstin(c.gstin || '');
    setAddress(c.billing_address || c.address || '');
    setShippingAddress(c.shipping_address || '');
    setCustState(c.state || '');
    setCreditLimitRupees(String((c.credit_limit_paise || 0) / 100));
    setIsAddModalOpen(true);
  };

  const removeCustomer = async (c: Customer) => {
    if (!(await confirmDialog(`Delete ${c.name}?`, { danger: true }))) return;
    try {
      await api.deleteCustomer(c.id);
      setNotice(`${c.name} deleted.`);
      loadCustomers();
    } catch (err: any) {
      if (err.code === 'HAS_HISTORY' && (await confirmDialog(`${err.message}\n\nDeactivate ${c.name} instead? Their invoices stay intact.`, { danger: true }))) {
        await api.deleteCustomer(c.id, true);
        setNotice(`${c.name} deactivated.`);
        loadCustomers();
      } else if (err.code !== 'HAS_HISTORY') {
        showAlert(err.message || 'Failed to delete customer');
      }
    }
  };

  const receivePayment = async () => {
    if (!payCustomer) return;
    try {
      if (payCustomer.outstanding_balance_paise < 0) {
        await api.refundCustomerAdvance(payCustomer.id, { amountPaise: rupeesToPaise(payAmount), mode: payMode, reference: payRef || undefined });
        setNotice(`${formatINR(rupeesToPaise(payAmount))} advance returned to ${payCustomer.name}`);
        setPayCustomer(null);
        loadCustomers();
        return;
      }
      const r = await api.receiveCustomerPayment(payCustomer.id, { amountPaise: rupeesToPaise(payAmount), mode: payMode, reference: payRef || undefined });
      const parts = r.allocations.map((a: any) => `${a.invoiceNumber}: ${formatINR(a.amountPaise)}`);
      if (r.advancePaise > 0) parts.push(`advance ${formatINR(r.advancePaise)}`);
      setNotice(`Payment recorded for ${payCustomer.name} — ${parts.join(', ')}`);
      setPayCustomer(null);
      loadCustomers();
    } catch (err: any) {
      showAlert(err.message || 'Failed to record payment');
    }
  };

  const exportCustomers = async (format: 'csv' | 'xlsx') => {
    try {
      await downloadFile(`/app/customers/export?format=${format}`, `customers.${format}`);
    } catch (err: any) {
      showAlert(err.message || 'Export failed');
    }
  };

  // A payment entered by mistake: cancel it, and the customer's balance goes back
  const undoPayment = async (e: any) => {
    if (!statementCustomer) return;
    const ok = await confirmDialog(`Undo the ${formatINR(e.credit)} payment from ${formatDate(e.date)}? It is removed from all totals and ${statementCustomer.name}'s balance goes back.`,
      { title: 'Undo payment?', confirmText: 'Undo payment', danger: true });
    if (!ok) return;
    try {
      await api.voidCustomerPayment(statementCustomer.id, e.payment_id);
      setNotice('Payment undone');
      await viewStatement(statementCustomer);
      loadCustomers();
    } catch (err: any) {
      showAlert(err.message || 'Could not undo the payment');
    }
  };

  const viewStatement = async (c: Customer) => {
    try {
      const [res, led] = await Promise.all([api.getCustomerById(c.id), api.getCustomerLedger(c.id)]);
      setStatementCustomer(res.customer);
      setStatementInvoices(res.invoices);
      setLedger(led);
    } catch (err: any) {
      showAlert(err.message || 'Failed to load customer statement');
    }
  };

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
            Customer Directory & Ledgers
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Credit limits, outstanding party balances, GSTIN records, and customer statement logs
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
        <button onClick={() => exportCustomers('xlsx')} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50">
          <Download className="w-3.5 h-3.5" /><span>Export</span>
        </button>
        <button
          onClick={() => { setEditingId(null); setIsAddModalOpen(true); }}
          className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-md shadow-emerald-500/25 transition active:scale-95 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Customer</span>
        </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs rounded-xl flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" /><span className="flex-1">{notice}</span><button onClick={() => setNotice('')}>✕</button>
        </div>
      )}

      {/* Filter */}
      <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center">
        <div className="flex-1 max-w-md relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by customer name, phone or GSTIN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold">
              <th className="p-3.5">Customer Name</th>
              <th className="p-3.5">Contact Details</th>
              <th className="p-3.5">GSTIN</th>
              <th className="p-3.5 text-right">Credit Limit</th>
              <th className="p-3.5 text-right">Balance</th>
              <th className="p-3.5 text-right">Statement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {customers.length > 0 ? (
              customers.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                  <td className="p-3.5">
                    <div className="font-bold text-slate-900 dark:text-white">{c.name}</div>
                    {c.address && <div className="text-[10px] text-slate-400 truncate max-w-xs">{c.address}</div>}
                  </td>
                  <td className="p-3.5">
                    <div className="font-mono text-slate-700 dark:text-slate-300">{c.phone || '-'}</div>
                    {c.email && <div className="text-[10px] text-slate-400">{c.email}</div>}
                  </td>
                  <td className="p-3.5 font-mono text-slate-600 dark:text-slate-300">
                    {c.gstin || '-'}
                  </td>
                  <td className="p-3.5 text-right font-mono text-slate-600 dark:text-slate-300">
                    {formatINR(c.credit_limit_paise)}
                  </td>
                  <td className="p-3.5 text-right font-mono font-bold">
                    <BalanceText paise={c.outstanding_balance_paise} />
                  </td>
                  <td className="p-3.5 text-right">
                    <button
                      onClick={() => viewStatement(c)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-emerald-600 transition"
                      title="View Customer Order Ledger"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { setPayCustomer(c); setPayAmount(c.outstanding_balance_paise !== 0 ? (Math.abs(c.outstanding_balance_paise) / 100).toFixed(2) : ''); setPayMode('CASH'); setPayRef(''); }}
                      className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-slate-800 text-slate-500 hover:text-emerald-600 transition" title={c.outstanding_balance_paise < 0 ? 'Return advance' : 'Receive Payment'}>
                      <IndianRupee className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-indigo-600 transition" title="Edit Customer">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => removeCustomer(c)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-slate-800 text-slate-400 hover:text-red-600 transition" title="Delete Customer">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  No customers found. Click "Add New Customer" to register your regular buyers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Customer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">{editingId ? 'Edit Customer' : 'Add New Customer'}</h3>
              <button onClick={() => { setIsAddModalOpen(false); setEditingId(null); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddCustomer} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Customer Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Phone Number</label>
                  <input
                    type="text"
                    placeholder="+91 9876543210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="email@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">GSTIN (Optional)</label>
                  <input
                    type="text"
                    placeholder="27AABCA1234A1Z5"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Credit Limit (₹)</label>
                  <input
                    type="number"
                    value={creditLimitRupees}
                    onChange={(e) => setCreditLimitRupees(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Billing Address</label>
                <input
                  type="text"
                  placeholder="Street, City, Pincode"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Shipping Address</label>
                  <input type="text" placeholder="If different from billing" value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">State (for GST)</label>
                  <input type="text" placeholder="e.g. Maharashtra" value={custState} onChange={(e) => setCustState(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500" />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md transition"
                >
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receive Payment Modal */}
      {payCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-3">
            {payCustomer.outstanding_balance_paise < 0 ? (<>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">Return advance — {payCustomer.name}</h3>
              <p className="text-xs text-slate-500">
                You hold <b className="text-sky-600 dark:text-sky-400">{formatINR(-payCustomer.outstanding_balance_paise)}</b> of {payCustomer.name}'s money
                (paid, but no bill uses it). Give it back and record how you paid it; the balance becomes ₹0.00.
              </p>
            </>) : (<>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">Receive payment — {payCustomer.name}</h3>
              <p className="text-xs text-slate-500">Owes you {formatINR(payCustomer.outstanding_balance_paise)}. The oldest unpaid invoices are settled first; any extra is kept as advance.</p>
            </>)}
            <input type="number" min="0" step="0.01" placeholder="Amount ₹" value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs" />
            <Select value={payMode} onChange={(e) => setPayMode(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs">
              {['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'WALLET'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </Select>
            <input placeholder="Reference (optional)" value={payRef} onChange={(e) => setPayRef(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs" />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setPayCustomer(null)} className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-xl">Cancel</button>
              <button onClick={receivePayment} disabled={!(parseFloat(payAmount) > 0)} className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl disabled:opacity-50">{payCustomer.outstanding_balance_paise < 0 ? 'Return advance' : 'Record Payment'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Statement View Modal */}
      {statementCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  Customer Ledger: {statementCustomer.name}
                </h3>
                <p className="text-xs text-slate-400">
                  Phone: {statementCustomer.phone || 'N/A'} · Balance: <BalanceText paise={statementCustomer.outstanding_balance_paise} />
                </p>
              </div>
              <button onClick={() => setStatementCustomer(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {ledger && (
                <div className="mb-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Ledger (debit = billed, credit = received)</h4>
                  <table className="w-full text-[11px]">
                    <thead className="text-slate-400 text-left"><tr><th className="py-1">Date</th><th>Type</th><th>Ref</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th><th /></tr></thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {ledger.entries.map((e: any, i: number) => (
                        <tr key={i}>
                          <td className="py-1">{formatDate(e.date)}</td><td>{e.type.replace('_', ' ')}</td><td className="font-mono">{e.reference || '-'}</td>
                          <td className="text-right font-mono">{e.debit ? formatINR(e.debit) : ''}</td>
                          <td className="text-right font-mono">{e.credit ? formatINR(e.credit) : ''}</td>
                          <td className="text-right font-mono font-bold">{formatINR(e.balance)}</td>
                          <td className="text-right pl-2">
                            {e.payment_id && (
                              <button onClick={() => undoPayment(e)} className="text-[10px] font-semibold text-rose-600 hover:underline">Undo</button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {ledger.entries.length === 0 && <tr><td colSpan={7} className="py-2 text-slate-400">No transactions yet.</td></tr>}
                    </tbody>
                  </table>
                  <div className="text-right text-xs font-bold mt-1">Closing balance: {formatINR(ledger.closingBalancePaise)}</div>
                </div>
              )}
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Transaction History</h4>
              {statementInvoices.length > 0 ? (
                statementInvoices.map((inv) => (
                  <div key={inv.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="font-mono font-bold text-xs text-slate-900 dark:text-white">{inv.invoice_number}</div>
                      <div className="text-[11px] text-slate-400">{formatDate(inv.invoice_date)} · {inv.payment_mode}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-bold text-xs text-slate-900 dark:text-white">{formatINR(inv.total_paise)}</div>
                      <div className={`text-[10px] font-bold ${inv.payment_status === 'PAID' ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {inv.payment_status}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-xs text-slate-400">
                  No invoices recorded for this customer yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

/** A customer's balance in plain words: what they owe you, or the advance you hold for them. */
const BalanceText: React.FC<{ paise: number }> = ({ paise }) =>
  paise > 0 ? <span className="text-amber-600 dark:text-amber-400">{formatINR(paise)} due</span>
  : paise < 0 ? <span className="text-sky-600 dark:text-sky-400">{formatINR(-paise)} advance</span>
  : <span className="text-slate-400">{formatINR(0)}</span>;
