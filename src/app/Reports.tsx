import { useCallback, useMemo, useState } from 'react';
import { PageShell } from './PageShell';
import { Card, EmptyState } from '@/components/ui/Card';
import { InfoHint } from '@/components/ui/InfoHint';
import { ConvertedMark } from '@/components/ConvertedMark';
import { useQuery } from '@/db/useQuery';
import type { DB } from '@/db/wasm';
import { formatMoney } from '@/lib/money';
import { convert } from '@/lib/fx';
import { startOfMonth, endOfMonth, toDateString } from '@/lib/dates';
import { useAppSettings } from './AppSettingsProvider';
import { CashflowTrendChart } from '@/components/charts/CashflowTrendChart';

interface CategorySpend {
  category_id: string;
  category_name: string;
  category_icon: string | null;
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

export function Reports() {
  const [tab, setTab] = useState<ReportTab>('category');
  const [month, setMonth] = useState(() => toDateString().slice(0, 7));
  const refDate = month + '-01';
  const { defaultCurrency: currency, fxRates } = useAppSettings();

  const from = toDateString(startOfMonth(new Date(refDate + 'T00:00:00')));
  const to = toDateString(endOfMonth(new Date(refDate + 'T00:00:00')));

  const catSpend = useQuery<CategorySpendRow[]>(
    useCallback(
      (db: DB) =>
        db.execO<CategorySpendRow>(
          `SELECT c.id AS category_id, c.name AS category_name, c.icon AS category_icon,
                  a.currency AS currency, SUM(ABS(t.amount_minor)) AS total
           FROM transactions t
           JOIN categories c ON c.id = t.category_id
           JOIN accounts a ON a.id = t.account_id
           WHERE t.kind = 'expense' AND t.occurred_on >= ? AND t.occurred_on <= ?
           GROUP BY c.id, a.currency`,
          [from, to],
        ),
      [from, to],
    ),
    { deps: ['transactions', 'categories', 'accounts'] },
  );

  const monthlyData = useQuery<MonthlyRowRaw[]>(
    useCallback(
      (db: DB) =>
        db.execO<MonthlyRowRaw>(
          `SELECT substr(t.occurred_on, 1, 7) AS month, t.kind AS kind,
                  a.currency AS currency, SUM(ABS(t.amount_minor)) AS total
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           WHERE t.kind IN ('expense', 'income')
           GROUP BY month, t.kind, a.currency`,
        ),
      [],
    ),
    { deps: ['transactions', 'accounts'] },
  );

  const categories = useMemo<CategorySpend[]>(() => {
    const map = new Map<string, CategorySpend>();
    for (const r of catSpend.data ?? []) {
      const ex = map.get(r.category_id) ?? {
        category_id: r.category_id,
        category_name: r.category_name,
        category_icon: r.category_icon,
        total: 0,
      };
      ex.total += convert(r.total, r.currency, currency, currency, fxRates);
      map.set(r.category_id, ex);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [catSpend.data, currency, fxRates]);

  const monthly = useMemo<MonthlyRow[]>(() => {
    const map = new Map<string, MonthlyRow>();
    for (const r of monthlyData.data ?? []) {
      const ex = map.get(r.month) ?? { month: r.month, expenses: 0, income: 0 };
      const conv = convert(r.total, r.currency, currency, currency, fxRates);
      if (r.kind === 'expense') ex.expenses += conv;
      else ex.income += conv;
      map.set(r.month, ex);
    }
    return Array.from(map.values())
      .sort((a, b) => (a.month < b.month ? 1 : -1))
      .slice(0, 24);
  }, [monthlyData.data, currency, fxRates]);

  const grandTotal = categories.reduce((s, c) => s + c.total, 0);

  return (
    <PageShell title="Reports" subtitle="Spending breakdowns and monthly trends">
      <div className="flex gap-1 rounded-lg bg-slate-900 p-1 sm:w-fit">
        {(['category', 'monthly'] as ReportTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition ${
              tab === t ? 'bg-brand-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'category' ? 'By category' : 'Monthly trend'}
          </button>
        ))}
      </div>

      {tab === 'category' && (
        <>
          <div className="flex items-center gap-3">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-50 focus:border-brand-500 focus:outline-none"
            />
            {grandTotal > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-slate-400">
                Total: <ConvertedMark currencies={(catSpend.data ?? []).map((r) => r.currency)} target={currency} />
                {formatMoney(grandTotal, currency)}
                <InfoHint label="What the total counts" title="Expenses only" align="right">
                  This adds up spending by category — income and transfers between
                  your accounts aren’t included.
                </InfoHint>
              </div>
            )}
          </div>

          {categories.length === 0 ? (
            <EmptyState title="No spending this month yet" description="Add an expense and you'll see where your money goes, category by category." />
          ) : (
            <Card className="space-y-3">
              {categories.map((c) => {
                const pct = grandTotal > 0 ? (c.total / grandTotal) * 100 : 0;
                return (
                  <div key={c.category_id}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-slate-50">
                        {c.category_icon ?? '•'} {c.category_name}
                      </span>
                      <span className="tabular-nums text-slate-300">
                        {formatMoney(c.total, currency)}{' '}
                        <span className="text-slate-500">({pct.toFixed(1)}%)</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-brand-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}

      {tab === 'monthly' && (
        <>
          {monthly.length === 0 ? (
            <EmptyState title="Nothing to chart yet" description="Once you've added some expenses and income, you'll see how each month compares." />
          ) : (
            <>
            <Card>
              <CashflowTrendChart data={monthly} currency={currency} />
            </Card>
            <Card>
              {(monthlyData.data ?? []).some((r) => r.currency !== currency) && (
                <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
                  <ConvertedMark currencies={(monthlyData.data ?? []).map((r) => r.currency)} target={currency} />
                  Amounts in other currencies are converted to {currency}.
                </p>
              )}
              <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[24rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="py-2 text-xs font-semibold uppercase text-slate-400">Month</th>
                    <th className="py-2 text-right text-xs font-semibold uppercase text-clay-400">Expenses</th>
                    <th className="py-2 text-right text-xs font-semibold uppercase text-mint-400">Income</th>
                    <th className="py-2 text-right text-xs font-semibold uppercase text-slate-400">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((m) => {
                    const net = m.income - m.expenses;
                    return (
                      <tr key={m.month} className="border-b border-slate-800/50">
                        <td className="py-2 text-slate-50">{m.month}</td>
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
