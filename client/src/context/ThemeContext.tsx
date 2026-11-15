import React, { createContext, useContext, useEffect, useState } from 'react';
import { desktop } from '../lib/desktop';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  toggleTheme: () => {},
  setTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // The desktop app's saved theme (on disk) first, then this window's storage
  const [theme, setThemeState] = useState<Theme>(() => {
    const fromApp = document.documentElement.dataset.apnaTheme;
    if (fromApp === 'dark' || fromApp === 'light') return fromApp;
    try { return localStorage.getItem('apna_billing_theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.dataset.apnaTheme = theme;
    try { localStorage.setItem('apna_billing_theme', theme); } catch { /* private mode */ }
    desktop.saveTheme(theme);
  }, [theme]);

  const toggleTheme = () => {
    setThemeState(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
