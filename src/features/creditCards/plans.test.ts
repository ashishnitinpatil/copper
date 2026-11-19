import { describe, expect, it } from 'vitest';
import { instalmentAmount, monthlyRateToBp, planSchedule, unbilledAfter } from './plans';

const plan = {
  principal_minor: 1_000_000, // 10,000.00
  months: 48,
  rate_bp: monthlyRateToBp(0.89),
  method: 'reducing' as const,
  fee_minor: 0,
  first_statement: '2026-01-03',
  settled_on: null,
};

describe('card instalment plans', () => {
  it('0.89% a month over 48 months: the usual amortised instalment, paying it all off', () => {
    expect(plan.rate_bp).toBe(1068);
    const s = planSchedule(plan, 3);
    expect(s).toHaveLength(48);
    expect(instalmentAmount(plan)).toBe(25_690); // 256.90 a month
    expect(s[0].interest).toBe(8_900); // 0.89% of 10,000
    expect(s.reduce((n, i) => n + i.principal, 0)).toBe(1_000_000);
    expect(s[1].statement).toBe('2026-02-03');
    expect(s[47].statement).toBe('2029-12-03');
  });

  it('flat interest stays the same every month; 0% has none', () => {
    const flat = planSchedule({ ...plan, method: 'flat', months: 12 }, 3);
    expect(new Set(flat.map((i) => i.interest)).size).toBe(1);
    const free = planSchedule({ ...plan, rate_bp: 0, months: 3 }, 3);
    expect(free.map((i) => i.interest)).toEqual([0, 0, 0]);
    expect(free.reduce((n, i) => n + i.principal, 0)).toBe(1_000_000);
  });

  it('the fee comes on the first statement', () => {
    const s = planSchedule({ ...plan, fee_minor: 10_500 }, 3);
    expect(s[0].fee).toBe(10_500);
    expect(s[1].fee).toBe(0);
  });

  it('what is left to bill after a statement', () => {
    expect(unbilledAfter(plan, 3, '2025-12-31')).toBe(1_000_000);
    const s = planSchedule(plan, 3);
    expect(unbilledAfter(plan, 3, '2026-02-03')).toBe(1_000_000 - s[0].principal - s[1].principal);
    expect(unbilledAfter(plan, 3, '2030-01-01')).toBe(0);
  });

  it('settling early bills everything left on the next statement, without interest', () => {
    const settled = { ...plan, settled_on: '2026-03-10' };
    const s = planSchedule(settled, 3);
    expect(s).toHaveLength(4);
    expect(s[3]).toMatchObject({ statement: '2026-04-03', interest: 0, settled: true });
    expect(s.reduce((n, i) => n + i.principal, 0)).toBe(1_000_000);
    expect(unbilledAfter(settled, 3, '2026-04-03')).toBe(0);
  });
});
