import React, { useState, useEffect } from 'react';
import {
  Globe, ShoppingBag, Clock, CheckCircle2, Truck, XCircle,
  ExternalLink, Copy, Check, Settings, Search, Printer,
  ArrowRight, AlertCircle, FileText, ChevronRight, X
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { OnlineOrder, OnlineOrderStatus, OnlineStoreConfig } from '../../types/index.js';

export function OnlineOrdersPage() {
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [storeConfig, setStoreConfig] = useState<OnlineStoreConfig | null>(null);
  const [stats, setStats] = useState<any>({
    total_orders: 0,
    pending_orders: 0,
    accepted_orders: 0,
    completed_orders: 0,
    total_revenue_paise: 0,
  });
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);

  // Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OnlineOrder | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isSlipModalOpen, setIsSlipModalOpen] = useState(false);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Settings form state
  const [formData, setFormData] = useState({
    slug: '',
    store_name: '',
    tagline: '',
    banner_message: '',
    is_active: 1,
    min_order_amount_paise: 0,
    delivery_fee_paise: 4000,
    accept_cod: 1,
    accept_online: 1,
    contact_phone: '',
    contact_whatsapp: '',
  });

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [configRes, ordersRes] = await Promise.all([
        api.getStoreConfig(),
        api.getStoreOrders({ status: statusFilter || undefined, search: searchQuery || undefined }),
      ]);

      if (configRes.store) {
        setStoreConfig(configRes.store);
        setFormData({
          slug: configRes.store.slug || '',
          store_name: configRes.store.store_name || '',
          tagline: configRes.store.tagline || '',
          banner_message: configRes.store.banner_message || '',
          is_active: configRes.store.is_active ? 1 : 0,
          min_order_amount_paise: configRes.store.min_order_amount_paise || 0,
          delivery_fee_paise: configRes.store.delivery_fee_paise || 0,
          accept_cod: configRes.store.accept_cod ? 1 : 0,
          accept_online: configRes.store.accept_online ? 1 : 0,
          contact_phone: configRes.store.contact_phone || '',
          contact_whatsapp: configRes.store.contact_whatsapp || '',
        });
      }
      if (configRes.stats) {
        setStats(configRes.stats);
      }
      setOrders(ordersRes.orders || []);
    } catch (err: any) {
      console.error('Failed to load store data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadData();
  };

  const handleCopyLink = () => {
    const origin = window.location.origin;
    const url = `${origin}/?store=${storeConfig?.slug || ''}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsActionLoading(true);
    try {
      const res = await api.updateStoreConfig(formData);
      setStoreConfig(res.store);
      setIsSettingsOpen(false);
      alert('Storefront settings updated successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to update store settings');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleViewOrder = async (order: OnlineOrder) => {
    setSelectedOrder(order);
    try {
      const res = await api.getStoreOrderById(order.id);
      setOrderItems(res.items || []);
      setIsDetailModalOpen(true);
    } catch (err: any) {
      alert(err.message || 'Failed to fetch order details');
    }
  };

  const handleUpdateStatus = async (orderId: string, newStatus: string) => {
    try {
      await api.updateOrderStatus(orderId, newStatus);
      loadData();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder((prev) => (prev ? { ...prev, status: newStatus as OnlineOrderStatus } : null));
      }
    } catch (err: any) {
      alert(err.message || 'Failed to update status');
    }
  };

  const handleConvertToInvoice = async (order: OnlineOrder) => {
    if (!window.confirm(`Convert order ${order.order_number} to a completed POS Invoice and automatically deduct product stock?`)) {
      return;
    }

    setIsActionLoading(true);
    try {
      const res = await api.convertOrderToInvoice(order.id);
      alert(`Success! POS Invoice ${res.invoiceNumber} generated and stock deducted.`);
      loadData();
      if (isDetailModalOpen) {
        setIsDetailModalOpen(false);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to convert order to invoice');
    } finally {
      setIsActionLoading(false);
    }
  };

  const getStatusBadge = (status: OnlineOrderStatus) => {
    switch (status) {
      case 'PENDING':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">Pending Review</span>;
      case 'ACCEPTED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300">Accepted</span>;
      case 'PREPARING':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">Packing</span>;
      case 'OUT_FOR_DELIVERY':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300">Out for Delivery</span>;
      case 'COMPLETED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">Completed & Billed</span>;
      case 'CANCELLED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">Cancelled</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800">{status}</span>;
    }
  };

  const publicStoreUrl = `${window.location.origin}/?store=${storeConfig?.slug || ''}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <Globe className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            <span>Online Storefront & Orders (PRD §4.20)</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Customer public web catalog, online order intake, and 1-click POS invoice conversion
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/80 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-2xs transition"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Store Settings</span>
          </button>

          <a
            href={publicStoreUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open Public Store</span>
          </a>
        </div>
      </div>

      {/* Live Storefront Public Link Banner */}
      <div className="p-4 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-transparent border border-emerald-500/30 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>Your Customer Web Store is Live</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            </div>
            <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 mt-0.5 truncate max-w-lg">
              {publicStoreUrl}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            onClick={handleCopyLink}
            className="flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700/50 hover:bg-emerald-50 rounded-lg text-xs font-semibold text-emerald-800 dark:text-emerald-300 transition"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Copied Link!' : 'Copy Store Link'}</span>
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Total Orders</span>
            <ShoppingBag className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100">{stats.total_orders}</div>
          <div className="text-[11px] text-slate-500 mt-1">E-Commerce Intake</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Pending Review</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400">{stats.pending_orders}</div>
          <div className="text-[11px] text-slate-500 mt-1">Needs merchant review</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Completed & Billed</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{stats.completed_orders}</div>
          <div className="text-[11px] text-slate-500 mt-1">Converted to POS Invoices</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Online Revenue</span>
            <Truck className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100">
            ₹{(stats.total_revenue_paise / 100).toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Completed web sales</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto scrollbar-none">
          {[
            { id: '', label: 'All Orders' },
            { id: 'PENDING', label: 'Pending' },
            { id: 'ACCEPTED', label: 'Accepted' },
            { id: 'PREPARING', label: 'Packing' },
            { id: 'OUT_FOR_DELIVERY', label: 'In Transit' },
            { id: 'COMPLETED', label: 'Completed' },
            { id: 'CANCELLED', label: 'Cancelled' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-emerald-600 text-white font-bold shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearch} className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by order #, customer, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </form>
      </div>

      {/* Orders Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Order # & Date</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Delivery Address</th>
                <th className="py-3 px-4">Items</th>
                <th className="py-3 px-4">Total Amount</th>
                <th className="py-3 px-4">Payment</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    Loading online orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <ShoppingBag className="w-10 h-10 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    <p className="font-semibold text-slate-600 dark:text-slate-300">No online orders found</p>
                    <p className="text-xs text-slate-400 mt-0.5">Share your storefront link to receive customer orders!</p>
                  </td>
                </tr>
              ) : (
                orders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {ord.order_number}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(ord.created_at).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-800 dark:text-slate-200">{ord.customer_name}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{ord.customer_phone}</div>
                    </td>

                    <td className="py-3 px-4 max-w-xs truncate text-slate-600 dark:text-slate-400">
                      {ord.delivery_address}
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {ord.item_count || 1} items
                      </span>
                    </td>

                    <td className="py-3 px-4 font-extrabold text-slate-900 dark:text-slate-100">
                      ₹{(ord.total_paise / 100).toFixed(2)}
                    </td>

                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {ord.payment_mode} ({ord.payment_status})
                      </span>
                    </td>

                    <td className="py-3 px-4">{getStatusBadge(ord.status)}</td>

                    <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                      <button
                        onClick={() => handleViewOrder(ord)}
                        className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold transition"
                      >
                        View
                      </button>

                      {ord.status !== 'COMPLETED' && ord.status !== 'CANCELLED' && (
                        <button
                          onClick={() => handleConvertToInvoice(ord)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow-xs"
                          title="Convert to POS Invoice & deduct inventory"
                        >
                          ⚡ Invoice & Bill
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Storefront Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Storefront Settings</h3>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-3.5 mt-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Public URL Slug *</label>
                <div className="flex items-center">
                  <span className="px-2.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-l-xl border border-r-0 border-slate-200 dark:border-slate-700 font-mono text-[11px]">
                    /?store=
                  </span>
                  <input
                    type="text"
                    required
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                    className="flex-1 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-r-xl font-mono text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Display Store Name *</label>
                <input
                  type="text"
                  required
                  value={formData.store_name}
                  onChange={(e) => setFormData({ ...formData, store_name: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Tagline / Subheading</label>
                <input
                  type="text"
                  value={formData.tagline}
                  onChange={(e) => setFormData({ ...formData, tagline: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Top Announcement Banner</label>
                <input
                  type="text"
                  value={formData.banner_message}
                  onChange={(e) => setFormData({ ...formData, banner_message: e.target.value })}
                  placeholder="e.g. 🎉 Free express delivery on orders above ₹499"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Delivery Fee (₹)</label>
                  <input
                    type="number"
                    value={formData.delivery_fee_paise / 100}
                    onChange={(e) => setFormData({ ...formData, delivery_fee_paise: Math.round(Number(e.target.value) * 100) })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-1 focus:ring-emerald-500 focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Min Order Amount (₹)</label>
                  <input
                    type="number"
                    value={formData.min_order_amount_paise / 100}
                    onChange={(e) => setFormData({ ...formData, min_order_amount_paise: Math.round(Number(e.target.value) * 100) })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-1 focus:ring-emerald-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Customer Phone</label>
                  <input
                    type="text"
                    value={formData.contact_phone}
                    onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">WhatsApp Number</label>
                  <input
                    type="text"
                    value={formData.contact_whatsapp}
                    onChange={(e) => setFormData({ ...formData, contact_whatsapp: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isActionLoading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md shadow-emerald-600/20 transition disabled:opacity-50"
                >
                  {isActionLoading ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Order Detail & Action Modal */}
      {isDetailModalOpen && selectedOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
                  <span>Order: {selectedOrder.order_number}</span>
                  {getStatusBadge(selectedOrder.status)}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Placed on {new Date(selectedOrder.created_at).toLocaleString('en-IN')}
                </p>
              </div>
              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="my-4 space-y-4 text-xs">
              {/* Customer Box */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-1">
                <div className="font-bold text-slate-800 dark:text-slate-200 flex justify-between">
                  <span>{selectedOrder.customer_name}</span>
                  <span className="font-mono text-emerald-600">{selectedOrder.customer_phone}</span>
                </div>
                <div className="text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Address: </span>
                  {selectedOrder.delivery_address}
                </div>
                {selectedOrder.notes && (
                  <div className="text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-1.5 rounded text-[11px] mt-1">
                    Note: {selectedOrder.notes}
                  </div>
                )}
              </div>

              {/* Order Items Table */}
              <div>
                <h4 className="font-bold uppercase tracking-wider text-slate-400 text-[10px] mb-2">Order Items</h4>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] uppercase font-bold text-slate-500">
                      <tr>
                        <th className="p-2">Item Name</th>
                        <th className="p-2 text-center">Qty</th>
                        <th className="p-2 text-right">Unit Price</th>
                        <th className="p-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {orderItems.map((itm) => (
                        <tr key={itm.id}>
                          <td className="p-2 font-semibold text-slate-800 dark:text-slate-200">{itm.product_name}</td>
                          <td className="p-2 text-center font-bold">{itm.quantity}</td>
                          <td className="p-2 text-right">₹{(itm.unit_price_paise / 100).toFixed(2)}</td>
                          <td className="p-2 text-right font-bold">₹{(itm.total_paise / 100).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-between items-center pt-3 text-sm font-extrabold text-slate-900 dark:text-slate-100">
                  <span>Total Payable:</span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    ₹{(selectedOrder.total_paise / 100).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Status Update Dropdown */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Update Order State:</span>
                <select
                  value={selectedOrder.status}
                  onChange={(e) => handleUpdateStatus(selectedOrder.id, e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-xs focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="PENDING">PENDING</option>
                  <option value="ACCEPTED">ACCEPTED</option>
                  <option value="PREPARING">PREPARING (Packing)</option>
                  <option value="OUT_FOR_DELIVERY">OUT_FOR_DELIVERY</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition"
              >
                Close
              </button>

              {selectedOrder.status !== 'COMPLETED' && selectedOrder.status !== 'CANCELLED' && (
                <button
                  onClick={() => handleConvertToInvoice(selectedOrder)}
                  disabled={isActionLoading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md shadow-emerald-600/20 transition flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Convert to POS Invoice</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

