import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { useTheme } from '../../context/ThemeContext.js';
import { useLanguage, Language } from '../../context/LanguageContext.js';
import { 
  Sun, Moon, Bell, LogOut, ChevronDown, Store, Shield, 
  PlusCircle, RefreshCw, ShoppingCart, Languages, GraduationCap, Factory
} from 'lucide-react';

interface NavbarProps {
  onNavigate: (page: string) => void;
  activePage: string;
}

export const Navbar: React.FC<NavbarProps> = ({ onNavigate }) => {
  const { user, logout, quickDemoLogin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const [showDemoMenu, setShowDemoMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);

  return (
    <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-30 px-4 lg:px-6 flex items-center justify-between">
      {/* Left: Active Business Badge */}
      <div className="flex items-center gap-3">
        {user?.businessName ? (
          <div className="flex items-center gap-2.5 bg-slate-100 dark:bg-slate-800/60 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/60">
            <Store className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold leading-tight text-slate-800 dark:text-slate-100">{user.businessName}</span>
              <span className="text-[10px] font-medium tracking-wide uppercase text-slate-500 dark:text-slate-400">
                {user.businessCategory || 'Store'} · {user.planId === 'plan_pro' ? 'Pro Plan' : 'Active'}
              </span>
            </div>
          </div>
        ) : user?.role === 'SUPER_ADMIN' ? (
          <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 px-3 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800/60">
            <Shield className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Platform Super Admin Mode</span>
          </div>
        ) : null}

        {/* Quick Demo Switcher Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowDemoMenu(!showDemoMenu)}
            className="hidden sm:flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Switch Business</span>
            <ChevronDown className="w-3 h-3" />
          </button>

          {showDemoMenu && (
            <div className="absolute left-0 mt-2 w-68 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl py-2 z-50">
              <div className="px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-400 tracking-wider">
                Instant Demo Profiles
              </div>
              <button
                onClick={() => { quickDemoLogin('grocery'); setShowDemoMenu(false); }}
                className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">Apna Supermart</div>
                  <div className="text-[10px] text-slate-400">Grocery & Retail (Barcodes)</div>
                </div>
              </button>
              <button
                onClick={() => { quickDemoLogin('restaurant'); setShowDemoMenu(false); }}
                className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">Spice Garden Cafe</div>
                  <div className="text-[10px] text-slate-400">Restaurant (Dine-in / KOT)</div>
                </div>
              </button>
              <button
                onClick={() => { quickDemoLogin('pharmacy'); setShowDemoMenu(false); }}
                className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">Apollo Care Pharmacy</div>
                  <div className="text-[10px] text-slate-400">Pharmacy (Batch & Expiry)</div>
                </div>
              </button>
              <button
                onClick={() => { quickDemoLogin('clothing'); setShowDemoMenu(false); }}
                className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">Zara Trends Boutique</div>
                  <div className="text-[10px] text-slate-400">Clothing & Garments (Sizes/Colors)</div>
                </div>
              </button>
              <button
                onClick={() => { quickDemoLogin('manufacturing'); setShowDemoMenu(false); }}
                className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">Apex Steel & Wood Crafts</div>
                  <div className="text-[10px] text-slate-400">Manufacturing (BOM & Work Orders)</div>
                </div>
              </button>
              <button
                onClick={() => { quickDemoLogin('school'); setShowDemoMenu(false); }}
                className="w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition bg-emerald-50/50 dark:bg-emerald-950/20"
              >
                <div>
                  <div className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                    <GraduationCap className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Vidyaniketan Public School</span>
                  </div>
                  <div className="text-[10px] text-slate-500">School & Fees (Students, Due, Receipts)</div>
                </div>
                <span className="text-[9px] bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 px-1 py-0.5 rounded font-bold">NEW</span>
              </button>
              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
              <button
                onClick={() => { quickDemoLogin('admin'); setShowDemoMenu(false); }}
                className="w-full text-left px-3 py-2 text-xs flex items-center justify-between text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition font-medium"
              >
                <div className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Platform Super Admin</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        {/* Fast Bill Button */}
        {user?.businessId && (
          <button
            onClick={() => onNavigate('billing')}
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-sm shadow-emerald-500/20 active:scale-95 transition"
          >
            <ShoppingCart className="w-4 h-4" />
            <span className="hidden sm:inline">{t('pos', 'POS Bill')}</span>
          </button>
        )}

        {/* Language Selector Dropdown (EN / BN / HI) */}
        <div className="relative">
          <button
            onClick={() => setShowLangMenu(!showLangMenu)}
            aria-label="Switch Language"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition"
          >
            <Languages className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span className="font-bold uppercase tracking-wider text-[11px]">{language}</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {showLangMenu && (
            <div className="absolute right-0 mt-2 w-36 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl py-1.5 z-50">
              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Language / ভাষা / भाषा
              </div>
              <button
                onClick={() => { setLanguage('en'); setShowLangMenu(false); }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition ${
                  language === 'en' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-semibold' : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span>English</span>
                {language === 'en' && <span className="text-[10px]">✓</span>}
              </button>
              <button
                onClick={() => { setLanguage('bn'); setShowLangMenu(false); }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition ${
                  language === 'bn' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-semibold' : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span>বাংলা (Bengali)</span>
                {language === 'bn' && <span className="text-[10px]">✓</span>}
              </button>
              <button
                onClick={() => { setLanguage('hi'); setShowLangMenu(false); }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition ${
                  language === 'hi' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-semibold' : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span>हिन्दी (Hindi)</span>
                {language === 'hi' && <span className="text-[10px]">✓</span>}
              </button>
            </div>
          )}
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-600" />}
        </button>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-bold text-xs flex items-center justify-center shadow-sm">
              {user?.name?.charAt(0) || 'U'}
            </div>
            <div className="hidden md:flex flex-col text-left">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{user?.name}</span>
              <span className="text-[10px] text-slate-400">{user?.role?.replace('_', ' ')}</span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl py-1.5 z-50">
              <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                <p className="text-xs font-medium text-slate-900 dark:text-slate-100">{user?.name}</p>
                <p className="text-[11px] text-slate-400 truncate">{user?.email}</p>
              </div>
              <button
                onClick={() => { onNavigate('settings'); setShowUserMenu(false); }}
                className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                Business Settings
              </button>
              <button
                onClick={() => { logout(); setShowUserMenu(false); }}
                className="w-full text-left px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-2 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
