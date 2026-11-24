import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Palette, ImagePlus, Trash2, Check, QrCode, Landmark, PenLine, Eye, Stamp } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { A4Invoice } from '../../components/billing/A4Invoice.js';
import { DigitalStamp, STAMP_PX, stampDate } from '../../components/billing/DigitalStamp.js';
import { BRAND_COLORS, Branding, STAMP_INKS, STAMP_WORDS, preparePicture } from '../../lib/branding.js';

/** An A4 page's width on screen (210 mm at 96 dpi) */
const SHEET_WIDTH = 794;

/** A few choices side by side, like one segmented button */
const Choice = <T extends string>({ value, options, disabled, onChange }: {
  value: T; options: Array<[T, string]>; disabled: boolean; onChange: (v: T) => void;
}) => (
  <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800">
    {options.map(([v, label]) => (
      <button key={v} type="button" disabled={disabled} onClick={() => onChange(v)}
        className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition disabled:opacity-60 ${value === v ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
        {label}
      </button>
    ))}
  </div>
);

const input = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60';

/** One picture (logo, signature, stamp): pick or drop a file, see it, remove it */
const PicturePicker: React.FC<{
  label: string; hint: string; value: string | null; disabled: boolean; box: string;
  prepare: (f: File) => Promise<string>; onChange: (v: string | null) => void; onError: (m: string) => void;
}> = ({ label, hint, value, disabled, box, prepare, onChange, onError }) => {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const take = async (f: File | undefined) => {
    if (!f || disabled) return;
    setBusy(true);
    try { onChange(await prepare(f)); onError(''); } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</div>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files?.[0]); }}
        className={`flex items-center gap-3 rounded-xl border-2 border-dashed p-3 transition ${over ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-700'}`}
      >
        {/* A checkered backdrop shows which parts of the picture are transparent */}
        <div className={`${box} shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden bg-[length:12px_12px] bg-[linear-gradient(45deg,#f1f5f9_25%,transparent_25%,transparent_75%,#f1f5f9_75%),linear-gradient(45deg,#f1f5f9_25%,#fff_25%,#fff_75%,#f1f5f9_75%)] bg-[position:0_0,6px_6px]`}>
          {value ? <img src={value} alt="" className="max-w-full max-h-full object-contain" /> : <ImagePlus className="w-5 h-5 text-slate-300" />}
        </div>
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
          <div className="flex gap-2">
            <button type="button" disabled={disabled || busy} onClick={() => file.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 dark:bg-slate-700 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-700 disabled:opacity-50">
              <ImagePlus className="w-3.5 h-3.5" />{busy ? 'Preparing…' : value ? 'Change' : 'Upload'}
            </button>
            {value && (
              <button type="button" disabled={disabled} onClick={() => onChange(null)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50">
                <Trash2 className="w-3.5 h-3.5" />Remove
              </button>
            )}
          </div>
        </div>
        <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/bmp"
          onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </div>
  );
};

