import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Shown before the label, in the field and the list (e.g. an account's icon). */
  icon?: ReactNode;
  /** Muted text on the right of the row (e.g. an account's balance). */
  hint?: string;
}

interface ComboboxProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  emptyOption?: ComboboxOption;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Large field with a small caption inside, for the one choice a screen hinges on. */
  size?: 'md' | 'lg';
  caption?: string;
  /** Accessible name when there's no visible label. */
  ariaLabel?: string;
}

const FIELD_BASE =
  'w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30 disabled:opacity-60';

export function Combobox({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  emptyOption,
  disabled,
  id,
  className,
  size = 'md',
  caption,
  ariaLabel,
}: ComboboxProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The menu is rendered in a portal with fixed positioning so it can escape a
  // scrollable/clipping ancestor (e.g. a modal) and open up or down to fit.
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  } | null>(null);

  const updatePosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const gap = 4;
    const vh = window.innerHeight;
    const spaceBelow = vh - r.bottom - gap - 8;
    const spaceAbove = r.top - gap - 8;
    // Prefer opening downward unless it's cramped and there's more room above.
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    if (openUp) {
      setPos({ left: r.left, width: r.width, bottom: vh - r.top + gap, maxHeight: spaceAbove });
    } else {
      setPos({ left: r.left, width: r.width, top: r.bottom + gap, maxHeight: spaceBelow });
    }
  }, []);

  const allOptions = useMemo(
    () => (emptyOption ? [emptyOption, ...options] : options),
    [emptyOption, options],
  );
  const selected = allOptions.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter((o) => o.label.toLowerCase().includes(q));
  }, [allOptions, query]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!containerRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  // Keep the portalled menu glued to the trigger as the page/modal scrolls.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[highlight] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlight((h) => Math.max(h - 1, 0));
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const opt = filtered[highlight];
      if (opt) choose(opt.value);
      e.preventDefault();
    }
  };

  return (
    <div className={`space-y-1 ${className ?? ''}`} ref={containerRef}>
      {label && (
        <label htmlFor={fieldId} className="block text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </label>
      )}
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          id={fieldId}
          disabled={disabled}
          onClick={() => !disabled && setOpen((o) => !o)}
          aria-label={ariaLabel}
          className={
            size === 'lg'
              ? 'flex w-full items-center gap-3 rounded-xl border border-brand-500/40 bg-brand-500/10 px-3 py-2.5 text-left transition hover:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40 disabled:opacity-60'
              : `${FIELD_BASE} flex items-center justify-between gap-2 text-left`
          }
        >
          {size === 'lg' ? (
            <>
              {selected?.icon && <span className="shrink-0">{selected.icon}</span>}
              <span className="min-w-0 flex-1">
                {caption && (
                  <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    {caption}
                  </span>
                )}
                <span className={`block truncate text-base font-semibold ${selected ? 'text-slate-50' : 'text-slate-500'}`}>
                  {selected?.label ?? placeholder}
                </span>
              </span>
              {selected?.hint && (
                <span className="shrink-0 text-xs tabular-nums text-slate-400">{selected.hint}</span>
              )}
              <ChevronDown className="h-4 w-4 shrink-0 text-brand-400" />
            </>
          ) : (
            <>
              <span className={`flex min-w-0 items-center gap-2 ${selected ? '' : 'text-slate-500'}`}>
                {selected?.icon && <span className="shrink-0">{selected.icon}</span>}
                <span className="truncate">{selected?.label ?? placeholder}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
            </>
          )}
        </button>
        {open &&
          pos &&
          createPortal(
            <div
              ref={menuRef}
              style={{
                position: 'fixed',
                left: pos.left,
                width: pos.width,
                top: pos.top,
                bottom: pos.bottom,
                maxHeight: pos.maxHeight,
              }}
              className="z-[60] flex flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl"
            >
              <div className="shrink-0 border-b border-slate-800 p-2">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKey}
                  placeholder="Search…"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-400 focus:outline-none"
                />
              </div>
              <ul ref={listRef} className="min-h-0 flex-1 overflow-auto py-1">
                {filtered.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-slate-500">No matches</li>
                ) : (
                  filtered.map((o, i) => (
                    <li key={o.value || '__empty'}>
                      <button
                        type="button"
                        onClick={() => choose(o.value)}
                        onMouseEnter={() => setHighlight(i)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${
                          i === highlight ? 'bg-slate-800 text-slate-50' : 'text-slate-200'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {o.icon && <span className="shrink-0">{o.icon}</span>}
                          <span className="truncate">{o.label}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {o.hint && <span className="text-xs tabular-nums text-slate-500">{o.hint}</span>}
                          {value === o.value && <Check className="h-3.5 w-3.5 text-brand-400" />}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}
