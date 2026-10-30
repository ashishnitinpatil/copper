import { toDateString } from '@/lib/dates';

// How banks charge interest on a loan paid back monthly:
//  - reducing: each month's interest is the yearly rate / 12 on what's still
//    owed, so it shrinks as the loan is paid down (most home and car loans);
//  - flat: interest is worked out once on the amount borrowed (amount × rate ×
//    years, "simple interest") and spread evenly, so every month carries the
//    same interest. The same rate costs far more charged flat.
// Either way the monthly payment is fixed, covering that month's interest
// first and paying down the principal with the rest.

export type InterestMethod = 'reducing' | 'flat';

export interface LoanTerms {
  method: InterestMethod;
  /** Yearly rate in basis points: 8.5% is 850. */
  rateBp: number;
  /** The amount borrowed (flat interest is charged on this). */
  principal: number;
  /** The fixed monthly payment. */
  payment: number;
}

/** Longest schedule worked out; past this a loan is treated as never paid off. */
const MAX_MONTHS = 1200;

const monthlyRate = (rateBp: number) => rateBp / 10_000 / 12;

/** The fixed monthly payment that pays off `principal` in `months`. */
export function monthlyPayment(method: InterestMethod, principal: number, rateBp: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = monthlyRate(rateBp);
  if (method === 'flat') return Math.round((principal + principal * r * months) / months);
  if (r === 0) return Math.ceil(principal / months);
  return Math.round((principal * r) / (1 - (1 + r) ** -months));
}

/** How the monthly payment splits when `owed` is still owed. */
export function splitPayment(owed: number, terms: LoanTerms): { principal: number; interest: number } {
  const base = terms.method === 'flat' ? terms.principal : owed;
  const interest = Math.max(0, Math.round(base * monthlyRate(terms.rateBp)));
  // The last payment is only what's left.
  const principal = Math.max(0, Math.min(terms.payment - interest, owed));
  return { principal, interest: Math.min(interest, Math.max(0, terms.payment)) };
}

/** Payments left and the interest they carry, or null if the payment never pays it off. */
export function remainingSchedule(owed: number, terms: LoanTerms): { payments: number; interest: number } | null {
  let left = owed;
  let payments = 0;
  let interest = 0;
  while (left > 0) {
    const s = splitPayment(left, terms);
    if (s.principal <= 0 || payments >= MAX_MONTHS) return null;
    left -= s.principal;
    interest += s.interest;
    payments += 1;
  }
  return { payments, interest };
}

/** The flat rate (bp) that costs the same as `rateBp` reducing over `months`. */
export function flatEquivalent(rateBp: number, months: number): number {
  const principal = 1_000_000;
  const total = monthlyPayment('reducing', principal, rateBp, months) * months - principal;
  return Math.round((total / principal / (months / 12)) * 10_000);
}

/** The reducing rate (bp) that costs the same as `rateBp` flat over `months`. */
export function reducingEquivalent(rateBp: number, months: number): number {
  const principal = 1_000_000;
  const target = monthlyPayment('flat', principal, rateBp, months);
  // The reducing payment grows with the rate: home in on the one that matches.
  let lo = 0;
  let hi = 20_000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (monthlyPayment('reducing', principal, mid, months) < target) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/** `day` of the month `monthsAhead` after `date`'s, moved back to the month's last day if it has none. */
function dayInMonth(date: Date, monthsAhead: number, day: number): Date {
  const y = date.getFullYear();
  const m = date.getMonth() + monthsAhead;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, last));
}

/** Due dates (payment day `day`) after `after`, up to and including `until`. */
export function dueDatesBetween(after: string, until: string, day: number): string[] {
  const start = new Date(after + 'T00:00:00');
  const out: string[] = [];
  for (let i = 0; i < MAX_MONTHS; i++) {
    const d = toDateString(dayInMonth(start, i, day));
    if (d > until) break;
    if (d > after) out.push(d);
  }
  return out;
}

/** The first due date (payment day `day`) on or after `from`. */
export function nextDueDate(from: string, day: number): string {
  const start = new Date(from + 'T00:00:00');
  const thisMonth = toDateString(dayInMonth(start, 0, day));
  return thisMonth >= from ? thisMonth : toDateString(dayInMonth(start, 1, day));
}

/** The due date `n` payments after `first` (0 is `first` itself). */
export function dueDateAfter(first: string, n: number, day: number): string {
  return toDateString(dayInMonth(new Date(first + 'T00:00:00'), n, day));
}

/** "8.5%" from 850 basis points. */
export function formatRate(rateBp: number): string {
  return `${Number((rateBp / 100).toFixed(2))}%`;
}

/** The yearly rate (bp, to the nearest 0.05%) that charges `interest` a month on `base`. */
export function impliedRate(interest: number, base: number): number {
  if (base <= 0) return 0;
  return Math.round(((interest / base) * 12 * 10_000) / 5) * 5;
}
