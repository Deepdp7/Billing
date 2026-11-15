import React, { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api, type ProductOptions } from '../../lib/api.js';
import { confirmDialog, showAlert } from '../../components/ui/dialogs.js';

/**
 * Products → Categories & Units: the shop's categories, units and GST rates. Every entry can be added, renamed or deleted;
 * each shows how many products use it. Deleting never deletes products (they keep their unit / rate, or become
 * uncategorised).
 */
export type ListTab = 'categories' | 'units' | 'gst';

interface Props {
  tab: ListTab;
  onTab: (t: ListTab) => void;
  onClose: () => void;
  categories: { id: string; name: string; product_count?: number }[];
  options: ProductOptions;
  onOptions: (o: ProductOptions) => void;
  /** Categories changed: the page reloads them */
  onCategoriesChanged: () => Promise<void> | void;
}

const input = 'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white';
const iconBtn = 'shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100';

const used = (n: number) => (
  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
    {n} product{n === 1 ? '' : 's'}
  </span>
);

export function CatalogListsManager({ tab, onTab, onClose, categories, options, onOptions, onCategoriesChanged }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ a: '', b: '' });
  const [adding, setAdding] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setEditing(null);
    } catch (err: any) {
      await showAlert(err.message || 'That did not work', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const unitsBody = (list: { value: string; label: string }[]) => list.map(({ value, label }) => ({ value, label }));
  const switchTab = (t: ListTab) => { onTab(t); setEditing(null); setAdding({ a: '', b: '' }); };

  // ---- Categories
  const saveCategory = (id: string) => run(async () => {
    if (!draft.a.trim()) throw new Error('Type a name for the category');
    await api.updateCategory(id, { name: draft.a.trim() });
    await onCategoriesChanged();
  });
  const deleteCategory = async (c: Props['categories'][number]) => {
    const n = c.product_count || 0;
    if (!(await confirmDialog(n ? `Delete "${c.name}"? Its ${n} product${n === 1 ? '' : 's'} stay, without a category.` : `Delete "${c.name}"?`,
      { title: 'Delete category', danger: true, confirmText: 'Delete' }))) return;
    await run(async () => { await api.deleteCategory(c.id); await onCategoriesChanged(); });
  };
  const addCategory = () => run(async () => {
    if (!adding.a.trim()) throw new Error('Type a name for the category');
    await api.createCategory({ name: adding.a.trim() });
    setAdding({ a: '', b: '' });
    await onCategoriesChanged();
  });

  // ---- Units (a renamed short name takes its products along)
  const saveUnit = (from: string) => run(async () => {
    const value = draft.a.trim();
    if (!value) throw new Error('Type the short name of the unit (e.g. box)');
    const units = options.units.map((u) => (u.value === from ? { value, label: draft.b.trim() || value } : u));
    onOptions(await api.saveProductOptions({ units: unitsBody(units), renameUnit: value !== from ? { from, to: value } : undefined }));
  });
  const deleteUnit = async (u: ProductOptions['units'][number]) => {
    if (!(await confirmDialog(u.products ? `Remove "${u.label}" from the list? Its ${u.products} product${u.products === 1 ? '' : 's'} keep this unit.` : `Remove "${u.label}" from the list?`,
      { title: 'Remove unit', danger: true, confirmText: 'Remove' }))) return;
    await run(async () => onOptions(await api.saveProductOptions({ units: unitsBody(options.units.filter((x) => x.value !== u.value)) })));
  };
  const addUnit = () => run(async () => {
    const value = adding.a.trim();
    if (!value) throw new Error('Type the short name of the unit (e.g. carton)');
    if (options.units.some((u) => u.value.toLowerCase() === value.toLowerCase())) throw new Error(`"${value}" is already in the list`);
    onOptions(await api.saveProductOptions({ units: [...unitsBody(options.units), { value, label: adding.b.trim() || value }] }));
    setAdding({ a: '', b: '' });
  });

  // ---- GST rates
  const rates = () => options.gstRates.map((r) => Number(r.rate));
  const rateOk = (s: string) => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 100;
  const saveRate = (from: string) => run(async () => {
    if (!rateOk(draft.a)) throw new Error('GST must be a number from 0 to 100');
    onOptions(await api.saveProductOptions({ gstRates: options.gstRates.map((r) => (r.rate === from ? Number(draft.a) : Number(r.rate))) }));
  });
  const deleteRate = async (r: ProductOptions['gstRates'][number]) => {
    if (!(await confirmDialog(r.products ? `Remove ${r.rate}% from the list? Its ${r.products} product${r.products === 1 ? '' : 's'} keep this rate.` : `Remove ${r.rate}% from the list?`,
      { title: 'Remove GST rate', danger: true, confirmText: 'Remove' }))) return;
    await run(async () => onOptions(await api.saveProductOptions({ gstRates: options.gstRates.filter((x) => x.rate !== r.rate).map((x) => Number(x.rate)) })));
  };
  const addRate = () => run(async () => {
    if (!rateOk(adding.a)) throw new Error('GST must be a number from 0 to 100');
    onOptions(await api.saveProductOptions({ gstRates: [...rates(), Number(adding.a)] }));
    setAdding({ a: '', b: '' });
  });

  const editButtons = (key: string, save: () => void, start: () => void, remove: () => void) => (
    editing === key ? (
      <>
        <button type="button" title="Save" disabled={busy} onClick={save} className={`${iconBtn} text-emerald-600 dark:text-emerald-400`}><Check className="h-4 w-4" /></button>
        <button type="button" title="Cancel" onClick={() => setEditing(null)} className={iconBtn}><X className="h-4 w-4" /></button>
      </>
    ) : (
      <>
        <button type="button" title="Rename" disabled={busy} onClick={start} className={iconBtn}><Pencil className="h-3.5 w-3.5" /></button>
        <button type="button" title="Delete" disabled={busy} onClick={remove} className={`${iconBtn} hover:!text-rose-600`}><Trash2 className="h-3.5 w-3.5" /></button>
      </>
    )
  );
  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };

  return (
    <div className="fixed inset-0 z-[1010] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Categories, Units & GST Rates</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Add, rename or delete the categories, units and GST rates your products use.</p>
          </div>
          <button type="button" onClick={onClose} className={iconBtn} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex gap-1 border-b border-slate-100 px-5 pt-3 dark:border-slate-800">
          {([['categories', `Categories (${categories.length})`], ['units', `Units (${options.units.length})`], ['gst', `GST rates (${options.gstRates.length})`]] as [ListTab, string][]).map(([t, label]) => (
            <button key={t} type="button" onClick={() => switchTab(t)}
              className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold transition ${tab === t ? 'border-emerald-500 text-emerald-700 dark:text-emerald-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-5 py-3">
          {tab === 'categories' && categories.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              {editing === c.id
                ? <input autoFocus className={input} value={draft.a} onChange={(e) => setDraft({ ...draft, a: e.target.value })} onKeyDown={onEnter(() => saveCategory(c.id))} />
                : <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">{c.name}</span>}
              {editing !== c.id && used(c.product_count || 0)}
              {editButtons(c.id, () => saveCategory(c.id), () => { setEditing(c.id); setDraft({ a: c.name, b: '' }); }, () => deleteCategory(c))}
            </div>
          ))}

          {tab === 'units' && options.units.map((u) => (
            <div key={u.value} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              {editing === u.value ? (
                <>
                  <input autoFocus className={`${input} w-24 font-mono`} value={draft.a} maxLength={20} placeholder="short" onChange={(e) => setDraft({ ...draft, a: e.target.value })} onKeyDown={onEnter(() => saveUnit(u.value))} />
                  <input className={input} value={draft.b} maxLength={40} placeholder="Shown as" onChange={(e) => setDraft({ ...draft, b: e.target.value })} onKeyDown={onEnter(() => saveUnit(u.value))} />
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">{u.label}</span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">{u.value}</span>
                  {used(u.products)}
                </>
              )}
              {editButtons(u.value, () => saveUnit(u.value), () => { setEditing(u.value); setDraft({ a: u.value, b: u.label }); }, () => deleteUnit(u))}
            </div>
          ))}

          {tab === 'gst' && options.gstRates.map((r) => (
            <div key={r.rate} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              {editing === r.rate
                ? <input autoFocus type="number" min={0} max={100} step="0.01" className={`${input} font-mono`} value={draft.a} onChange={(e) => setDraft({ ...draft, a: e.target.value })} onKeyDown={onEnter(() => saveRate(r.rate))} />
                : <span className="min-w-0 flex-1 font-mono text-sm text-slate-800 dark:text-slate-100">{r.rate === '0' ? '0% (Nil)' : `${r.rate}%`}</span>}
              {editing !== r.rate && used(r.products)}
              {editButtons(r.rate, () => saveRate(r.rate), () => { setEditing(r.rate); setDraft({ a: r.rate, b: '' }); }, () => deleteRate(r))}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
          {tab === 'categories' && (
            <input className={input} value={adding.a} placeholder="New category, e.g. Cold Drinks" onChange={(e) => setAdding({ ...adding, a: e.target.value })} onKeyDown={onEnter(addCategory)} />
          )}
          {tab === 'units' && (
            <>
              <input className={`${input} w-28 font-mono`} value={adding.a} maxLength={20} placeholder="e.g. carton" onChange={(e) => setAdding({ ...adding, a: e.target.value })} onKeyDown={onEnter(addUnit)} />
              <input className={input} value={adding.b} maxLength={40} placeholder="Shown as (optional)" onChange={(e) => setAdding({ ...adding, b: e.target.value })} onKeyDown={onEnter(addUnit)} />
            </>
          )}
          {tab === 'gst' && (
            <input type="number" min={0} max={100} step="0.01" className={`${input} font-mono`} value={adding.a} placeholder="New rate, e.g. 1.5" onChange={(e) => setAdding({ ...adding, a: e.target.value })} onKeyDown={onEnter(addRate)} />
          )}
          <button type="button" disabled={busy} onClick={tab === 'categories' ? addCategory : tab === 'units' ? addUnit : addRate}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60">
            <Plus className="h-3.5 w-3.5" />Add
          </button>
        </div>
      </div>
    </div>
  );
}
