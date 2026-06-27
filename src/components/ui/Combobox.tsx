import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface ComboboxOption {
  value: string;
  label: string;
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
          className={`${FIELD_BASE} flex items-center justify-between gap-2 text-left`}
        >
          <span className={`truncate ${selected ? '' : 'text-slate-500'}`}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
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
                        <span className="truncate">{o.label}</span>
                        {value === o.value && <Check className="h-3.5 w-3.5 shrink-0 text-brand-400" />}
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
