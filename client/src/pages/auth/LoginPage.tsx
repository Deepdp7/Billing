import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { 
  Zap, ShoppingCart, UtensilsCrossed, Pill, Shield, 
  ArrowRight, Lock, Mail, Store, Shirt, Factory, GraduationCap 
} from 'lucide-react';

interface LoginPageProps {
  onNavigateToRegister: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onNavigateToRegister }) => {
  const { login, quickDemoLogin, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login({ email, password });
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check credentials.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950 text-white flex items-center justify-center p-4">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        
        {/* Left Side: Brand & Quick Demo Switchers */}
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <Zap className="w-7 h-7 text-white fill-white" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight font-['Outfit']">
                Apna Billing
              </h1>
              <p className="text-xs text-emerald-400 font-semibold tracking-wide uppercase">
                All-in-One Multi-Category Billing Platform
              </p>
            </div>
          </div>

          <p className="text-slate-300 text-sm leading-relaxed">
            Fast POS billing, atomic GST invoices, real-time inventory ledger, and industry-tailored workflows for Indian businesses.
          </p>

          {/* 1-Click Demo Profiles */}
          <div className="space-y-3 pt-2">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <span>🚀 1-Click Demo Profiles (Preloaded)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => quickDemoLogin('grocery')}
                disabled={isLoading}
                className="text-left p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-emerald-500/50 transition group shadow-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <ShoppingCart className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Apna Supermart</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">Grocery & Retail · Barcodes</p>
              </button>

              <button
                type="button"
                onClick={() => quickDemoLogin('restaurant')}
                disabled={isLoading}
                className="text-left p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-amber-500/50 transition group shadow-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <UtensilsCrossed className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Spice Garden Cafe</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">Restaurant · KOT & Tables</p>
              </button>

              <button
                type="button"
                onClick={() => quickDemoLogin('pharmacy')}
                disabled={isLoading}
                className="text-left p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-blue-500/50 transition group shadow-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Pill className="w-4 h-4 text-blue-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Apollo Care Chemist</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">Pharmacy · Batches & Expiry</p>
              </button>

              <button
                type="button"
                onClick={() => quickDemoLogin('clothing')}
                disabled={isLoading}
                className="text-left p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-purple-500/50 transition group shadow-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Shirt className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Zara Trends Fashion</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">Clothing · Size/Color Matrix</p>
              </button>

              <button
                type="button"
                onClick={() => quickDemoLogin('manufacturing')}
                disabled={isLoading}
                className="text-left p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-amber-500/50 transition group shadow-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Factory className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Apex Manufacturing</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">BOM Recipes · Work Orders</p>
              </button>

              <button
                type="button"
                onClick={() => quickDemoLogin('school')}
                disabled={isLoading}
                className="text-left p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 hover:border-emerald-500/50 transition group shadow-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <GraduationCap className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Vidyaniketan School</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">Students & Fee Collection</p>
              </button>

              <button
                type="button"
                onClick={() => quickDemoLogin('admin')}
                disabled={isLoading}
                className="col-span-1 sm:col-span-2 text-left p-3 rounded-xl bg-indigo-950/40 hover:bg-indigo-900/50 border border-indigo-700/50 hover:border-indigo-400 transition group shadow-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-indigo-200">Platform Super Admin</span>
                </div>
                <p className="text-[11px] text-indigo-300/80 leading-tight">SaaS Multi-tenant Control & Plans</p>
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Login Form */}
        <div className="bg-slate-900/90 border border-slate-800 p-8 rounded-2xl shadow-2xl backdrop-blur-xl">
          <div className="mb-6">
            <h2 className="text-xl font-bold font-['Outfit']">Sign In to Your Business</h2>
            <p className="text-xs text-slate-400 mt-1">Enter your credentials or click any demo profile</p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-950/50 border border-red-800 text-red-200 text-xs rounded-xl">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Business Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="email"
                  required
                  placeholder="owner@business.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-800/80 border border-slate-700 text-white rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-800/80 border border-slate-700 text-white rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs py-3 rounded-xl transition shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
            >
              <span>{isLoading ? 'Signing In...' : 'Sign In to Dashboard'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-800 text-center">
            <p className="text-xs text-slate-400">
              New business?{' '}
              <button
                type="button"
                onClick={onNavigateToRegister}
                className="text-emerald-400 font-bold hover:underline"
              >
                Register & Choose Category
              </button>
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};
