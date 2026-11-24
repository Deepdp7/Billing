import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '../types/index.js';
import { api } from '../lib/api.js';
import { showToast } from '../components/ui/dialogs.js';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  /** True only while the stored session is first being checked (not during login/register requests). */
  initializing: boolean;
  login: (credentials: { email: string; password: string; shopId?: string; details?: { state?: string; category?: string } }) => Promise<void>;
  register: (data: any) => Promise<void>;
  quickDemoLogin: (type: 'grocery' | 'restaurant' | 'pharmacy' | 'clothing' | 'manufacturing' | 'school' | 'admin') => Promise<void>;
  logout: (reason?: 'manual' | 'expired') => void;
  refreshUser: () => Promise<void>;
  /** Opens another business on this computer: at once if it is still signed in here, otherwise its sign-in */
  switchBusiness: (shopId: string) => void;
  /** Leaves this business signed in (to come back to) and opens the sign-up for a new business */
  addBusiness: () => void;
  /** Set by switchBusiness / addBusiness for the sign-in screen */
  intent: { mode: 'signin' | 'signup'; shopId?: string } | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  initializing: true,
  login: async () => {},
  register: async () => {},
  quickDemoLogin: async () => {},
  logout: () => {},
  refreshUser: async () => {},
  switchBusiness: () => {},
  addBusiness: () => {},
  intent: null,
});

// Every business signed in on this computer keeps its session, so switching back needs no password (until it expires)
const SESSIONS = 'apna_billing_sessions';
function sessions(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SESSIONS) || '{}') || {}; } catch { return {}; }
}
function saveSessions(all: Record<string, string>) {
  try { localStorage.setItem(SESSIONS, JSON.stringify(all)); } catch { /* private mode */ }
}
/** The business this window works on; the licence screen and its live updates follow it */
function setCurrentShop(shopId: string) {
  try { localStorage.setItem('apna_billing_shop', shopId); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('apna:shop-changed', { detail: shopId }));
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('apna_billing_token'));
  const [isLoading, setIsLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [intent, setIntent] = useState<AuthContextType['intent']>(null);

  /** Signed in (sign-in, sign-up or switch): this window now works on that business */
  const begin = (newToken: string, shopId: string | undefined, newUser?: User) => {
    const shop = shopId || 'main';
    saveSessions({ ...sessions(), [shop]: newToken });
    localStorage.setItem('apna_billing_token', newToken);
    setCurrentShop(shop);
    setIntent(null);
    setToken(newToken);
    if (newUser) setUser(newUser);
  };

  const refreshUser = async () => {
    try {
      if (!token) {
        setUser(null);
        setIsLoading(false);
        setInitializing(false);
        return;
      }
      const res = await api.getMe();
      setUser(res.user);
      if (res.user?.shopId) {
        saveSessions({ ...sessions(), [res.user.shopId]: token });
        if (localStorage.getItem('apna_billing_shop') !== res.user.shopId) setCurrentShop(res.user.shopId);
      }
    } catch (err) {
      console.warn('Session expired or invalid, logging out');
      logout('expired');
    } finally {
      setIsLoading(false);
      setInitializing(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, [token]);

  useEffect(() => {
    const onData = (e: Event) => {
      const tables: string[] = (e as CustomEvent).detail?.tables || [];
      if (tables.includes('businesses') || tables.includes('users')) void refreshUser();
    };
    window.addEventListener('apna:data-changed', onData);
    return () => window.removeEventListener('apna:data-changed', onData);
  });

  useEffect(() => {
    const onEnded = () => logout('expired');
    window.addEventListener('apna:session-ended', onEnded);
    return () => window.removeEventListener('apna:session-ended', onEnded);
  }, []);

  const login = async (credentials: { email: string; password: string; shopId?: string; details?: { state?: string; category?: string } }) => {
    setIsLoading(true);
    try {
      const res = await api.login(credentials);
      // Signing in could not use the account's licence here: the licence screen says why
      try {
        if (res.licenseJoin?.message) sessionStorage.setItem('apna_license_join', JSON.stringify(res.licenseJoin));
        else sessionStorage.removeItem('apna_license_join');
      } catch { /* storage blocked */ }
      begin(res.token, res.user?.shopId, res.user);
      if (res.newOnThisComputer) {
        showToast('This computer is now one of your devices',
          'Your products, bills, customers, stock and staff are here, and every change on any of your computers now shows on all of them at once.',
          'success', 12000);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (data: any) => {
    setIsLoading(true);
    try {
      const res = await api.registerBusiness(data);
      begin(res.token, res.user?.shopId, res.user);
    } finally {
      setIsLoading(false);
    }
  };

  const quickDemoLogin = async (type: 'grocery' | 'restaurant' | 'pharmacy' | 'clothing' | 'manufacturing' | 'school' | 'admin') => {
    const credsMap = {
      grocery: { email: 'owner@apnasupermart.com', password: 'password123' },
      restaurant: { email: 'manager@spicegarden.com', password: 'password123' },
      pharmacy: { email: 'pharmacist@apollocare.com', password: 'password123' },
      clothing: { email: 'fashion@zaratrends.com', password: 'password123' },
      manufacturing: { email: 'owner@apexindustries.com', password: 'password123' },
      school: { email: 'principal@vidyaniketan.edu', password: 'password123' },
      admin: { email: 'admin@apnabilling.com', password: 'admin123' },
    };

    await login(credsMap[type]);
  };

  /** Signs this business out (other businesses on this computer stay signed in) */
  const logout = (reason: 'manual' | 'expired' = 'manual') => {
    const current = localStorage.getItem('apna_billing_token');
    if (current) api.reportLogout(current, reason === 'expired' ? 'expired' : 'manual');
    saveSessions(Object.fromEntries(Object.entries(sessions()).filter(([, t]) => t !== current)));
    localStorage.removeItem('apna_billing_token');
    setToken(null);
    setUser(null);
  };

  const leave = () => {
    localStorage.removeItem('apna_billing_token');
    setToken(null);
    setUser(null);
  };

  const switchBusiness = (shopId: string) => {
    const saved = sessions()[shopId];
    if (saved) {
      // Checked by /auth/me (refreshUser): an expired session lands on the sign-in screen
      localStorage.setItem('apna_billing_token', saved);
      setCurrentShop(shopId);
      setInitializing(true);
      setToken(saved);
      return;
    }
    leave();
    setCurrentShop(shopId);
    setIntent({ mode: 'signin', shopId });
  };

  const addBusiness = () => {
    const from = user?.shopId || localStorage.getItem('apna_billing_shop') || undefined;
    leave();
    setIntent({ mode: 'signup', shopId: from });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        initializing,
        login,
        register,
        quickDemoLogin,
        logout,
        refreshUser,
        switchBusiness,
        addBusiness,
        intent,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
