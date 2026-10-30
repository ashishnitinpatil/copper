import { useCallback, useMemo, useState } from 'react';
import { PageShell } from './PageShell';
import { Card, EmptyState, LoadingRows } from '@/components/ui/Card';
import { InfoHint } from '@/components/ui/InfoHint';
import { ConvertedMark } from '@/components/ConvertedMark';
import { useQuery } from '@/db/useQuery';
import type { DB } from '@/db/wasm';
import { formatMoney } from '@/lib/money';
import { convert } from '@/lib/fx';
import { toDateString } from '@/lib/dates';
import {
  periodComparison, periodLabel, periodStart, precedingSpan, stepPeriod, type PeriodUnit, type Span,
} from '@/lib/reportPeriods';
import { categoryStyle } from '@/lib/categoryStyle';
import { distinctColors } from '@/lib/distinctColors';
import { useAppSettings } from './AppSettingsProvider';
import { CashflowTrendChart } from '@/components/charts/CashflowTrendChart';
import { CategoryDonut, type DonutSlice } from '@/components/charts/CategoryDonut';
import { CategoryCoin } from '@/components/ui/CategoryCoin';
import { DateField } from '@/components/ui/DateField';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CategorySpend {
  category_id: string;
  category_name: string;
  category_icon: string | null;
  category_color: string | null;
  total: number;
}

interface MonthlyRow {
  month: string;
  expenses: number;
  income: number;
}

// Raw rows are grouped by account currency so the component can convert each
// slice into the default currency before summing (see lib/fx).
interface CategorySpendRow {
  category_id: string;
  category_name: string;
  category_icon: string | null;
  category_color: string | null;
  currency: string;
  total: number;
}

interface MonthlyRowRaw {
  month: string;
  kind: string;
  currency: string;
  total: number;
}

type ReportTab = 'category' | 'monthly';
type PeriodChoice = PeriodUnit | 'custom';

const PERIOD_CHOICES: { id: PeriodChoice; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
  { id: 'custom', label: 'Custom dates' },
];

// Uncategorized spend is its own row, so the total is everything spent.
const CATEGORY_SPEND_SQL = `SELECT COALESCE(c.id, '') AS category_id, COALESCE(c.name, 'Uncategorized') AS category_name,
          c.icon AS category_icon, c.color AS category_color,
          a.currency AS currency, SUM(ABS(t.amount_minor)) AS total
   FROM transactions t
   LEFT JOIN categories c ON c.id = t.category_id
   JOIN accounts a ON a.id = t.account_id
   WHERE t.kind = 'expense' AND t.occurred_on >= ? AND t.occurred_on <= ?
   GROUP BY c.id, a.currency`;

// The donut shows the biggest categories; the rest share one grey slice.
const DONUT_SLICES = 7;

