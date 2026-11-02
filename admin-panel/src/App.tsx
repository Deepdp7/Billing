import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  LayoutDashboard, Users, MonitorSmartphone, Hourglass, BadgeIndianRupee, Layers, ToggleRight, BarChart3, History,
  PauseCircle, CalendarX, Megaphone, ScrollText, Settings, UserCog, LogOut, Zap, KeyRound,
  Eye, EyeOff, ArrowRight, Radio, Building2,
} from 'lucide-react';
import { api, post, session, setUnauthorizedHandler } from './api';
import { Button, cx } from './components/ui';
import { OverviewPage } from './pages/Overview';
import { CustomersPage, CustomerDetail } from './pages/Customers';
import { LicensesPage, LicenseDetail } from './pages/Licenses';
import { InstallationsPage, InstallationDetail } from './pages/Installations';
import { PlansPage } from './pages/Plans';
import { FeaturesPage } from './pages/Features';
import { UsagePage } from './pages/Usage';
import { EventsPage, NoticesPage, AuditPage, SettingsPage, AdminUsersPage, SecurityPage } from './pages/Admin';
import { LiveFeed } from './live';
import { ThemeSwitch } from './theme';

export type Role = 'OWNER' | 'ADMIN' | 'SUPPORT' | 'VIEWER';
export interface Admin { id: string; email: string; name: string; role: Role; totpEnabled: boolean }
export interface Route { page: string; id?: string; params?: Record<string, string> }

const RANK: Record<Role, number> = { VIEWER: 0, SUPPORT: 1, ADMIN: 2, OWNER: 3 };

interface Ctx { admin: Admin; nav: (page: string, id?: string, params?: Record<string, string>) => void; can: (r: Role) => boolean }
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

