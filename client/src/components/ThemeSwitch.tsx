import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

/** Light / dark control. The active side uses the app's green gradient. */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex items-center rounded-full border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-950/80 p-0.5 shadow-sm" role="group" aria-label="Color theme">
      <button
        type="button"
        onClick={() => setTheme('light')}
        aria-pressed={theme === 'light'}
        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${theme === 'light' ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'}`}
      >
        <Sun className="w-3.5 h-3.5" />
        <span>Light</span>
      </button>
      <button
        type="button"
        onClick={() => setTheme('dark')}
        aria-pressed={theme === 'dark'}
        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${theme === 'dark' ? 'bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
      >
        <Moon className="w-3.5 h-3.5" />
        <span>Dark</span>
      </button>
    </div>
  );
}
