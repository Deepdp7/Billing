import React from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { useLanguage } from '../../context/LanguageContext.js';
import { 
  LayoutDashboard, ShoppingCart, FileText, Package, 
  Warehouse, Users, Settings, ShieldCheck, Zap, 
  Truck, Receipt, BarChart3, FileSpreadsheet, UserCheck, 
  UtensilsCrossed, Pill, Barcode, Building2, HardDrive, 
  ShieldAlert, LifeBuoy, RotateCcw, Shirt, Globe, Factory,
  Award, GraduationCap, Wrench, Layers
} from 'lucide-react';

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activePage, onNavigate }) => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const category = user?.businessCategory;

  const coreNavItems = [
    { id: 'dashboard', label: t('dashboard', 'Dashboard'), icon: LayoutDashboard },
    { id: 'billing', label: t('pos', 'POS Billing'), icon: ShoppingCart },
    { id: 'online-orders', label: t('ecommerce', 'Online Store & Orders'), icon: Globe },
    { id: 'invoices', label: t('invoices', 'Invoices'), icon: FileText },
    { id: 'products', label: t('inventory', 'Products'), icon: Package },
    { id: 'inventory', label: t('inventory', 'Inventory'), icon: Warehouse },
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

  return (
    <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between select-none shrink-0 overflow-y-auto">
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
                  <span>{item.label}</span>
                  {item.id === 'billing' && (
                    <span className="ml-auto text-[10px] bg-emerald-500/20 text-emerald-200 px-1.5 py-0.5 rounded font-mono">
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

          {/* Operations & Back-Office */}
          <div className="space-y-1">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Back-Office Operations
            </div>
            {operationsNavItems.map((item) => {
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
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Enterprise & Scale Modules (Phase 5) */}
          <div className="space-y-1">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
              Enterprise & Utilities
            </div>
            <button
              onClick={() => onNavigate('barcodes')}
              className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                activePage === 'barcodes'
                  ? 'bg-indigo-600 text-white shadow-md font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900'
              }`}
            >
              <Barcode className="w-4 h-4 text-slate-400" />
              <span>Barcode Generator</span>
            </button>
            <button
              onClick={() => onNavigate('branches')}
              className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                activePage === 'branches'
                  ? 'bg-indigo-600 text-white shadow-md font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-4 h-4 text-slate-400" />
              <span>Store Branches</span>
            </button>
            <button
              onClick={() => onNavigate('backup')}
              className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                activePage === 'backup'
                  ? 'bg-indigo-600 text-white shadow-md font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900'
              }`}
            >
              <HardDrive className="w-4 h-4 text-slate-400" />
              <span>Backup & Restore</span>
            </button>
            <button
              onClick={() => onNavigate('audit-logs')}
              className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                activePage === 'audit-logs'
                  ? 'bg-indigo-600 text-white shadow-md font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900'
              }`}
            >
              <ShieldAlert className="w-4 h-4 text-slate-400" />
              <span>Audit Activity Logs</span>
            </button>
            <button
              onClick={() => onNavigate('support')}
              className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                activePage === 'support'
                  ? 'bg-indigo-600 text-white shadow-md font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900'
              }`}
            >
              <LifeBuoy className="w-4 h-4 text-slate-400" />
              <span>Help & Support</span>
            </button>
          </div>

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
          <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Apna Billing Core</span>
          <span className="text-[10px] font-bold bg-emerald-600 text-white px-1.5 py-0.5 rounded">All-in-One</span>
        </div>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          {category ? `${category} Multi-Module Mode` : 'Active'}
        </p>
      </div>
    </aside>
  );
};
