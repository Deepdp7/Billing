import React, { useState, useEffect } from 'react';
import {
  Factory, Layers, Play, CheckCircle2, AlertTriangle,
  Plus, Search, RefreshCw, Printer, Trash2, Eye,
  ChevronRight, Box, ArrowRight, ShieldCheck, Clock, X
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { BomRecipe, ProductionOrder, ProductionOrderStatus } from '../../types/index.js';

export function ManufacturingPage() {
  const [activeTab, setActiveTab] = useState<'boms' | 'orders' | 'inventory'>('boms');
  const [boms, setBoms] = useState<BomRecipe[]>([]);
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({
    active_boms: 0,
    total_orders: 0,
    planned_orders: 0,
    in_progress_orders: 0,
    completed_orders: 0,
    total_units_produced: 0,
    total_production_cost_paise: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals
  const [isCreateBomOpen, setIsCreateBomOpen] = useState(false);
  const [isCreateOrderOpen, setIsCreateOrderOpen] = useState(false);
  const [selectedBom, setSelectedBom] = useState<BomRecipe | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<ProductionOrder | null>(null);
  const [orderComponents, setOrderComponents] = useState<any[]>([]);
  const [isExecuteRunOpen, setIsExecuteRunOpen] = useState(false);
  const [isPrintSlipOpen, setIsPrintSlipOpen] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // New BOM Form State
  const [bomForm, setBomForm] = useState({
    finished_product_id: '',
    output_quantity: 1,
    output_unit: 'Pcs',
    estimated_labor_cost_rupees: 0,
    estimated_overhead_cost_rupees: 0,
    notes: '',
    items: [{ raw_material_id: '', quantity_required: 1, unit: 'Kg', wastage_percent: 0 }],
  });

  // New Work Order Form State
  const [orderForm, setOrderForm] = useState({
    bom_id: '',
    target_quantity: 1,
    batch_number: '',
    notes: '',
  });

  // Execute Run Form State
  const [executeForm, setExecuteForm] = useState({
    completed_quantity: 1,
    labor_cost_rupees: 0,
    overhead_cost_rupees: 0,
  });

  useEffect(() => {
    loadData();
  }, [activeTab, statusFilter]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [bomsRes, ordersRes, statsRes, prodsRes] = await Promise.all([
        api.getBoms({ search: searchQuery || undefined }),
        api.getProductionOrders({ status: statusFilter || undefined, search: searchQuery || undefined }),
        api.getManufacturingStats(),
        api.getProducts(),
      ]);

      setBoms(bomsRes.boms || []);
      setOrders(ordersRes.orders || []);
      setStats(statsRes);
      setProducts(prodsRes.data || []);
    } catch (err: any) {
      console.error('Failed to load manufacturing data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadData();
  };

  // --------------------------------------------------------------------------
  // BOM Form Handlers
  // --------------------------------------------------------------------------
  const addBomItemRow = () => {
    setBomForm((prev) => ({
      ...prev,
      items: [...prev.items, { raw_material_id: '', quantity_required: 1, unit: 'Pcs', wastage_percent: 0 }],
    }));
  };

  const removeBomItemRow = (index: number) => {
    setBomForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const updateBomItemRow = (index: number, field: string, value: any) => {
    setBomForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
  };

  const handleCreateBom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bomForm.finished_product_id) {
      alert('Please select a finished product.');
      return;
    }

    if (bomForm.items.some((i) => !i.raw_material_id || i.quantity_required <= 0)) {
      alert('Please select valid raw materials and required quantities.');
      return;
    }

    setIsActionLoading(true);
    try {
      await api.createBom({
        finished_product_id: bomForm.finished_product_id,
        output_quantity: Number(bomForm.output_quantity) || 1,
        output_unit: bomForm.output_unit,
        estimated_labor_cost_paise: Math.round(Number(bomForm.estimated_labor_cost_rupees || 0) * 100),
        estimated_overhead_cost_paise: Math.round(Number(bomForm.estimated_overhead_cost_rupees || 0) * 100),
        notes: bomForm.notes || undefined,
        items: bomForm.items.map((i) => ({
          raw_material_id: i.raw_material_id,
          quantity_required: Number(i.quantity_required),
          unit: i.unit,
          wastage_percent: Number(i.wastage_percent) || 0,
        })),
      });

      alert('BOM Recipe created successfully!');
      setIsCreateBomOpen(false);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create BOM');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDeleteBom = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this BOM recipe?')) return;
    try {
      await api.deleteBom(id);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete BOM');
    }
  };

  // --------------------------------------------------------------------------
  // Production Orders Handlers
  // --------------------------------------------------------------------------
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderForm.bom_id || Number(orderForm.target_quantity) <= 0) {
      alert('Please choose a BOM recipe and enter a valid target quantity.');
      return;
    }

    setIsActionLoading(true);
    try {
      await api.createProductionOrder({
        bom_id: orderForm.bom_id,
        target_quantity: Number(orderForm.target_quantity),
        batch_number: orderForm.batch_number || undefined,
        notes: orderForm.notes || undefined,
      });

      alert('Production work order created!');
      setIsCreateOrderOpen(false);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to create production order');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleViewOrder = async (order: ProductionOrder) => {
    setSelectedOrder(order);
    try {
      const res = await api.getProductionOrderById(order.id);
      setOrderComponents(res.components || []);
      setExecuteForm({
        completed_quantity: order.target_quantity,
        labor_cost_rupees: (order.total_labor_cost_paise || 0) / 100,
        overhead_cost_rupees: (order.total_overhead_cost_paise || 0) / 100,
      });
    } catch (err: any) {
      console.error('Failed to get order details:', err);
    }
  };

  const handleStartOrder = async (orderId: string) => {
    try {
      await api.startProductionOrder(orderId);
      loadData();
      if (selectedOrder) {
        setSelectedOrder({ ...selectedOrder, status: 'IN_PROGRESS' });
      }
    } catch (err: any) {
      alert(err.message || 'Failed to start order');
    }
  };

  const handleExecuteProductionRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;

    setIsActionLoading(true);
    try {
      const res = await api.executeProductionRun(selectedOrder.id, {
        completed_quantity: Number(executeForm.completed_quantity),
        labor_cost_paise: Math.round(Number(executeForm.labor_cost_rupees || 0) * 100),
        overhead_cost_paise: Math.round(Number(executeForm.overhead_cost_rupees || 0) * 100),
      });

      alert(res.message);
      setIsExecuteRunOpen(false);
      setSelectedOrder(null);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to execute production run');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!window.confirm('Are you sure you want to cancel this work order?')) return;
    try {
      await api.cancelProductionOrder(orderId);
      loadData();
      if (selectedOrder) setSelectedOrder(null);
    } catch (err: any) {
      alert(err.message || 'Failed to cancel order');
    }
  };

  const getStatusBadge = (status: ProductionOrderStatus) => {
    switch (status) {
      case 'PLANNED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">Planned</span>;
      case 'IN_PROGRESS':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300">In Production</span>;
      case 'COMPLETED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">Completed & Stocked</span>;
      case 'CANCELLED':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300">Cancelled</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-800">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
            <Factory className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            <span>Manufacturing & Bill of Materials (BOM) — PRD §5</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Raw materials recipe assembly, production work orders, and atomic conversion to finished goods inventory
          </p>
        </div>

        <div className="flex items-center gap-2">
          {activeTab === 'boms' && (
            <button
              onClick={() => setIsCreateBomOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-600/20 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New BOM Recipe</span>
            </button>
          )}

          {activeTab === 'orders' && (
            <button
              onClick={() => setIsCreateOrderOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-600/20 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Work Order</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">BOM Formulations</span>
            <Layers className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100">{stats.active_boms}</div>
          <div className="text-[11px] text-slate-500 mt-1">Active product recipes</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">In Production</span>
            <Clock className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-blue-600 dark:text-blue-400">{stats.in_progress_orders}</div>
          <div className="text-[11px] text-slate-500 mt-1">Assembly line runs</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Units Produced</span>
            <Box className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{stats.total_units_produced}</div>
          <div className="text-[11px] text-slate-500 mt-1">Finished goods stocked</div>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Production Output Value</span>
            <ShieldCheck className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-slate-100">
            ₹{(stats.total_production_cost_paise / 100).toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Total manufacturing cost</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('boms')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeTab === 'boms'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Bill of Materials (BOM Recipes)</span>
        </button>

        <button
          onClick={() => setActiveTab('orders')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeTab === 'orders'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Factory className="w-4 h-4" />
          <span>Production Work Orders</span>
        </button>

        <button
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeTab === 'inventory'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Box className="w-4 h-4" />
          <span>Raw Materials Inventory</span>
        </button>
      </div>

      {/* TAB 1: BOM RECIPES */}
      {activeTab === 'boms' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {boms.map((bom) => (
              <div
                key={bom.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col justify-between hover:border-amber-400 transition"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs font-extrabold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded">
                      {bom.bom_code}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-400">
                      Yield: {bom.output_quantity} {bom.output_unit}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 line-clamp-2">
                    {bom.finished_product_name}
                  </h3>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                    SKU: {bom.finished_product_sku} · Stock: {bom.finished_product_stock || 0}
                  </div>

                  {/* Components snippet */}
                  <div className="my-3 p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl space-y-1.5 text-xs">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Formula Components ({bom.items?.length || 0})
                    </div>
                    {bom.items?.map((item) => (
                      <div key={item.id} className="flex justify-between text-slate-600 dark:text-slate-300">
                        <span className="truncate pr-2">{item.raw_material_name}</span>
                        <span className="font-mono shrink-0 font-bold">
                          {item.quantity_required} {item.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Est. Unit Cost:</span>
                    <span className="font-extrabold text-slate-900 dark:text-slate-100">
                      ₹{((bom.estimated_cost_per_unit_paise || 0) / 100).toFixed(2)}
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setOrderForm({
                          bom_id: bom.id,
                          target_quantity: bom.output_quantity * 5,
                          batch_number: '',
                          notes: '',
                        });
                        setIsCreateOrderOpen(true);
                      }}
                      className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Start Work Order</span>
                    </button>
                    <button
                      onClick={() => handleDeleteBom(bom.id)}
                      className="p-2 text-slate-400 hover:text-rose-600 transition rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {boms.length === 0 && !isLoading && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center">
              <Layers className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-700 dark:text-slate-300 text-sm">No BOM recipes defined yet</h4>
              <p className="text-xs text-slate-400 mt-1">Create your first Bill of Materials formula to begin manufacturing</p>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PRODUCTION WORK ORDERS */}
      {activeTab === 'orders' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Order # & Batch</th>
                  <th className="py-3 px-4">Finished Good</th>
                  <th className="py-3 px-4">BOM Formulation</th>
                  <th className="py-3 px-4 text-center">Target Qty</th>
                  <th className="py-3 px-4 text-center">Completed</th>
                  <th className="py-3 px-4">Total Cost</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {orders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-mono font-bold text-amber-600 dark:text-amber-400">{ord.order_number}</div>
                      <div className="text-[10px] text-slate-400">{ord.batch_number}</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-800 dark:text-slate-200">{ord.finished_product_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{ord.finished_product_sku}</div>
                    </td>

                    <td className="py-3 px-4 font-mono font-semibold text-slate-600 dark:text-slate-400">
                      {ord.bom_code}
                    </td>

                    <td className="py-3 px-4 text-center font-bold">{ord.target_quantity}</td>
                    <td className="py-3 px-4 text-center font-bold text-emerald-600">{ord.completed_quantity}</td>

                    <td className="py-3 px-4 font-extrabold text-slate-900 dark:text-slate-100">
                      {ord.total_cost_paise > 0 ? `₹${(ord.total_cost_paise / 100).toFixed(2)}` : '—'}
                    </td>

                    <td className="py-3 px-4">{getStatusBadge(ord.status)}</td>

                    <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        onClick={() => handleViewOrder(ord)}
                        className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold transition"
                      >
                        Inspect
                      </button>

                      {ord.status === 'PLANNED' && (
                        <button
                          onClick={() => handleStartOrder(ord.id)}
                          className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition"
                        >
                          Start Run
                        </button>
                      )}

                      {ord.status === 'IN_PROGRESS' && (
                        <button
                          onClick={() => {
                            handleViewOrder(ord);
                            setIsExecuteRunOpen(true);
                          }}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow-xs"
                        >
                          ⚡ Execute Run
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: RAW MATERIALS INVENTORY */}
      {activeTab === 'inventory' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm">Component Stocks & Raw Materials</h3>
            <span className="text-xs text-slate-400">Deducted automatically during production runs</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Material / Trim Name</th>
                  <th className="py-3 px-4">SKU Code</th>
                  <th className="py-3 px-4">Current Stock</th>
                  <th className="py-3 px-4">Unit Purchase Cost</th>
                  <th className="py-3 px-4">Inventory Valuation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {products
                  .filter((p) => p.name.includes('Roll') || p.name.includes('Thread') || p.name.includes('Button') || p.name.includes('Box') || p.sku?.startsWith('RM-'))
                  .map((p) => (
                    <tr key={p.id}>
                      <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-200">{p.name}</td>
                      <td className="py-3 px-4 font-mono text-slate-500">{p.sku}</td>
                      <td className="py-3 px-4 font-bold text-emerald-600">
                        {p.stock_quantity} {p.unit}
                      </td>
                      <td className="py-3 px-4">₹{(p.purchase_price_paise / 100).toFixed(2)}</td>
                      <td className="py-3 px-4 font-extrabold text-slate-900 dark:text-slate-100">
                        ₹{((p.stock_quantity * p.purchase_price_paise) / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Create BOM Recipe */}
      {isCreateBomOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-600" />
                <span>Define New Bill of Materials (BOM)</span>
              </h3>
              <button
                onClick={() => setIsCreateBomOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBom} className="space-y-4 mt-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Finished Good *</label>
                  <select
                    required
                    value={bomForm.finished_product_id}
                    onChange={(e) => setBomForm({ ...bomForm, finished_product_id: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  >
                    <option value="">Select Finished Product</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Standard Yield *</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={bomForm.output_quantity}
                      onChange={(e) => setBomForm({ ...bomForm, output_quantity: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Unit</label>
                    <input
                      type="text"
                      value={bomForm.output_unit}
                      onChange={(e) => setBomForm({ ...bomForm, output_unit: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                    />
                  </div>
                </div>
              </div>

              {/* Component Items */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold uppercase tracking-wider text-slate-500 text-[10px]">
                    Raw Material Ingredients
                  </span>
                  <button
                    type="button"
                    onClick={addBomItemRow}
                    className="text-xs font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Component</span>
                  </button>
                </div>

                {bomForm.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <select
                        required
                        value={item.raw_material_id}
                        onChange={(e) => updateBomItemRow(idx, 'raw_material_id', e.target.value)}
                        className="w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                      >
                        <option value="">Choose Raw Material</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="col-span-3">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Qty required"
                        value={item.quantity_required}
                        onChange={(e) => updateBomItemRow(idx, 'quantity_required', Number(e.target.value))}
                        className="w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold"
                      />
                    </div>

                    <div className="col-span-2">
                      <input
                        type="text"
                        placeholder="Unit"
                        value={item.unit}
                        onChange={(e) => updateBomItemRow(idx, 'unit', e.target.value)}
                        className="w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs"
                      />
                    </div>

                    <div className="col-span-2 flex items-center gap-1">
                      <input
                        type="number"
                        placeholder="Wastage %"
                        value={item.wastage_percent}
                        onChange={(e) => updateBomItemRow(idx, 'wastage_percent', Number(e.target.value))}
                        className="w-12 px-1 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-center"
                        title="Scrap/Wastage %"
                      />
                      {bomForm.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeBomItemRow(idx)}
                          className="p-1 text-slate-400 hover:text-rose-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Labor & Overhead Cost */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Est. Labor Cost per Batch (₹)
                  </label>
                  <input
                    type="number"
                    value={bomForm.estimated_labor_cost_rupees}
                    onChange={(e) => setBomForm({ ...bomForm, estimated_labor_cost_rupees: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Est. Overhead Cost per Batch (₹)
                  </label>
                  <input
                    type="number"
                    value={bomForm.estimated_overhead_cost_rupees}
                    onChange={(e) => setBomForm({ ...bomForm, estimated_overhead_cost_rupees: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateBomOpen(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isActionLoading}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold shadow-md shadow-amber-600/20 transition disabled:opacity-50"
                >
                  {isActionLoading ? 'Saving...' : 'Save BOM Recipe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Work Order */}
      {isCreateOrderOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
                <Factory className="w-5 h-5 text-amber-600" />
                <span>Issue Production Work Order</span>
              </h3>
              <button
                onClick={() => setIsCreateOrderOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-3.5 mt-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Select BOM Recipe *</label>
                <select
                  required
                  value={orderForm.bom_id}
                  onChange={(e) => setOrderForm({ ...orderForm, bom_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                >
                  <option value="">Select Recipe</option>
                  {boms.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bom_code} — {b.finished_product_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Target Output Quantity *</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={orderForm.target_quantity}
                  onChange={(e) => setOrderForm({ ...orderForm, target_quantity: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Production Batch Code</label>
                <input
                  type="text"
                  placeholder="Leave empty for auto-generated BATCH-XXX"
                  value={orderForm.batch_number}
                  onChange={(e) => setOrderForm({ ...orderForm, batch_number: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Notes</label>
                <input
                  type="text"
                  placeholder="Special instructions for floor supervisor"
                  value={orderForm.notes}
                  onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateOrderOpen(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isActionLoading}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold shadow-md shadow-amber-600/20 transition disabled:opacity-50"
                >
                  {isActionLoading ? 'Issuing...' : 'Create Work Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Order Inspection & Atomic Execution */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base flex items-center gap-2">
                  <span>Work Order: {selectedOrder.order_number}</span>
                  {getStatusBadge(selectedOrder.status)}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Batch: {selectedOrder.batch_number}</p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="my-4 space-y-4 text-xs">
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200/80 dark:border-amber-900/60 flex justify-between items-center">
                <div>
                  <div className="font-bold text-amber-900 dark:text-amber-200">
                    Product: {selectedOrder.finished_product_name}
                  </div>
                  <div className="text-[11px] text-amber-700 dark:text-amber-400">
                    Target: {selectedOrder.target_quantity} units
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-amber-800 dark:text-amber-300">
                    Formula: {selectedOrder.bom_code}
                  </div>
                </div>
              </div>

              {/* Component Availability Checklist */}
              <div>
                <h4 className="font-bold uppercase tracking-wider text-slate-400 text-[10px] mb-2">
                  Raw Material Stock Requirements
                </h4>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] uppercase font-bold text-slate-500">
                      <tr>
                        <th className="p-2">Component</th>
                        <th className="p-2 text-right">Required</th>
                        <th className="p-2 text-right">In Stock</th>
                        <th className="p-2 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {orderComponents.map((comp) => (
                        <tr key={comp.id}>
                          <td className="p-2 font-semibold text-slate-800 dark:text-slate-200">{comp.raw_material_name}</td>
                          <td className="p-2 text-right font-bold">
                            {comp.required_quantity} {comp.unit}
                          </td>
                          <td className="p-2 text-right">
                            {comp.current_stock} {comp.unit}
                          </td>
                          <td className="p-2 text-center">
                            {comp.has_enough_stock ? (
                              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                                Ready
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">
                                Short {comp.shortage_quantity}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Execution Form (if in progress) */}
              {isExecuteRunOpen && (
                <form onSubmit={handleExecuteProductionRun} className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-300 space-y-3">
                  <h4 className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Complete Production & Restock Goods</span>
                  </h4>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Completed Yield
                      </label>
                      <input
                        type="number"
                        required
                        value={executeForm.completed_quantity}
                        onChange={(e) => setExecuteForm({ ...executeForm, completed_quantity: Number(e.target.value) })}
                        className="w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 rounded-lg text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Labor Cost (₹)
                      </label>
                      <input
                        type="number"
                        value={executeForm.labor_cost_rupees}
                        onChange={(e) => setExecuteForm({ ...executeForm, labor_cost_rupees: Number(e.target.value) })}
                        className="w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 rounded-lg text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Overhead Cost (₹)
                      </label>
                      <input
                        type="number"
                        value={executeForm.overhead_cost_rupees}
                        onChange={(e) => setExecuteForm({ ...executeForm, overhead_cost_rupees: Number(e.target.value) })}
                        className="w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 rounded-lg text-xs font-bold"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsExecuteRunOpen(false)}
                      className="px-3 py-1 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isActionLoading}
                      className="px-4 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow-xs"
                    >
                      {isActionLoading ? 'Converting...' : '⚡ Confirm Production Conversion'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-100 dark:border-slate-800">
              {selectedOrder.status !== 'COMPLETED' && selectedOrder.status !== 'CANCELLED' && (
                <button
                  onClick={() => handleCancelOrder(selectedOrder.id)}
                  className="text-xs text-rose-600 hover:underline"
                >
                  Cancel Order
                </button>
              )}

              <div className="flex gap-2 ml-auto">
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-semibold transition"
                >
                  Close
                </button>

                {selectedOrder.status === 'IN_PROGRESS' && !isExecuteRunOpen && (
                  <button
                    onClick={() => setIsExecuteRunOpen(true)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-md shadow-emerald-600/20 transition flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Complete & Restock</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

