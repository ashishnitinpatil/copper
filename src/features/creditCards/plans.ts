import type { CardPlan } from '@/db/types';
import { dueDateAfter, monthlyPayment, splitPayment } from '@/features/loans/loanMath';

// A card instalment plan (an EPP, or a loan on the card): the whole amount sits
// on the card's balance from the start — the credit is used — but each
// statement bills only one instalment of it, plus that month's interest. The
// interest works like a loan's: on what's still owed ("reducing", what a
// monthly rate on the card usually means) or on the amount converted ("flat").

export interface Instalment {
  /** 1-based. */
  n: number;
  /** The statement that bills it. */
  statement: string;
  principal: number;
  interest: number;
  /** The processing fee, on the first statement only. */
  fee: number;
  /** Settled early: everything left, billed at once, without interest. */
  settled?: boolean;
}

type PlanTerms = Pick<
  CardPlan,
  'principal_minor' | 'months' | 'rate_bp' | 'method' | 'fee_minor' | 'first_statement' | 'settled_on'
> &
  Partial<Pick<CardPlan, 'interest_upfront'>>;

/**
 * Whether the bank puts all the interest on the card when the plan starts (as
 * many do for flat-rate deals: the statement's deal amount includes it), rather
 * than each statement adding that month's.
 */
export const interestUpfront = (plan: Pick<CardPlan, 'method'> & Partial<Pick<CardPlan, 'interest_upfront'>>) =>
  plan.interest_upfront == null ? plan.method === 'flat' : plan.interest_upfront === 1;

/** The fixed monthly instalment (principal + interest). */
export function instalmentAmount(plan: Pick<CardPlan, 'principal_minor' | 'months' | 'rate_bp' | 'method'>): number {
  return monthlyPayment(plan.method, plan.principal_minor, plan.rate_bp, plan.months);
}

/** Every instalment: one a statement, from the first, on the card's statement day. */
export function planSchedule(plan: PlanTerms, statementDay: number): Instalment[] {
  const payment = instalmentAmount(plan);
  const terms = { method: plan.method, rateBp: plan.rate_bp, principal: plan.principal_minor, payment };
  const out: Instalment[] = [];
  let owed = plan.principal_minor;
  // Flat: the last instalment brings the interest to the bank's figure (amount × rate × months).
  const flatInterest = plan.method === 'flat' ? Math.round((plan.principal_minor * plan.rate_bp * plan.months) / 120_000) : null;
  let interestSoFar = 0;
  for (let i = 0; i < plan.months && owed > 0; i++) {
    const statement = dueDateAfter(plan.first_statement, i, statementDay);
    const fee = i === 0 ? plan.fee_minor : 0;
    if (plan.settled_on && statement >= plan.settled_on) {
      out.push({ n: i + 1, statement, principal: owed, interest: 0, fee, settled: true });
      break;
    }
    const s = splitPayment(owed, terms);
    // The last instalment takes whatever rounding left over.
    const last = i === plan.months - 1;
    const principal = last ? owed : s.principal;
    const interest = last && flatInterest != null ? Math.max(0, flatInterest - interestSoFar) : s.interest;
    out.push({ n: i + 1, statement, principal, interest, fee });
    owed -= principal;
    interestSoFar += interest;
  }
  return out;
}

/**
 * What's on the card but still to be billed after the statement of `date`:
 * principal, and the interest of later instalments too when it all went on at
 * the start.
 */
export function unbilledAfter(plan: PlanTerms, statementDay: number, date: string): number {
  const upfront = interestUpfront(plan);
  return planSchedule(plan, statementDay)
    .filter((i) => i.statement > date)
    .reduce((sum, i) => sum + i.principal + (upfront ? i.interest : 0), 0);
}

/** The interest of the whole plan. */
export const totalInterest = (plan: PlanTerms, statementDay: number) =>
  planSchedule(plan, statementDay).reduce((sum, i) => sum + i.interest, 0);

/** "0.89% a month" ⇄ the yearly basis points the plan stores. */
export const monthlyRateToBp = (percentAMonth: number) => Math.round(percentAMonth * 12 * 100);
export const bpToMonthlyRate = (bp: number) => Number((bp / 12 / 100).toFixed(4));

export interface PlanProgress {
  /** Instalments on statements up to `today`. */
  billed: number;
  total: number;
  settled: boolean;
  /** The next statement with an instalment, if any are left. */
  next: string | null;
  /** On the card, still to come on statements (principal, plus interest when it went on at the start). */
  left: number;
}

/** Where a plan is on `today`. */
export function planProgress(plan: PlanTerms, statementDay: number, today: string): PlanProgress {
  const schedule = planSchedule(plan, statementDay);
  return {
    billed: schedule.filter((i) => i.statement <= today).length,
    total: schedule.length,
    settled: !!plan.settled_on,
    next: schedule.find((i) => i.statement > today)?.statement ?? null,
    left: unbilledAfter(plan, statementDay, today),
  };
}

/** "Instalments · 8 of 48" (with `billed`, "8 of 48 billed"), "Instalments · all 48 billed", "Instalments · settled". */
export function progressLabel(p: PlanProgress, billed = false): string {
  if (p.settled) return 'Instalments · settled';
  if (p.billed >= p.total) return `Instalments · all ${p.total} billed`;
  return `Instalments · ${p.billed} of ${p.total}${billed ? ' billed' : ''}`;
}
