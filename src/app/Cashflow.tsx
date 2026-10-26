import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageShell } from './PageShell';
import { Card, EmptyState } from '@/components/ui/Card';
import { InfoHint } from '@/components/ui/InfoHint';
import { ConvertedMark } from '@/components/ConvertedMark';
import { useQuery } from '@/db/useQuery';
import { listAccounts, getAccountBalances, type AccountBalance } from '@/db/queries/accounts';
import { listRecurringRules } from '@/db/queries/recurring';
import type { RecurringTemplate } from '@/db/queries/recurring';
import { upcomingOccurrences } from '@/features/recurring/frequencies';
import { getCreditCardStatements, type StatementInfo } from '@/features/creditCards/statementEngine';
import type { Account, RecurringRule } from '@/db/types';
import { formatMoney } from '@/lib/money';
import { convert } from '@/lib/fx';
import { toDateString, addDays, formatHumanDate } from '@/lib/dates';
import { useAppSettings } from './AppSettingsProvider';
import {
  getMonthlyDeltas,
  getMonthlyInOut,
  getFutureTransactions,
  type FutureTxnRow,
} from '@/features/cashflow/queries';
import {
  buildBalanceSeries,
  buildInOutSeries,
  avgInOut,
  projectInOut,
  projectBalance,
  type DeltaRow,
  type InOutRow,
  type Scope,
} from '@/features/cashflow/trends';
import { BalanceTrendChart } from '@/components/charts/BalanceTrendChart';
import { CashflowTrendChart } from '@/components/charts/CashflowTrendChart';

type Horizon = 30 | 60 | 90;
type Mode = 'forecast' | 'trend';
type TrendWindow = 3 | 6 | 12;

