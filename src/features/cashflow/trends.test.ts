import { describe, it, expect } from 'vitest';
import type { Account } from '@/db/types';
import {
  addMonthsYm,
  monthRange,
  buildBalanceSeries,
  buildInOutSeries,
  avgInOut,
  projectInOut,
  projectBalance,
  type DeltaRow,
  type InOutRow,
  type InOutPoint,
} from './trends';

function acct(over: Partial<Account>): Account {
  return {
    id: 'a',
    name: 'A',
    type: 'bank',
    currency: 'AED',
    opening_balance_minor: 0,
    is_main: 0,
    include_in_total: 1,
    credit_limit_minor: null,
    statement_day: null,
    due_day: null,
    pay_from_account_id: null,
    color: null,
    icon: null,
    starts_on: '',
    archived_at: null,
    created_at: '2023-01-01T00:00:00Z',
    ...over,
  };
}

describe('addMonthsYm', () => {
  it('rolls across year boundaries both ways', () => {
    expect(addMonthsYm('2026-06', 1)).toBe('2026-07');
    expect(addMonthsYm('2026-12', 1)).toBe('2027-01');
    expect(addMonthsYm('2026-01', -1)).toBe('2025-12');
    expect(addMonthsYm('2026-06', 6)).toBe('2026-12');
  });
});

describe('monthRange', () => {
  it('is inclusive and ordered', () => {
    expect(monthRange('2026-04', '2026-07')).toEqual(['2026-04', '2026-05', '2026-06', '2026-07']);
  });
  it('returns empty when from is after to', () => {
    expect(monthRange('2026-08', '2026-06')).toEqual([]);
  });
});

describe('buildBalanceSeries', () => {
  it('carries opening balance forward and accumulates deltas (single account)', () => {
    const accounts = [acct({ id: 'a', opening_balance_minor: 10000 })];
    const deltas: DeltaRow[] = [
      { account_id: 'a', ym: '2026-04', delta_minor: 5000 },
      { account_id: 'a', ym: '2026-06', delta_minor: -2000 },
    ];
    const series = buildBalanceSeries({
      accounts,
      deltas,
      scope: 'a',
      defaultCurrency: 'AED',
      fxRates: {},
      throughYm: '2026-06',
    });
    expect(series.map((p) => [p.ym, p.balance_minor])).toEqual([
      ['2026-04', 15000], // 10000 + 5000
      ['2026-05', 15000], // carried
      ['2026-06', 13000], // 15000 - 2000
    ]);
    expect(series.every((p) => !p.projected)).toBe(true);
  });

  it("sums accounts for 'all' and only includes counted, non-archived accounts", () => {
    const accounts = [
      acct({ id: 'a', opening_balance_minor: 10000 }),
      acct({ id: 'b', opening_balance_minor: 0 }),
      acct({ id: 'x', include_in_total: 0, opening_balance_minor: 99999 }), // excluded
      acct({ id: 'y', archived_at: '2026-01-01T00:00:00Z', opening_balance_minor: 88888 }), // excluded
    ];
    const deltas: DeltaRow[] = [
      { account_id: 'a', ym: '2026-06', delta_minor: 1000 },
      { account_id: 'b', ym: '2026-06', delta_minor: 2000 },
      { account_id: 'x', ym: '2026-06', delta_minor: 500 },
    ];
    const series = buildBalanceSeries({
      accounts,
      deltas,
      scope: 'all',
      defaultCurrency: 'AED',
      fxRates: {},
      throughYm: '2026-06',
    });
    expect(series).toEqual([{ ym: '2026-06', balance_minor: 13000, projected: false }]);
  });

  it('converts foreign-currency accounts to the default currency', () => {
    // 1 USD = 3.67 AED; both two-decimal currencies.
    const accounts = [acct({ id: 'u', currency: 'USD', opening_balance_minor: 10000 })]; // $100
    const series = buildBalanceSeries({
      accounts,
      deltas: [],
      scope: 'all',
      defaultCurrency: 'AED',
      fxRates: { USD: 3.67 },
      throughYm: '2026-06',
    });
    expect(series[0].balance_minor).toBe(36700); // 367.00 AED
  });
});

describe('avgInOut', () => {
  const actual: InOutPoint[] = [
    { ym: '2026-03', income: 9000, expenses: 3000, projected: false },
    { ym: '2026-04', income: 11000, expenses: 5000, projected: false },
    { ym: '2026-05', income: 10000, expenses: 4000, projected: false },
    { ym: '2026-06', income: 1000, expenses: 200, projected: false }, // current partial month
  ];

  it('averages the last N completed months, excluding the current partial month', () => {
    expect(avgInOut(actual, 3, '2026-06')).toEqual({ income: 10000, expenses: 4000, monthsUsed: 3 });
  });

  it('uses fewer months when history is short', () => {
    expect(avgInOut(actual.slice(0, 2), 6, '2026-06')).toEqual({
      income: 10000,
      expenses: 4000,
      monthsUsed: 2,
    });
  });

  it('returns zeros with no completed months', () => {
    expect(avgInOut([actual[3]], 3, '2026-06')).toEqual({ income: 0, expenses: 0, monthsUsed: 0 });
  });
});

describe('projectInOut / projectBalance', () => {
  it('repeats the average forward and marks points projected', () => {
    const proj = projectInOut('2026-06', { income: 10000, expenses: 4000 }, 2);
    expect(proj).toEqual([
      { ym: '2026-07', income: 10000, expenses: 4000, projected: true },
      { ym: '2026-08', income: 10000, expenses: 4000, projected: true },
    ]);
  });

  it('extends the balance by the average net change', () => {
    const proj = projectBalance(13000, '2026-06', 6000, 3); // +6000/mo
    expect(proj.map((p) => [p.ym, p.balance_minor])).toEqual([
      ['2026-07', 19000],
      ['2026-08', 25000],
      ['2026-09', 31000],
    ]);
    expect(proj.every((p) => p.projected)).toBe(true);
  });
});

describe('buildInOutSeries', () => {
  it('fills gap months with zero and respects scope', () => {
    const accounts = [acct({ id: 'a' }), acct({ id: 'b', include_in_total: 0 })];
    const rows: InOutRow[] = [
      { account_id: 'a', ym: '2026-05', kind: 'income', currency: 'AED', total_minor: 5000 },
      { account_id: 'a', ym: '2026-05', kind: 'expense', currency: 'AED', total_minor: 2000 },
      { account_id: 'b', ym: '2026-05', kind: 'income', currency: 'AED', total_minor: 9999 }, // excluded by scope 'all'
    ];
    const out = buildInOutSeries({
      accounts,
      rows,
      scope: 'all',
      defaultCurrency: 'AED',
      fxRates: {},
      months: ['2026-04', '2026-05'],
    });
    expect(out).toEqual([
      { ym: '2026-04', income: 0, expenses: 0, projected: false },
      { ym: '2026-05', income: 5000, expenses: 2000, projected: false },
    ]);
  });
});
