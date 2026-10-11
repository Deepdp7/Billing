import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { LoyaltyRule, LoyaltyTransaction, Customer } from '../../types/index.js';
import { useLanguage } from '../../context/LanguageContext.js';
import { 
  Award, Gift, TrendingUp, Users, ArrowUpRight, ArrowDownLeft, 
  Settings, Search, RefreshCw, CheckCircle2, AlertCircle, Plus,
  ShieldAlert, Sparkles, Filter, ChevronRight
} from 'lucide-react';

export const LoyaltyRewardsPage: React.FC = () => {
  const { t } = useLanguage();
  const [rule, setRule] = useState<LoyaltyRule | null>(null);
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  
  // Rule Edit State
  const [isEditingRule, setIsEditingRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    pointsPerSpendUnit: 1,
    spendUnitAmount: 100,
    redemptionValuePerPoint: 0.25,
    minPointsToRedeem: 50,
    isActive: true,
  });

  // Adjust Modal State
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [adjustData, setAdjustData] = useState({
    points: 10,
    type: 'EARNED' as 'EARNED' | 'REDEEMED' | 'ADJUSTED',
    notes: 'Bonus appreciation points',
  });
  const [adjusting, setAdjusting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [ruleRes, txRes, custRes] = await Promise.all([
        api.getLoyaltyRule(),
        api.getLoyaltyTransactions(50),
        api.getCustomers(),
      ]);

      if (ruleRes.rule) {
        setRule(ruleRes.rule);
        setRuleForm({
          pointsPerSpendUnit: ruleRes.rule.pointsPerSpendUnit,
          spendUnitAmount: ruleRes.rule.spendUnitAmount,
          redemptionValuePerPoint: ruleRes.rule.redemptionValuePerPoint,
          minPointsToRedeem: ruleRes.rule.minPointsToRedeem,
          isActive: Boolean(ruleRes.rule.isActive),
        });
      }

      setTransactions(txRes.transactions || []);
      setCustomers((custRes as any).data || (custRes as any).customers || []);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to load loyalty details' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.updateLoyaltyRule(ruleForm);
      setRule(res.rule);
      setIsEditingRule(false);
      setNotification({ type: 'success', message: 'Loyalty rules updated successfully!' });
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to save rules' });
    }
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    setAdjusting(true);
    try {
      await api.adjustLoyaltyPoints({
        customerId: selectedCustomer.id,
        points: Number(adjustData.points),
        type: adjustData.type,
        notes: adjustData.notes,
      });

      setNotification({
        type: 'success',
        message: `Updated points for ${selectedCustomer.name} successfully!`,
      });
      setAdjustModalOpen(false);
      fetchData();
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Points adjustment failed' });
    } finally {
      setAdjusting(false);
    }
  };

  // Filtered lists
  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.phone || '').includes(searchQuery)
  );

  const filteredTransactions = transactions.filter((tx) => {
    if (typeFilter !== 'ALL' && tx.type !== typeFilter) return false;
    return true;
  });

  const totalPointsCirculating = customers.reduce((acc, c) => acc + (c.loyaltyPoints || 0), 0);
  const totalPointsRedeemed = transactions
    .filter((tx) => tx.type === 'REDEEMED')
    .reduce((acc, tx) => acc + Math.abs(tx.points), 0);

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
          <button
            onClick={() => setNotification(null)}
            className="text-xs uppercase font-bold tracking-wider opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-400 flex items-center justify-center text-white shadow-lg shadow-amber-500/30">
            <Award className="w-6 h-6 fill-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {t('loyaltyProgram', 'Customer Loyalty & Points Ledger')}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              PRD §4.13 Rewards Engine · Point Accrual, POS Redemption & Balance Ledger
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

          <button
            onClick={() => setIsEditingRule(!isEditingRule)}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-500/20 transition"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Configure Rule</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Points in Circulation</span>
            <Sparkles className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {totalPointsCirculating.toLocaleString('en-IN')} <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Pts</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Cash Liability: ₹{(totalPointsCirculating * (rule?.redemptionValuePerPoint || 0.25)).toFixed(2)}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Points Redeemed</span>
            <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
            {totalPointsRedeemed.toLocaleString('en-IN')} <span className="text-xs font-semibold">Pts</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Discount Saved by Shoppers
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Earn Formula</span>
            <TrendingUp className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-white">
            {rule?.pointsPerSpendUnit || 1} Pt / ₹{rule?.spendUnitAmount || 100}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Auto-awarded during POS Billing
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Redeem Rate</span>
            <Gift className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-white">
            1 Pt = ₹{rule?.redemptionValuePerPoint || 0.25}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Min {rule?.minPointsToRedeem || 50} pts to unlock discount
          </p>
        </div>
      </div>

      {/* Rule Edit Form Panel */}
      {isEditingRule && (
        <div className="p-5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 shadow-sm animate-fadeIn">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <h2 className="font-bold text-sm text-slate-900 dark:text-white">
                Loyalty Earning & Redemption Policy Settings
              </h2>
            </div>
            <button
              onClick={() => setIsEditingRule(false)}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              Cancel
            </button>
          </div>

          <form onSubmit={handleSaveRule} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Points Awarded
              </label>
              <input
                type="number"
                min="1"
                value={ruleForm.pointsPerSpendUnit}
                onChange={(e) => setRuleForm({ ...ruleForm, pointsPerSpendUnit: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                For Every Spend (₹)
              </label>
              <input
                type="number"
                min="1"
                value={ruleForm.spendUnitAmount}
                onChange={(e) => setRuleForm({ ...ruleForm, spendUnitAmount: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Rupee Value per Point (₹)
              </label>
              <input
                type="number"
                step="0.05"
                min="0.05"
                value={ruleForm.redemptionValuePerPoint}
                onChange={(e) => setRuleForm({ ...ruleForm, redemptionValuePerPoint: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Min. Points to Redeem
              </label>
              <input
                type="number"
                min="1"
                value={ruleForm.minPointsToRedeem}
                onChange={(e) => setRuleForm({ ...ruleForm, minPointsToRedeem: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
                required
              />
            </div>

            <div className="col-span-1 sm:col-span-2 lg:col-span-4 flex items-center justify-between pt-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ruleForm.isActive}
                  onChange={(e) => setRuleForm({ ...ruleForm, isActive: e.target.checked })}
                  className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400"
                />
                <span>Enable Loyalty Points engine automatically during checkout</span>
              </label>

              <button
                type="submit"
                className="px-4 py-2 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-md transition"
              >
                Save Settings
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Grid: Customer Loyalty Directory & Transaction Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Customer Points Directory (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-600" />
                <span>Customer Loyalty Balances</span>
              </h2>
              <p className="text-[11px] text-slate-400">Total {customers.length} registered customers</p>
            </div>

            {/* Search */}
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder={t('search', 'Search customer / phone...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3 text-right">Points</th>
                  <th className="px-4 py-3 text-right">Cash Value</th>
                  <th className="px-4 py-3 text-center">Tier</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      No customers found matching search.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((cust) => {
                    const pts = cust.loyaltyPoints || 0;
                    const value = pts * (rule?.redemptionValuePerPoint || 0.25);
                    const tier = pts >= 500 ? 'GOLD' : pts >= 150 ? 'SILVER' : 'BRONZE';
                    return (
                      <tr key={cust.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                        <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-100">
                          {cust.name}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500 dark:text-slate-400">
                          {cust.phone}
                        </td>
                        <td className="px-4 py-3 text-right font-black text-amber-600 dark:text-amber-400">
                          {pts.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-300">
                          ₹{value.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${
                              tier === 'GOLD'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border border-amber-300'
                                : tier === 'SILVER'
                                ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                                : 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300'
                            }`}
                          >
                            {tier}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => {
                              setSelectedCustomer(cust);
                              setAdjustModalOpen(true);
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-amber-500 hover:text-white dark:hover:bg-amber-500 transition"
                          >
                            {t('adjustPoints', 'Adjust')}
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

        {/* Loyalty Activity Ledger (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <span>Loyalty Activity Ledger</span>
              </h2>
              <p className="text-[11px] text-slate-400">Real-time audit trail of all point movements</p>
            </div>

            {/* Filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
            >
              <option value="ALL">All Types</option>
              <option value="EARNED">Earned (+)</option>
              <option value="REDEEMED">Redeemed (-)</option>
              <option value="ADJUSTED">Adjusted</option>
            </select>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/60 overflow-y-auto max-h-[500px]">
            {filteredTransactions.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No recent loyalty transactions logged.
              </div>
            ) : (
              filteredTransactions.map((tx) => {
                const isEarned = tx.type === 'EARNED';
                const isRedeemed = tx.type === 'REDEEMED';
                return (
                  <div key={tx.id} className="p-3.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                          isEarned
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                            : isRedeemed
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                            : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400'
                        }`}
                      >
                        {isEarned ? (
                          <ArrowUpRight className="w-4 h-4" />
                        ) : isRedeemed ? (
                          <ArrowDownLeft className="w-4 h-4" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </div>

                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          <span>{tx.customerName || 'Customer'}</span>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                              isEarned
                                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40'
                                : isRedeemed
                                ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40'
                                : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40'
                            }`}
                          >
                            {tx.type}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {tx.notes || (isEarned ? 'Awarded from sales invoice' : 'Redeemed during checkout')}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {new Date(tx.createdAt || tx.created_at || Date.now()).toLocaleString('en-IN', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div
                        className={`font-black text-sm ${
                          isEarned
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : isRedeemed
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-indigo-600 dark:text-indigo-400'
                        }`}
                      >
                        {isEarned ? '+' : isRedeemed ? '-' : ''}
                        {Math.abs(tx.points)} Pts
                      </div>
                      <div className="text-[10px] text-slate-400 font-medium">
                        Balance: {tx.balanceAfter}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Manual Adjustment Modal */}
      {adjustModalOpen && selectedCustomer && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scaleIn">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-slate-900 dark:text-white">
                  Adjust Customer Loyalty Points
                </h3>
              </div>
              <button
                onClick={() => setAdjustModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-4 mt-4">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs">
                <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedCustomer.name}</div>
                <div className="text-slate-500 font-mono">{selectedCustomer.phone}</div>
                <div className="mt-1 font-bold text-amber-600 dark:text-amber-400">
                  Current Points: {selectedCustomer.loyaltyPoints || 0} Pts
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Adjustment Action
                </label>
                <select
                  value={adjustData.type}
                  onChange={(e: any) => setAdjustData({ ...adjustData, type: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                >
                  <option value="EARNED">Credit Points (+)</option>
                  <option value="REDEEMED">Debit / Redeem Points (-)</option>
                  <option value="ADJUSTED">Manual Balance Correction</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Points Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  value={adjustData.points}
                  onChange={(e) => setAdjustData({ ...adjustData, points: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Reason / Notes
                </label>
                <input
                  type="text"
                  value={adjustData.notes}
                  onChange={(e) => setAdjustData({ ...adjustData, notes: e.target.value })}
                  placeholder="e.g. Promotional gift, system adjustment..."
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setAdjustModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adjusting}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-md transition"
                >
                  {adjusting ? 'Saving...' : 'Apply Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
