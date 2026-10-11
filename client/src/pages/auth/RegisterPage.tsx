import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { BusinessCategory } from '../../types/index.js';
import { 
  Zap, ShoppingBag, UtensilsCrossed, Pill, Shirt, 
  Truck, Wrench, Factory, GraduationCap, ArrowLeft, ArrowRight 
} from 'lucide-react';

interface RegisterPageProps {
  onNavigateToLogin: () => void;
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

export const RegisterPage: React.FC<RegisterPageProps> = ({ onNavigateToLogin }) => {
  const { register, isLoading } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<BusinessCategory>('GROCERY');
  const [ownerName, setOwnerName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [gstin, setGstin] = useState('');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await register({
        ownerName,
        businessName,
        category: selectedCategory,
        email,
        phone,
        password,
        gstin,
        city: city || 'Mumbai',
        state: 'Maharashtra',
      });
    } catch (err: any) {
      setError(err.message || 'Onboarding failed');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 lg:p-8 flex flex-col justify-center items-center">
      <div className="max-w-4xl w-full space-y-6">
        
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onNavigateToLogin}
            className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Sign In</span>
          </button>

          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-400 fill-emerald-400" />
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

        {error && (
          <div className="p-3 bg-red-950/60 border border-red-800 text-red-200 text-xs rounded-xl">
            {error}
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
                    ? 'border-emerald-500 bg-emerald-950/30 ring-2 ring-emerald-500/50 shadow-lg shadow-emerald-950/40'
                    : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className={`p-2 rounded-lg ${isSelected ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-300'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  {isSelected && (
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800">
                      Selected
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-xs text-white">{cat.title}</h3>
                  <p className="text-[10px] text-slate-400 line-clamp-2 mt-0.5">{cat.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Business Registration Details Form */}
        <form onSubmit={handleRegister} className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              Step 2: Business & Owner Details ({selectedCategory})
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Business / Store Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Royal Enterprise"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Owner / Manager Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Amit Sharma"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Business Email (Sign in) *</label>
              <input
                type="email"
                required
                placeholder="store@business.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Phone Number *</label>
              <input
                type="text"
                required
                placeholder="+91 9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Password *</label>
              <input
                type="password"
                required
                placeholder="Minimum 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">GSTIN (Optional)</label>
              <input
                type="text"
                placeholder="e.g. 27AABCA1234A1Z5"
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs py-3 rounded-xl transition shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
          >
            <span>{isLoading ? 'Setting up Your Workspace...' : 'Launch Apna Billing Workspace'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

      </div>
    </div>
  );
};
