import React, { useState } from 'react';
import { AlertTriangle, Check, Copy, Info } from 'lucide-react';
import type { SessionNotice } from '../../context/LicenseContext.js';

interface Props {
  notice: SessionNotice | null | undefined;
  className?: string;
}

export const SessionNoticeBanner: React.FC<Props> = ({ notice, className = '' }) => {
  const [copied, setCopied] = useState(false);
  if (!notice) return null;

  const copyPath = async () => {
    if (!notice.backupFile) return;
    try {
      await navigator.clipboard.writeText(notice.backupFile);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked in some webviews */
    }
  };

  return (
    <div
      role="status"
      className={`rounded-2xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/35 text-amber-950 dark:text-amber-50 p-4 shadow-sm ${className}`}
    >
      <div className="flex gap-3">
        <div className="shrink-0 w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 flex items-center justify-center">
          <AlertTriangle className="w-4.5 h-4.5 w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h3 className="text-sm font-bold text-amber-950 dark:text-amber-50">{notice.title}</h3>
            <p className="text-xs text-amber-900/80 dark:text-amber-100/80 leading-relaxed mt-1">
              {notice.body}
            </p>
          </div>

          {notice.backupFile && (
            <div className="rounded-xl border border-amber-200/80 dark:border-amber-800/50 bg-white/70 dark:bg-slate-950/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700/80 dark:text-amber-300/80">
                  Safety backup
                </span>
                <button
                  type="button"
                  onClick={copyPath}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200 hover:text-amber-950 dark:hover:text-white transition"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy path'}
                </button>
              </div>
              <p className="font-mono text-[11px] leading-relaxed break-all text-slate-700 dark:text-slate-300">
                {notice.backupFile}
              </p>
            </div>
          )}

          {notice.hint && (
            <div className="flex items-start gap-2 text-xs text-amber-900/75 dark:text-amber-100/75">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{notice.hint}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