export function Cashflow() {
  const [mode, setMode] = useState<Mode>('forecast');
  const [horizon, setHorizon] = useState<Horizon>(30);
  const { defaultCurrency, fxRates } = useAppSettings();
  // rrule is loaded lazily so the forecast enumerates future occurrences with
  // the exact same engine that materializes them — no calendar drift.
  const [rruleLib, setRruleLib] = useState<typeof import('rrule') | null>(null);
  useEffect(() => {
    let active = true;
    import('rrule').then((m) => {
      if (active) setRruleLib(m);
    });
    return () => {
      active = false;
    };
  }, []);

  const accountsState = useQuery<Account[]>(
    useCallback((d) => listAccounts(d), []),
    { deps: ['accounts'] },
  );
  const balancesState = useQuery<AccountBalance[]>(
    useCallback((d) => getAccountBalances(d), []),
    { deps: ['accounts', 'transactions'] },
  );
  const recurringState = useQuery<RecurringRule[]>(
    useCallback((d) => listRecurringRules(d), []),
    { deps: ['recurring_rules'] },
  );
  const ccState = useQuery<StatementInfo[]>(
    useCallback((d) => getCreditCardStatements(d), []),
    { deps: ['accounts', 'transactions'] },
  );
  const deltasState = useQuery<DeltaRow[]>(
    useCallback((d) => getMonthlyDeltas(d), []),
    { deps: ['accounts', 'transactions'] },
  );
  const inOutState = useQuery<InOutRow[]>(
    useCallback((d) => getMonthlyInOut(d), []),
    { deps: ['accounts', 'transactions'] },
  );
  // Pre-logged future transactions over the widest horizon; the forecast memo
  // trims them to the selected 30/60/90-day window.
  const futureTxnState = useQuery<FutureTxnRow[]>(
    useCallback((d) => getFutureTransactions(d, toDateString(), toDateString(addDays(new Date(), 90))), []),
    { deps: ['accounts', 'transactions'] },
  );

  const [trendWindow, setTrendWindow] = useState<TrendWindow>(3);
  const [scope, setScope] = useState<Scope>('all');

  const accounts = accountsState.data ?? [];
  const balances = balancesState.data ?? [];
  const rules = recurringState.data ?? [];
  const ccStatements = ccState.data ?? [];
  const futureTxns = futureTxnState.data ?? [];

  const nonCreditAccounts = useMemo(
    // Same accounts as the Dashboard total: "not counted" ones (e.g. loans to
    // or from family) would otherwise swing the forecast.
    () => accounts.filter((a) => a.type !== 'credit_card' && !a.archived_at && a.include_in_total === 1),
    [accounts],
  );

  const balanceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of balances) m.set(b.account_id, b.balance_minor);
    return m;
  }, [balances]);

  const forecast = useMemo(() => {
    if (nonCreditAccounts.length === 0) return [];

    const today = new Date();
    const todayStr = toDateString(today);
    const entries: ForecastEntry[] = [];

    let running = 0;
    for (const a of nonCreditAccounts) {
      const bal = balanceMap.get(a.id) ?? a.opening_balance_minor;
      running += convert(bal, a.currency, defaultCurrency, defaultCurrency, fxRates);
    }

    entries.push({ date: todayStr, label: 'Today', amount: 0, balance: running });

    const events: { date: string; label: string; amount: number }[] = [];

    const endDate = addDays(today, horizon);
    if (rruleLib) {
      for (const rule of rules) {
        let tpl: RecurringTemplate;
        try {
          tpl = JSON.parse(rule.template_json);
        } catch {
          continue;
        }
        const acct = nonCreditAccounts.find((a) => a.id === tpl.account_id);
        if (!acct) continue;

        let occurrences: string[];
        try {
          // Occurrences strictly after today (past ones are already materialized
          // into the balance) up to the horizon.
          occurrences = upcomingOccurrences(rruleLib, rule.rrule, todayStr, toDateString(endDate));
        } catch {
          continue;
        }

        const signed = tpl.kind === 'expense' ? -Math.abs(tpl.amount_minor) : Math.abs(tpl.amount_minor);
        const amount = convert(signed, acct.currency, defaultCurrency, defaultCurrency, fxRates);
        for (const occ of occurrences) {
          events.push({
            date: occ,
            label: `${tpl.kind === 'expense' ? '−' : '+'} Recurring`,
            amount,
          });
        }
      }
    }

    const endDateStr = toDateString(endDate);
    for (const t of futureTxns) {
      if (t.occurred_on <= todayStr || t.occurred_on > endDateStr) continue;
      const acct = nonCreditAccounts.find((a) => a.id === t.account_id);
      if (!acct) continue;
      const base = t.category_name ?? (t.kind === 'expense' ? 'Scheduled expense' : 'Scheduled income');
      events.push({
        date: t.occurred_on,
        label: t.note ? `${base} · ${t.note}` : base,
        amount: convert(t.amount_minor, t.currency, defaultCurrency, defaultCurrency, fxRates),
      });
    }

    for (const stmt of ccStatements) {
      if (!stmt.account.pay_from_account_id) continue;
      const payAcct = nonCreditAccounts.find((a) => a.id === stmt.account.pay_from_account_id);
      if (!payAcct) continue;
      if (stmt.daysUntilDue >= 0 && stmt.daysUntilDue <= horizon) {
        events.push({
          date: stmt.dueDate,
          label: `${stmt.account.name} payment due`,
          amount: -convert(stmt.statementBalance, stmt.account.currency, defaultCurrency, defaultCurrency, fxRates),
        });
      }
    }

    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    for (const ev of events) {
      running += ev.amount;
      entries.push({
        date: ev.date,
        label: ev.label,
        amount: ev.amount,
        balance: running,
      });
    }

    return entries;
  }, [nonCreditAccounts, balanceMap, rules, ccStatements, futureTxns, horizon, defaultCurrency, fxRates, rruleLib]);

  // What the forecast leaves out, so its "Today" figure can be squared with the
  // Dashboard total: cards whose bills can't be projected, and uncounted accounts.
  const missing = useMemo(() => {
    const live = accounts.filter((a) => !a.archived_at);
    const billed = new Set(
      ccStatements
        .filter((s) => nonCreditAccounts.some((a) => a.id === s.account.pay_from_account_id))
        .map((s) => s.account.id),
    );
    const balanceOf = (a: Account) => balanceMap.get(a.id) ?? a.opening_balance_minor;
    const cards = live.filter(
      (a) => a.type === 'credit_card' && a.include_in_total === 1 && !billed.has(a.id) && balanceOf(a) !== 0,
    );
    const cardTotal = cards.reduce(
      (sum, a) => sum + convert(balanceOf(a), a.currency, defaultCurrency, defaultCurrency, fxRates),
      0,
    );
    return { cards, cardTotal, notCounted: live.filter((a) => a.include_in_total !== 1) };
  }, [accounts, ccStatements, nonCreditAccounts, balanceMap, defaultCurrency, fxRates]);

  const minBalance = forecast.length > 0 ? Math.min(...forecast.map((f) => f.balance)) : 0;

  const liveAccounts = useMemo(() => accounts.filter((a) => !a.archived_at), [accounts]);
  // The accounts Trend adds up (all counted ones, or the one picked).
  const trendCurrencies = (
    scope === 'all' ? liveAccounts.filter((a) => a.include_in_total === 1) : accounts.filter((a) => a.id === scope)
  ).map((a) => a.currency);

  const trend = useMemo(() => {
    const deltas = deltasState.data;
    const inOutRows = inOutState.data;
    if (!deltas || !inOutRows || accounts.length === 0) return null;

    const currentYm = toDateString().slice(0, 7);
    const actualBalance = buildBalanceSeries({
      accounts,
      deltas,
      scope,
      defaultCurrency,
      fxRates,
      throughYm: currentYm,
    });
    if (actualBalance.length === 0) return null;

    const months = actualBalance.map((p) => p.ym);
    const inOut = buildInOutSeries({ accounts, rows: inOutRows, scope, defaultCurrency, fxRates, months });
    const avg = avgInOut(inOut, trendWindow, currentYm);
    const avgNet = avg.income - avg.expenses;

    const lastBalance = actualBalance[actualBalance.length - 1].balance_minor;
    const projBalance = projectBalance(lastBalance, currentYm, avgNet, trendWindow);
    const projInOut = projectInOut(currentYm, avg, trendWindow);

    // Bars show exactly the months we averaged (completed only) plus the
    // projected months, so "last N → next N" reads directly off the chart.
    const completed = inOut.filter((p) => p.ym < currentYm).slice(-trendWindow);
    const bars = [...completed, ...projInOut].map((p) => ({
      month: p.ym,
      income: p.income,
      expenses: p.expenses,
    }));

    return {
      balanceData: [...actualBalance, ...projBalance],
      bars,
      projectedFromIndex: completed.length,
      avg,
      avgNet,
      lastBalance,
      projectedEnd: projBalance[projBalance.length - 1]?.balance_minor ?? lastBalance,
    };
  }, [accounts, deltasState.data, inOutState.data, scope, trendWindow, defaultCurrency, fxRates]);

  return (
    <PageShell
      title="Cashflow"
      subtitle={
        mode === 'forecast'
          ? 'Your estimated balance over the next 30, 60 or 90 days'
          : 'Your balance over time, with a trend projection from recent months'
      }
    >
      <div className="flex items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-slate-900 p-1 sm:w-fit">
          {(['forecast', 'trend'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize transition ${
                mode === m ? 'bg-brand-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m === 'forecast' ? 'Forecast' : 'Trend'}
            </button>
          ))}
        </div>
        <InfoHint label="Forecast vs Trend" title="Two ways to project">
          <span className="mb-1.5 block">
            <span className="font-medium text-slate-300">Forecast</span> — your balance today plus
            your recurring entries, like rent and salary.
          </span>
          <span className="block">
            <span className="font-medium text-slate-300">Trend</span> — what an average month looks
            like lately, leaving out transfers and this unfinished month.
          </span>
        </InfoHint>
      </div>

      {mode === 'forecast' && (
        <>
      {ccStatements.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Upcoming card bills</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ccStatements.map((stmt) => (
              <div
                key={stmt.account.id}
                className={`rounded-lg border p-3 ${
                  stmt.isPastDue ? 'border-danger/50 bg-danger/10' : 'border-slate-800 bg-slate-900/60'
                }`}
              >
                <div className="text-sm font-medium text-slate-50">{stmt.account.name}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-clay-400">
                  {formatMoney(stmt.statementBalance, stmt.account.currency)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Billing period: {formatHumanDate(stmt.cycleStart)} — {formatHumanDate(stmt.cycleEnd)}
                </div>
                <div
                  className={`text-xs ${
                    stmt.isPastDue
                      ? 'font-semibold text-danger'
                      : stmt.daysUntilDue <= 5
                        ? 'text-warning'
                        : 'text-slate-400'
                  }`}
                >
                  {stmt.isPastDue
                    ? `Past due by ${-stmt.daysUntilDue} days`
                    : `Due in ${stmt.daysUntilDue} days (${formatHumanDate(stmt.dueDate)})`}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex gap-1 rounded-lg bg-slate-900 p-1 sm:w-fit">
        {([30, 60, 90] as Horizon[]).map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => setHorizon(h)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              horizon === h ? 'bg-brand-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {h} days
          </button>
        ))}
      </div>

      {(missing.cards.length > 0 || missing.notCounted.length > 0) && (
        <div className="rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-info">
          <p className="text-sm font-semibold">Not in this forecast</p>
          <ul className="mt-1.5 list-disc space-y-1.5 pl-5 text-xs">
            {missing.cards.length > 0 && (
              <li>
                <span className="font-semibold tabular-nums">
                  {formatMoney(missing.cardTotal, defaultCurrency)}
                </span>{' '}
                on {missing.cards.length === 1 ? 'credit card' : `${missing.cards.length} credit cards`} (
                {nameList(missing.cards)}). A card&rsquo;s bill shows up here once it has a statement day and a
                &ldquo;Pay bill from&rdquo; account.{' '}
                <Link to="/accounts" className="font-medium underline">
                  Set up in Accounts
                </Link>
              </li>
            )}
            {missing.notCounted.length > 0 && (
              <li>
                {nameList(missing.notCounted)}{' '}
                {missing.notCounted.length === 1 ? 'isn’t' : 'aren’t'} counted in your total balance.{' '}
                <Link to="/accounts" className="font-medium underline">
                  Change in Accounts
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}

      {forecast.length === 0 ? (
        <EmptyState
          title="Nothing to show yet"
          description="Add a bank or cash account to see where your balance is heading."
          action={
            <Link to="/accounts" className="text-sm font-medium text-brand-300 underline">
              Go to Accounts
            </Link>
          }
        />
      ) : (
        <Card>
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-300">
            {/* Not "balance": the Dashboard total also counts card debt. */}
            Forecast for the next {horizon} days
            <ConvertedMark
              currencies={[...nonCreditAccounts, ...ccStatements.map((st) => st.account)].map((a) => a.currency)}
              target={defaultCurrency}
            />
          </h3>
          {minBalance < 0 && (
            <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {forecast[0].balance < 0
                ? 'Balance is already negative today'
                : `Balance goes negative on ${formatHumanDate(forecast.find((f) => f.balance < 0)!.date)}`}
            </div>
          )}
          {forecast.length === 1 && (
            <p className="mb-3 text-xs text-slate-500">
              Nothing is scheduled in the next {horizon} days, so your balance stays as it is today.
              Add recurring entries like rent, salary or subscriptions to see them coming.{' '}
              <Link to="/transactions?view=recurring" className="font-medium text-brand-300 underline">
                Add a recurring entry
              </Link>
            </p>
          )}
          <div className="divide-y divide-slate-800">
            {forecast.map((entry, i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm text-slate-50">{entry.label}</div>
                  <div className="text-xs text-slate-500">{formatHumanDate(entry.date)}</div>
                </div>
                <div className="text-right">
                  {entry.amount !== 0 && (
                    <div
                      className={`text-xs tabular-nums ${
                        entry.amount < 0 ? 'text-clay-400' : 'text-mint-400'
                      }`}
                    >
                      {formatMoney(entry.amount, defaultCurrency, { signed: true })}
                    </div>
                  )}
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      entry.balance < 0 ? 'text-clay-400' : 'text-slate-50'
                    }`}
                  >
                    {formatMoney(entry.balance, defaultCurrency)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
        </>
      )}

      {mode === 'trend' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-lg bg-slate-900 p-1">
              {([3, 6, 12] as TrendWindow[]).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setTrendWindow(w)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    trendWindow === w
                      ? 'bg-brand-500 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {w} mo
                </button>
              ))}
            </div>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-50 focus:border-brand-500 focus:outline-none"
            >
              <option value="all">All accounts</option>
              {liveAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <InfoHint label="About these controls" title="How the trend reads">
              <span className="mb-1.5 block">
                <span className="font-medium text-slate-300">Window</span> — averages
                that many recent full months, then projects the same number forward.
              </span>
              <span className="block">
                <span className="font-medium text-slate-300">All accounts</span> includes
                credit cards and accounts left out of your total, so it won’t match the
                Dashboard balance.
              </span>
            </InfoHint>
          </div>

          {!trend ? (
            <EmptyState
              title="Nothing to show yet"
              description="Add some transactions to see your balance trend and projection."
            />
          ) : (
            <>
              <Card>
                <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-300">
                  Balance over time
                  <ConvertedMark currencies={trendCurrencies} target={defaultCurrency} />
                </h3>
                <BalanceTrendChart
                  data={trend.balanceData}
                  currency={defaultCurrency}
                  windowMonths={trendWindow}
                />
              </Card>

              <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Avg income / mo</div>
                  <div className="mt-1 font-display text-xl font-semibold tabular-nums text-mint-400">
                    {formatMoney(trend.avg.income, defaultCurrency)}
                  </div>
                </Card>
                <Card>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Avg expense / mo</div>
                  <div className="mt-1 font-display text-xl font-semibold tabular-nums text-clay-400">
                    {formatMoney(trend.avg.expenses, defaultCurrency)}
                  </div>
                </Card>
                <Card>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Avg net / mo</div>
                  <div
                    className={`mt-1 font-display text-xl font-semibold tabular-nums ${
                      trend.avgNet >= 0 ? 'text-mint-400' : 'text-clay-400'
                    }`}
                  >
                    {formatMoney(trend.avgNet, defaultCurrency, { signed: true })}
                  </div>
                </Card>
              </div>

              <Card>
                <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-300">
                  Income & expense
                  <ConvertedMark currencies={trendCurrencies} target={defaultCurrency} />
                </h3>
                <p className="mb-3 text-xs text-slate-500">
                  Last {trend.avg.monthsUsed} month{trend.avg.monthsUsed === 1 ? '' : 's'} of actuals,
                  then {trendWindow} projected months at that average.
                </p>
                <CashflowTrendChart
                  data={trend.bars}
                  currency={defaultCurrency}
                  chronological
                  projectedFromIndex={trend.projectedFromIndex}
                />
                <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-300">
                  Projected balance in {trendWindow} months:{' '}
                  <span
                    className={`font-semibold tabular-nums ${
                      trend.projectedEnd < 0 ? 'text-clay-400' : 'text-slate-50'
                    }`}
                  >
                    {formatMoney(trend.projectedEnd, defaultCurrency)}
                  </span>
                  <span className="text-slate-500">
                    {' '}
                    (now {formatMoney(trend.lastBalance, defaultCurrency)})
                  </span>
                </div>
                {trend.avg.monthsUsed < trendWindow && (
                  <p className="mt-2 text-xs text-warning/80">
                    Only {trend.avg.monthsUsed} completed month
                    {trend.avg.monthsUsed === 1 ? '' : 's'} of history available — the average uses
                    what's there.
                  </p>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}

interface ForecastEntry {
  date: string;
  label: string;
  amount: number;
  balance: number;
}

function nameList(accounts: Account[], max = 3): string {
  const names = accounts.map((a) => a.name);
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}
