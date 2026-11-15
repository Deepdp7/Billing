import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

/**
 * Drop-in replacement for <select>: same props (value, onChange(e) with e.target.value, disabled, required, name,
 * title, className) and the same <option> children, but with a styled popover list, keyboard support and, for long
 * lists, a search box. The `className` you pass styles the closed field exactly as it styled the native select.
 */

interface Opt { value: string; label: string; disabled: boolean }

function text(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (React.isValidElement(node)) return text((node.props as any).children);
  return '';
}

function collect(children: React.ReactNode, out: Opt[] = []): Opt[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const p: any = child.props;
    if (child.type === 'option') {
      const label = text(p.children);
      out.push({ value: p.value !== undefined ? String(p.value) : label, label, disabled: !!p.disabled });
    } else if (child.type === 'optgroup' || child.type === React.Fragment) {
      collect(p.children, out);
    }
  });
  return out;
}

// Layout classes belong on the wrapper (so grids/flex rows treat the select like the native one); the rest style the field.
const OUTER = /^(?:-?m[trblxyse]?-|w-|min-w-|max-w-|flex-|grow|shrink|basis-|col-|row-|self-|justify-self-|order-)/;
function splitClasses(className = '') {
  const outer: string[] = [];
  const inner: string[] = [];
  for (const token of className.split(/\s+/).filter(Boolean)) {
    (OUTER.test(token.replace(/^(?:(?:sm|md|lg|xl|2xl):)+/, '')) ? outer : inner).push(token);
  }
  return { outer: outer.join(' '), inner: inner.join(' ') };
}

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');
const SEARCH_THRESHOLD = 8;

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'defaultValue' | 'multiple'> {
  value?: string | number | null;
  defaultValue?: string | number;
  onChange?: (e: any) => void;
  placeholder?: string;
}

export function Select({ value, defaultValue, onChange, children, className, disabled, required, name, id, title, placeholder = 'Select…', autoFocus, ...aria }: SelectProps) {
  const options = useMemo(() => collect(children), [children]);
  const [uncontrolled, setUncontrolled] = useState(() => String(defaultValue ?? options[0]?.value ?? ''));
  const current = value !== undefined && value !== null ? String(value) : value === null ? '' : uncontrolled;
  const selected = options.find((o) => o.value === current);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const searchable = options.length >= SEARCH_THRESHOLD;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const above = r.top;
    const flip = below < 240 && above > below;
    const maxH = Math.max(140, Math.min(340, (flip ? above : below) - 16));
    const width = Math.max(r.width, 180);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos(flip ? { left, bottom: window.innerHeight - r.top + 6, width, maxH } : { left, top: r.bottom + 6, width, maxH });
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) btnRef.current?.focus();
  }, []);

  const openList = () => {
    if (disabled) return;
    const idx = Math.max(0, options.findIndex((o) => o.value === current));
    setActive(idx);
    setQuery('');
    place();
    setOpen(true);
  };

  const choose = (o: Opt) => {
    if (o.disabled) return;
    if (o.value !== current) {
      if (value === undefined) setUncontrolled(o.value);
      onChange?.({ target: { value: o.value, name }, currentTarget: { value: o.value, name }, type: 'change' });
    }
    close();
  };

  useLayoutEffect(() => {
    if (!open) return;
    (searchable ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) close(false);
    };
    const onScroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) place(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place, close]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, shown]);

  const move = (dir: 1 | -1) => {
    if (!shown.length) return;
    let i = active;
    for (let n = 0; n < shown.length; n++) {
      i = (i + dir + shown.length) % shown.length;
      if (!shown[i].disabled) break;
    }
    setActive(i);
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, shown.length - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) choose(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopPropagation(); close(); } // don't also close a modal underneath
    else if (e.key === 'Tab') close(false);
  };

  const { outer, inner } = splitClasses(className);
  const listId = useMemo(() => `sel-${Math.random().toString(36).slice(2, 9)}`, []);

  return (
    <div className={cx('relative inline-block', outer)}>
      <button
        ref={btnRef}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={aria['aria-label']}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp'].includes(e.key) || ((e.key === 'Enter' || e.key === ' ') && !open)) { e.preventDefault(); if (!open) openList(); }
        }}
        className={cx(inner, 'w-full flex items-center justify-between gap-2 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
          open && 'ring-2 ring-emerald-500/30 border-emerald-500')}
      >
        <span className={cx('truncate', !selected && 'opacity-50')}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className={cx('w-4 h-4 shrink-0 opacity-60 transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {required && (
        // Gives the browser something to validate so `required` still blocks form submit with its usual message.
        <input tabIndex={-1} aria-hidden required value={current} onChange={() => {}} name={name}
          className="absolute left-0 bottom-0 w-full h-px opacity-0 pointer-events-none" />
      )}
      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxH, zIndex: 1100 }}
          className="apna-pop flex flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl shadow-slate-900/15 text-slate-800 dark:text-slate-100"
          onKeyDown={onListKey}
        >
          {searchable && (
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <input ref={searchRef} value={query} placeholder="Search…" onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                className="w-full bg-transparent text-xs outline-none placeholder:text-slate-400" />
            </div>
          )}
          <div ref={listRef} id={listId} role="listbox" tabIndex={-1} className="overflow-y-auto p-1 outline-none">
            {shown.length === 0 && <div className="px-3 py-3 text-xs text-slate-400">No matches</div>}
            {shown.map((o, i) => {
              const isSel = o.value === current;
              return (
                <div
                  key={`${o.value}-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={o.disabled}
                  onMouseEnter={() => !o.disabled && setActive(i)}
                  onClick={() => choose(o)}
                  className={cx('flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer select-none',
                    i === active && !o.disabled && 'bg-emerald-50 dark:bg-emerald-500/15',
                    isSel && 'font-semibold text-emerald-700 dark:text-emerald-400',
                    o.disabled && 'opacity-40 cursor-not-allowed')}
                >
                  <span className="truncate">{o.label || ' '}</span>
                  {isSel && <Check className="w-3.5 h-3.5 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
