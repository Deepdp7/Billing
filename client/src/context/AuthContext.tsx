import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '../types/index.js';
import { api } from '../lib/api.js';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  register: (data: any) => Promise<void>;
  quickDemoLogin: (type: 'grocery' | 'restaurant' | 'pharmacy' | 'clothing' | 'manufacturing' | 'school' | 'admin') => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  login: async () => {},
  register: async () => {},
  quickDemoLogin: async () => {},
  logout: () => {},
  refreshUser: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('apna_billing_token'));
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    try {
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }
      const res = await api.getMe();
      setUser(res.user);
    } catch (err) {
      console.warn('Session expired or invalid, logging out');
      logout();
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, [token]);

  const login = async (credentials: { email: string; password: string }) => {
    setIsLoading(true);
    try {
      const res = await api.login(credentials);
      localStorage.setItem('apna_billing_token', res.token);
      setToken(res.token);
      setUser(res.user);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (data: any) => {
    setIsLoading(true);
    try {
      const res = await api.registerBusiness(data);
      localStorage.setItem('apna_billing_token', res.token);
      setToken(res.token);
      setUser(res.user);
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

  const logout = () => {
    localStorage.removeItem('apna_billing_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        register,
        quickDemoLogin,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
