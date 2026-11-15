import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { clearSessionNotice, takeSessionNotice, useLicense, type SessionNotice } from '../../context/LicenseContext.js';
import {
  Zap, ShoppingCart, UtensilsCrossed, Pill, Shield,
  ArrowRight, Lock, Mail, Shirt, Factory, GraduationCap, User, Phone,
} from 'lucide-react';
import { ThemeSwitch } from '../../components/ThemeSwitch.js';
import { SessionNoticeBanner } from '../../components/system/SessionNoticeBanner.js';
import type { SignupDraft } from './RegisterPage.js';

interface LoginPageProps {
  onContinueSignup: (draft: SignupDraft) => void;
  setupRequired?: boolean;
  /** Open on Sign Up when coming back from business setup. */
  initialMode?: 'signin' | 'signup';
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onContinueSignup,
  setupRequired = false,
  initialMode = 'signin',
}) => {
  const { login, quickDemoLogin, isLoading } = useAuth();
  const { system } = useLicense();
  const demoMode = !!system?.demoMode;
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<SessionNotice | null>(null);
  useEffect(() => { setNotice(takeSessionNotice()); }, []);
  useEffect(() => { setMode(initialMode); }, [initialMode]);

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next);
    setError('');
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    clearSessionNotice();
    setError('');
    try {
      await login({ email, password });
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check credentials.');
    }
  };

  const handleSignUp = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const missing: string[] = [];
    if (!ownerName.trim()) missing.push('your name');
    if (!email.trim()) missing.push('email');
    if (!phone.trim()) missing.push('phone number');
    if (!password) missing.push('password');
    if (missing.length) {
      setError(`Fill in ${missing.join(', ')} to continue.`);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email. That email is used to sign in.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    clearSessionNotice();
    onContinueSignup({
      ownerName: ownerName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      password,
    });
  };

  return (
    <div className="relative min-h-screen w-full max-w-full overflow-x-hidden overscroll-none touch-pan-y bg-slate-100 text-slate-900 dark:bg-gradient-to-br dark:from-slate-900 dark:via-slate-950 dark:to-emerald-950 dark:text-white flex items-center justify-center p-4">
      <div className="absolute top-4 right-4 z-20"><ThemeSwitch /></div>
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center">

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

          <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
            Fast POS billing, atomic GST invoices, real-time inventory ledger, and industry-tailored workflows for Indian businesses.
          </p>

          {demoMode && <div className="space-y-3 pt-2">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <span>🚀 1-Click Demo Profiles (Preloaded)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button type="button" onClick={() => quickDemoLogin('grocery')} disabled={isLoading} className="text-left p-3 rounded-xl bg-white dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500/50 transition group shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <ShoppingCart className="w-4 h-4 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-slate-900 dark:text-white">Apna Supermart</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">Grocery & Retail · Barcodes</p>
              </button>

              <button type="button" onClick={() => quickDemoLogin('restaurant')} disabled={isLoading} className="text-left p-3 rounded-xl bg-white dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500/50 transition group shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <UtensilsCrossed className="w-4 h-4 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-slate-900 dark:text-white">Spice Garden Cafe</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">Restaurant · KOT & Tables</p>
              </button>

              <button type="button" onClick={() => quickDemoLogin('pharmacy')} disabled={isLoading} className="text-left p-3 rounded-xl bg-white dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500/50 transition group shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Pill className="w-4 h-4 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-slate-900 dark:text-white">Apollo Care Chemist</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">Pharmacy · Batches & Expiry</p>
              </button>

              <button type="button" onClick={() => quickDemoLogin('clothing')} disabled={isLoading} className="text-left p-3 rounded-xl bg-white dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500/50 transition group shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Shirt className="w-4 h-4 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-slate-900 dark:text-white">Zara Trends Fashion</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">Clothing · Size/Color Matrix</p>
              </button>

              <button type="button" onClick={() => quickDemoLogin('manufacturing')} disabled={isLoading} className="text-left p-3 rounded-xl bg-white dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500/50 transition group shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Factory className="w-4 h-4 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-slate-900 dark:text-white">Apex Manufacturing</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">BOM Recipes · Work Orders</p>
              </button>

              <button type="button" onClick={() => quickDemoLogin('school')} disabled={isLoading} className="text-left p-3 rounded-xl bg-white dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500/50 transition group shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <GraduationCap className="w-4 h-4 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-slate-900 dark:text-white">Vidyaniketan School</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">Students & Fee Collection</p>
              </button>

              <button type="button" onClick={() => quickDemoLogin('admin')} disabled={isLoading} className="col-span-1 sm:col-span-2 text-left p-3 rounded-xl bg-white dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/80 hover:border-emerald-500/50 transition group shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-4 h-4 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-slate-900 dark:text-white">Platform Super Admin</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">SaaS Multi-tenant Control & Plans</p>
              </button>
            </div>
          </div>}
        </div>

        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 p-8 rounded-2xl shadow-2xl">
          <div className="mb-5">
            <h2 className="text-xl font-bold font-['Outfit']">
              {mode === 'signup' ? 'Create your account' : 'Sign in to your business'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {mode === 'signup'
                ? 'Enter basic details first. Next you will choose your business category.'
                : setupRequired
                  ? 'Already set up this shop? Sign in below, or switch to Sign Up.'
                  : demoMode
                    ? 'Enter your credentials or click any demo profile'
                    : 'Enter the owner or staff credentials for this computer'}
            </p>
          </div>

          {/* Sign In / Sign Up toggle */}
          <div className="mb-5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className={`py-2.5 rounded-lg text-xs font-bold transition ${
                mode === 'signin'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-600'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className={`py-2.5 rounded-lg text-xs font-bold transition ${
                mode === 'signup'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-slate-600'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Sign Up
            </button>
          </div>

          <SessionNoticeBanner notice={notice} className="mb-4" />

          {error && (
            <div className="mb-4 p-3 bg-red-950/50 border border-red-800 text-red-200 text-xs rounded-xl">
              {error}
            </div>
          )}

          {mode === 'signin' ? (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Business Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="email"
                    required
                    placeholder="owner@business.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="btn-brand w-full font-bold text-xs py-3 rounded-xl transition flex items-center justify-center gap-2 active:scale-95"
              >
                <span>{isLoading ? 'Signing In...' : 'Sign In to Dashboard'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <form noValidate onSubmit={handleSignUp} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Your name *</label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    placeholder="e.g. Amit Sharma"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    className="w-full bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Email (sign in) *</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="email"
                    placeholder="owner@business.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Phone number *</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    placeholder="+91 9876543210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">Password *</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn-brand w-full font-bold text-xs py-3 rounded-xl transition flex items-center justify-center gap-2 active:scale-95"
              >
                <span>Continue to business setup</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>

      </div>
    </div>
  );
};