export function Reports() {
  const [tab, setTab] = useState<ReportTab>('category');
  const today = toDateString();
  const [unit, setUnit] = useState<PeriodChoice>('month');
  // The first day of the month, quarter or year being looked at.
  const [start, setStart] = useState(() => periodStart('month', today));
  const [range, setRange] = useState<Span>(() => ({ from: periodStart('month', today), to: today }));
  const [compare, setCompare] = useState(false);
  const [activeSlice, setActiveSlice] = useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const { defaultCurrency: currency, fxRates } = useAppSettings();

  const spans = useMemo(
    () =>
      unit === 'custom'
        ? { current: range, previous: precedingSpan(range), partial: false }
        : periodComparison(unit, start, today),
    [unit, start, range, today],
  );
  const { from, to } = spans.current;
  const before = spans.previous;

  const catSpend = useQuery<CategorySpendRow[]>(
    useCallback((db: DB) => db.execO<CategorySpendRow>(CATEGORY_SPEND_SQL, [from, to]), [from, to]),
    { deps: ['transactions', 'categories', 'accounts'] },
  );
  const prevSpend = useQuery<CategorySpendRow[]>(
    useCallback(
      (db: DB) =>
        compare ? db.execO<CategorySpendRow>(CATEGORY_SPEND_SQL, [before.from, before.to]) : Promise.resolve([]),
      [compare, before.from, before.to],
    ),
    { deps: ['transactions', 'categories', 'accounts'] },
  );

  const choosePeriod = (next: PeriodChoice) => {
    if (next === 'custom') setRange({ from, to });
    else setStart(periodStart(next, unit === 'custom' ? range.from : start));
    setUnit(next);
  };

  const monthlyData = useQuery<MonthlyRowRaw[]>(
    useCallback(
      (db: DB) =>
        db.execO<MonthlyRowRaw>(
          `SELECT substr(t.occurred_on, 1, 7) AS month, t.kind AS kind,
                  a.currency AS currency, SUM(ABS(t.amount_minor)) AS total
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           WHERE t.kind IN ('expense', 'income')
             -- This month only up to today; later months are shown as upcoming.
             AND (t.occurred_on <= ? OR substr(t.occurred_on, 1, 7) > substr(?, 1, 7))
           GROUP BY month, t.kind, a.currency`,
          [today, today],
        ),
      [today],
    ),
    { deps: ['transactions', 'accounts'] },
  );

  const categories = useMemo(() => byCategory(catSpend.data ?? [], currency, fxRates), [catSpend.data, currency, fxRates]);
  const previous = useMemo(() => byCategory(prevSpend.data ?? [], currency, fxRates), [prevSpend.data, currency, fxRates]);
  const prevById = useMemo(() => new Map(previous.map((c) => [c.category_id, c.total])), [previous]);
  // Categories spent on before but not now still belong in a comparison.
  const listed = useMemo(
    () =>
      compare
        ? [...categories, ...previous.filter((p) => !categories.some((c) => c.category_id === p.category_id)).map((p) => ({ ...p, total: 0 }))]
        : categories,
    [compare, categories, previous],
  );

  const monthly = useMemo<MonthlyRow[]>(() => {
    const map = new Map<string, MonthlyRow>();
    for (const r of monthlyData.data ?? []) {
      const ex = map.get(r.month) ?? { month: r.month, expenses: 0, income: 0 };
      const conv = convert(r.total, r.currency, currency, currency, fxRates);
      if (r.kind === 'expense') ex.expenses += conv;
      else ex.income += conv;
      map.set(r.month, ex);
    }
    return Array.from(map.values()).sort((a, b) => (a.month < b.month ? 1 : -1));
  }, [monthlyData.data, currency, fxRates]);

  // Months after this one only hold scheduled entries (future EMIs, recurring),
  // so they stay folded away unless asked for.
  const thisMonth = toDateString().slice(0, 7);
  const pastMonths = useMemo(() => monthly.filter((m) => m.month <= thisMonth).slice(0, 24), [monthly, thisMonth]);
  const upcomingMonths = useMemo(() => monthly.filter((m) => m.month > thisMonth), [monthly, thisMonth]);
  const chartMonths = useMemo(() => {
    const past = pastMonths.slice(0, 12).reverse();
    return showUpcoming ? [...past, ...upcomingMonths.slice().reverse().slice(0, 12)] : past;
  }, [pastMonths, upcomingMonths, showUpcoming]);
  const tableMonths = showUpcoming ? [...upcomingMonths, ...pastMonths] : pastMonths;

  const grandTotal = categories.reduce((s, c) => s + c.total, 0);
  const prevTotal = previous.reduce((s, c) => s + c.total, 0);
  const label = unit === 'custom' ? null : periodLabel(unit, start);
  const beforeLabel =
    unit === 'custom'
      ? 'the same number of days before'
      : `${spans.partial ? 'the same days of ' : ''}the ${unit} before`;
  const slices = useMemo<DonutSlice[]>(() => {
    const top = categories.slice(0, categories.length > DONUT_SLICES ? DONUT_SLICES - 1 : DONUT_SLICES);
    const rest = categories.slice(top.length);
    // Neighbouring categories can share a colour; keep slices tellable apart.
    const colors = distinctColors(
      top.map((c) => categoryStyle(c.category_name, c.category_color, c.category_icon).color),
      rest.length > 0 ? ['#94a3b8'] : [],
    );
    const out: DonutSlice[] = top.map((c, i) => ({
      id: c.category_id,
      label: c.category_name,
      value: c.total,
      color: colors[i],
    }));
    if (rest.length > 0) {
      out.push({
        id: 'rest',
        label: `${rest.length} more`,
        value: rest.reduce((s, c) => s + c.total, 0),
        color: '#94a3b8',
      });
    }
    return out;
  }, [categories]);
  const sliceOf = (categoryId: string) => (slices.some((s) => s.id === categoryId) ? categoryId : 'rest');

  return (
    <PageShell title="Reports" subtitle="Spending breakdowns and monthly trends">
      <div className="flex gap-1 rounded-lg bg-slate-900 p-1 sm:w-fit">
        {(['category', 'monthly'] as ReportTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              tab === t ? 'bg-brand-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'category' ? 'By category' : 'Monthly trend'}
          </button>
        ))}
      </div>

      {tab === 'category' && (
        <>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="group" aria-label="Period">
            {PERIOD_CHOICES.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={unit === p.id}
                onClick={() => choosePeriod(p.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                  unit === p.id ? 'bg-brand-500 text-slate-950' : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {unit === 'custom' ? (
              <div className="flex flex-1 items-center gap-2 sm:flex-none">
                <DateField
                  value={range.from}
                  onChange={(v) => v && setRange({ from: v, to: v > range.to ? v : range.to })}
                  className="min-w-0 flex-1 sm:w-40 sm:flex-none"
                  placeholder="From"
                />
                <span className="text-sm text-slate-500">to</span>
                <DateField
                  value={range.to}
                  onChange={(v) => v && setRange({ from: v < range.from ? v : range.from, to: v })}
                  className="min-w-0 flex-1 sm:w-40 sm:flex-none"
                  placeholder="To"
                />
              </div>
            ) : (
              <PeriodStepper
                unit={unit}
                label={label ?? ''}
                onStep={(n) => setStart(stepPeriod(unit, start, n))}
                canGoForward={stepPeriod(unit, start, 1) <= today}
              />
            )}
            {spans.partial && <span className="text-xs text-slate-500">so far</span>}
            <button
              type="button"
              aria-pressed={compare}
              onClick={() => setCompare((v) => !v)}
              className={`ml-auto rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                compare
                  ? 'border-brand-500 text-brand-400'
                  : 'border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              Compare
            </button>
          </div>

          {catSpend.data === null ? (
            <LoadingRows label="Loading spending…" />
          ) : categories.length === 0 ? (
            <EmptyState
              title={label ? `No spending in ${label}` : 'No spending in these dates'}
              description="Add an expense and you'll see where your money goes, category by category."
            />
          ) : (
            <Card>
              {compare && prevSpend.data && (
                <p className="mb-4 text-sm text-slate-300">
                  <ChangeSentence now={grandTotal} before={prevTotal} currency={currency} beforeLabel={beforeLabel} />
                </p>
              )}
              <div className="grid items-start gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
                {/* Stays in view beside a long category list. */}
                <div className="space-y-2 md:sticky md:top-6">
                  <CategoryDonut
                    slices={slices}
                    total={grandTotal}
                    currency={currency}
                    activeId={activeSlice}
                    onActiveChange={setActiveSlice}
                  />
                  <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                    <ConvertedMark currencies={(catSpend.data ?? []).map((r) => r.currency)} target={currency} />
                    Expenses only
                    <InfoHint label="What the total counts" title="Expenses only">
                      This adds up spending by category — income and transfers between
                      your accounts aren’t included.
                    </InfoHint>
                  </p>
                </div>
                <ul className="space-y-1">
                  {listed.map((c) => {
                    const pct = grandTotal > 0 ? (c.total / grandTotal) * 100 : 0;
                    const slice = sliceOf(c.category_id);
                    const color = slices.find((s) => s.id === slice)?.color;
                    return (
                      <li
                        key={c.category_id}
                        onPointerEnter={() => setActiveSlice(slice)}
                        onPointerLeave={() => setActiveSlice(null)}
                        className={`flex items-center gap-3 rounded-lg px-2 py-1.5 transition ${
                          activeSlice === slice ? 'bg-slate-800/70' : ''
                        }`}
                      >
                        <CategoryCoin name={c.category_name} color={c.category_color} icon={c.category_icon} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="truncate text-slate-50">{c.category_name}</span>
                            <span className="shrink-0 tabular-nums text-slate-200">{formatMoney(c.total, currency)}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-slate-800">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                            </div>
                            <span className="w-10 text-right text-xs tabular-nums text-slate-500">{pct > 0 && pct < 1 ? "<1" : pct.toFixed(0)}%</span>
                          </div>
                          {compare && prevSpend.data && (
                            <RowChange now={c.total} before={prevById.get(c.category_id) ?? 0} currency={currency} />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === 'monthly' && (
        <>
          {monthlyData.data === null ? (
            <LoadingRows label="Loading months…" />
          ) : pastMonths.length === 0 && upcomingMonths.length === 0 ? (
            <EmptyState title="Nothing to chart yet" description="Once you've added some expenses and income, you'll see how each month compares." />
          ) : (
            <>
            <Card>
              <CashflowTrendChart
                data={chartMonths}
                currency={currency}
                chronological
                projectedFromIndex={showUpcoming ? Math.min(pastMonths.length, 12) : undefined}
                projection="scheduled"
              />
            </Card>
            {upcomingMonths.length > 0 && (
              <button
                type="button"
                aria-expanded={showUpcoming}
                onClick={() => setShowUpcoming((v) => !v)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-left"
              >
                <span className="text-sm font-medium text-slate-200">Upcoming months</span>
                <span className="text-xs text-slate-500">
                  {upcomingMonths.length} with scheduled entries{' '}
                  <span className="font-medium text-brand-400">{showUpcoming ? 'Hide' : 'Show'}</span>
                </span>
              </button>
            )}
            <Card>
              {(monthlyData.data ?? []).some((r) => r.currency !== currency) && (
                <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
                  <ConvertedMark currencies={(monthlyData.data ?? []).map((r) => r.currency)} target={currency} />
                  Amounts in other currencies are converted to {currency}.
                </p>
              )}
              <div className="-mx-1 overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums sm:text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="py-2 text-xs font-semibold uppercase text-slate-400">Month</th>
                    <th className="py-2 text-right text-xs font-semibold uppercase text-clay-400">Expenses</th>
                    <th className="py-2 text-right text-xs font-semibold uppercase text-mint-400">Income</th>
                    <th className="py-2 text-right text-xs font-semibold uppercase text-slate-400">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {tableMonths.map((m) => {
                    const net = m.income - m.expenses;
                    return (
                      <tr
                        key={m.month}
                        className={`border-b border-slate-800/50 ${m.month > thisMonth ? 'opacity-60' : ''}`}
                      >
                        <td className="py-2 text-slate-50">
                          {new Date(m.month + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                        </td>
                        <td className="py-2 text-right tabular-nums text-clay-400">
                          {formatMoney(m.expenses, currency)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-mint-400">
                          {formatMoney(m.income, currency)}
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums font-medium ${
                            net >= 0 ? 'text-mint-400' : 'text-clay-400'
                          }`}
                        >
                          {formatMoney(net, currency, { signed: true })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </Card>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}

function byCategory(rows: CategorySpendRow[], currency: string, fxRates: Parameters<typeof convert>[4]): CategorySpend[] {
  const map = new Map<string, CategorySpend>();
  for (const r of rows) {
    const ex = map.get(r.category_id) ?? {
      category_id: r.category_id,
      category_name: r.category_name,
      category_icon: r.category_icon,
      category_color: r.category_color,
      total: 0,
    };
    ex.total += convert(r.total, r.currency, currency, currency, fxRates);
    map.set(r.category_id, ex);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function PeriodStepper({
  unit,
  label,
  onStep,
  canGoForward,
}: {
  unit: PeriodUnit;
  label: string;
  onStep: (n: number) => void;
  canGoForward: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900/60">
      <button
        type="button"
        aria-label={`Previous ${unit}`}
        onClick={() => onStep(-1)}
        className="rounded-l-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-50"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[8.5rem] px-1 text-center text-sm font-medium text-slate-100" aria-live="polite">
        {label}
      </span>
      <button
        type="button"
        aria-label={`Next ${unit}`}
        onClick={() => onStep(1)}
        disabled={!canGoForward}
        className="rounded-r-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-50 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// Within 1% counts as the same; spending less is the good direction.
function change(now: number, before: number) {
  const diff = now - before;
  if (before === 0) return { diff, pct: null, same: now === 0 };
  return { diff, pct: Math.round((Math.abs(diff) / before) * 100), same: Math.abs(diff) < before * 0.01 };
}

function ChangeSentence({ now, before, currency, beforeLabel }: { now: number; before: number; currency: string; beforeLabel: string }) {
  const { diff, pct, same } = change(now, before);
  if (before === 0) return <>Nothing was spent in {beforeLabel}.</>;
  if (same) return <>About the same as {beforeLabel} ({formatMoney(before, currency)}).</>;
  return (
    <>
      <span className={diff < 0 ? 'text-success' : 'text-danger'}>
        {formatMoney(Math.abs(diff), currency)} {diff < 0 ? 'less' : 'more'} ({pct}%)
      </span>{' '}
      than {beforeLabel} ({formatMoney(before, currency)}).
    </>
  );
}

function RowChange({ now, before, currency }: { now: number; before: number; currency: string }) {
  const { diff, pct, same } = change(now, before);
  return (
    <p className="mt-0.5 text-xs text-slate-500">
      {before === 0 ? (
        'Nothing before'
      ) : (
        <>
          {formatMoney(before, currency)} before
          {!same && (
            <span className={diff < 0 ? 'text-success' : 'text-danger'}>
              {' · '}
              {pct}% {diff < 0 ? 'less' : 'more'}
            </span>
          )}
        </>
      )}
    </p>
  );
}
