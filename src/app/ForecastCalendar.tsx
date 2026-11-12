import { useMemo, useState } from 'react';
import type { CardBill } from '@/features/creditCards/statementEngine';
import { formatMoney, fromMinor } from '@/lib/money';
import { parseDateString, toDateString } from '@/lib/dates';
import type { ForecastEntry } from './Cashflow';

interface DayItem {
  label: string;
  /** null for a card bill whose amount only the bank's statement knows. */
  amount: number | null;
}

interface Props {
  /** The forecast, starting with today's balance. */
  entries: ForecastEntry[];
  /** Unpaid card bills; ones the forecast already has a payment for aren't repeated. */
  bills: CardBill[];
  currency: string;
  /** The last day the forecast covers. */
  end: string;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** −₹12.5K: short enough for a day cell on a phone. */
function compact(minor: number, currency: string): string {
  const n = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Math.abs(fromMinor(minor, currency)));
  return `${minor < 0 ? '−' : '+'}${n}`;
}

/** The forecast laid out by month: what's coming on which day, and the balance after it. */
export function ForecastCalendar({ entries, bills, currency, end }: Props) {
  const today = entries[0]?.date ?? toDateString();

  const days = useMemo(() => {
    const map = new Map<string, { items: DayItem[]; net: number }>();
    for (const e of entries.slice(1)) {
      const day = map.get(e.date) ?? { items: [], net: 0 };
      day.items.push({ label: e.label, amount: e.amount });
      day.net += e.amount;
      map.set(e.date, day);
    }
    for (const bill of bills) {
      if (!bill.dueDate || bill.dueDate > end) continue;
      if (entries.some((e) => e.cardId === bill.account.id && e.date === bill.dueDate)) continue;
      const day = map.get(bill.dueDate) ?? { items: [], net: 0 };
      day.items.push({ label: `${bill.account.name} bill due`, amount: null });
      map.set(bill.dueDate, day);
    }
    return map;
  }, [entries, bills, end]);

  // Balance at the end of each day from today on, carried over quiet days.
  const balanceOn = useMemo(() => {
    const sorted = entries.slice(1);
    return (date: string) => {
      let bal = entries[0]?.balance ?? 0;
      for (const e of sorted) {
        if (e.date > date) break;
        bal = e.balance;
      }
      return bal;
    };
  }, [entries]);

  const firstBusy = [...days.keys()].filter((d) => d >= today).sort()[0];
  const [selected, setSelected] = useState<string>(firstBusy ?? today);

  const months = useMemo(() => {
    const out: { year: number; month: number }[] = [];
    const start = parseDateString(today);
    const last = parseDateString(end);
    for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= last; d.setMonth(d.getMonth() + 1)) {
      out.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return out;
  }, [today, end]);

  const startsPositive = (entries[0]?.balance ?? 0) >= 0;
  const picked = days.get(selected);
  const inRange = (date: string) => date >= today && date <= end;

  return (
    <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-6 lg:space-y-0">
      <div className="space-y-5">
      {months.map(({ year, month }) => {
        const first = new Date(year, month, 1);
        const lead = (first.getDay() + 6) % 7; // Monday first
        const count = new Date(year, month + 1, 0).getDate();
        const cells: (string | null)[] = [
          ...Array<null>(lead).fill(null),
          ...Array.from({ length: count }, (_, i) => toDateString(new Date(year, month, i + 1))),
        ];
        return (
          <section key={`${year}-${month}`} aria-label={first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
            <h4 className="mb-2 font-display text-sm font-semibold text-slate-200">
              {first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </h4>
            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((w) => (
                <div key={w} className="pb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  {w}
                </div>
              ))}
              {cells.map((date, i) => {
                if (!date) return <div key={`pad-${i}`} />;
                const day = days.get(date);
                const live = inRange(date);
                const hasBill = day?.items.some((it) => it.amount === null);
                // Marks where the balance dips below zero; already below today, every day
                // would be marked (the warning above says so instead).
                const negative = live && startsPositive && balanceOn(date) < 0;
                const isSelected = date === selected;
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setSelected(date)}
                    aria-pressed={isSelected}
                    aria-label={`${parseDateString(date).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}${
                      day ? `, ${day.items.length} ${day.items.length === 1 ? 'item' : 'items'}` : ''
                    }`}
                    className={`relative flex min-h-[3.25rem] flex-col items-center rounded-lg border px-0.5 pb-1 pt-1.5 transition ${
                      isSelected
                        ? 'border-brand-500 bg-brand-500/10'
                        : negative
                          ? 'border-transparent bg-danger/10'
                          : date === today
                            ? 'border-slate-600 bg-slate-900/60'
                            : 'border-transparent hover:border-slate-700'
                    } ${live || day ? '' : 'opacity-40'}`}
                  >
                    <span className={`text-xs tabular-nums ${date === today ? 'font-semibold text-slate-50' : 'text-slate-300'}`}>
                      {parseDateString(date).getDate()}
                    </span>
                    {day && day.net !== 0 && (
                      <span
                        className={`mt-0.5 max-w-full truncate text-[10px] font-medium tabular-nums ${
                          day.net < 0 ? 'text-clay-400' : 'text-mint-400'
                        }`}
                      >
                        {compact(day.net, currency)}
                      </span>
                    )}
                    {hasBill && (
                      <span
                        aria-hidden
                        className={`mt-auto h-1.5 w-1.5 rounded-full ${date < today ? 'bg-danger' : 'bg-warning'}`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 lg:sticky lg:top-4" aria-live="polite">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h4 className="text-sm font-semibold text-slate-100">
            {parseDateString(selected).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h4>
          {inRange(selected) && (
            <span className="whitespace-nowrap text-xs text-slate-500">
              Balance after:{' '}
              <span className={`font-semibold tabular-nums ${balanceOn(selected) < 0 ? 'text-clay-400' : 'text-slate-200'}`}>
                {formatMoney(balanceOn(selected), currency)}
              </span>
            </span>
          )}
        </div>
        {picked ? (
          <ul className="mt-2 divide-y divide-slate-800">
            {picked.items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-slate-200">{it.label}</span>
                {it.amount === null ? (
                  <span className={`shrink-0 text-xs ${selected < today ? 'text-danger' : 'text-warning'}`}>
                    {selected < today ? 'Overdue · not paid yet' : 'Amount on your statement'}
                  </span>
                ) : (
                  <span className={`shrink-0 tabular-nums ${it.amount < 0 ? 'text-clay-400' : 'text-mint-400'}`}>
                    {formatMoney(it.amount, currency, { signed: true })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Nothing planned for this day.</p>
        )}
      </div>
    </div>
  );
}
