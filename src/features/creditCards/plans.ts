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
>;

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
  for (let i = 0; i < plan.months && owed > 0; i++) {
    const statement = dueDateAfter(plan.first_statement, i, statementDay);
    const fee = i === 0 ? plan.fee_minor : 0;
    if (plan.settled_on && statement >= plan.settled_on) {
      out.push({ n: i + 1, statement, principal: owed, interest: 0, fee, settled: true });
      break;
    }
    const s = splitPayment(owed, terms);
    // The last instalment takes whatever rounding left over.
    const principal = i === plan.months - 1 ? owed : s.principal;
    out.push({ n: i + 1, statement, principal, interest: s.interest, fee });
    owed -= principal;
  }
  return out;
}

/** What's still to be billed after the statement of `date` (principal only). */
export function unbilledAfter(plan: PlanTerms, statementDay: number, date: string): number {
  const billed = planSchedule(plan, statementDay)
    .filter((i) => i.statement <= date)
    .reduce((sum, i) => sum + i.principal, 0);
  return Math.max(0, plan.principal_minor - billed);
}

/** "0.89% a month" ⇄ the yearly basis points the plan stores. */
export const monthlyRateToBp = (percentAMonth: number) => Math.round(percentAMonth * 12 * 100);
export const bpToMonthlyRate = (bp: number) => Number((bp / 12 / 100).toFixed(4));
