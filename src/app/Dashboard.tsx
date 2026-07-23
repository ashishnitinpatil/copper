import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, TrendingUp, TrendingDown, Minus, AlertTriangle, ArrowRight, X, Check } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { PageShell } from './PageShell';
import { Card, EmptyState } from '@/components/ui/Card';
import { InfoHint } from '@/components/ui/InfoHint';
import { useQuery } from '@/db/useQuery';
import {
  listAccounts,
  getAccountBalances,
  getTotalsByCurrency,
  type AccountBalance,
  type CurrencyTotal,
} from '@/db/queries/accounts';
import { listTransactions, type TransactionWithMeta } from '@/db/queries/transactions';
import { getBudgetsWithSpent, type BudgetWithSpent } from '@/db/queries/budgets';
import type { Account, AccountType } from '@/db/types';
import { formatMoney } from '@/lib/money';
import { startOfMonth, toDateString, formatRelativeDate } from '@/lib/dates';
import { AccountTypeIcon } from '@/components/ui/AccountTypeIcon';
import { Money } from '@/components/ui/Money';
import { CategoryCoin } from '@/components/ui/CategoryCoin';
import { useIsFirstPull } from '@/sync/SyncProgressBanner';
import { useAppSettings } from './AppSettingsProvider';

function LocalOnlyWarning() {
  const { google } = useAuth();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('et-sync-warning-dismissed') === '1',
  );
  if (google || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem('et-sync-warning-dismissed', '1');
    setDismissed(true);
  };

  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-warning">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium">Your data is only on this device.</span>{' '}
        Clearing your browser or losing this device would erase it, with no way to get it back. Turn
        on sync to keep a copy in Google Drive — or export a backup file regularly.
        <div className="mt-2">
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 rounded-md bg-warning/20 px-2.5 py-1 text-xs font-medium text-warning transition hover:bg-warning/30"
          >
            Set up sync <ArrowRight size={13} />
          </Link>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 text-warning/70 transition hover:bg-warning/20 hover:text-warning"
      >
        <X size={16} />
      </button>
    </div>
  );
}

interface GettingStartedStep {
  done: boolean;
  label: string;
  desc: string;
  to: string;
  cta: string;
}

