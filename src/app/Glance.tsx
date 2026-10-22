import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { CategoryCoin } from '@/components/ui/CategoryCoin';
import { ConvertedMark } from '@/components/ConvertedMark';
import { CategoryDonut, type DonutSlice } from '@/components/charts/CategoryDonut';
import { useQuery } from '@/db/useQuery';
import type { DB } from '@/db/wasm';
import { formatMoney } from '@/lib/money';
import { convert } from '@/lib/fx';
import { categoryStyle } from '@/lib/categoryStyle';
import { distinctColors } from '@/lib/distinctColors';
import { endOfMonth, startOfMonth, toDateString } from '@/lib/dates';
import { useAppSettings } from './AppSettingsProvider';

/**
 * "How am I doing?" at the top of the Dashboard: what came in, what went out,
 * how that compares, and where the money went. Counts expenses and income up
 * to today only — transfers between your own accounts and scheduled future
 * entries are left out.
 */

type Period = 'month' | 'last-month' | 'year' | 'all';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

// Categories named in the list; the rest share one grey slice.
const TOP = 5;

interface Range {
  from: string;
  to: string;
}

interface Ranges {
  current: Range;
  /** The same stretch one step earlier, to compare with. */
  previous: Range | null;
  /** How the comparison reads, e.g. "this time last month". */
  previousLabel: string;
}

/** The same day of the month `n` months away, clamped to that month's length. */
function shiftMonths(d: Date, n: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), endOfMonth(first).getDate()));
}

function rangesFor(period: Period, today: Date): Ranges {
  const t = toDateString(today);
  if (period === 'month') {
    const prev = shiftMonths(today, -1);
    return {
      current: { from: toDateString(startOfMonth(today)), to: t },
      previous: { from: toDateString(startOfMonth(prev)), to: toDateString(prev) },
      previousLabel: 'this time last month',
    };
  }
  if (period === 'last-month') {
    const last = shiftMonths(today, -1);
    const before = shiftMonths(today, -2);
    return {
      current: { from: toDateString(startOfMonth(last)), to: toDateString(endOfMonth(last)) },
      previous: { from: toDateString(startOfMonth(before)), to: toDateString(endOfMonth(before)) },
      previousLabel: 'the month before',
    };
  }
  if (period === 'year') {
    const y = today.getFullYear();
    return {
      current: { from: `${y}-01-01`, to: t },
      previous: { from: `${y - 1}-01-01`, to: `${y - 1}${t.slice(4)}` },
      previousLabel: 'this time last year',
    };
  }
  return { current: { from: '', to: t }, previous: null, previousLabel: '' };
}

interface Row {
  kind: 'expense' | 'income';
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  currency: string;
  total: number;
  first_on: string;
}

const sumSql = (byCategory: boolean) => `
  SELECT t.kind AS kind, ${byCategory ? 't.category_id' : 'NULL'} AS category_id,
         ${byCategory ? 'c.name' : 'NULL'} AS category_name, ${byCategory ? 'c.icon' : 'NULL'} AS category_icon,
         ${byCategory ? 'c.color' : 'NULL'} AS category_color,
         a.currency AS currency, SUM(ABS(t.amount_minor)) AS total, MIN(t.occurred_on) AS first_on
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  ${byCategory ? 'LEFT JOIN categories c ON c.id = t.category_id' : ''}
  WHERE t.kind IN ('expense', 'income') AND t.occurred_on >= ? AND t.occurred_on <= ?
  GROUP BY t.kind, ${byCategory ? 't.category_id, ' : ''}a.currency`;

/** Whole months from `from` to `to`, counting both ends (at least 1). */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);
}

