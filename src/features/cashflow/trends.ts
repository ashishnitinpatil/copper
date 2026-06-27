/**
 * Pure helpers for the Cashflow "Trend" mode: historical end-of-day balances
 * and a flat-average projection of the next N months.
 *
 * Everything here is pure (no DB, no Date.now) so it can be unit-tested; the
 * component feeds it query results plus today's month.
 */
import { convert, type FxRates } from '@/lib/fx';
import type { Account } from '@/db/types';

/** Net change (all kinds, incl. transfers) per account per month. */
export interface DeltaRow {
  account_id: string;
  ym: string; // YYYY-MM
  delta_minor: number;
}

/** Income/expense magnitude (transfers excluded) per account per month. */
export interface InOutRow {
  account_id: string;
  ym: string;
  kind: 'income' | 'expense';
  currency: string;
  total_minor: number; // always positive (SUM of ABS)
}

export interface BalancePoint {
  ym: string;
  balance_minor: number; // default currency for 'all', native for a single account
  projected: boolean;
}

export interface InOutPoint {
  ym: string;
  income: number; // default currency, minor
  expenses: number;
  projected: boolean;
}

/** 'all' = every account that counts toward the total; otherwise an account id. */
export type Scope = 'all' | string;

export function addMonthsYm(ym: string, k: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + k;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function monthRange(fromYm: string, toYm: string): string[] {
  if (fromYm > toYm) return [];
  const out: string[] = [];
  let cur = fromYm;
  // Guard against pathological inputs producing a runaway loop.
  for (let i = 0; cur <= toYm && i < 1200; i++) {
    out.push(cur);
    cur = addMonthsYm(cur, 1);
  }
  return out;
}

function includedAccounts(accounts: Account[], scope: Scope): Account[] {
  return scope === 'all'
    ? accounts.filter((a) => a.archived_at === null && a.include_in_total === 1)
    : accounts.filter((a) => a.id === scope);
}

interface BalanceOpts {
  accounts: Account[];
  deltas: DeltaRow[];
  scope: Scope;
  defaultCurrency: string;
  fxRates: FxRates;
  throughYm: string; // current month, YYYY-MM
}

/**
 * Month-end balance for each month from the first activity through `throughYm`.
 * Balance at month M = opening_balance + Σ(delta up to and including M), carried
 * forward across months with no activity. Each account's running balance is
 * converted to the default currency before summing, so the whole view shares
 * one currency and the final 'all' point matches the dashboard total.
 */
export function buildBalanceSeries(opts: BalanceOpts): BalancePoint[] {
  const { accounts, deltas, scope, defaultCurrency, fxRates, throughYm } = opts;
  const included = includedAccounts(accounts, scope);
  if (included.length === 0) return [];

  const ids = new Set(included.map((a) => a.id));
  const relevant = deltas.filter((d) => ids.has(d.account_id));

  const earliest = relevant.reduce(
    (min, d) => (d.ym < min ? d.ym : min),
    relevant[0]?.ym ?? throughYm,
  );
  const months = monthRange(earliest < throughYm ? earliest : throughYm, throughYm);

  const deltaByKey = new Map<string, number>();
  for (const d of relevant) deltaByKey.set(`${d.account_id}|${d.ym}`, d.delta_minor);

  const running = new Map<string, number>();
  for (const a of included) running.set(a.id, a.opening_balance_minor);

  return months.map((ym) => {
    let total = 0;
    for (const a of included) {
      const cur = running.get(a.id)! + (deltaByKey.get(`${a.id}|${ym}`) ?? 0);
      running.set(a.id, cur);
      total += convert(cur, a.currency, defaultCurrency, defaultCurrency, fxRates);
    }
    return { ym, balance_minor: total, projected: false };
  });
}

interface InOutOpts {
  accounts: Account[];
  rows: InOutRow[];
  scope: Scope;
  defaultCurrency: string;
  fxRates: FxRates;
  months: string[]; // the month axis from buildBalanceSeries, oldest→newest
}

/**
 * Income and expense totals per month over the same axis as the balance series,
 * in the default currency. Months with no activity come back as zero so the
 * average isn't skewed by gaps.
 */
export function buildInOutSeries(opts: InOutOpts): InOutPoint[] {
  const { accounts, rows, scope, defaultCurrency, fxRates, months } = opts;
  const ids = new Set(includedAccounts(accounts, scope).map((a) => a.id));

  const byYm = new Map<string, { income: number; expenses: number }>();
  for (const ym of months) byYm.set(ym, { income: 0, expenses: 0 });

  for (const r of rows) {
    if (!ids.has(r.account_id)) continue;
    const bucket = byYm.get(r.ym);
    if (!bucket) continue;
    const conv = convert(r.total_minor, r.currency, defaultCurrency, defaultCurrency, fxRates);
    if (r.kind === 'income') bucket.income += conv;
    else bucket.expenses += conv;
  }

  return months.map((ym) => ({ ym, ...byYm.get(ym)!, projected: false }));
}

/**
 * Flat average of income/expense over the last `n` *completed* months. The
 * current (partial) month is excluded so a mid-month snapshot doesn't drag the
 * average down. Averages over however many completed months exist, up to n.
 */
export function avgInOut(
  actual: InOutPoint[],
  n: number,
  currentYm: string,
): { income: number; expenses: number; monthsUsed: number } {
  const completed = actual.filter((p) => p.ym < currentYm);
  const window = completed.slice(-n);
  if (window.length === 0) return { income: 0, expenses: 0, monthsUsed: 0 };
  const sumI = window.reduce((s, p) => s + p.income, 0);
  const sumE = window.reduce((s, p) => s + p.expenses, 0);
  return {
    income: Math.round(sumI / window.length),
    expenses: Math.round(sumE / window.length),
    monthsUsed: window.length,
  };
}

/** Repeat the average income/expense forward for `n` months. */
export function projectInOut(
  fromYm: string,
  avg: { income: number; expenses: number },
  n: number,
): InOutPoint[] {
  const out: InOutPoint[] = [];
  for (let k = 1; k <= n; k++) {
    out.push({ ym: addMonthsYm(fromYm, k), income: avg.income, expenses: avg.expenses, projected: true });
  }
  return out;
}

/** Extend the balance line forward by adding the average net change each month. */
export function projectBalance(
  lastBalanceMinor: number,
  fromYm: string,
  avgNetMinor: number,
  n: number,
): BalancePoint[] {
  const out: BalancePoint[] = [];
  let bal = lastBalanceMinor;
  for (let k = 1; k <= n; k++) {
    bal += avgNetMinor;
    out.push({ ym: addMonthsYm(fromYm, k), balance_minor: bal, projected: true });
  }
  return out;
}