/** Logo & branding: how the shop's bills (A4 and receipt) and the app look */
export const BrandingSettings: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const canEdit = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';
  const [b, setB] = useState<Branding | null>(null);
  const [saved, setSaved] = useState<Branding | null>(null);
  const [business, setBusiness] = useState<any>(null);
  const [prefs, setPrefs] = useState<any>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  // The preview is the real A4 sheet at its real width, shrunk to whatever space the page has
  const frame = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.5);
  const loaded = !!b;
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const fit = () => setZoom(Math.min(1, el.clientWidth / SHEET_WIDTH));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  useEffect(() => {
    api.getBranding().then((r) => { setB(r.branding); setSaved(r.branding); }).catch((e) => setError(e.message));
    api.getBusinessProfile().then((r) => setBusiness(r.business)).catch(() => {});
    api.getBusinessSettings().then((r) => setPrefs(r.settings)).catch(() => {});
  }, []);

  const set = <K extends keyof Branding>(k: K, v: Branding[K]) => setB((cur) => (cur ? { ...cur, [k]: v } : cur));
  const dirty = !!b && !!saved && JSON.stringify(b) !== JSON.stringify(saved);

  // A sample bill with part of it still due, so the UPI code and bank details show in the preview
  const sample = useMemo(() => {
    if (!b) return null;
    const line = (name: string, qty: number, price: number, rate: number, hsn: string) => {
      const taxable = qty * price;
      const tax = Math.round((taxable * rate) / 100);
      return { product_name: name, sku: '', hsn_code: hsn, quantity: qty, unit: 'pcs', unit_price_paise: price, discount_paise: 0,
        taxable_paise: taxable, tax_paise: tax, tax_rate: rate, cgst_paise: Math.floor(tax / 2), sgst_paise: tax - Math.floor(tax / 2), total_paise: taxable + tax };
    };
    const items = [line('Sample product', 2, 45000, 18, '8471'), line('Another item', 1, 12000, 5, '4901')];
    const subtotal = items.reduce((s, i) => s + i.taxable_paise, 0);
    const tax = items.reduce((s, i) => s + i.tax_paise, 0);
    const total = subtotal + tax;
    return {
      id: 'preview', invoice_number: `${business?.invoice_prefix || 'INV-'}1001`, invoice_date: new Date().toISOString().slice(0, 10),
      status: 'ISSUED', payment_status: 'PARTIAL', payment_mode: 'CASH', customer_name: 'Customer Name', customer_phone: '98XXXXXX10',
      subtotal_paise: subtotal, discount_paise: 0, cgst_paise: items.reduce((s, i) => s + i.cgst_paise, 0), sgst_paise: items.reduce((s, i) => s + i.sgst_paise, 0),
      igst_paise: 0, total_paise: total, amount_paid_paise: Math.round(total / 2), items,
      business: { ...(business || { name: user?.businessName }), logo_url: b.logo }, branding: b,
      footer: prefs?.invoiceFooter, terms: prefs?.invoiceTerms,
    } as any;
  }, [b, business, prefs, user?.businessName]);

  const save = async () => {
    if (!b || !saved) return;
    setSaving(true);
    try {
      // Only what changed is sent (pictures are large)
      const changes = Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== (saved as any)[k]).map(([k, v]) => [k, v ?? '']));
      const r = await api.updateBranding(changes as Partial<Branding>);
      setB(r.branding);
      setSaved(r.branding);
      setError('');
      setMsg('Branding saved. Every bill from now on, and old bills you open again, use it.');
      setTimeout(() => setMsg(''), 5000);
      if ('logo' in changes) await refreshUser();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!b) return error ? <div className="text-xs text-red-600">{error}</div> : null;
  const off = !canEdit;
  const toggle = (key: 'showUpiQr' | 'showBank' | 'logoOnReceipt' | 'stampDate' | 'stampOnReceipt', label: string, hint: string) => (
    <label className="flex items-start gap-2.5 text-xs">
      <input type="checkbox" className="mt-0.5" disabled={off} checked={b[key]} onChange={(e) => set(key, e.target.checked)} />
      <span><span className="font-semibold text-slate-800 dark:text-slate-200">{label}</span><span className="block text-slate-500">{hint}</span></span>
    </label>
  );
  const field = (key: keyof Branding, label: string, placeholder = '', mono = false) => (
    <label className="text-xs space-y-1 block"><span className="font-semibold text-slate-700 dark:text-slate-300">{label}</span>
      <input disabled={off} value={(b[key] as string) || ''} placeholder={placeholder} onChange={(e) => set(key, e.target.value as any)} className={`${input} ${mono ? 'font-mono' : ''}`} /></label>
  );

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
      <div>
        <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2"><Palette className="w-4 h-4 text-emerald-600" />Logo &amp; Branding</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Your logo, colour, signature and payment details on every bill (A4 and receipt), in the PDF, and in the app. Saved with your shop
          and sent to your other computers on this account.
        </p>
        {off && <p className="mt-2 text-xs text-amber-600">Only the business owner can change the branding.</p>}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-5">
          <PicturePicker label="Logo" box="w-20 h-20" value={b.logo} disabled={off} onError={setError} onChange={(v) => set('logo', v)}
            hint="PNG, JPG, WebP or SVG. A transparent PNG looks best. Resized for you."
            prepare={(f) => preparePicture(f, 512, 512)} />

          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Brand colour</div>
            <div className="flex flex-wrap items-center gap-2">
              {BRAND_COLORS.map((c) => (
                <button key={c} type="button" disabled={off} onClick={() => set('color', c)} aria-label={`Colour ${c}`}
                  className={`w-7 h-7 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-slate-900 transition ${b.color.toLowerCase() === c ? 'ring-2 ring-slate-900 dark:ring-white' : ''}`}
                  style={{ background: c }}>
                  {b.color.toLowerCase() === c && <Check className="w-4 h-4 text-white mx-auto" />}
                </button>
              ))}
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
                <input type="color" disabled={off} value={b.color} onChange={(e) => set('color', e.target.value)} className="w-8 h-7 rounded cursor-pointer bg-transparent" />
                Custom <span className="font-mono">{b.color}</span>
              </label>
            </div>
            <p className="text-[11px] text-slate-500">Used for the bill's top line, title, total and thank-you line.</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {field('tagline', 'Tagline / slogan', 'Quality you can trust')}
            {field('website', 'Website or Instagram', 'www.myshop.in')}
          </div>

          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><PenLine className="w-3.5 h-3.5" />Signature &amp; stamp</div>
            <PicturePicker label="Authorised signature" box="w-28 h-14" value={b.signature} disabled={off} onError={setError} onChange={(v) => set('signature', v)}
              hint="Sign on white paper and take a photo. The white paper is removed for you."
              prepare={(f) => preparePicture(f, 600, 240, true)} />
          </div>

          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><Stamp className="w-3.5 h-3.5" />Digital stamp</div>
            <div className="flex flex-wrap items-start gap-4">
              <div className="space-y-2 min-w-0 flex-1">
                <Choice value={b.stampMode} disabled={off} onChange={(v) => set('stampMode', v)}
                  options={[['off', 'No stamp'], ['seal', 'Round seal'], ['image', 'My stamp picture']]} />
                <p className="text-[11px] text-slate-500">
                  {b.stampMode === 'seal' ? 'Drawn for you like a rubber stamp: your shop name round the top, your city round the bottom, a word in the middle.'
                    : b.stampMode === 'image' ? 'Your own rubber stamp, scanned or photographed, pressed on the bill in stamp-pad ink.'
                    : 'Bills are printed without a stamp.'}
                </p>
              </div>
              {/* the stamp as it will look beside the signature */}
              {b.stampMode !== 'off' && (
                <div className="shrink-0 w-[140px] h-[140px] rounded-xl border border-slate-200 bg-white flex items-center justify-center">
                  <DigitalStamp brand={b} businessName={business?.name || user?.businessName || ''} place={[business?.city, business?.state].filter(Boolean).join(', ')}
                    date={stampDate(new Date().toISOString())} size={STAMP_PX.signature[b.stampSize]} strength={b.stampStrength / 100} />
                </div>
              )}
            </div>

            {b.stampMode === 'image' && (
              <PicturePicker label="Your stamp picture" box="w-16 h-16" value={b.stamp} disabled={off} onError={setError}
                onChange={(v) => set('stamp', v)}
                hint="A photo or scan of your rubber stamp on white paper. The paper is removed and the stamp is printed in the ink you pick."
                prepare={(f) => preparePicture(f, 400, 400, true)} />
            )}

            {b.stampMode === 'seal' && (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  {field('stampTop', 'Round the top', business?.name || 'Your shop name')}
                  {field('stampBottom', 'Round the bottom', [business?.city, business?.state].filter(Boolean).join(', ') || 'City, State')}
                </div>
                <div className="space-y-1.5">
                  {field('stampCenter', 'In the middle', 'AUTHORISED')}
                  <div className="flex flex-wrap gap-1.5">
                    {STAMP_WORDS.map((w) => (
                      <button key={w} type="button" disabled={off} onClick={() => set('stampCenter', w)}
                        className={`px-2 py-0.5 rounded-md border text-[10px] font-bold tracking-wide disabled:opacity-60 ${b.stampCenter.toUpperCase() === w ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}>
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
                {toggle('stampDate', "Put the bill's date in the seal", 'Like a date stamp: every bill shows its own date.')}
              </div>
            )}

            {b.stampMode !== 'off' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Ink</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {STAMP_INKS.map(({ ink, name }) => (
                      <button key={ink} type="button" disabled={off} onClick={() => set('stampInk', ink)} title={name} aria-label={`${name} ink`}
                        className={`w-7 h-7 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-slate-900 ${b.stampInk.toLowerCase() === ink ? 'ring-2 ring-slate-900 dark:ring-white' : ''}`}
                        style={{ background: ink }}>
                        {b.stampInk.toLowerCase() === ink && <Check className="w-4 h-4 text-white mx-auto" />}
                      </button>
                    ))}
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
                      <input type="color" disabled={off} value={b.stampInk.startsWith('#') ? b.stampInk : '#1e3a8a'} onChange={(e) => set('stampInk', e.target.value)} className="w-8 h-7 rounded cursor-pointer bg-transparent" />
                      Custom
                    </label>
                    {b.stampMode === 'image' && (
                      <button type="button" disabled={off} onClick={() => set('stampInk', 'original')}
                        className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold disabled:opacity-60 ${b.stampInk === 'original' ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}>
                        Picture's own colours
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Where</div>
                    <Choice value={b.stampPlace} disabled={off} onChange={(v) => set('stampPlace', v)}
                      options={[['signature', 'By the signature'], ['watermark', 'Watermark']]} />
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Size</div>
                    <Choice value={b.stampSize} disabled={off} onChange={(v) => set('stampSize', v)}
                      options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]} />
                  </div>
                </div>
                <label className="block text-xs space-y-1">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Ink strength <span className="font-normal text-slate-500">{b.stampStrength}%</span></span>
                  <input type="range" min={20} max={100} step={5} disabled={off} value={b.stampStrength}
                    onChange={(e) => set('stampStrength', Number(e.target.value))} className="w-full accent-emerald-600" />
                  <span className="block text-[11px] text-slate-500">
                    {b.stampPlace === 'watermark' ? 'A watermark is always printed faint, behind the bill, so every word stays readable.' : 'Lower looks like a lightly pressed stamp.'}
                  </span>
                </label>
                {toggle('stampOnReceipt', 'Also stamp receipts (80 mm)', 'Printed in black, small, above the thank-you line.')}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><QrCode className="w-3.5 h-3.5" />UPI payments</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {field('upiId', 'UPI ID', 'myshop@okaxis', true)}
              {field('upiPayee', 'Name shown in the UPI app', business?.name || 'Shop name')}
            </div>
            {toggle('showUpiQr', 'Print a "Scan to pay" QR code on bills', 'Only on bills with money still due, for exactly that amount. Any UPI app (GPay, PhonePe, Paytm) can pay it.')}
          </div>

          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><Landmark className="w-3.5 h-3.5" />Bank details (A4 bills)</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {field('bankAccountName', 'Account holder name')}
              {field('bankAccountNumber', 'Account number', '', true)}
              {field('bankIfsc', 'IFSC', 'SBIN0001234', true)}
              {field('bankName', 'Bank name', 'State Bank of India')}
              {field('bankBranch', 'Branch')}
            </div>
            {toggle('showBank', 'Print bank details on A4 bills', 'For customers who pay by bank transfer (NEFT / IMPS / RTGS).')}
          </div>

          <div className="space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Receipt (80 mm)</div>
            {toggle('logoOnReceipt', 'Print the logo on receipts', 'Receipt printers print it in grey tones.')}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" />Preview (A4 bill)</div>
          <div className="rounded-xl bg-slate-100 dark:bg-slate-950/50 p-3 overflow-hidden lg:sticky lg:top-4">
            <div ref={frame} className="w-full">
            <div className="pointer-events-none select-none" style={{ zoom, width: SHEET_WIDTH }}>
              {sample && <A4Invoice invoice={sample} />}
            </div>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}
      {canEdit && (
        <div className="flex items-center gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
          <button onClick={save} disabled={saving || !dirty}
            className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Branding'}
          </button>
          {dirty && !saving && <button onClick={() => setB(saved)} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Undo changes</button>}
          {msg && <span className="text-xs text-emerald-600 flex items-center gap-1"><Check className="w-3.5 h-3.5" />{msg}</span>}
        </div>
      )}
    </div>
  );
};
