import React, { useEffect, useRef, useState } from 'react';
import { ScanBarcode, CheckCircle2, Printer, Cloud, WifiOff, ReceiptIndianRupee, Boxes, MonitorSmartphone } from 'lucide-react';

/**
 * The sign-in screen's showcase: a short, looping story of a sale in Apna Billing — a barcode is scanned, the items
 * drop into the bill, the GST total counts up, it is paid by UPI, the receipt prints and the bill shows on the second
 * counter at once. Drawn in code (sharp on every screen, follows the light / dark theme, a few KB). Slower computers
 * (lite mode) still see the story step by step, without the sliding and the soft glow; "reduce motion" gets the
 * finished picture.
 */

const ITEMS = [
  { name: 'Basmati Rice 5 kg', qty: 1, price: 645 },
  { name: 'Toor Dal 1 kg', qty: 1, price: 168 },
  { name: 'Masala Chai 250 g', qty: 1, price: 120 },
  { name: 'Sunflower Oil 1 L', qty: 1, price: 155 },
];
const SUBTOTAL = ITEMS.reduce((s, i) => s + i.qty * i.price, 0);
const GST = Math.round(SUBTOTAL * 0.05 * 100) / 100;
const TOTAL = SUBTOTAL + GST;

const HEADLINES = ['Bill in seconds.', 'Stock that counts itself.', 'Every counter, always in sync.', 'GST invoices, done right.'];

