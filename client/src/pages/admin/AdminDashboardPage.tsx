import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { Plan } from '../../types/index.js';
import { formatINR, formatDate, formatDateTime, paiseToRupees, rupeesToPaise } from '../../lib/utils.js';
import { 
  Shield, Building2, Users, CreditCard, Activity, 
  Search, ToggleLeft, ToggleRight, CheckCircle2, AlertOctagon, 
  Edit3, Save, X, RefreshCw 
} from 'lucide-react';

export const AdminDashboardPage: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'businesses' | 'plans' | 'logs'>('businesses');
  const [search, setSearch] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  
  // Plan Edit Modal
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [planPrice, setPlanPrice] = useState('');
  const [planUsers, setPlanUsers] = useState(2);
  const [planInvoices, setPlanInvoices] = useState(100);

  useEffect(() => {
    loadAdminData();
  }, [search]);

  const loadAdminData = async () => {
    try {
      const [dashRes, bizRes, planRes, logRes] = await Promise.all([
        api.getAdminDashboard(),
        api.listAdminBusinesses({ search: search || undefined }),
        api.listAdminPlans(),
        api.getAdminAuditLogs(),
      ]);
      setStats(dashRes);
      setBusinesses(bizRes.data);
      setPlans(planRes.data);
      setLogs(logRes.data);
    } catch (err) {
      console.error('Failed to load admin data', err);
    }
  };

  const handleToggleStatus = async (id: string, currentStatus: string, bizName: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    if (!window.confirm(`Change status of "${bizName}" to ${newStatus}?`)) return;

    try {
      await api.updateBusinessStatus(id, newStatus);
      setStatusMsg(`Business "${bizName}" status updated to ${newStatus}.`);
      setTimeout(() => setStatusMsg(''), 4000);
      loadAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to update status');
    }
  };

  const openPlanEdit = (p: Plan) => {
    setEditingPlan(p);
    setPlanPrice(String(paiseToRupees(p.price_paise)));
    setPlanUsers(p.max_users);
    setPlanInvoices(p.max_invoices_per_month);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlan) return;

    try {
      await api.updateAdminPlan(editingPlan.id, {
        pricePaise: rupeesToPaise(planPrice),
        maxUsers: planUsers,
        maxInvoicesPerMonth: planInvoices,
      });
      setEditingPlan(null);
      setStatusMsg(`Subscription plan "${editingPlan.name}" updated successfully.`);
      setTimeout(() => setStatusMsg(''), 4000);
      loadAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to update plan');
    }
  };

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Super Admin Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/30">
              <Shield className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit']">
              Platform Admin Control Center
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Global multi-tenant governance, subscription pricing, business status, and audit telemetry
          </p>
        </div>

        <button
          onClick={loadAdminData}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition shadow-sm self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Telemetry</span>
        </button>
      </div>

      {statusMsg && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs rounded-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Admin KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Registered Tenants</span>
            <Building2 className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {stats?.stats?.totalBusinesses || 0}
          </div>
          <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
            {stats?.stats?.activeBusinesses || 0} Active on platform
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Total User Accounts</span>
            <Users className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {stats?.stats?.totalUsers || 0}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Owners, managers, cashiers
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Platform Gross GMV</span>
            <CreditCard className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {formatINR(stats?.stats?.platformTotalSalesPaise || 0)}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Cumulative sales across all stores
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Invoices Emitted</span>
            <Activity className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {stats?.stats?.platformTotalInvoices || 0}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Atomic transactions executed
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('businesses')}
          className={`pb-2.5 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'businesses'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Businesses Directory ({businesses.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('plans')}
          className={`pb-2.5 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'plans'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>SaaS Subscription Plans ({plans.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`pb-2.5 text-xs font-bold transition flex items-center gap-2 border-b-2 ${
            activeTab === 'logs'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Security Audit Trail</span>
        </button>
      </div>

      {/* 1. Businesses Directory */}
      {activeTab === 'businesses' && (
        <div className="space-y-4">
          <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center">
            <div className="flex-1 max-w-md relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search tenant businesses by name, email or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold">
                  <th className="p-3.5">Business Name</th>
                  <th className="p-3.5">Category</th>
                  <th className="p-3.5">Owner Account</th>
                  <th className="p-3.5">Assigned Plan</th>
                  <th className="p-3.5 text-center">Status</th>
                  <th className="p-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {businesses.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <td className="p-3.5">
                      <div className="font-bold text-slate-900 dark:text-white">{b.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">ID: {b.id} · {b.city || 'India'}</div>
                    </td>
                    <td className="p-3.5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {b.category}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="text-slate-800 dark:text-slate-200 font-medium">{b.owner_name || 'Owner'}</div>
                      <div className="text-[10px] text-slate-400">{b.owner_email || b.email}</div>
                    </td>
                    <td className="p-3.5 font-semibold text-slate-700 dark:text-slate-300">
                      {b.plan_name || 'Standard'}
                    </td>
                    <td className="p-3.5 text-center">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          b.status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                        }`}
                      >
                        {b.status}
                      </span>
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => handleToggleStatus(b.id, b.status, b.name)}
                        className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition ${
                          b.status === 'ACTIVE'
                            ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950'
                            : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950'
                        }`}
                      >
                        {b.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. SaaS Subscription Plans */}
      {activeTab === 'plans' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((p) => (
            <div
              key={p.id}
              className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-500">
                    {p.tier} Tier
                  </span>
                  <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
                    {p.billing_period}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{p.name}</h3>
                
                <div className="text-2xl font-black text-slate-900 dark:text-white my-3">
                  {formatINR(p.price_paise)}
                  <span className="text-xs font-medium text-slate-400"> / month</span>
                </div>

                <div className="space-y-2 py-3 border-t border-slate-100 dark:border-slate-800 text-xs">
                  <div className="flex justify-between text-slate-600 dark:text-slate-300">
                    <span>Max Staff Users:</span>
                    <span className="font-bold">{p.max_users}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 dark:text-slate-300">
                    <span>Monthly Invoices Cap:</span>
                    <span className="font-bold">{p.max_invoices_per_month}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 dark:text-slate-300">
                    <span>Branch Outlets:</span>
                    <span className="font-bold">{p.max_branches}</span>
                  </div>
                </div>

                <div className="pt-2 space-y-1">
                  <span className="text-[11px] font-bold text-slate-400 block mb-1">Included Features:</span>
                  {p.features?.map((f, i) => (
                    <div key={i} className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => openPlanEdit(p)}
                className="w-full py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Configure Pricing & Limits</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 3. Security Audit Trail */}
      {activeTab === 'logs' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-4">
          <div className="space-y-3">
            {logs.length > 0 ? (
              logs.map((l) => (
                <div key={l.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">{l.action}</div>
                    <div className="text-[11px] text-slate-400">{l.entity_type} · {l.business_name || 'System Platform'}</div>
                  </div>
                  <span className="text-[10px] text-slate-400">{formatDateTime(l.created_at)}</span>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-xs text-slate-400">
                System initialized in tamper-evident WAL mode. Event logging active.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Plan Edit Modal */}
      {editingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Edit {editingPlan.name}
              </h3>
              <button onClick={() => setEditingPlan(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePlan} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Monthly Price (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={planPrice}
                  onChange={(e) => setPlanPrice(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Max Staff Accounts</label>
                <input
                  type="number"
                  required
                  value={planUsers}
                  onChange={(e) => setPlanUsers(parseInt(e.target.value) || 1)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Max Monthly Invoices</label>
                <input
                  type="number"
                  required
                  value={planInvoices}
                  onChange={(e) => setPlanInvoices(parseInt(e.target.value) || 100)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingPlan(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md transition"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