// A friendly first-run checklist. Each step's tick is derived from real data —
// so it stays honest: adding a transaction, setting a budget or turning on sync
// checks the box for you. Auto-hides once every step is done or once dismissed.
function GettingStarted({ steps, onDismiss }: { steps: GettingStartedStep[]; onDismiss: () => void }) {
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <Card className="relative border-brand-500/30 bg-brand-500/[0.05]">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss getting started"
        className="absolute right-3 top-3 rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
      >
        <X size={16} />
      </button>
      <div className="font-display text-lg font-semibold text-slate-100">Welcome to Copper</div>
      <p className="mb-4 mt-0.5 text-sm text-slate-400">
        A few steps to make it yours — {doneCount} of {steps.length} done.
      </p>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.to} className="flex items-center gap-3">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                s.done ? 'bg-brand-500 text-white' : 'border border-slate-500 text-slate-400'
              }`}
            >
              {s.done ? <Check size={14} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={`text-sm font-medium ${
                  s.done ? 'text-slate-500 line-through' : 'text-slate-100'
                }`}
              >
                {s.label}
              </div>
              {!s.done && <div className="text-xs text-slate-500">{s.desc}</div>}
            </div>
            {!s.done && (
              <Link
                to={s.to}
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-500/15 px-2.5 py-1 text-xs font-medium text-brand-400 transition hover:bg-brand-500/25"
              >
                {s.cta} <ArrowRight size={12} />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function Dashboard() {
  const now = useMemo(() => new Date(), []);
  const monthFrom = toDateString(startOfMonth(now));
  const { defaultCurrency, fxRates } = useAppSettings();


  const accountsState = useQuery<Account[]>(
    useCallback((d) => listAccounts(d), []),
    { deps: ['accounts'] },
  );
  const balancesState = useQuery<AccountBalance[]>(
    useCallback((d) => getAccountBalances(d), []),
    { deps: ['accounts', 'transactions'] },
  );
  const totalsState = useQuery<CurrencyTotal[]>(
    useCallback((d) => getTotalsByCurrency(d), []),
    { deps: ['accounts', 'transactions'] },
  );
  const recentState = useQuery<TransactionWithMeta[]>(
    useCallback((d) => listTransactions(d, { limit: 8 }), []),
    { deps: ['transactions'] },
  );
  const budgetsState = useQuery<BudgetWithSpent[]>(
    useCallback(
      (d) => getBudgetsWithSpent(d, monthFrom, defaultCurrency, fxRates),
      [monthFrom, defaultCurrency, fxRates],
    ),
    { deps: ['budgets', 'transactions', 'accounts', 'categories'] },
  );

  const accounts = accountsState.data ?? [];
  const balances = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of balancesState.data ?? []) m.set(b.account_id, b.balance_minor);
    return m;
  }, [balancesState.data]);

  const recent = recentState.data ?? [];
  const budgets = budgetsState.data ?? [];
  const overBudgets = budgets.filter((b) => b.spent_minor > b.amount_minor);

  const { google } = useAuth();
  const [gsDismissed, setGsDismissed] = useState(
    () => localStorage.getItem('et-getting-started-dismissed') === '1',
  );
  const gettingStartedSteps: GettingStartedStep[] = [
    {
      done: recent.length > 0,
      label: 'Record your first transaction',
      desc: 'Tap Add to log an expense or income.',
      to: '/add',
      cta: 'Add',
    },
    {
      done: !!google,
      label: 'Keep your data safe',
      desc: 'Turn on Drive sync, or export a backup file.',
      to: '/settings',
      cta: 'Set up',
    },
    {
      done: budgets.length > 0,
      label: 'Set a monthly budget',
      desc: 'Optional — pick a category and a limit to track spending.',
      to: '/budgets',
      cta: 'Create',
    },
  ];
  // While a first pull is streaming the ledger in, both the checklist ("record
  // your first transaction") and the local-only warning are wrong — the data is
  // arriving. The global SyncProgressBanner speaks for this state instead.
  const firstPull = useIsFirstPull();
  const showGettingStarted =
    !firstPull && !gsDismissed && !gettingStartedSteps.every((s) => s.done);

  return (
    <PageShell title="Dashboard" subtitle="Overview of accounts, budgets and recent activity">
      {showGettingStarted ? (
        <GettingStarted
          steps={gettingStartedSteps}
          onDismiss={() => {
            localStorage.setItem('et-getting-started-dismissed', '1');
            setGsDismissed(true);
          }}
        />
      ) : firstPull ? null : (
        <LocalOnlyWarning />
      )}
      <TotalBalanceCard totals={totalsState.data ?? []} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a) => (
          <Link
            key={a.id}
            to="/accounts"
            className="group rounded-xl border border-slate-800 bg-slate-900/40 p-4 transition hover:-translate-y-0.5 hover:border-brand-500 hover:bg-slate-900/70"
          >
            <div className="flex items-center gap-2">
              <AccountTypeIcon type={a.type as AccountType} className="h-4 w-4 text-slate-400" />
              <div className="text-xs uppercase tracking-wide text-slate-500">
                {a.type.replace('_', ' ')}
              </div>
              {a.include_in_total === 0 && (
                <span
                  title="Not included in your total balance"
                  className="ml-auto rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
                >
                  not counted
                </span>
              )}
            </div>
            <div className="mt-1 text-sm font-medium text-slate-50">
              {a.icon ? <span className="mr-1">{a.icon}</span> : null}
              {a.name}
            </div>
            <Money
              minor={balances.get(a.id) ?? a.opening_balance_minor}
              currency={a.currency}
              className={`mt-2 block font-display text-xl font-semibold tabular-nums ${
                (balances.get(a.id) ?? 0) < 0 ? 'text-clay-400' : 'text-slate-100'
              }`}
            />
          </Link>
        ))}
      </div>

      {overBudgets.length > 0 && (
        <Card>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-clay-400">
            <AlertTriangle className="h-4 w-4" />
            Over budget this month
          </h3>
          <div className="space-y-2">
            {overBudgets.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-200">
                  {b.category_icon} {b.category_name}
                </span>
                <span className="tabular-nums text-clay-400">
                  {formatMoney(b.spent_minor, b.currency)} /{' '}
                  {formatMoney(b.amount_minor, b.currency)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300">Recent transactions</h3>
          <Link to="/transactions" className="flex items-center gap-1 text-xs text-brand-400 hover:underline">
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {recent.length === 0 ? (
          <EmptyState
            title="No transactions yet"
            description="Tap Add to record your first expense or income."
          />
        ) : (
          <div className="divide-y divide-slate-800">
            {recent.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  {tx.kind === 'transfer' ? (
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-400">
                      ↔
                    </span>
                  ) : (
                    <CategoryCoin
                      name={tx.category_name ?? 'Uncategorized'}
                      color={tx.category_color}
                      icon={tx.category_icon}
                      size="sm"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-100">
                      {tx.kind === 'transfer' ? 'Transfer' : tx.category_name ?? 'Uncategorized'}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {formatRelativeDate(tx.occurred_on)} · {tx.account_name}
                      {tx.note ? ` · ${tx.note}` : ''}
                    </div>
                  </div>
                </div>
                <div
                  className={`shrink-0 pl-2 font-display tabular-nums text-sm font-semibold ${
                    tx.amount_minor < 0 ? 'text-clay-400' : 'text-mint-400'
                  }`}
                >
                  {formatMoney(tx.amount_minor, tx.account_currency, { signed: true })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {budgets.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-300">Budget progress</h3>
            <Link to="/budgets" className="flex items-center gap-1 text-xs text-brand-400 hover:underline">
              Manage
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-3">
            {budgets.map((b) => {
              const pct = b.amount_minor > 0 ? Math.min((b.spent_minor / b.amount_minor) * 100, 100) : 0;
              const over = b.spent_minor > b.amount_minor;
              const barColor = over ? 'bg-clay-500' : pct > 80 ? 'bg-amber-500' : 'bg-mint-500';
              return (
                <div key={b.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-slate-300">
                      {b.category_icon} {b.category_name}
                    </span>
                    <span className="tabular-nums text-slate-500">
                      {formatMoney(b.spent_minor, b.currency, { withSymbol: false })} /{' '}
                      {formatMoney(b.amount_minor, b.currency, { withSymbol: false })}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </PageShell>
  );
}

function TotalBalanceCard({ totals }: { totals: CurrencyTotal[] }) {
  if (totals.length === 0) {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-slate-800 p-2">
            <Wallet className="h-5 w-5 text-slate-400" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Total balance</div>
            <div className="text-sm text-slate-400">No accounts yet</div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
        <Wallet className="h-3.5 w-3.5" />
        Total balance
        <InfoHint label="How the balance is calculated" title="As of today">
          Balances count transactions up to today only. Future-dated entries —
          scheduled EMIs and the like — aren’t included until their date arrives.
        </InfoHint>
      </div>
      <div className={`mt-3 grid gap-4 ${totals.length > 1 ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}`}>
        {totals.map((t) => {
          const TrendIcon = t.balance_minor > 0 ? TrendingUp : t.balance_minor < 0 ? TrendingDown : Minus;
          const color =
            t.balance_minor > 0
              ? 'text-mint-400'
              : t.balance_minor < 0
                ? 'text-clay-400'
                : 'text-slate-400';
          return (
            <div key={t.currency}>
              <div className={`flex items-center gap-2 ${color}`}>
                <TrendIcon className="h-5 w-5 shrink-0" />
                <Money
                  minor={t.balance_minor}
                  currency={t.currency}
                  className="font-display text-4xl font-semibold tabular-nums"
                />
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {t.account_count} account{t.account_count === 1 ? '' : 's'} · {t.currency}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