const NAV: Array<{ page: string; label: string; icon: any; min?: Role; group: string }> = [
  { page: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Monitor' },
  { page: 'customers', label: 'Customers', icon: Users, group: 'Monitor' },
  { page: 'installations', label: 'Installations', icon: MonitorSmartphone, group: 'Monitor' },
  { page: 'usage', label: 'Feature Usage', icon: BarChart3, group: 'Monitor' },
  { page: 'trials', label: 'Trial Licenses', icon: Hourglass, group: 'Licensing' },
  { page: 'paid', label: 'Paid Licenses', icon: BadgeIndianRupee, group: 'Licensing' },
  { page: 'suspended', label: 'Suspended', icon: PauseCircle, group: 'Licensing' },
  { page: 'expired', label: 'Expired', icon: CalendarX, group: 'Licensing' },
  { page: 'events', label: 'Activation History', icon: History, group: 'Licensing' },
  { page: 'plans', label: 'Subscription Plans', icon: Layers, group: 'Control' },
  { page: 'features', label: 'Feature Permissions', icon: ToggleRight, group: 'Control' },
  { page: 'notices', label: 'Notifications', icon: Megaphone, group: 'Control' },
  { page: 'audit', label: 'Audit Logs', icon: ScrollText, min: 'ADMIN', group: 'System' },
  { page: 'settings', label: 'System Settings', icon: Settings, group: 'System' },
  { page: 'admins', label: 'Admin Users', icon: UserCog, min: 'OWNER', group: 'System' },
  { page: 'security', label: 'My Security', icon: KeyRound, group: 'System' },
];

function readRoute(): Route {
  const [page, id] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { page: page || 'overview', id: id || undefined };
}

function Login({ onDone }: { onDone: (a: Admin) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter the email and password for this console.');
      return;
    }
    if (needTotp && totp.length < 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await post<{ token: string; admin: Admin }>('/auth/login', { email, password, totp: needTotp ? totp : undefined });
      session.set(r.token);
      onDone(r.admin);
    } catch (err: any) {
      if (err.code === 'TOTP_REQUIRED') setNeedTotp(true);
      else setError(err.message || 'Sign-in failed. Check the license server and try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-screen grid md:grid-cols-[1.05fr_0.95fr] bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white">
      <aside className="relative flex flex-col justify-between gap-8 overflow-hidden px-8 py-8 md:px-12 md:py-10 bg-gradient-to-br from-indigo-700 via-indigo-900 to-slate-950 text-white">
        <div className="pointer-events-none absolute -top-24 -left-16 h-72 w-72 rounded-full bg-indigo-300/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-violet-400/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30">
            <Zap className="h-5 w-5 fill-white" />
          </div>
          <div>
            <div className="font-['Outfit'] text-lg font-extrabold tracking-tight">Apna Billing</div>
            <div className="text-xs text-indigo-100/80">License console</div>
          </div>
        </div>
        <div className="relative max-w-md space-y-6">
          <h1 className="font-['Outfit'] text-4xl font-extrabold leading-tight">Control every shop from one desk.</h1>
          <p className="text-sm leading-relaxed text-indigo-50/80">Issue licenses, lock a feature on an open billing screen, and sign a computer out the moment you remove it.</p>
          <ul className="space-y-3 text-sm">
            {[
              { icon: Building2, text: 'Customers, plans, and paid or trial licenses' },
              { icon: Radio, text: 'Feature changes reach the shop while it is open' },
              { icon: MonitorSmartphone, text: 'Deactivate a computer and its session ends' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/20"><Icon className="h-4 w-4" /></span>
                <span className="text-indigo-50">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-indigo-100/70">Owner, admin, and support accounts only. Shop staff sign in on the billing app.</p>
      </aside>

      <main className="relative flex items-center justify-center px-5 py-10">
        <div className="absolute right-4 top-4"><ThemeSwitch /></div>
        <form noValidate onSubmit={submit} className="w-full max-w-md space-y-5">
          <div>
            <h2 className="font-['Outfit'] text-2xl font-extrabold text-slate-900 dark:text-white">{needTotp ? 'Confirm it’s you' : 'Sign in'}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {needTotp ? 'This account uses an authenticator. Enter the current 6-digit code.' : 'Use the email and password created for this console.'}
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
              <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-rose-300" />
              <span>{error}</span>
            </div>
          )}

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Email</span>
            <input
              type="email"
              autoComplete="username"
              autoFocus={!needTotp}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@yourcompany.com"
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-600 dark:focus:border-indigo-400"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Password</span>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your console password"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 pr-11 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-600 dark:focus:border-indigo-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 dark:hover:text-white"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          {needTotp && (
            <label className="block rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-200">Authenticator code</span>
              <input
                inputMode="numeric"
                autoFocus
                maxLength={6}
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full rounded-xl border border-indigo-200 bg-white px-3.5 py-3 text-center font-['Outfit'] text-2xl tracking-[0.4em] text-slate-900 outline-none focus:border-indigo-400 dark:border-indigo-500/30 dark:bg-slate-950 dark:text-white"
              />
              <span className="mt-2 block text-xs text-indigo-700/80 dark:text-indigo-100/70">Open your authenticator app and type the code before it expires.</span>
            </label>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-900/40 transition hover:from-indigo-400 hover:to-violet-400 disabled:opacity-60"
          >
            {busy ? 'Signing in…' : needTotp ? 'Verify and open console' : 'Sign in to console'}
            {!busy && <ArrowRight className="h-4 w-4" />}
          </button>
          <p className="text-center text-xs text-slate-500">This sign-in stays in this window and ends when you close it.</p>
        </form>
      </main>
    </div>
  );
}

export function App() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [checking, setChecking] = useState(true);
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    setUnauthorizedHandler(() => setAdmin(null));
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    if (session.get()) {
      api<{ admin: Admin }>('GET', '/auth/me').then((r) => setAdmin(r.admin)).catch(() => session.clear()).finally(() => setChecking(false));
    } else setChecking(false);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (checking) return <div className="min-h-screen flex items-center justify-center bg-slate-100 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">Loading…</div>;
  if (!admin) return <Login onDone={setAdmin} />;

  const nav = (page: string, id?: string, params?: Record<string, string>) => {
    window.location.hash = `/${page}${id ? `/${id}` : ''}`;
    setRoute({ page, id, params });
    window.scrollTo(0, 0);
  };
  const can = (r: Role) => RANK[admin.role] >= RANK[r];
  const logout = async () => {
    try { await post('/auth/logout'); } catch { /* session may already be gone */ }
    session.clear();
    setAdmin(null);
  };

  const { page, id } = route;
  let content: React.ReactNode;
  switch (page) {
    case 'customers': content = id ? <CustomerDetail id={id} /> : <CustomersPage />; break;
    case 'installations': content = id ? <InstallationDetail id={id} /> : <InstallationsPage />; break;
    case 'licenses': content = id ? <LicenseDetail id={id} /> : <LicensesPage preset="all" />; break;
    case 'trials': content = <LicensesPage preset="trials" />; break;
    case 'paid': content = <LicensesPage preset="paid" />; break;
    case 'suspended': content = <LicensesPage preset="suspended" />; break;
    case 'expired': content = <LicensesPage preset="expired" />; break;
    case 'plans': content = <PlansPage />; break;
    case 'features': content = <FeaturesPage />; break;
    case 'usage': content = <UsagePage />; break;
    case 'events': content = <EventsPage />; break;
    case 'notices': content = <NoticesPage />; break;
    case 'audit': content = <AuditPage />; break;
    case 'settings': content = <SettingsPage />; break;
    case 'admins': content = <AdminUsersPage />; break;
    case 'security': content = <SecurityPage />; break;
    default: content = <OverviewPage />;
  }
  const activePage = page === 'licenses' ? 'paid' : page;
  const groups = [...new Set(NAV.map((n) => n.group))];

  return (
    <AppCtx.Provider value={{ admin, nav, can }}>
      <div className="flex h-full min-h-0 bg-slate-100 dark:bg-slate-950">
        <aside className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="h-14 flex items-center gap-2.5 px-4 border-b border-slate-200 dark:border-slate-800">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white"><Zap className="w-4 h-4 fill-white" /></div>
            <div>
              <div className="font-extrabold text-sm text-slate-900 dark:text-white font-['Outfit']">Apna Billing</div>
              <div className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-300 uppercase tracking-wider">License Admin</div>
            </div>
          </div>
          <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
            {groups.map((g) => (
              <div key={g} className="space-y-0.5">
                <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{g}</div>
                {NAV.filter((n) => n.group === g && (!n.min || can(n.min))).map((n) => {
                  const Icon = n.icon;
                  const active = activePage === n.page;
                  return (
                    <button key={n.page} onClick={() => nav(n.page)}
                      className={cx('w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition',
                        active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}>
                      <Icon className={cx('w-4 h-4', active ? 'text-white' : 'text-slate-400 dark:text-slate-500')} />{n.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="p-3 border-t border-slate-200 dark:border-slate-800">
            <ThemeSwitch className="mb-3 w-full justify-center" />
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{admin.name}</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{admin.email} · {admin.role}</div>
            <Button tone="ghost" onClick={logout} className="mt-2 w-full"><LogOut className="w-3.5 h-3.5" />Sign out</Button>
          </div>
        </aside>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-100 p-6 dark:bg-slate-950">{content}</main>
      </div>
      <LiveFeed onUnauthorized={() => { session.clear(); setAdmin(null); }} />
    </AppCtx.Provider>
  );
}
