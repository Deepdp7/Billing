import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { BusinessCategory } from '../../types/index.js';
import {
  Zap, ShoppingBag, UtensilsCrossed, Pill, Shirt,
  Truck, Wrench, Factory, GraduationCap, ArrowLeft, ArrowRight,
} from 'lucide-react';
import { Select } from '../../components/ui/Select.js';
import { ThemeSwitch } from '../../components/ThemeSwitch.js';
import { clearSessionNotice, takeSessionNotice, type SessionNotice } from '../../context/LicenseContext.js';
import { SessionNoticeBanner } from '../../components/system/SessionNoticeBanner.js';

export interface SignupDraft {
  ownerName: string;
  email: string;
  phone: string;
  password: string;
}

interface RegisterPageProps {
  account: SignupDraft;
  onNavigateToLogin: () => void;
}

export const CATEGORIES: Array<{
  id: BusinessCategory;
  title: string;
  desc: string;
  icon: any;
}> = [
  { id: 'GROCERY', title: 'Grocery & Supermarket', desc: 'Rapid barcode scan, loose items, FMCG packaging, weighing scales', icon: ShoppingBag },
  { id: 'RESTAURANT', title: 'Restaurant & Cafe', desc: 'Table layout, Kitchen Order Tickets (KOT), takeaway billing', icon: UtensilsCrossed },
  { id: 'PHARMACY', title: 'Pharmacy & Medical', desc: 'Medicine batch numbers, expiry tracking, drug schedules', icon: Pill },
  { id: 'CLOTHING', title: 'Clothing & Fashion', desc: 'Apparel variants (Size/Color matrix), barcode tags, exchanges', icon: Shirt },
  { id: 'WHOLESALE', title: 'Wholesale & B2B', desc: 'Tiered bulk pricing, customer credit limits, distributor ledgers', icon: Truck },
  { id: 'SERVICE', title: 'Service & Repair Center', desc: 'Job cards, labor billing, appointments, service quotations', icon: Wrench },
  { id: 'MANUFACTURING', title: 'Small Manufacturing', desc: 'Raw materials, Bill of Materials (BOM), production inventory', icon: Factory },
  { id: 'SCHOOL', title: 'School & Institute', desc: 'Fee installments, student ledgers, fee receipts & dues', icon: GraduationCap },
];

const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh',
};
export const STATE_NAMES = Object.values(GST_STATES).sort();

export const RegisterPage: React.FC<RegisterPageProps> = ({ account, onNavigateToLogin }) => {
  const { register, isLoading } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<BusinessCategory>('GROCERY');
  const [businessName, setBusinessName] = useState('');
  const [gstin, setGstin] = useState('');
  const [stateName, setStateName] = useState('');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<SessionNotice | null>(null);
  useEffect(() => { setNotice(takeSessionNotice()); }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    clearSessionNotice();
    setError('');
    const missing: string[] = [];
    if (!businessName.trim()) missing.push('business name');
    if (!stateName) missing.push('state');
    if (missing.length) {
      setError(`Fill in ${missing.join(', ')} before launching the workspace.`);
      return;
    }
    try {
      await register({
        ownerName: account.ownerName,
        businessName,
        category: selectedCategory,
        email: account.email,
        phone: account.phone,
        password: account.password,
        gstin,
        city: city || undefined,
        state: stateName,
      });
    } catch (err: any) {
      setError(err.message || 'Onboarding failed');
    }
  };

  return (
    <div className="h-dvh w-full max-w-full overflow-y-auto overflow-x-hidden overscroll-none touch-pan-y bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white p-4 lg:p-8 flex flex-col items-center">
      <div className="max-w-4xl w-full space-y-6">

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onNavigateToLogin}
            className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Sign Up</span>
          </button>

          <div className="flex items-center gap-3">
            <ThemeSwitch />
            <Zap className="w-5 h-5 text-emerald-500 fill-emerald-500 dark:text-emerald-400 dark:fill-emerald-400" />
            <span className="font-extrabold text-sm tracking-tight font-['Outfit']">
              Apna Billing Onboarding
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <span className="text-slate-500">1. Account</span>
          <span className="text-slate-300 dark:text-slate-700">/</span>
          <span className="text-emerald-600 dark:text-emerald-400">2. Business setup</span>
        </div>

        <SessionNoticeBanner notice={notice} />

        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold font-['Outfit']">Choose your business category</h1>
          <p className="text-xs text-slate-400">
            Apna Billing automatically adapts its modules, invoice headers, and fields to your business type.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`p-3.5 rounded-xl text-left border transition-all flex flex-col justify-between h-32 ${
                  isSelected
                    ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/40 dark:bg-emerald-950/30 dark:ring-emerald-500/50 shadow-lg'
                    : 'border-slate-200 bg-white hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700 dark:hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className={`p-2 rounded-lg ${isSelected ? 'btn-brand text-white' : 'bg-emerald-50 text-emerald-700 dark:bg-slate-800 dark:text-emerald-300'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  {isSelected && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/80 dark:border-emerald-800">
                      Selected
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-xs text-slate-900 dark:text-white">{cat.title}</h3>
                  <p className="text-[10px] text-slate-400 line-clamp-2 mt-0.5">{cat.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        <form noValidate onSubmit={handleRegister} className="bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
              Business details ({selectedCategory})
            </h2>
            <p className="text-[11px] text-slate-400 mt-1">Signed in as {account.email}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Business / Store Name *</label>
              <input
                type="text"
                placeholder="e.g. Royal Enterprise"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 dark:bg-slate-800/80 dark:border-slate-700 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">GSTIN (Optional)</label>
              <input
                type="text"
                placeholder="e.g. 27AABCA1234A1Z5"
                value={gstin}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  setGstin(v);
                  const st = GST_STATES[v.slice(0, 2)];
                  if (st) setStateName(st);
                }}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 dark:bg-slate-800/80 dark:border-slate-700 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">State * (decides CGST/SGST vs IGST)</label>
              <Select
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 dark:bg-slate-800/80 dark:border-slate-700 dark:text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="">Select state…</option>
                {STATE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">City (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Mumbai"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 dark:bg-slate-800/80 dark:border-slate-700 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-4">
            {error && (
              <div className="p-3 bg-red-950/60 border border-red-800 text-red-200 text-xs rounded-xl">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="btn-brand w-full font-bold text-xs py-3 rounded-xl transition flex items-center justify-center gap-2 active:scale-95"
            >
              <span>{isLoading ? 'Setting up Your Workspace...' : 'Launch Apna Billing Workspace'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
