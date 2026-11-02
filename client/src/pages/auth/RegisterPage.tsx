import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { BusinessCategory } from '../../types/index.js';
import { 
  Zap, ShoppingBag, UtensilsCrossed, Pill, Shirt, 
  Truck, Wrench, Factory, GraduationCap, ArrowLeft, ArrowRight 
} from 'lucide-react';
import { Select } from '../../components/ui/Select.js';
import { ThemeSwitch } from '../../components/ThemeSwitch.js';
import { clearSessionNotice, takeSessionNotice } from '../../context/LicenseContext.js';

interface RegisterPageProps {
  /** Omitted during first-run setup: there is no account to sign in to yet. */
  onNavigateToLogin?: () => void;
}

const CATEGORIES: Array<{
  id: BusinessCategory;
  title: string;
  desc: string;
  icon: any;
  color: string;
}> = [
  {
    id: 'GROCERY',
    title: 'Grocery & Supermarket',
    desc: 'Rapid barcode scan, loose items, FMCG packaging, weighing scales',
    icon: ShoppingBag,
    color: 'emerald',
  },
  {
    id: 'RESTAURANT',
    title: 'Restaurant & Cafe',
    desc: 'Table layout, Kitchen Order Tickets (KOT), takeaway billing',
    icon: UtensilsCrossed,
    color: 'amber',
  },
  {
    id: 'PHARMACY',
    title: 'Pharmacy & Medical',
    desc: 'Medicine batch numbers, expiry tracking, drug schedules',
    icon: Pill,
    color: 'blue',
  },
  {
    id: 'CLOTHING',
    title: 'Clothing & Fashion',
    desc: 'Apparel variants (Size/Color matrix), barcode tags, exchanges',
    icon: Shirt,
    color: 'purple',
  },
  {
    id: 'WHOLESALE',
    title: 'Wholesale & B2B',
    desc: 'Tiered bulk pricing, customer credit limits, distributor ledgers',
    icon: Truck,
    color: 'indigo',
  },
  {
    id: 'SERVICE',
    title: 'Service & Repair Center',
    desc: 'Job cards, labor billing, appointments, service quotations',
    icon: Wrench,
    color: 'cyan',
  },
  {
    id: 'MANUFACTURING',
    title: 'Small Manufacturing',
    desc: 'Raw materials, Bill of Materials (BOM), production inventory',
    icon: Factory,
    color: 'orange',
  },
  {
    id: 'SCHOOL',
    title: 'School & Institute',
    desc: 'Fee installments, student ledgers, fee receipts & dues',
    icon: GraduationCap,
    color: 'rose',
  },
];

// GST state codes (first two digits of a GSTIN) → state / UT.
const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh',
};
const STATE_NAMES = Object.values(GST_STATES).sort();

export const RegisterPage: React.FC<RegisterPageProps> = ({ onNavigateToLogin }) => {
  const { register, isLoading } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<BusinessCategory>('GROCERY');
  const [ownerName, setOwnerName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [gstin, setGstin] = useState('');
  const [stateName, setStateName] = useState('');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');
  // Why the app is back at setup (e.g. the shop was erased), including where its safety backup was saved.
  const [notice, setNotice] = useState('');
  useEffect(() => { setNotice(takeSessionNotice()); }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    clearSessionNotice();
    setError('');
    const missing: string[] = [];
    if (!businessName.trim()) missing.push('business name');
    if (!ownerName.trim()) missing.push('owner name');
    if (!email.trim()) missing.push('email');
    if (!phone.trim()) missing.push('phone number');
    if (!password) missing.push('password');
    if (!stateName) missing.push('state');
    if (missing.length) {
      setError(`Fill in ${missing.join(', ')} before launching the workspace.`);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid business email. That email is the sign-in.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    try {
      await register({
        ownerName,
        businessName,
        category: selectedCategory,
        email,
        phone,
        password,
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
        
        {/* Top Header */}
        <div className="flex items-center justify-between">
          {onNavigateToLogin ? (
            <button
              type="button"
              onClick={onNavigateToLogin}
              className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Sign In</span>
            </button>
          ) : (
            <span className="text-xs font-semibold text-slate-400">First-time setup: create your business and owner login</span>
          )}

          <div className="flex items-center gap-3">
            <ThemeSwitch />
            <Zap className="w-5 h-5 text-emerald-500 fill-emerald-500 dark:text-emerald-400 dark:fill-emerald-400" />
            <span className="font-extrabold text-sm tracking-tight font-['Outfit']">
              Apna Billing Onboarding
            </span>
          </div>
        </div>

        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold font-['Outfit']">Step 1: Choose Your Business Category</h1>
          <p className="text-xs text-slate-400">
            Apna Billing automatically adapts its modules, invoice headers, and fields to your business type.
          </p>
        </div>

        {notice && (
          <div className="p-3 bg-amber-950/50 border border-amber-700 text-amber-100 text-xs rounded-xl break-words">
            {notice}
          </div>
        )}

        {/* Category Selection Grid */}
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

        {/* Business Registration Details Form */}
        <form noValidate onSubmit={handleRegister} className="bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">
              Step 2: Business & Owner Details ({selectedCategory})
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
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
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Owner / Manager Name *</label>
              <input
                type="text"
                placeholder="e.g. Amit Sharma"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 dark:bg-slate-800/80 dark:border-slate-700 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Business Email (Sign in) *</label>
              <input
                type="email"
                placeholder="store@business.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 dark:bg-slate-800/80 dark:border-slate-700 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Phone Number *</label>
              <input
                type="text"
                placeholder="+91 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 dark:bg-slate-800/80 dark:border-slate-700 dark:text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Password *</label>
              <input
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
