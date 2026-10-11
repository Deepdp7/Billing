import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { StockTransfer, StockTransferItem } from '../../types/index.js';
import { formatDate } from '../../lib/utils.js';
import { 
  Building2, Plus, MapPin, Phone, UserCheck, 
  CheckCircle2, Trash2, AlertCircle, ArrowLeftRight, 
  Truck, Package, Search, Printer, X, RefreshCw, 
  Clock, CheckCircle, Ban, FileText, ArrowRight
} from 'lucide-react';

export const BranchesPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'branches' | 'transfers'>('branches');
  
  // Branches State
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [branchManager, setBranchManager] = useState('');

  // Transfers State
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [transferSearch, setTransferSearch] = useState('');
  const [transferStatusFilter, setTransferStatusFilter] = useState('');
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [selectedChallan, setSelectedChallan] = useState<{ transfer: any; items: any[]; business: any } | null>(null);

  // New Transfer Form State
  const [sourceBranchId, setSourceBranchId] = useState('');
  const [destBranchId, setDestBranchId] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [availableProducts, setAvailableProducts] = useState<any[]>([]);
  const [transferItems, setTransferItems] = useState<Array<{
    productId: string;
    productName: string;
    sku: string;
    availableStock: number;
    quantity: number;
    unit: string;
  }>>([]);

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadAll();
  }, [transferStatusFilter, transferSearch]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [branchRes, transRes, prodRes] = await Promise.all([
        api.getBranches(),
        api.getTransfers({
          status: transferStatusFilter || undefined,
          search: transferSearch || undefined,
        }),
        api.getProducts({ limit: 100 }),
      ]);
      setBranches(branchRes.branches || []);
      setTransfers(transRes.data || []);
      setAvailableProducts(prodRes.data || []);

      if (branchRes.branches?.length >= 2) {
        setSourceBranchId(branchRes.branches[0].id);
        setDestBranchId(branchRes.branches[1].id);
      } else if (branchRes.branches?.length === 1) {
        setSourceBranchId(branchRes.branches[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load branches and transfers', err);
    } finally {
      setLoading(false);
    }
  };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 4000);
  };

  // Branch creation
  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName || !branchCode) return;
    try {
      setSubmitting(true);
      await api.createBranch({
        name: branchName,
        code: branchCode,
        address: branchAddress,
        phone: branchPhone,
        manager_name: branchManager,
      });
      showNotification('success', 'New store outlet created successfully!');
      setIsBranchModalOpen(false);
      setBranchName('');
      setBranchCode('');
      setBranchAddress('');
      setBranchPhone('');
      setBranchManager('');
      loadAll();
    } catch (err: any) {
      showNotification('error', err.message || 'Failed to create branch');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteBranch = async (id: string) => {
    if (!confirm('Are you sure you want to remove this branch?')) return;
    try {
      await api.deleteBranch(id);
      showNotification('success', 'Branch removed successfully');
      loadAll();
    } catch (err: any) {
      showNotification('error', err.message || 'Cannot delete primary branch');
    }
  };

  // Transfer creation
  const handleAddItemToTransfer = (prodId: string) => {
    const prod = availableProducts.find(p => p.id === prodId);
    if (!prod) return;
    if (transferItems.some(i => i.productId === prodId)) {
      alert('Product already added to transfer list');
      return;
    }

    setTransferItems(prev => [
      ...prev,
      {
        productId: prod.id,
        productName: prod.name,
        sku: prod.sku,
        availableStock: prod.stock_quantity,
        quantity: Math.min(1, prod.stock_quantity),
        unit: prod.unit || 'Pcs',
      }
    ]);
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceBranchId || !destBranchId) {
      alert('Please select both source and destination branches');
      return;
    }
    if (sourceBranchId === destBranchId) {
      alert('Source branch and destination branch cannot be the same');
      return;
    }
    if (!transferItems.length) {
      alert('Please add at least one product to transfer');
      return;
    }

    const source = branches.find(b => b.id === sourceBranchId);
    const dest = branches.find(b => b.id === destBranchId);

    try {
      setSubmitting(true);
      const res = await api.createTransfer({
        sourceBranchId,
        sourceBranchName: source?.name || 'Source Outlet',
        destBranchId,
        destBranchName: dest?.name || 'Destination Outlet',
        items: transferItems.map(it => ({
          productId: it.productId,
          productName: it.productName,
          sku: it.sku,
          quantity: it.quantity,
          unit: it.unit,
        })),
        trackingNumber,
        notes: transferNotes,
      });

      showNotification('success', res.message || 'Stock transfer challan created and items dispatched!');
      setIsTransferModalOpen(false);
      setTransferItems([]);
      setTrackingNumber('');
      setTransferNotes('');
      loadAll();
    } catch (err: any) {
      alert(err.message || 'Failed to dispatch stock transfer');
    } finally {
      setSubmitting(false);
    }
  };

  // Receive Transfer
  const handleReceiveTransfer = async (id: string, num: string) => {
    if (!confirm(`Confirm receipt of all goods for Transfer Challan ${num}?`)) return;
    try {
      const res = await api.receiveTransfer(id);
      showNotification('success', res.message || 'Transfer completed and received!');
      if (selectedChallan) setSelectedChallan(null);
      loadAll();
    } catch (err: any) {
      alert(err.message || 'Failed to receive transfer');
    }
  };

  // Cancel Transfer
  const handleCancelTransfer = async (id: string, num: string) => {
    if (!confirm(`Cancel Transfer Challan ${num} and restore goods back to warehouse stock?`)) return;
    try {
      const res = await api.cancelTransfer(id);
      showNotification('success', res.message || 'Transfer cancelled and stock restored');
      if (selectedChallan) setSelectedChallan(null);
      loadAll();
    } catch (err: any) {
      alert(err.message || 'Failed to cancel transfer');
    }
  };

  // View Challan Modal
  const handleViewChallan = async (id: string) => {
    try {
      const res = await api.getTransferById(id);
      setSelectedChallan(res.data);
    } catch (err: any) {
      alert('Failed to load transfer challan details');
    }
  };

  // Aggregated Stats
  const activeInTransit = transfers.filter(t => t.status === 'IN_TRANSIT').length;
  const completedCount = transfers.filter(t => t.status === 'COMPLETED').length;
  const totalUnitsDispatched = transfers.reduce((sum, t) => sum + (t.total_quantity || 0), 0);

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 rounded-xl text-indigo-600 dark:text-indigo-400">
              <Building2 className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
              Multi-Store & Stock Transfer Hub
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manage branches, satellite outlets, and inter-branch delivery challans with atomic stock dispatch (PRD §4.4 & §4.19)
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsTransferModalOpen(true)}
            className="flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-md shadow-emerald-600/20 transition active:scale-95"
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>+ Dispatch Stock Transfer</span>
          </button>

          <button
            onClick={() => setIsBranchModalOpen(true)}
            className="flex items-center gap-2 text-xs font-bold px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-md shadow-indigo-600/20 transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add Store Branch</span>
          </button>
        </div>
      </div>

      {notification && (
        <div className={`p-4 rounded-xl flex items-center gap-2.5 text-xs font-semibold ${
          notification.type === 'success' 
            ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300' 
            : 'bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300'
        }`}>
          {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
            <span>Store Outlets</span>
            <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-white">
            {branches.length} Outlets
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Main hub & satellite stores
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
            <span>In-Transit Transfers</span>
            <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-amber-600 dark:text-amber-400">
            {activeInTransit} Active
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Goods currently on delivery route
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
            <span>Dispatched Quantity</span>
            <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
            {totalUnitsDispatched} Units
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Transferred across outlets
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium mb-1">
            <span>Completed Challans</span>
            <div className="p-1.5 rounded-lg bg-teal-50 dark:bg-teal-950/50 text-teal-600">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-white font-mono">
            {completedCount} Received
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Fully settled delivery gate passes
          </div>
        </div>
      </div>

      {/* Tabs & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl">
          <button
            onClick={() => setActiveTab('branches')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'branches'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Store Outlets</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-mono">
              {branches.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('transfers')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'transfers'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm font-extrabold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>Stock Transfers & Challans</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 font-mono">
              {transfers.length}
            </span>
          </button>
        </div>

        {activeTab === 'transfers' && (
          <div className="flex items-center gap-2 px-2">
            <select
              value={transferStatusFilter}
              onChange={(e) => setTransferStatusFilter(e.target.value)}
              className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none"
            >
              <option value="">All Statuses</option>
              <option value="IN_TRANSIT">In-Transit Only</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>

            <div className="relative min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search challan, branch or tracking..."
                value={transferSearch}
                onChange={(e) => setTransferSearch(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <button
              onClick={loadAll}
              title="Refresh"
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400 flex flex-col items-center gap-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading branch records & transfers...</span>
        </div>
      ) : activeTab === 'branches' ? (
        /* ================= TAB 1: BRANCH OUTLETS GRID ================= */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {branches.map((b) => (
            <div
              key={b.id}
              className={`rounded-2xl p-5 border transition shadow-sm relative flex flex-col justify-between ${
                b.is_main
                  ? 'border-indigo-300 dark:border-indigo-800 bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-950/30 dark:bg-slate-900'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-2.5 rounded-xl ${b.is_main ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm text-slate-900 dark:text-white font-['Outfit']">
                        {b.name}
                      </h3>
                      <span className="font-mono text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                        {b.code}
                      </span>
                    </div>
                  </div>

                  {b.is_main === 1 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                      Primary Main
                    </span>
                  )}
                </div>

                <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300 pt-1">
                  {b.address && (
                    <div className="flex items-center gap-2 text-slate-500">
                      <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{b.address}</span>
                    </div>
                  )}
                  {b.phone && (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Phone className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      <span>{b.phone}</span>
                    </div>
                  )}
                  {b.manager_name && (
                    <div className="flex items-center gap-2 text-slate-500">
                      <UserCheck className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                      <span>Manager: <strong className="text-slate-700 dark:text-slate-200">{b.manager_name}</strong></span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <span className="text-[10px] text-slate-400">
                  Added: {formatDate(b.created_at)}
                </span>
                {!b.is_main && (
                  <button
                    onClick={() => handleDeleteBranch(b.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-950 hover:text-rose-600 transition"
                    title="Remove Outlet"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ================= TAB 2: STOCK TRANSFERS TABLE ================= */
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          {transfers.length === 0 ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
              <Truck className="w-12 h-12 text-emerald-500" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">No Stock Transfers Recorded</p>
              <p className="text-xs text-slate-500 max-w-sm">
                Dispatch goods between your central store and branch outlets with live stock deduction.
              </p>
              <button
                onClick={() => setIsTransferModalOpen(true)}
                className="mt-2 text-xs font-bold px-4 py-2 rounded-xl bg-emerald-600 text-white"
              >
                + Create First Stock Transfer
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-4">Challan #</th>
                    <th className="py-3 px-4">Route (Source → Destination)</th>
                    <th className="py-3 px-4 text-center">Items / Qty</th>
                    <th className="py-3 px-4">Tracking / Vehicle</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {transfers.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                      <td className="py-3.5 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {t.transfer_number}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
                          <span>{t.source_branch_name}</span>
                          <ArrowRight className="w-3 h-3 text-slate-400" />
                          <span className="text-emerald-600 dark:text-emerald-400">{t.dest_branch_name}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono">
                        <span className="font-bold text-slate-900 dark:text-white">{t.total_quantity}</span>
                        <span className="text-[10px] text-slate-400 ml-1">({t.total_items_count} SKUs)</span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 font-mono text-[11px]">
                        {t.tracking_number || 'Internal Staff Van'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        {formatDate(t.transfer_date)}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          t.status === 'IN_TRANSIT'
                            ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900 animate-pulse'
                            : t.status === 'COMPLETED'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900'
                            : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900'
                        }`}>
                          {t.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleViewChallan(t.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 transition font-semibold text-[11px]"
                            title="View Gate Pass Challan"
                          >
                            <FileText className="w-3 h-3" />
                            <span>Challan</span>
                          </button>

                          {t.status === 'IN_TRANSIT' && (
                            <>
                              <button
                                onClick={() => handleReceiveTransfer(t.id, t.transfer_number)}
                                className="px-2.5 py-1.5 rounded-lg text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 hover:bg-emerald-100 transition font-bold text-[11px]"
                                title="Mark Goods as Received"
                              >
                                Receive
                              </button>
                              <button
                                onClick={() => handleCancelTransfer(t.id, t.transfer_number)}
                                className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950 transition"
                                title="Cancel Dispatch & Restore Stock"
                              >
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
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
      {/* MODAL 1: NEW BRANCH OUTLET */}
      {/* ========================================================================= */}
      {isBranchModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white font-['Outfit']">
                Add New Store Branch
              </h3>
              <button onClick={() => setIsBranchModalOpen(false)} className="p-1 text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBranch} className="space-y-3.5 text-xs">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Branch Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Phoenix Mall Outlet, Warehouse Depot"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Branch Code *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. PHX-02, WH-CENTRAL"
                  value={branchCode}
                  onChange={(e) => setBranchCode(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono uppercase"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Full Address</label>
                <input
                  type="text"
                  placeholder="Street, City, Pin"
                  value={branchAddress}
                  onChange={(e) => setBranchAddress(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Phone</label>
                  <input
                    type="text"
                    value={branchPhone}
                    onChange={(e) => setBranchPhone(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Manager Name</label>
                  <input
                    type="text"
                    value={branchManager}
                    onChange={(e) => setBranchManager(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsBranchModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-indigo-600 text-white"
                >
                  Save Branch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: DISPATCH NEW STOCK TRANSFER */}
      {/* ========================================================================= */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 rounded-xl">
                  <ArrowLeftRight className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900 dark:text-white font-['Outfit']">
                    Dispatch Stock Transfer Challan
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Transfers items between branches with atomic inventory deduction & challan numbering
                  </p>
                </div>
              </div>
              <button onClick={() => setIsTransferModalOpen(false)} className="p-1.5 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTransfer} className="space-y-4 text-xs">
              {/* Branch Route */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Source Branch (Deducts Stock) *
                  </label>
                  <select
                    value={sourceBranchId}
                    onChange={(e) => setSourceBranchId(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                  >
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Destination Branch (Receives Stock) *
                  </label>
                  <select
                    value={destBranchId}
                    onChange={(e) => setDestBranchId(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                  >
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Add Product Dropdown */}
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Add Item from Catalog
                </label>
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      handleAddItemToTransfer(e.target.value);
                      e.target.value = '';
                    }
                  }}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                >
                  <option value="">-- Choose Product to Transfer --</option>
                  {availableProducts.map(p => (
                    <option key={p.id} value={p.id} disabled={p.stock_quantity <= 0}>
                      {p.name} (Available: {p.stock_quantity} {p.unit || 'Pcs'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Transfer Items List */}
              {transferItems.length > 0 && (
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-700 dark:text-slate-300 block">
                    Dispatched Items List ({transferItems.length})
                  </label>
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                    {transferItems.map((item, idx) => (
                      <div key={idx} className="p-2.5 bg-white dark:bg-slate-900 flex items-center justify-between gap-3 text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-900 dark:text-white truncate">{item.productName}</div>
                          <div className="text-[10px] text-slate-400">
                            Available Stock: <strong className="text-emerald-500 font-mono">{item.availableStock}</strong> {item.unit}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-slate-400">Dispatch Qty:</label>
                          <input
                            type="number"
                            min="1"
                            max={item.availableStock}
                            value={item.quantity}
                            onChange={(e) => {
                              const val = Math.min(item.availableStock, Math.max(1, Number(e.target.value) || 1));
                              const updated = [...transferItems];
                              updated[idx].quantity = val;
                              setTransferItems(updated);
                            }}
                            className="w-16 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-center font-bold text-emerald-600 dark:text-emerald-400"
                          />
                          <button
                            type="button"
                            onClick={() => setTransferItems(prev => prev.filter((_, i) => i !== idx))}
                            className="p-1 text-slate-400 hover:text-rose-500"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Transport & Notes */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Transport / Vehicle / Tracking No.
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Van MH-12-AB-1234, Driver Rajesh"
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">Dispatch Notes</label>
                  <input
                    type="text"
                    placeholder="e.g. Urgent stock replenishment"
                    value={transferNotes}
                    onChange={(e) => setTransferNotes(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !transferItems.length}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white shadow-md disabled:opacity-50"
                >
                  Issue Challan & Dispatch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: VIEW & PRINT DELIVERY CHALLAN GATE PASS */}
      {/* ========================================================================= */}
      {selectedChallan && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                  Stock Transfer Delivery Challan
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl text-xs font-bold flex items-center gap-1.5 hover:opacity-90 transition"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Challan</span>
                </button>
                <button 
                  onClick={() => setSelectedChallan(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Gate Pass Body */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700/80 text-xs space-y-4 font-sans">
              <div className="flex justify-between items-start border-b border-slate-200 dark:border-slate-700 pb-3">
                <div>
                  <div className="text-base font-extrabold text-slate-900 dark:text-white font-['Outfit']">
                    {selectedChallan.business?.name || 'Apna Billing Store'}
                  </div>
                  {selectedChallan.business?.gstin && (
                    <div className="text-[11px] text-slate-500 font-mono">
                      GSTIN: {selectedChallan.business.gstin}
                    </div>
                  )}
                  <div className="text-[11px] text-slate-400">
                    Official Inter-Branch Movement Delivery Voucher
                  </div>
                </div>

                <div className="text-right">
                  <div className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 inline-block">
                    {selectedChallan.transfer?.status}
                  </div>
                  <div className="font-mono font-bold text-sm text-slate-900 dark:text-white mt-1">
                    {selectedChallan.transfer?.transfer_number}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Date: {formatDate(selectedChallan.transfer?.transfer_date)}
                  </div>
                </div>
              </div>

              {/* Route */}
              <div className="grid grid-cols-2 gap-4 text-[11px] pb-2 border-b border-slate-200 dark:border-slate-700">
                <div>
                  <div className="text-slate-400 font-medium">Consignor (Source Outlet):</div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {selectedChallan.transfer?.source_branch_name}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-slate-400 font-medium">Consignee (Destination Outlet):</div>
                  <div className="font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {selectedChallan.transfer?.dest_branch_name}
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] font-bold text-slate-400 border-b border-slate-200 dark:border-slate-700 uppercase">
                      <th className="py-1.5">Item Description</th>
                      <th className="py-1.5">SKU</th>
                      <th className="py-1.5 text-center">Dispatched Qty</th>
                      <th className="py-1.5 text-center">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {selectedChallan.items?.map((it: any, i: number) => (
                      <tr key={i}>
                        <td className="py-2 text-slate-800 dark:text-slate-200 font-medium">{it.product_name}</td>
                        <td className="py-2 text-slate-400 font-mono text-[11px]">{it.sku || '-'}</td>
                        <td className="py-2 text-center font-bold text-slate-900 dark:text-white font-mono">{it.dispatched_quantity}</td>
                        <td className="py-2 text-center text-slate-500">{it.unit || 'Pcs'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Transport & Notes */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center text-[11px]">
                <div className="text-slate-500">
                  Vehicle / Tracking: <strong>{selectedChallan.transfer?.tracking_number || 'Internal Staff'}</strong>
                </div>
                <div className="text-right font-bold text-slate-900 dark:text-white">
                  Total Items: {selectedChallan.transfer?.total_quantity} Units
                </div>
              </div>

              {/* Signatures */}
              <div className="pt-4 grid grid-cols-2 gap-8 text-[10px] text-slate-400 border-t border-dashed border-slate-200 dark:border-slate-700">
                <div className="border-t border-slate-300 dark:border-slate-600 pt-1 text-center">
                  Dispatched By (Sign / Stamp)
                </div>
                <div className="border-t border-slate-300 dark:border-slate-600 pt-1 text-center">
                  Received & Verified By (Sign / Stamp)
                </div>
              </div>
            </div>

            {/* Quick Actions in Modal */}
            {selectedChallan.transfer?.status === 'IN_TRANSIT' && (
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => handleCancelTransfer(selectedChallan.transfer.id, selectedChallan.transfer.transfer_number)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-xl text-rose-600 border border-rose-200 dark:border-rose-900 hover:bg-rose-50"
                >
                  Cancel Challan
                </button>
                <button
                  onClick={() => handleReceiveTransfer(selectedChallan.transfer.id, selectedChallan.transfer.transfer_number)}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white shadow-md hover:bg-emerald-500"
                >
                  Confirm Goods Received
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
