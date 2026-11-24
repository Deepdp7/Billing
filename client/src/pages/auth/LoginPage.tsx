import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext.js';
import { clearSessionNotice, takeSessionNotice, useLicense, type SessionNotice } from '../../context/LicenseContext.js';
import {
  Zap, ShoppingCart, UtensilsCrossed, Pill, Shield,
  ArrowRight, Lock, Mail, Shirt, Factory, GraduationCap, User, Phone,
} from 'lucide-react';
import { ThemeSwitch } from '../../components/ThemeSwitch.js';
import { SessionNoticeBanner } from '../../components/system/SessionNoticeBanner.js';
import type { SignupDraft } from './RegisterPage.js';
import { ForgotPasswordDialog } from './ForgotPasswordDialog.js';
import { CATEGORIES, STATE_NAMES } from './RegisterPage.js';
import { Select } from '../../components/ui/Select.js';
import { VideoBackdrop } from '../../components/auth/VideoBackdrop.js';
import { StoryBars, StoryText, createStory } from '../../components/auth/loginStory.js';
import { LOGIN_CLIPS } from '../../lib/loginMedia.js';

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
  const { login, quickDemoLogin, isLoading, intent, switchBusiness } = useAuth();
  const { system } = useLicense();
  const businesses = system?.businesses || [];
  const signInTo = intent?.shopId ? businesses.find((b) => b.id === intent.shopId)?.name : undefined;
  // The same sign-in works for more than one business on this computer: which one to open
  const [choices, setChoices] = useState<Array<{ id: string; name: string }> | null>(null);
  // An account made on another computer, older than the details kept on the server: what this computer still needs
  const [setup, setSetup] = useState<{ needs: string[]; businessName: string } | null>(null);
  const [setupState, setSetupState] = useState('');
  const [setupCategory, setSetupCategory] = useState('');
  const demoMode = !!system?.demoMode;
  // Which clip of the background story is showing (the player and the words share it; see components/auth/loginStory.tsx)
  const story = useRef(createStory()).current;
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const [resetDone, setResetDone] = useState('');
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
    setChoices(null);
    if (setup && ((setup.needs.includes('state') && !setupState) || (setup.needs.includes('category') && !setupCategory))) {
      setError('Choose the details below to finish setting up this computer.');
      return;
    }
    try {
      await login({ email, password, ...(setup ? { details: { state: setupState || undefined, category: setupCategory || undefined } } : {}) });
    } catch (err: any) {
      if (err.code === 'CHOOSE_BUSINESS' && Array.isArray(err.details?.businesses)) {
        setChoices(err.details.businesses);
        return;
      }
      if (err.code === 'ACCOUNT_DETAILS_NEEDED' && Array.isArray(err.details?.needs)) {
        setSetup({ needs: err.details.needs, businessName: err.details.businessName || 'your business' });
        return;
      }
      setError(err.message || 'Login failed. Please check credentials.');
    }
  };

  const openChosen = async (shopId: string) => {
    setError('');
    try {
      await login({ email, password, shopId });
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
    <div className="relative isolate min-h-screen w-full max-w-full overflow-x-hidden overscroll-none touch-pan-y bg-slate-950 text-white flex items-center justify-center p-4">
      <VideoBackdrop clips={LOGIN_CLIPS} story={story} />
      <div className="absolute top-4 right-4 z-20"><ThemeSwitch /></div>
      <div className="max-w-6xl w-full grid grid-cols-1 md:grid-cols-[1.15fr_1fr] gap-10 lg:gap-16 items-center">

        <div className="space-y-6 min-w-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <Zap className="w-7 h-7 text-white fill-white" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight font-['Outfit'] text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.4)]">
                Apna Billing
              </h1>
              <p className="text-xs text-emerald-300 font-semibold tracking-wide uppercase [text-shadow:0_1px_4px_rgba(0,0,0,0.5)]">
                All-in-One Multi-Category Billing Platform
              </p>
            </div>
          </div>

          <div className="space-y-5 pt-2 md:pt-10">
            <StoryText clips={LOGIN_CLIPS} story={story} />
            <StoryBars clips={LOGIN_CLIPS} story={story} />
          </div>

          {demoMode && <div className="space-y-3 pt-2">
            <div className="text-xs font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
              <span>🚀 1-Click Demo Profiles (Preloaded)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button type="button" onClick={() => quickDemoLogin('grocery')} disabled={isLoading} className="text-left p-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 hover:border-emerald-400/70 transition group shadow-lg shadow-black/10">
                <div className="flex items-center gap-2 mb-1">
                  <ShoppingCart className="w-4 h-4 text-emerald-300 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Apna Supermart</span>
                </div>
                <p className="text-[11px] text-white/70 leading-tight">Grocery & Retail · Barcodes</p>
              </button>

              <button type="button" onClick={() => quickDemoLogin('restaurant')} disabled={isLoading} className="text-left p-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 hover:border-emerald-400/70 transition group shadow-lg shadow-black/10">
                <div className="flex items-center gap-2 mb-1">
                  <UtensilsCrossed className="w-4 h-4 text-emerald-300 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Spice Garden Cafe</span>
                </div>
                <p className="text-[11px] text-white/70 leading-tight">Restaurant · KOT & Tables</p>
              </button>

              <button type="button" onClick={() => quickDemoLogin('pharmacy')} disabled={isLoading} className="text-left p-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 hover:border-emerald-400/70 transition group shadow-lg shadow-black/10">
                <div className="flex items-center gap-2 mb-1">
                  <Pill className="w-4 h-4 text-emerald-300 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Apollo Care Chemist</span>
                </div>
                <p className="text-[11px] text-white/70 leading-tight">Pharmacy · Batches & Expiry</p>
              </button>

              <button type="button" onClick={() => quickDemoLogin('clothing')} disabled={isLoading} className="text-left p-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 hover:border-emerald-400/70 transition group shadow-lg shadow-black/10">
                <div className="flex items-center gap-2 mb-1">
                  <Shirt className="w-4 h-4 text-emerald-300 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Zara Trends Fashion</span>
                </div>
                <p className="text-[11px] text-white/70 leading-tight">Clothing · Size/Color Matrix</p>
              </button>

              <button type="button" onClick={() => quickDemoLogin('manufacturing')} disabled={isLoading} className="text-left p-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 hover:border-emerald-400/70 transition group shadow-lg shadow-black/10">
                <div className="flex items-center gap-2 mb-1">
                  <Factory className="w-4 h-4 text-emerald-300 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Apex Manufacturing</span>
                </div>
                <p className="text-[11px] text-white/70 leading-tight">BOM Recipes · Work Orders</p>
              </button>

              <button type="button" onClick={() => quickDemoLogin('school')} disabled={isLoading} className="text-left p-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 hover:border-emerald-400/70 transition group shadow-lg shadow-black/10">
                <div className="flex items-center gap-2 mb-1">
                  <GraduationCap className="w-4 h-4 text-emerald-300 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Vidyaniketan School</span>
                </div>
                <p className="text-[11px] text-white/70 leading-tight">Students & Fee Collection</p>
              </button>

              <button type="button" onClick={() => quickDemoLogin('admin')} disabled={isLoading} className="col-span-1 sm:col-span-2 text-left p-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 hover:border-emerald-400/70 transition group shadow-lg shadow-black/10">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-4 h-4 text-emerald-300 group-hover:scale-110 transition-transform" />
                  <span className="font-bold text-xs text-white">Platform Super Admin</span>
                </div>
                <p className="text-[11px] text-white/70 leading-tight">SaaS Multi-tenant Control & Plans</p>
              </button>
            </div>
          </div>}
        </div>

        <div className="login-card bg-white/[0.94] dark:bg-slate-900/[0.9] border border-white/40 dark:border-white/10 p-8 rounded-2xl shadow-2xl text-slate-900 dark:text-white">
          <div className="mb-5">
            <h2 className="text-xl font-bold font-['Outfit']">
              {mode === 'signup'
                ? businesses.length ? 'Add a new business' : 'Create your account'
                : signInTo && intent?.mode === 'signin' ? `Sign in to ${signInTo}` : 'Sign in to your business'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {mode === 'signup'
                ? businesses.length
                  ? 'It gets its own data, bills and licence, separate from the businesses already on this computer. Use a different email for it.'
                  : 'Enter basic details first. Next you will choose your business category.'
                : businesses.length > 1
                  ? 'Sign in with the email of the business you want to open.'
                  : setupRequired
                  ? 'Already set up this shop? Sign in below, or switch to Sign Up.'
                  : demoMode
                    ? 'Enter your credentials or click any demo profile'
                    : 'Enter the owner or staff credentials for this computer'}
            </p>
          </div>

          {mode === 'signup' && intent?.mode === 'signup' && intent.shopId && signInTo && (
            <button type="button" onClick={() => switchBusiness(intent.shopId!)}
              className="mb-4 -mt-1 text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
              ← Back to {signInTo}
            </button>
          )}

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

          {resetDone && mode === 'signin' && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-800 dark:text-emerald-200 text-xs rounded-xl">
              {resetDone}
            </div>
          )}
          {forgot && (
            <ForgotPasswordDialog
              initialEmail={email}
              onClose={() => setForgot(false)}
              onDone={(e) => { setForgot(false); setEmail(e); setPassword(''); setResetDone('Your password has been changed. Sign in with the new password.'); }}
            />
          )}

          {mode === 'signin' && businesses.length > 1 && !choices && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span>On this computer:</span>
              {businesses.map((b) => (
                <span key={b.id} className={`rounded-full border px-2 py-0.5 font-semibold ${b.id === intent?.shopId
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{b.name}</span>
              ))}
            </div>
          )}
          {mode === 'signin' && choices && (
            <div className="mb-4 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">This sign-in opens more than one business. Which one?</p>
              <div className="space-y-1.5">
                {choices.map((c) => (
                  <button key={c.id} type="button" disabled={isLoading} onClick={() => void openChosen(c.id)}
                    className="w-full flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition">
                    <span className="truncate">{c.name}</span>
                    <ArrowRight className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === 'signin' && setup && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">Setting up {setup.businessName} on this computer</p>
              <p className="mt-0.5 mb-2 text-[11px] text-slate-500 dark:text-slate-400">Your account was found. Choose these once, then press Sign In again.</p>
              <div className="space-y-2">
                {setup.needs.includes('category') && (
                  <Select value={setupCategory} onChange={(e) => setSetupCategory(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 dark:bg-slate-800/80 dark:border-slate-700 dark:text-white">
                    <option value="">Type of business…</option>
                    {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </Select>
                )}
                {setup.needs.includes('state') && (
                  <Select value={setupState} onChange={(e) => setSetupState(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 dark:bg-slate-800/80 dark:border-slate-700 dark:text-white">
                    <option value="">State of the business (for GST)…</option>
                    {STATE_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                )}
              </div>
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
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">Password</label>
                  <button type="button" onClick={() => { setError(''); setForgot(true); }}
                    className="text-[11px] font-semibold text-emerald-600 hover:underline dark:text-emerald-400">Forgot password?</button>
                </div>
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