// The story, one step every STEP_MS: 0 scan, 1-4 items, 5 totals, 6 paid, 7 receipt, 8 synced, then a pause
const STEP_MS = 700;
const LAST_STEP = 8;
const LOOP_STEPS = 14;

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function stillPicture() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Counts up to `target` once `on` turns true */
function useCountUp(target: number, on: boolean, still: boolean) {
  const [value, setValue] = useState(still ? target : 0);
  useEffect(() => {
    if (still) { setValue(target); return; }
    if (!on) { setValue(0); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 650);
      setValue(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, target, still]);
  return value;
}

export const LoginShowcase: React.FC = () => {
  const still = useRef(stillPicture()).current;
  const [step, setStep] = useState(still ? LAST_STEP : 0);
  const [headline, setHeadline] = useState(0);

  useEffect(() => {
    if (still) return;
    let n = 0;
    const timer = window.setInterval(() => {
      if (document.hidden) return; // nothing moves while the window is not shown
      n = (n + 1) % LOOP_STEPS;
      setStep(Math.min(n, LAST_STEP));
      if (n === 0) setHeadline((h) => (h + 1) % HEADLINES.length);
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [still]);

  const total = useCountUp(TOTAL, step >= 5, still);
  const shown = (i: number) => step >= i + 1;
  const reveal = (on: boolean) => `transition-all duration-500 ease-out ${on ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`;
  const restarting = !still && step === 0;

  return (
    <div className="relative select-none" aria-hidden="true">
      {/* Soft colour moving slowly behind */}
      <div className="apna-glow pointer-events-none absolute -inset-10 overflow-hidden">
        <div className="apna-drift absolute -left-6 top-4 h-56 w-56 rounded-full bg-emerald-400/25 blur-3xl dark:bg-emerald-500/20" />
        <div className="apna-drift-slow absolute right-0 top-32 h-64 w-64 rounded-full bg-teal-300/25 blur-3xl dark:bg-teal-500/15" />
        <div className="apna-drift absolute bottom-0 left-24 h-44 w-44 rounded-full bg-sky-300/20 blur-3xl dark:bg-sky-500/10" />
      </div>

      <div className="relative">
        <h2 key={headline} className="apna-headline text-2xl md:text-[28px] font-extrabold tracking-tight font-['Outfit'] text-slate-900 dark:text-white">
          {HEADLINES[headline]}
        </h2>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
          Fast POS billing, GST invoices, live stock and every counter in sync — made for Indian businesses.
        </p>

        <div className="relative mt-6 pr-6 pb-36">
          {/* The billing counter */}
          <div className={`relative rounded-2xl border border-slate-200 bg-white/90 shadow-xl shadow-emerald-900/5 dark:border-slate-700/80 dark:bg-slate-900/85 transition-opacity duration-300 ${restarting ? 'opacity-90' : 'opacity-100'}`}>
            <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
              <span className="ml-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">POS Billing · Counter 1</span>
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                <ScanBarcode className="h-3 w-3" /> Scanner ready
              </span>
            </div>

            <div className="grid grid-cols-[92px_1fr] gap-4 p-4">
              {/* Barcode being scanned */}
              <div className="relative flex h-[92px] items-center justify-center overflow-hidden rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30">
                <div className="flex h-12 items-stretch gap-[2px]">
                  {[2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 1, 3].map((w, i) => (
                    <span key={i} className="bg-slate-800 dark:bg-slate-200" style={{ width: w }} />
                  ))}
                </div>
                {step <= 4 && !still && <span className="apna-scan absolute inset-x-1 h-0.5 rounded bg-rose-500 shadow-[0_0_10px_2px_rgba(244,63,94,0.55)]" />}
              </div>

              {/* The bill filling up */}
              <div className="min-w-0">
                <div className="space-y-1.5">
                  {ITEMS.map((it, i) => (
                    <div key={it.name} className={`flex items-center justify-between rounded-lg px-2 py-1 text-[12px] ${reveal(shown(i))} ${step === i + 1 && !still ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''}`}>
                      <span className="truncate text-slate-700 dark:text-slate-200">{it.name}</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-white">{rupees(it.price)}</span>
                    </div>
                  ))}
                </div>
                <div className={`mt-2 border-t border-slate-100 pt-2 dark:border-slate-800 ${reveal(step >= 5)}`}>
                  <div className="flex justify-between px-2 text-[11px] text-slate-500 dark:text-slate-400"><span>Subtotal</span><span className="font-mono">{rupees(SUBTOTAL)}</span></div>
                  <div className="flex justify-between px-2 text-[11px] text-slate-500 dark:text-slate-400"><span>GST 5% (CGST + SGST)</span><span className="font-mono">{rupees(GST)}</span></div>
                  <div className="mt-1 flex items-center justify-between px-2">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">Total</span>
                    <span className="font-mono text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{rupees(total)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Paid */}
            <div className={`absolute left-4 bottom-5 transition-all duration-300 ${step >= 6 ? 'scale-100 opacity-100 rotate-[-6deg]' : 'scale-150 opacity-0 rotate-0'}`}>
              <span className="inline-flex items-center gap-1 rounded-lg border-2 border-emerald-500 bg-white/90 px-2.5 py-1 text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:bg-slate-900/90 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Paid · UPI
              </span>
            </div>
          </div>

          {/* Receipt printing */}
          <div className={`absolute bottom-0 right-0 w-44 origin-top transition-all duration-700 ease-out ${step >= 7 ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0'}`}>
            <div className="rounded-b-xl rounded-t-sm border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-700 dark:text-slate-200"><Printer className="h-3 w-3" /> TAX INVOICE</div>
              <div className="mt-1 text-[9px] text-slate-400">INV-1042 · {new Date().toLocaleDateString('en-IN')}</div>
              <div className="mt-2 space-y-1">
                {[80, 64, 72, 56].map((w, i) => <div key={i} className="h-1 rounded bg-slate-200 dark:bg-slate-600" style={{ width: `${w}%` }} />)}
              </div>
              <div className="mt-2 flex items-end justify-between">
                <span className="font-mono text-[11px] font-bold text-slate-900 dark:text-white">{rupees(TOTAL)}</span>
                <div className="grid grid-cols-4 gap-px">
                  {[1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0, 1, 0, 1, 1].map((on, i) => <span key={i} className={`h-1.5 w-1.5 ${on ? 'bg-slate-800 dark:bg-slate-200' : 'bg-transparent'}`} />)}
                </div>
              </div>
            </div>
          </div>

          {/* The other counter has it at once */}
          <div className={`absolute left-0 bottom-2 w-56 rounded-xl border bg-white/95 p-3 shadow-lg transition-all duration-500 dark:bg-slate-900/95 ${step >= 8 ? 'border-emerald-300 opacity-100 translate-y-0 dark:border-emerald-700' : 'border-slate-200 opacity-0 translate-y-3 dark:border-slate-700'}`}>
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-[11px] font-bold text-slate-800 dark:text-slate-100">Counter 2</span>
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"><Cloud className="h-3 w-3" /> Synced in 0.2 s</span>
            </div>
            <div className="relative mt-2 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              {!still && <span className="apna-flow absolute inset-y-0 w-10 rounded-full bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />}
            </div>
            <div className="mt-1.5 text-[10px] text-slate-500 dark:text-slate-400">New bill {rupees(TOTAL)} · stock updated</div>
          </div>
        </div>

        {/* What it does, at a glance */}
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { icon: ReceiptIndianRupee, text: 'GST-ready invoices' },
            { icon: Boxes, text: 'Live stock' },
            { icon: Cloud, text: 'Sync across counters' },
            { icon: WifiOff, text: 'Keeps working offline' },
          ].map(({ icon: Icon, text }, i) => (
            <span key={text} className="apna-float inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200"
              style={{ animationDelay: `${i * 0.6}s` }}>
              <Icon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> {text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
