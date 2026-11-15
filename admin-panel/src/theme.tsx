import React, { createContext, useContext, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { desktop } from './lib/desktop';

export type Theme = 'light' | 'dark';
const KEY = 'apna_admin_theme';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({ theme: 'light', setTheme: () => {} });

/** The Admin app hands over the theme it saved on disk (<html data-apna-theme>); a browser uses its own storage */
export function readTheme(): Theme {
  const saved = document.documentElement.dataset.apnaTheme;
  if (saved === 'dark' || saved === 'light') return saved;
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.apnaTheme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  desktop.saveTheme(theme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  return <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Light / dark control. The active side uses the console's indigo gradient. */
export function ThemeSwitch({ className = '' }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className={`flex items-center rounded-full border border-slate-200 bg-white/90 p-0.5 shadow-sm dark:border-slate-700 dark:bg-slate-950/80 ${className}`} role="group" aria-label="Color theme">
      <button
        type="button"
        onClick={() => setTheme('light')}
        aria-pressed={theme === 'light'}
        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${theme === 'light' ? 'bg-gradient-to-r from-indigo-600 to-violet-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'}`}
      >
        <Sun className="h-3.5 w-3.5" />
        <span>Light</span>
      </button>
      <button
        type="button"
        onClick={() => setTheme('dark')}
        aria-pressed={theme === 'dark'}
        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${theme === 'dark' ? 'bg-gradient-to-r from-indigo-600 to-violet-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
      >
        <Moon className="h-3.5 w-3.5" />
        <span>Dark</span>
      </button>
    </div>
  );
}
