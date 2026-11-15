import React, { useState } from 'react';
import { KeyRound, Lock, Mail, X } from 'lucide-react';
import { api } from '../../lib/api.js';

const inputCls =
  'w-full bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl pl-10 pr-4 py-2.5 text-xs focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition';

/**
 * Forgot password: a 6-digit code is emailed to the sign-in email (sent by Apna Billing's server), then the code and
 * a new password set it on this computer. Needs the internet. Closes with ✕ or Cancel only.
 */
export function ForgotPasswordDialog({ initialEmail, onClose, onDone }: {
  initialEmail: string;
  onClose: () => void;
  onDone: (email: string) => void;
}) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api.forgotPassword(email.trim());
      setInfo(`We sent a 6-digit code to ${email.trim()}. It works for ${r.minutes} minutes. Check the spam folder too.`);
      setStep('code');
    } catch (err: any) {
      setError(err?.message || 'Could not send the code. Check the internet connection.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('The new password needs at least 8 characters.');
    if (password !== again) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      await api.resetPassword({ email: email.trim(), code: code.trim(), password });
      onDone(email.trim());
    } catch (err: any) {
      setError(err?.message || 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="forgot-title"
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full flex items-center justify-center bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
              <KeyRound className="w-4 h-4" />
            </div>
            <h2 id="forgot-title" className="text-sm font-bold text-slate-900 dark:text-white">Reset your password</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 'email' ? (
          <form onSubmit={sendCode} className="p-5 space-y-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Enter the email you sign in with. We will email you a code to set a new password.
            </p>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input type="email" required autoFocus placeholder="owner@business.com" value={email}
                onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </div>
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={busy || !email.trim()} className="btn-brand px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-60">
                {busy ? 'Sending…' : 'Send code'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={reset} className="p-5 space-y-3">
            {info && <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg p-2.5">{info}</p>}
            <input inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={6} placeholder="6-digit code" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full bg-white dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl px-4 py-2.5 text-center text-lg font-bold tracking-[0.5em] focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500" />
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input type="password" required minLength={8} placeholder="New password (8+ characters)" value={password}
                onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input type="password" required placeholder="New password again" value={again}
                onChange={(e) => setAgain(e.target.value)} className={inputCls} />
            </div>
            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex items-center justify-between gap-2 pt-1">
              <button type="button" disabled={busy} onClick={() => { setCode(''); void sendCode(); }}
                className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400 disabled:opacity-60">Send a new code</button>
              <button type="submit" disabled={busy || code.length !== 6} className="btn-brand px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-60">
                {busy ? 'Saving…' : 'Set new password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
