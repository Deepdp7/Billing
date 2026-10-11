import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { BulkPriceSlab, DistributorRoute, WholesaleParty, Product, Customer } from '../../types/index.js';
import { useLanguage } from '../../context/LanguageContext.js';
import { 
  Truck, Layers, CreditCard, MapPin, Plus, Search, 
  RefreshCw, CheckCircle2, AlertCircle, Trash2, ArrowUpRight,
  TrendingDown, ShieldAlert, DollarSign, Users, ChevronRight, X
} from 'lucide-react';

export const WholesalePage: React.FC = () => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'slabs' | 'dealers' | 'routes'>('slabs');
  const [slabs, setSlabs] = useState<BulkPriceSlab[]>([]);
  const [routes, setRoutes] = useState<DistributorRoute[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showAddSlabModal, setShowAddSlabModal] = useState(false);
  const [slabForm, setSlabForm] = useState({
    productId: '',
    minQuantity: 10,
    maxQuantity: 49,
    slabPrice: 0,
  });

  const [showAddRouteModal, setShowAddRouteModal] = useState(false);
  const [routeForm, setRouteForm] = useState({
    routeName: '',
    salespersonName: '',
    areaZone: '',
  });

  const [selectedParty, setSelectedParty] = useState<Customer | null>(null);
  const [partyLedger, setPartyLedger] = useState<any>(null);
  const [showLedgerModal, setShowLedgerModal] = useState(false);

  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditForm, setCreditForm] = useState({
    creditLimit: 50000,
    creditDays: 30,
    customerType: 'WHOLESALE',
  });

  const [showLedgerEntryModal, setShowLedgerEntryModal] = useState(false);
  const [ledgerEntryForm, setLedgerEntryForm] = useState({
    entryType: 'PAYMENT_CREDIT',
    referenceNo: '',
    amount: 5000,
    notes: 'Cheque payment received',
  });

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [slabRes, routeRes, prodRes, custRes, sumRes] = await Promise.all([
        api.getBulkSlabs(),
        api.getDistributorRoutes(),
        api.getProducts(),
        api.getCustomers(),
        api.getWholesaleSummary(),
      ]);

      const productsList = (prodRes as any).data || (prodRes as any).products || [];
      const customersList = (custRes as any).data || (custRes as any).customers || [];

      setSlabs(slabRes.slabs || []);
      setRoutes(routeRes.routes || []);
      setProducts(productsList);
      setCustomers(customersList);
      setSummary(sumRes.summary || null);

      if (productsList && productsList.length > 0) {
        setSlabForm(prev => ({
          ...prev,
          productId: productsList[0].id,
          slabPrice: (productsList[0].sale_price_paise || 0) / 100 * 0.9,
        }));
      }
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to load wholesale records' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateSlab = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createBulkSlab({
        productId: slabForm.productId,
        minQuantity: Number(slabForm.minQuantity),
        maxQuantity: slabForm.maxQuantity ? Number(slabForm.maxQuantity) : null,
        slabPrice: Number(slabForm.slabPrice),
      });

      setNotification({ type: 'success', message: 'Bulk price slab registered!' });
      setShowAddSlabModal(false);
      fetchData();
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to create bulk slab' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteSlab = async (id: string) => {
    if (!confirm('Are you sure you want to remove this pricing tier?')) return;
    try {
      await api.deleteBulkSlab(id);
      setNotification({ type: 'success', message: 'Price slab removed' });
      fetchData();
      setTimeout(() => setNotification(null), 3000);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to delete slab' });
    }
  };

  const handleCreateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createDistributorRoute(routeForm);
      setNotification({ type: 'success', message: 'Distribution route created!' });
      setShowAddRouteModal(false);
      setRouteForm({ routeName: '', salespersonName: '', areaZone: '' });
      fetchData();
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to create route' });
    } finally {
      setSubmitting(false);
    }
  };

  const openPartyLedger = async (cust: Customer) => {
    setSelectedParty(cust);
    try {
      const res = await api.getPartyLedger(cust.id);
      setPartyLedger(res);
      setShowLedgerModal(true);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to load ledger' });
    }
  };

  const openCreditTerms = (cust: Customer) => {
    setSelectedParty(cust);
    setCreditForm({
      creditLimit: ((cust as any).credit_limit_paise || 0) / 100 || 50000,
      creditDays: (cust as any).credit_days || 30,
      customerType: (cust as any).customer_type || 'WHOLESALE',
    });
    setShowCreditModal(true);
  };

  const handleUpdateCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedParty) return;
    setSubmitting(true);
    try {
      await api.updateCustomerCredit(selectedParty.id, creditForm);
      setNotification({ type: 'success', message: 'Customer credit limits updated!' });
      setShowCreditModal(false);
      fetchData();
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to update credit terms' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddLedgerEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedParty) return;
    setSubmitting(true);
    try {
      await api.addPartyLedgerEntry({
        customerId: selectedParty.id,
        entryType: ledgerEntryForm.entryType,
        referenceNo: ledgerEntryForm.referenceNo,
        amount: Number(ledgerEntryForm.amount),
        notes: ledgerEntryForm.notes,
      });

      setNotification({ type: 'success', message: 'Party ledger transaction recorded!' });
      setShowLedgerEntryModal(false);
      const res = await api.getPartyLedger(selectedParty.id);
      setPartyLedger(res);
      fetchData();
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Transaction failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const wholesaleCustomers = customers.filter(c => 
    (c as any).customer_type === 'WHOLESALE' || 
    (c as any).customer_type === 'DISTRIBUTOR' ||
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between text-sm shadow-lg border transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/80 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            )}
            <span className="font-medium">{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)} className="text-xs uppercase font-bold tracking-wider opacity-70">
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
            <Truck className="w-7 h-7 fill-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Wholesale & Distribution Hub
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              PRD §5 Wholesale Vertical · Bulk Tiered Pricing, Party Ledger & Credit Limits
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchData()}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{t('refresh', 'Refresh')}</span>
          </button>

          {activeTab === 'slabs' && (
            <button
              onClick={() => setShowAddSlabModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/25 transition"
            >
              <Plus className="w-4 h-4" />
              <span>New Bulk Slab</span>
            </button>
          )}

          {activeTab === 'routes' && (
            <button
              onClick={() => setShowAddRouteModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/25 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add Distribution Route</span>
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Wholesale Dealers</span>
            <Users className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {summary?.totalDealers ?? 1} <span className="text-xs font-medium text-slate-400">Parties</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Authorized distributors & retailers</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Bulk Slabs</span>
            <Layers className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400">
            {slabs.length} <span className="text-xs font-medium text-slate-400">Tiers</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Automatic POS quantity discounts</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Credit Limit</span>
            <CreditCard className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
            ₹{(summary?.totalCreditLimit ?? 50000).toLocaleString('en-IN')}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Extended distributor credit lines</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Wholesale Receivables</span>
            <AlertCircle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400">
            ₹{(summary?.totalReceivables ?? 14500).toLocaleString('en-IN')}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Outstanding market dues</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('slabs')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'slabs'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Tiered Bulk Pricing Slabs ({slabs.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('dealers')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'dealers'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Dealer Credit Limits & Party Ledger ({customers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('routes')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'routes'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span>Distribution Routes & Zones ({routes.length})</span>
        </button>
      </div>

      {/* TAB 1: Bulk Price Slabs */}
      {activeTab === 'slabs' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">
              Quantity Break Pricing Slabs
            </h2>
            <span className="text-xs text-slate-400">Auto-applied in Wholesale Orders</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Product Name</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3 text-right">Standard Price</th>
                  <th className="px-4 py-3 text-center">Quantity Slab</th>
                  <th className="px-4 py-3 text-right">Wholesale Rate</th>
                  <th className="px-4 py-3 text-right">Savings %</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {slabs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      No bulk pricing slabs defined yet. Click "New Bulk Slab" to set up quantity discounts.
                    </td>
                  </tr>
                ) : (
                  slabs.map((slab) => {
                    const discount = slab.standardPrice > 0 
                      ? Math.round(((slab.standardPrice - slab.slabPrice) / slab.standardPrice) * 100) 
                      : 0;
                    return (
                      <tr key={slab.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                          {slab.productName}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400">
                          {slab.productSku}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-400 line-through">
                          ₹{slab.standardPrice.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">
                            {slab.minQuantity} - {slab.maxQuantity ? `${slab.maxQuantity} pcs` : 'Above'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-black text-indigo-600 dark:text-indigo-400 text-sm">
                          ₹{slab.slabPrice.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            {discount}% OFF
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleDeleteSlab(slab.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Dealer Credit Limits & Party Ledger */}
      {activeTab === 'dealers' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden space-y-4">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-sm text-slate-900 dark:text-white">
                Dealer Accounts & Party Ledger
              </h2>
              <p className="text-[11px] text-slate-400">Track credit limits, outstanding balances, and account statements</p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search party name, phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Party Name</th>
                  <th className="px-4 py-3">Phone / Contact</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Credit Limit</th>
                  <th className="px-4 py-3 text-center">Credit Days</th>
                  <th className="px-4 py-3 text-right">Balance Due</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {wholesaleCustomers.map((cust) => {
                  const creditLimit = ((cust as any).credit_limit_paise || 0) / 100;
                  const balanceDue = ((cust as any).outstanding_balance_paise || 0) / 100;
                  const creditDays = (cust as any).credit_days || 30;
                  const type = (cust as any).customer_type || 'RETAIL';
                  return (
                    <tr key={cust.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                        {cust.name}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400">
                        {cust.phone}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                          type === 'WHOLESALE' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-slate-200">
                        ₹{creditLimit.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-slate-500">
                        {creditDays} Days
                      </td>
                      <td className="px-4 py-3 text-right font-black text-amber-600 dark:text-amber-400">
                        ₹{balanceDue.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          onClick={() => openCreditTerms(cust)}
                          className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                        >
                          Credit Terms
                        </button>
                        <button
                          onClick={() => openPartyLedger(cust)}
                          className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition"
                        >
                          Party Ledger
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Distribution Routes & Zones */}
      {activeTab === 'routes' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">
              Sales Distribution Routes
            </h2>
            <span className="text-xs text-slate-400">{routes.length} routes registered</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Route Name</th>
                  <th className="px-4 py-3">Assigned Salesperson</th>
                  <th className="px-4 py-3">Area / Delivery Zone</th>
                  <th className="px-4 py-3 text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {routes.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                      No distribution routes set up. Click "Add Distribution Route" to organize sales delivery zones.
                    </td>
                  </tr>
                ) : (
                  routes.map((rt) => (
                    <tr key={rt.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-indigo-500" />
                        <span>{rt.routeName}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium">
                        {rt.salespersonName || 'Unassigned'}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {rt.areaZone || 'Metro Wide'}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-400 font-mono text-[10px]">
                        {new Date(rt.createdAt).toLocaleDateString('en-IN')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Bulk Slab Modal */}
      {showAddSlabModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scaleIn">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white">
                Create Tiered Bulk Pricing Slab
              </h3>
              <button onClick={() => setShowAddSlabModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSlab} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Product
                </label>
                <select
                  value={slabForm.productId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    const p = products.find(x => x.id === pid);
                    setSlabForm({
                      ...slabForm,
                      productId: pid,
                      slabPrice: p ? (p.sale_price_paise || 0) / 100 * 0.9 : slabForm.slabPrice,
                    });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  required
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Std: ₹{((p.sale_price_paise || 0) / 100).toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Min Quantity (Pcs)
                  </label>
                  <input
                    type="number"
                    min="2"
                    value={slabForm.minQuantity}
                    onChange={(e) => setSlabForm({ ...slabForm, minQuantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Max Quantity (Optional)
                  </label>
                  <input
                    type="number"
                    value={slabForm.maxQuantity || ''}
                    onChange={(e) => setSlabForm({ ...slabForm, maxQuantity: e.target.value ? Number(e.target.value) : null as any })}
                    placeholder="Leave empty for unlimited"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Wholesale Unit Rate (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={slabForm.slabPrice}
                  onChange={(e) => setSlabForm({ ...slabForm, slabPrice: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold text-sm"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddSlabModal(false)}
                  className="px-4 py-2 font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition"
                >
                  Save Slab
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Distribution Route Modal */}
      {showAddRouteModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scaleIn">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white">
                Add Sales Distribution Route
              </h3>
              <button onClick={() => setShowAddRouteModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRoute} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Route Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Route 2 - South District Market"
                  value={routeForm.routeName}
                  onChange={(e) => setRouteForm({ ...routeForm, routeName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Salesperson In-Charge
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ramesh Kulkarni"
                  value={routeForm.salespersonName}
                  onChange={(e) => setRouteForm({ ...routeForm, salespersonName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Territory / Area Zone
                </label>
                <input
                  type="text"
                  placeholder="e.g. Bandra to Colaba Southern Corridors"
                  value={routeForm.areaZone}
                  onChange={(e) => setRouteForm({ ...routeForm, areaZone: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddRouteModal(false)}
                  className="px-4 py-2 font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition"
                >
                  Register Route
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Credit Terms Modal */}
      {showCreditModal && selectedParty && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scaleIn">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white">
                Dealer Credit Terms: {selectedParty.name}
              </h3>
              <button onClick={() => setShowCreditModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateCredit} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Customer Type
                </label>
                <select
                  value={creditForm.customerType}
                  onChange={(e) => setCreditForm({ ...creditForm, customerType: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                >
                  <option value="WHOLESALE">Wholesale Dealer / Party</option>
                  <option value="DISTRIBUTOR">Master Distributor</option>
                  <option value="RETAIL">Standard Retail</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Maximum Credit Limit (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  value={creditForm.creditLimit}
                  onChange={(e) => setCreditForm({ ...creditForm, creditLimit: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold text-sm"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Credit Terms (Days)
                </label>
                <input
                  type="number"
                  min="0"
                  value={creditForm.creditDays}
                  onChange={(e) => setCreditForm({ ...creditForm, creditDays: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreditModal(false)}
                  className="px-4 py-2 font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition"
                >
                  Save Credit Terms
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Party Ledger Statement Modal */}
      {showLedgerModal && partyLedger && selectedParty && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full p-6 animate-scaleIn flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  Party Ledger: {partyLedger.customer.name}
                </h3>
                <p className="text-xs text-slate-400">
                  Credit Limit: ₹{partyLedger.customer.creditLimit.toLocaleString('en-IN')} · Dues: ₹{partyLedger.customer.outstandingBalance.toLocaleString('en-IN')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowLedgerEntryModal(true)}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow-sm flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Record Transaction</span>
                </button>
                <button onClick={() => setShowLedgerModal(false)} className="text-slate-400 hover:text-slate-600 font-bold text-lg">
                  ✕
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 mt-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 font-semibold uppercase text-[10px] sticky top-0 border-b border-slate-100 dark:border-slate-800">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Type / Ref</th>
                    <th className="px-3 py-2 text-right">Debit (+)</th>
                    <th className="px-3 py-2 text-right">Credit (-)</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
                  {partyLedger.entries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-400 font-sans">
                        No previous ledger entries found. Record invoice or payment receipts to begin ledger.
                      </td>
                    </tr>
                  ) : (
                    partyLedger.entries.map((e: any) => (
                      <tr key={e.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2 text-slate-500">
                          {new Date(e.createdAt).toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-3 py-2 font-sans font-medium text-slate-800 dark:text-slate-200">
                          {e.entryType} {e.referenceNo ? `(${e.referenceNo})` : ''}
                        </td>
                        <td className="px-3 py-2 text-right text-rose-600 font-bold">
                          {e.debit > 0 ? `₹${e.debit.toFixed(2)}` : '-'}
                        </td>
                        <td className="px-3 py-2 text-right text-emerald-600 font-bold">
                          {e.credit > 0 ? `₹${e.credit.toFixed(2)}` : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-black text-slate-900 dark:text-white">
                          ₹{e.runningBalance.toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Record Ledger Transaction Modal */}
      {showLedgerEntryModal && selectedParty && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scaleIn">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white">
                Record Transaction: {selectedParty.name}
              </h3>
              <button onClick={() => setShowLedgerEntryModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleAddLedgerEntry} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Transaction Type
                </label>
                <select
                  value={ledgerEntryForm.entryType}
                  onChange={(e) => setLedgerEntryForm({ ...ledgerEntryForm, entryType: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                >
                  <option value="PAYMENT_CREDIT">Payment Received (Credit -)</option>
                  <option value="INVOICE_DEBIT">Invoice Billing (Debit +)</option>
                  <option value="RETURN_CREDIT">Goods Return (Credit -)</option>
                  <option value="ADJUSTMENT">Balance Adjustment</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Amount (₹)
                </label>
                <input
                  type="number"
                  min="1"
                  value={ledgerEntryForm.amount}
                  onChange={(e) => setLedgerEntryForm({ ...ledgerEntryForm, amount: Number(e.target.value) })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold text-sm"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Reference No / Cheque No
                </label>
                <input
                  type="text"
                  placeholder="e.g. CHQ-991204 / NEFT-8821"
                  value={ledgerEntryForm.referenceNo}
                  onChange={(e) => setLedgerEntryForm({ ...ledgerEntryForm, referenceNo: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  placeholder="e.g. Clearance verified"
                  value={ledgerEntryForm.notes}
                  onChange={(e) => setLedgerEntryForm({ ...ledgerEntryForm, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowLedgerEntryModal(false)}
                  className="px-4 py-2 font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition"
                >
                  Record Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
