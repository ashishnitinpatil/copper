import { describe, expect, it } from 'vitest';
import { instalmentAmount, interestUpfront, monthlyRateToBp, planSchedule, totalInterest, unbilledAfter } from './plans';

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

  it('flat interest comes mostly early, adding up to amount × rate × months; 0% has none', () => {
    const flat = planSchedule({ ...plan, method: 'flat', months: 12 }, 3);
    const interest = flat.map((i) => i.interest);
    expect(interest[0]).toBeGreaterThan(interest[10]);
    expect(interest.reduce((n, i) => n + i, 0)).toBe(Math.round((1_000_000 * plan.rate_bp * 12) / 120_000));
    expect(flat.reduce((n, i) => n + i.principal, 0)).toBe(1_000_000);
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

  // A Mashreq statement (23 Oct 2026): 55,000 at 0.79% a month flat over 48
  // months, booked 24 Mar; deal amount 75,856.00, instalment 1,580.33, 41 left,
  // 64,793.77 outstanding.
  it('reproduces a real flat deal from a bank statement', () => {
    const deal = {
      principal_minor: 5_500_000,
      months: 48,
      rate_bp: monthlyRateToBp(0.79),
      method: 'flat' as const,
      fee_minor: 0,
      first_statement: '2026-04-23',
      settled_on: null,
    };
    expect(interestUpfront(deal)).toBe(true);
    expect(instalmentAmount(deal)).toBe(158_033);
    expect(totalInterest(deal, 23)).toBe(2_085_600);
    expect(planSchedule(deal, 23).filter((i) => i.statement <= '2026-10-23')).toHaveLength(7);
    // Principal and interest still to come: the deal's outstanding, to rounding.
    expect(unbilledAfter(deal, 23, '2026-10-23')).toBe(6_479_369);
    // The bank splits each instalment at the rate it works out to (about 1.4% a
    // month on what's left): 8 statements in (23 Nov), 5,820 of interest has
    // been billed and 48,178 of the 55,000 is still owed.
    const billed = planSchedule({ ...deal, interest_upfront: 0 }, 23).filter((i) => i.statement <= '2026-11-23');
    expect(billed).toHaveLength(8);
    expect(Math.abs(billed.reduce((n, i) => n + i.interest, 0) - 582_029)).toBeLessThan(10);
    expect(Math.abs(unbilledAfter({ ...deal, interest_upfront: 0 }, 23, '2026-11-23') - 4_817_765)).toBeLessThan(10);
  });

  it('interest goes on up front for flat plans unless said otherwise; monthly for reducing', () => {
    expect(interestUpfront({ method: 'flat', interest_upfront: null })).toBe(true);
    expect(interestUpfront({ method: 'reducing', interest_upfront: null })).toBe(false);
    expect(interestUpfront({ method: 'flat', interest_upfront: 0 })).toBe(false);
    expect(interestUpfront({ method: 'reducing', interest_upfront: 1 })).toBe(true);
    // Monthly interest: only principal is left to bill.
    expect(unbilledAfter({ ...plan, interest_upfront: 0 }, 3, '2025-12-31')).toBe(1_000_000);
  });
});
