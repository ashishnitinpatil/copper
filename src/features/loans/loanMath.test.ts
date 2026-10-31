import { describe, expect, it } from 'vitest';
import {
  dueDateAfter,
  dueDatesBetween,
  flatEquivalent,
  interestBefore,
  monthlyPayment,
  nextDueDate,
  reducingEquivalent,
  remainingSchedule,
  splitPayment,
  type LoanTerms,
} from './loanMath';

const car: LoanTerms = { method: 'reducing', rateBp: 750, principal: 2_000_000, payment: 40_076 };

describe('monthlyPayment', () => {
  it('matches a standard loan calculator', () => {
    // $20,000 at 7.5% over 5 years: $400.76 a month.
    expect(monthlyPayment('reducing', 2_000_000, 750, 60)).toBe(40_076);
    // ₹10,00,000 at 9% over 20 years: ₹8,997.26.
    expect(monthlyPayment('reducing', 100_000_000, 900, 240)).toBe(899_726);
  });

  it('spreads an interest-free loan evenly', () => {
    expect(monthlyPayment('reducing', 120_000, 0, 12)).toBe(10_000);
  });
});

describe('splitPayment', () => {
  it('covers the month’s interest first', () => {
    // 7.5% a year is 0.625% a month: $125 on $20,000.
    expect(splitPayment(2_000_000, car)).toEqual({ principal: 27_576, interest: 12_500 });
  });

  it('charges only what’s left on the last payment', () => {
    expect(splitPayment(10_000, { ...car, rateBp: 1200, payment: 40_000 })).toEqual({ principal: 10_000, interest: 100 });
  });
});

describe('remainingSchedule', () => {
  it('pays a loan off in its term, with the interest a calculator shows', () => {
    const s = remainingSchedule(2_000_000, car)!;
    expect(s.payments).toBe(60);
    // $4,045.54 of interest over the five years (to within rounding).
    expect(Math.abs(s.interest - 404_554)).toBeLessThan(100);
  });

  it('says so when the payment never catches up with the interest', () => {
    expect(remainingSchedule(2_000_000, { ...car, payment: 12_000 })).toBeNull();
  });
});

describe('flat-rate loans', () => {
  // ₹1,00,000 at 10% flat for 2 years: ₹20,000 interest, ₹5,000 a month of
  // which ₹833.33 is interest, every month.
  const flat: LoanTerms = { method: 'flat', rateBp: 1000, principal: 10_000_000, payment: 500_000 };

  it('spreads amount × rate × years evenly over the term', () => {
    expect(monthlyPayment('flat', 10_000_000, 1000, 24)).toBe(500_000);
  });

  it('charges the same interest every month, however much is left', () => {
    expect(splitPayment(10_000_000, flat)).toEqual({ principal: 416_667, interest: 83_333 });
    expect(splitPayment(1_000_000, flat)).toEqual({ principal: 416_667, interest: 83_333 });
    const s = remainingSchedule(10_000_000, flat)!;
    expect(s.payments).toBe(24);
    expect(Math.abs(s.interest - 2_000_000)).toBeLessThan(24);
  });

  it('puts a rate side by side with what it costs the other way', () => {
    // 10% flat over 2 years costs about the same as 18.0% reducing…
    expect(reducingEquivalent(1000, 24) / 100).toBeCloseTo(18.0, 0);
    // …and 7.5% reducing over 5 years is about 4.0% flat.
    expect(flatEquivalent(750, 60) / 100).toBeCloseTo(4.0, 0);
    expect(reducingEquivalent(flatEquivalent(750, 60), 60)).toBeCloseTo(750, -1);
  });
});

describe('due dates', () => {
  it('lists each month’s payment day after a date, ending on a month’s last day when it has no such day', () => {
    expect(dueDatesBetween('2026-01-15', '2026-04-30', 31)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(dueDatesBetween('2026-01-05', '2026-03-04', 5)).toEqual(['2026-02-05']);
  });

  it('finds the next payment day and the ones after it', () => {
    expect(nextDueDate('2026-10-31', 5)).toBe('2026-11-05');
    expect(nextDueDate('2026-11-05', 5)).toBe('2026-11-05');
    expect(dueDateAfter('2026-11-05', 59, 5)).toBe('2031-10-05');
  });
});

describe('interestBefore', () => {
  // ₹100,000 at 12% over 12 months: ₹8,884.88 a month.
  const terms: LoanTerms = { method: 'reducing', rateBp: 1200, principal: 10_000_000, payment: 888_488 };
  it('is the payments already made less the principal they paid off', () => {
    // Two payments in: ₹84,151.39 owed, 10 left.
    const est = interestBefore(8_415_139, terms, 12)!;
    // 2 × 8,884.88 − 15,848.61 = 1,921.15 (₹1,000 + ₹921.15).
    expect(est).toBe(2 * 888_488 - (10_000_000 - 8_415_139));
    expect(est).toBe(192_115);
  });
  it('is nothing for a loan tracked from the start, or without a term', () => {
    expect(interestBefore(10_000_000, terms, 12)).toBeNull();
    expect(interestBefore(8_415_139, terms, null)).toBeNull();
    expect(interestBefore(8_415_139, { ...terms, payment: 0 }, 12)).toBeNull();
  });
});
