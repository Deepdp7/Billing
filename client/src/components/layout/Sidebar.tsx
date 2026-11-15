import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { useLanguage } from '../../context/LanguageContext.js';
import { shownVersion, useLicense } from '../../context/LicenseContext.js';
import { PAGE_FEATURES } from '../../lib/features.js';
import { 
  LayoutDashboard, ShoppingCart, FileText, Package, 
  Warehouse, Users, Settings, ShieldCheck, Zap, 
  Truck, Receipt, BarChart3, FileSpreadsheet, UserCheck, 
  UtensilsCrossed, Pill, Barcode, Building2, HardDrive, 
  ShieldAlert, LifeBuoy, RotateCcw, Shirt, Globe, Factory,
  Award, GraduationCap, Wrench, Layers, Lock, KeyRound, ChevronDown
} from 'lucide-react';

type Group = 'operations' | 'enterprise';
const GROUPS_KEY = 'apna_sidebar_groups';

function readOpenGroups(): Partial<Record<Group, boolean>> {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}'); } catch { return {}; }
}

/** A menu section that opens and closes (smoothly) when its header is clicked */
function NavGroup({ title, titleClass, count, open, onToggle, children }: {
  title: string; titleClass: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-slate-100 dark:hover:bg-slate-800/60 ${titleClass}`}>
        <span className="flex-1 text-left">{title}</span>
        <span className="rounded-full bg-slate-100 px-1.5 py-px text-[9px] font-semibold tracking-normal text-slate-500 dark:bg-slate-800 dark:text-slate-400">{count}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
      </button>
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden" inert={!open}>
          <div className="space-y-1 pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activePage, onNavigate }) => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { license, hasFeature } = useLicense();
  const locked = (id: string) => !!PAGE_FEATURES[id] && !hasFeature(PAGE_FEATURES[id]);
  const [openGroups, setOpenGroups] = useState<Partial<Record<Group, boolean>>>(readOpenGroups);
  const toggleGroup = (g: Group) => setOpenGroups((o) => {
    const next = { ...o, [g]: !o[g] };
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify(next)); } catch { /* not remembered */ }
    return next;
  });
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const category = user?.businessCategory;

  const coreNavItems = [
    { id: 'dashboard', label: t('dashboard', 'Dashboard'), icon: LayoutDashboard },
    { id: 'billing', label: t('pos', 'POS Billing'), icon: ShoppingCart },
    { id: 'online-orders', label: t('ecommerce', 'Online Store & Orders'), icon: Globe },
    { id: 'invoices', label: t('invoices', 'Invoices'), icon: FileText },
    { id: 'products', label: t('products', 'Products'), icon: Package },
    { id: 'inventory', label: t('inventory', 'Inventory'), icon: Warehouse },
  ];

  const enterpriseNavItems = [
    { id: 'barcodes', label: 'Barcode Generator', icon: Barcode },
    { id: 'branches', label: 'Store Branches', icon: Building2 },
    { id: 'backup', label: 'Backup & Restore', icon: HardDrive },
    { id: 'audit-logs', label: 'Audit Activity Logs', icon: ShieldAlert },
    { id: 'support', label: 'Help & Support', icon: LifeBuoy },
  ];

  const operationsNavItems = [
    { id: 'wholesale', label: t('wholesale', 'Wholesale & Distribution'), icon: Layers },
    { id: 'services', label: t('service', 'Service & Work Orders'), icon: Wrench },
    { id: 'loyalty', label: t('loyalty', 'Loyalty & Rewards'), icon: Award },
    { id: 'returns', label: 'Returns & Refunds', icon: RotateCcw },
    { id: 'purchases', label: t('purchases', 'Purchases & Vendors'), icon: Truck },
    { id: 'expenses', label: 'Store Expenses', icon: Receipt },
    { id: 'reports', label: t('reports', 'Reports & P&L'), icon: BarChart3 },
    { id: 'quotations', label: 'Quotations', icon: FileSpreadsheet },
    { id: 'customers', label: t('customers', 'Customers'), icon: Users },
    { id: 'staff', label: 'Staff Roles', icon: UserCheck },
  ];

  // The shop's own industry screen is shown above (Industry Vertical), so not again in Back-Office
  const opsItems = operationsNavItems.filter((item) => !(item.id === 'services' && category === 'SERVICE') && !(item.id === 'wholesale' && category === 'WHOLESALE'));

  // The section holding the current page opens by itself (e.g. reached from the dashboard)
  useEffect(() => {
    const g: Group | null = opsItems.some((i) => i.id === activePage) ? 'operations' : enterpriseNavItems.some((i) => i.id === activePage) ? 'enterprise' : null;
    if (g) setOpenGroups((o) => (o[g] ? o : { ...o, [g]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage]);

  const navButton = (item: { id: string; label: string; icon: React.ComponentType<{ className?: string }> }, tone: 'emerald' | 'indigo') => {
    const Icon = item.icon;
    const isActive = activePage === item.id;
    return (
      <button
        key={item.id}
        onClick={() => onNavigate(item.id)}
        className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
          isActive
            ? tone === 'emerald' ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25 font-bold' : 'bg-indigo-600 text-white shadow-md font-bold'
            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-100'
        }`}
      >
        <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
        <span className={locked(item.id) ? 'opacity-50' : ''}>{item.label}</span>
        {locked(item.id) && <Lock className="w-3 h-3 ml-auto text-slate-400" />}
      </button>
    );
  };

  return (
    <aside className="w-64 h-full min-h-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between select-none shrink-0 overflow-y-auto">
      <div>
        {/* Brand Header */}
        <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-800 gap-3 sticky top-0 bg-white dark:bg-slate-900 z-10">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/30">
            <Zap className="w-5 h-5 fill-white" />
          </div>
          <div>
            <span className="font-extrabold text-base tracking-tight bg-gradient-to-r from-slate-900 via-emerald-800 to-teal-700 dark:from-white dark:via-emerald-300 dark:to-teal-400 bg-clip-text text-transparent font-['Outfit']">
              Apna Billing
            </span>
            <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 tracking-wider uppercase">
              Omni Platform v1.0
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <div className="p-3 space-y-4">
          
          {/* Main Core */}
          <div className="space-y-1">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Core Billing & Stock
            </div>
            {coreNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25 font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span className={locked(item.id) ? 'opacity-50' : ''}>{item.label}</span>
                  {locked(item.id) && <Lock className="w-3 h-3 ml-auto text-slate-400" />}
                  {item.id === 'billing' && (
                    <span className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'}`}>
                      POS
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Vertical Modules (Category Specific) */}
          {(category === 'RESTAURANT' || category === 'PHARMACY' || category === 'CLOTHING' || category === 'MANUFACTURING' || category === 'SCHOOL' || category === 'WHOLESALE' || category === 'SERVICE') && (
            <div className="space-y-1">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-500 dark:text-amber-400">
                Industry Vertical
              </div>
              {category === 'SCHOOL' && (
                <button
                  onClick={() => onNavigate('school')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activePage === 'school'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25 font-bold'
                      : 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                  }`}
                >
                  <GraduationCap className="w-4 h-4" />
                  <span>{t('school', 'School & Fee Management')}</span>
                </button>
              )}
              {category === 'RESTAURANT' && (
                <button
                  onClick={() => onNavigate('restaurant')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activePage === 'restaurant'
                      ? 'bg-amber-500 text-white shadow-md shadow-amber-500/25 font-bold'
                      : 'text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                  }`}
                >
                  <UtensilsCrossed className="w-4 h-4" />
                  <span>Tables & KOT</span>
                </button>
              )}
              {category === 'PHARMACY' && (
                <button
                  onClick={() => onNavigate('pharmacy')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activePage === 'pharmacy'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                      : 'text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                  }`}
                >
                  <Pill className="w-4 h-4" />
                  <span>Batches & Expiry</span>
                </button>
              )}
              {category === 'CLOTHING' && (
                <button
                  onClick={() => onNavigate('clothing')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activePage === 'clothing'
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/25 font-bold'
                      : 'text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40'
                  }`}
                >
                  <Shirt className="w-4 h-4" />
                  <span>Apparel & Variants</span>
                </button>
              )}
              {category === 'MANUFACTURING' && (
                <button
                  onClick={() => onNavigate('manufacturing')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activePage === 'manufacturing'
                      ? 'bg-amber-600 text-white shadow-md shadow-amber-600/25 font-bold'
                      : 'text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                  }`}
                >
                  <Factory className="w-4 h-4" />
                  <span>Manufacturing & BOM</span>
                </button>
              )}
              {category === 'WHOLESALE' && (
                <button
                  onClick={() => onNavigate('wholesale')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activePage === 'wholesale'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-bold'
                      : 'text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  <span>{t('wholesale', 'Wholesale & Distribution')}</span>
                </button>
              )}
              {category === 'SERVICE' && (
                <button
                  onClick={() => onNavigate('services')}
                  className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                    activePage === 'services'
                      ? 'bg-amber-600 text-white shadow-md shadow-amber-600/25 font-bold'
                      : 'text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                  }`}
                >
                  <Wrench className="w-4 h-4" />
                  <span>{t('service', 'Service & Work Orders')}</span>
                </button>
              )}
            </div>
          )}

          {/* Operations & Back-Office, and Enterprise & Utilities: sections that open and close */}
          <NavGroup title="Back-Office Operations" titleClass="text-slate-400" count={opsItems.length}
            open={!!openGroups.operations} onToggle={() => toggleGroup('operations')}>
            {opsItems.map((item) => navButton(item, 'emerald'))}
          </NavGroup>

          <NavGroup title="Enterprise & Utilities" titleClass="text-indigo-500 dark:text-indigo-400" count={enterpriseNavItems.length}
            open={!!openGroups.enterprise} onToggle={() => toggleGroup('enterprise')}>
            {enterpriseNavItems.map((item) => navButton(item, 'indigo'))}
          </NavGroup>

          {/* Settings */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
            <button
              onClick={() => onNavigate('settings')}
              className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                activePage === 'settings'
                  ? 'bg-emerald-600 text-white shadow-md font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80'
              }`}
            >
              <Settings className="w-4 h-4 text-slate-400" />
              <span>Settings</span>
            </button>
            <button
              onClick={() => onNavigate('license')}
              className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                activePage === 'license'
                  ? 'bg-emerald-600 text-white shadow-md font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80'
              }`}
            >
              <KeyRound className="w-4 h-4 text-slate-400" />
              <span>License</span>
            </button>
          </div>

          {/* Super Admin Section */}
          {isSuperAdmin && (
            <div className="pt-2 space-y-1">
              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                SaaS Super Admin
              </div>
              <button
                onClick={() => onNavigate('admin')}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                  activePage === 'admin'
                    ? 'bg-indigo-600 text-white shadow-md font-bold'
                    : 'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Platform Admin</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Plan footer card */}
      <div className="p-3 m-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{license?.license?.plan.name || 'Apna Billing Core'}</span>
          <span className={`text-[10px] font-bold text-white px-1.5 py-0.5 rounded ${license?.canWrite === false ? 'bg-amber-500' : 'bg-emerald-600'}`}>
            {license?.license?.type || (license?.enforced ? 'UNLICENSED' : 'All-in-One')}
          </span>
        </div>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          {license?.license
            ? license.canWrite
              ? license.license.daysRemaining !== null ? `${license.license.daysRemaining} day(s) remaining` : 'Lifetime license'
              : `Read-only · ${license.mode.replace(/_/g, ' ').toLowerCase()}`
            : category ? `${category} Multi-Module Mode` : 'Active'}
        </p>
        {/* Which version this PC runs (after an update it shows the new number) */}
        {license?.appVersion && (
          <p className="mt-1.5 border-t border-slate-200 pt-1.5 text-[10px] text-slate-400 dark:border-slate-700">
            Apna Billing v{shownVersion(license.appVersion)}
          </p>
        )}
      </div>
    </aside>
  );
};
