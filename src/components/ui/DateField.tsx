import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { parseDateString, toDateString } from '@/lib/dates';

interface DateFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  /** Allow clearing (filters, optional end dates). */
  optional?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}

const FIELD_BASE =
  'w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-50 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30';

/** First day of the week for the person's locale (0 = Sunday, 1 = Monday). */
function weekStart(): number {
  try {
    const loc = new Intl.Locale(navigator.language) as Intl.Locale & {
      weekInfo?: { firstDay: number };
      getWeekInfo?: () => { firstDay: number };
    };
    const first = loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay;
    return first === undefined ? 0 : first % 7;
  } catch {
    return 0;
  }
}

/** "Today", "Yesterday", "Tomorrow", else "Tue, 13 Oct" (with the year when it isn't this year). */
export function friendlyDate(value: string): string {
  if (!value) return '';
  const today = new Date();
  const d = parseDateString(value);
  const diff = Math.round((d.getTime() - parseDateString(toDateString(today)).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function shiftDays(value: string, n: number): string {
  const d = parseDateString(value);
  d.setDate(d.getDate() + n);
  return toDateString(d);
}

/**
 * A date field that matches the app's theme: a button showing a friendly date,
 * opening a small calendar with Today / Yesterday shortcuts. Replaces the
 * browser's native picker, whose look and colours can't follow our themes.
 */
export function DateField({ value, onChange, label, optional, placeholder = 'Any date', className, id }: DateFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => parseDateString(value || toDateString()));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const place = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 288;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom;
    setPos(below < 360 && r.top > below ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    setView(parseDateString(value || toDateString()));
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!buttonRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
    // Re-seed the visible month only when opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const first = weekStart();
  const today = toDateString();
  const days = useMemo(() => {
    const y = view.getFullYear();
    const m = view.getMonth();
    const lead = (new Date(y, m, 1).getDay() - first + 7) % 7;
    return Array.from({ length: 42 }, (_, i) => new Date(y, m, 1 - lead + i));
  }, [view, first]);
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 7 + ((first + i) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' }),
      ),
    [first],
  );

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  // Arrow keys on the closed field step the date a day at a time.
  const onFieldKey = (e: React.KeyboardEvent) => {
    if (!value || open) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(shiftDays(value, -1));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(shiftDays(value, 1));
    }
  };

  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      {label && (
        <label htmlFor={fieldId} className="block text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </label>
      )}
      <button
        ref={buttonRef}
        id={fieldId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ? undefined : `Date: ${value ? friendlyDate(value) : placeholder}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onFieldKey}
        className={`${FIELD_BASE} flex items-center gap-2 text-left`}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-brand-400" />
        <span className={`truncate ${value ? '' : 'text-slate-500'}`}>{value ? friendlyDate(value) : placeholder}</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label="Choose a date"
            style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: 288 }}
            className="z-[60] rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-semibold text-slate-100">
                {view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {weekdays.map((w, i) => (
                <span key={i} className="py-1 text-[11px] font-medium text-slate-500">
                  {w}
                </span>
              ))}
              {days.map((d) => {
                const v = toDateString(d);
                const inMonth = d.getMonth() === view.getMonth();
                const selected = v === value;
                const isToday = v === today;
                return (
                  <button
                    key={v}
                    type="button"
                    data-date={v}
                    onClick={() => pick(v)}
                    aria-pressed={selected}
                    aria-label={d.toLocaleDateString(undefined, { dateStyle: 'full' })}
                    className={`h-9 rounded-lg text-sm tabular-nums transition ${
                      selected
                        ? 'bg-brand-500 font-semibold text-slate-950'
                        : isToday
                          ? 'font-semibold text-brand-300 ring-1 ring-inset ring-brand-500/60 hover:bg-slate-800'
                          : inMonth
                            ? 'text-slate-200 hover:bg-slate-800'
                            : 'text-slate-600 hover:bg-slate-800'
                    }`}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-800 pt-2">
              <button
                type="button"
                onClick={() => pick(today)}
                className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => pick(shiftDays(today, -1))}
                className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
              >
                Yesterday
              </button>
              {optional && value && (
                <button
                  type="button"
                  onClick={() => pick('')}
                  className="ml-auto rounded-md px-2.5 py-1 text-xs font-medium text-slate-400 hover:text-slate-100"
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** A month stepper ("‹ October 2026 ›") for pages that look at one month at a time. */
export function MonthField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [y, m] = value.split('-').map(Number);
  const step = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const thisMonth = toDateString().slice(0, 7);
  return (
    <div className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/60">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => step(-1)}
        className="rounded-l-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-50"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[8.5rem] px-1 text-center text-sm font-medium text-slate-100" aria-live="polite">
        {label}
      </span>
      <button
        type="button"
        aria-label="Next month"
        onClick={() => step(1)}
        disabled={value >= thisMonth}
        className="rounded-r-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-50 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