export function Glance() {
  const [period, setPeriod] = useState<Period>('month');
  const { defaultCurrency: currency, fxRates } = useAppSettings();
  const [activeSlice, setActiveSlice] = useState<string | null>(null);
  const ranges = useMemo(() => rangesFor(period, new Date()), [period]);

  const deps = ['transactions', 'categories', 'accounts'];
  const current = useQuery<Row[]>(
    useCallback(
      (db: DB) => db.execO<Row>(sumSql(true), [ranges.current.from, ranges.current.to]),
      [ranges],
    ),
    { deps, cacheKey: `glance:${period}` },
  );
  const previous = useQuery<Row[]>(
    useCallback(
      (db: DB) =>
        ranges.previous
          ? db.execO<Row>(sumSql(false), [ranges.previous.from, ranges.previous.to])
          : Promise.resolve([]),
      [ranges],
    ),
    { deps, cacheKey: `glance-prev:${period}` },
  );

  const toMain = useCallback(
    (r: Row) => convert(r.total, r.currency, currency, currency, fxRates),
    [currency, fxRates],
  );

  const summary = useMemo(() => {
    const rows = current.data ?? [];
    let spent = 0;
    let earned = 0;
    let firstOn = '';
    const byCategory = new Map<string, { id: string; name: string; icon: string | null; color: string | null; total: number }>();
    for (const r of rows) {
      const v = toMain(r);
      if (!firstOn || r.first_on < firstOn) firstOn = r.first_on;
      if (r.kind === 'income') {
        earned += v;
        continue;
      }
      spent += v;
      const id = r.category_id ?? 'none';
      const c = byCategory.get(id) ?? {
        id,
        name: r.category_name ?? 'Uncategorized',
        icon: r.category_icon,
        color: r.category_color,
        total: 0,
      };
      c.total += v;
      byCategory.set(id, c);
    }
    const categories = [...byCategory.values()].sort((a, b) => b.total - a.total);
    let prevSpent = 0;
    for (const r of previous.data ?? []) if (r.kind === 'expense') prevSpent += toMain(r);
    return { spent, earned, net: earned - spent, categories, prevSpent, firstOn };
  }, [current.data, previous.data, toMain]);

  const slices = useMemo<DonutSlice[]>(() => {
    const { categories } = summary;
    const top = categories.slice(0, categories.length > TOP + 1 ? TOP : TOP + 1);
    const rest = categories.slice(top.length);
    // Neighbouring categories can share a colour; keep slices tellable apart.
    const colors = distinctColors(
      top.map((c) => categoryStyle(c.name, c.color, c.icon).color),
      rest.length > 0 ? ['#94a3b8'] : [],
    );
    const out: DonutSlice[] = top.map((c, i) => ({
      id: c.id,
      label: c.name,
      value: c.total,
      color: colors[i],
    }));
    if (rest.length > 0) {
      out.push({ id: 'rest', label: `${rest.length} more`, value: rest.reduce((s, c) => s + c.total, 0), color: '#94a3b8' });
    }
    return out;
  }, [summary]);

  const loading = current.data === null;
  const { spent, earned, net, categories, prevSpent, firstOn } = summary;

  // One plain sentence: how this compares, or the monthly average for all time.
  let comparison: { text: string; good: boolean | null } | null = null;
  if (!loading && ranges.previous && previous.data && (spent > 0 || prevSpent > 0)) {
    const diff = spent - prevSpent;
    comparison =
      prevSpent === 0
        ? { text: `Nothing spent ${ranges.previousLabel}`, good: null }
        : Math.abs(diff) < prevSpent * 0.01
          ? { text: `Spent about the same as ${ranges.previousLabel}`, good: null }
          : {
              text: `Spent ${formatMoney(Math.abs(diff), currency)} ${diff < 0 ? 'less' : 'more'} than ${ranges.previousLabel}`,
              good: diff < 0,
            };
  } else if (!loading && period === 'all' && spent > 0 && firstOn) {
    comparison = {
      text: `About ${formatMoney(Math.round(spent / monthsBetween(firstOn, ranges.current.to)), currency)} a month on average`,
      good: null,
    };
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-300">At a glance</h3>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={period === p.id}
              onClick={() => setPeriod(p.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                period === p.id ? 'bg-brand-500 text-slate-950' : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div role="status" className="mt-4 space-y-3 motion-safe:animate-pulse">
          <span className="sr-only">Loading…</span>
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-slate-800" />
            ))}
          </div>
          <div className="h-32 rounded-lg bg-slate-800/70" />
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-3">
            <Figure label="Spent" minor={spent} currency={currency} className="text-clay-400" />
            <Figure label="Earned" minor={earned} currency={currency} className="text-mint-400" />
            <Figure
              label="Net"
              minor={net}
              currency={currency}
              signed
              className={net < 0 ? 'text-clay-400' : 'text-slate-50'}
            />
          </dl>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
            {comparison && (
              <span
                className={
                  comparison.good === true ? 'text-mint-400' : comparison.good === false ? 'text-clay-400' : ''
                }
              >
                {comparison.text}
              </span>
            )}
            <ConvertedMark currencies={(current.data ?? []).map((r) => r.currency)} target={currency} />
          </div>

          {categories.length === 0 ? (
            <p className="mt-5 text-sm text-slate-400">No spending in this period yet.</p>
          ) : (
            <div className="mt-5 grid items-center gap-5 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <div className="mx-auto w-40 sm:w-full">
                <CategoryDonut
                  slices={slices}
                  total={spent}
                  currency={currency}
                  activeId={activeSlice}
                  onActiveChange={setActiveSlice}
                />
              </div>
              <ul className="space-y-1">
                {slices.map((s) => {
                  const c = categories.find((x) => x.id === s.id);
                  const pct = spent > 0 ? (s.value / spent) * 100 : 0;
                  return (
                    <li
                      key={s.id}
                      onPointerEnter={() => setActiveSlice(s.id)}
                      onPointerLeave={() => setActiveSlice(null)}
                      className={`flex items-center gap-3 rounded-lg px-2 py-1.5 transition ${
                        activeSlice === s.id ? 'bg-slate-800/70' : ''
                      }`}
                    >
                      {c ? (
                        <CategoryCoin name={c.name} color={c.color} icon={c.icon} size="sm" />
                      ) : (
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs text-slate-400">
                          +{categories.length - TOP}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate text-slate-50">{s.label}</span>
                          <span className="shrink-0 tabular-nums text-slate-200">{formatMoney(s.value, currency)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-slate-800">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                          </div>
                          <span className="w-9 text-right text-xs tabular-nums text-slate-500">
                            {pct > 0 && pct < 1 ? '<1' : pct.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
                <li className="px-2 pt-1">
                  <Link to="/reports" className="inline-flex items-center gap-1 text-xs text-brand-400 hover:underline">
                    All categories in Reports <ArrowRight className="h-3 w-3" />
                  </Link>
                </li>
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Figure({
  label,
  minor,
  currency,
  signed,
  className,
}: {
  label: string;
  minor: number;
  currency: string;
  signed?: boolean;
  className: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-0.5 truncate font-display text-base font-semibold tabular-nums sm:text-xl ${className}`}>
        {formatMoney(minor, currency, { signed })}
      </dd>
    </div>
  );
}
