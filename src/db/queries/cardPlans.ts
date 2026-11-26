import type { DB } from '../wasm';
import type { CardPlan } from '../types';
import { uuid } from '../uuid';
import { nowIso, toDateString } from '@/lib/dates';
import { interestUpfront, planSchedule, totalInterest } from '@/features/creditCards/plans';
import { dueDateAfter, nextDueDate } from '@/features/loans/loanMath';
import { partCategory } from './loans';

/** A plan with what it's for: its card's statement day and the entry it converts. */
export interface CardPlanInfo extends CardPlan {
  statement_day: number;
  card_name: string;
  tx_date: string;
  tx_note: string | null;
  tx_amount: number;
}

// Plans whose card or entry is gone drop out here (no foreign keys to cascade).
const PLANS = `SELECT p.*, a.statement_day, a.name AS card_name, t.occurred_on AS tx_date, t.note AS tx_note,
    -t.amount_minor AS tx_amount
  FROM card_plans p
  JOIN accounts a ON a.id = p.card_id AND a.statement_day IS NOT NULL
  JOIN transactions t ON t.id = p.transaction_id`;

export async function listCardPlans(db: DB, cardId?: string): Promise<CardPlanInfo[]> {
  return db.execO<CardPlanInfo>(
    `${PLANS} ${cardId ? 'WHERE p.card_id = ?' : ''} ORDER BY t.occurred_on`,
    cardId ? [cardId] : [],
  );
}

export async function getPlanForTransaction(db: DB, transactionId: string): Promise<CardPlanInfo | null> {
  const [plan] = await db.execO<CardPlanInfo>(`${PLANS} WHERE p.transaction_id = ?`, [transactionId]);
  return plan ?? null;
}

export type CardPlanInput = Pick<
  CardPlan,
  | 'card_id'
  | 'transaction_id'
  | 'principal_minor'
  | 'months'
  | 'rate_bp'
  | 'method'
  | 'fee_minor'
  | 'first_statement'
  | 'interest_upfront'
> & {
  /** Statements already past whose interest is recorded some other way: skip adding it. */
  billedThrough?: string;
};

export async function createCardPlan(db: DB, input: CardPlanInput): Promise<string> {
  const id = uuid();
  await db.exec(
    `INSERT INTO card_plans (id, card_id, transaction_id, principal_minor, months, rate_bp, method, fee_minor,
       first_statement, billed_through, created_at, interest_upfront)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.card_id,
      input.transaction_id,
      input.principal_minor,
      input.months,
      input.rate_bp,
      input.method,
      input.fee_minor,
      input.first_statement,
      input.billedThrough ?? '',
      nowIso(),
      input.interest_upfront,
    ],
  );
  await materializeCardPlans(db);
  return id;
}

/**
 * New terms. Interest added at the start is worked out again: the terms were
 * corrected, so the bank's charge was the new figure all along. Monthly interest
 * already added stays (the bank charged it). How it's added (up front or monthly)
 * isn't changed here.
 */
export async function updateCardPlan(
  db: DB,
  id: string,
  terms: Pick<CardPlan, 'principal_minor' | 'months' | 'rate_bp' | 'method' | 'fee_minor' | 'first_statement'>,
): Promise<void> {
  await db.exec(
    `UPDATE card_plans SET principal_minor = ?, months = ?, rate_bp = ?, method = ?, fee_minor = ?, first_statement = ?
     WHERE id = ?`,
    [terms.principal_minor, terms.months, terms.rate_bp, terms.method, terms.fee_minor, terms.first_statement, id],
  );
  const [plan] = await db.execO<CardPlanInfo>(`${PLANS} WHERE p.id = ?`, [id]);
  // Not once settled: the refund was worked out from the old figure.
  if (plan && interestUpfront(plan) && !plan.settled_on) {
    await db.exec('UPDATE transactions SET amount_minor = ?, note = ? WHERE id = ?', [
      -totalInterest(plan, plan.statement_day),
      `Interest for all ${plan.months} instalments · ${label(plan)}`,
      `plan:${id}:interest`,
    ]);
  }
  await materializeCardPlans(db);
}

type TxFields = { account_id: string; amount_minor: number; occurred_on: string };

/**
 * The entry a plan converts was changed (edited, or an edit undone): the plan
 * follows it. A plan of the whole amount takes the new amount; one of part of
 * it is cut down only if the entry is now smaller. A new date moves the first
 * instalment by as many statements as the date moved; another card takes the
 * plan along. Interest and fees already on the card stay as they are.
 */
export async function followPlanTransaction(db: DB, transactionId: string, before: TxFields | null): Promise<void> {
  if (!before) return;
  const [plan] = await db.execO<CardPlan>('SELECT * FROM card_plans WHERE transaction_id = ?', [transactionId]);
  if (!plan) return;
  const [now] = await db.execO<TxFields>('SELECT account_id, amount_minor, occurred_on FROM transactions WHERE id = ?', [
    transactionId,
  ]);
  if (!now) return;
  const was = -before.amount_minor;
  const amount = -now.amount_minor;
  let principal = plan.principal_minor;
  if (amount > 0 && amount !== was && (principal === was || principal > amount)) principal = amount;

  let first = plan.first_statement;
  if (now.occurred_on !== before.occurred_on || now.account_id !== before.account_id) {
    const days = await db.execO<{ id: string; statement_day: number | null }>(
      'SELECT id, statement_day FROM accounts WHERE id IN (?, ?)',
      [before.account_id, now.account_id],
    );
    const oldDay = days.find((d) => d.id === before.account_id)?.statement_day;
    const newDay = days.find((d) => d.id === now.account_id)?.statement_day;
    if (oldDay && newDay) {
      // Which statement after the entry it starts on (0: the first one).
      const start = nextDueDate(before.occurred_on, oldDay);
      let n = 0;
      while (n < 120 && dueDateAfter(start, n, oldDay) < plan.first_statement) n++;
      first = dueDateAfter(nextDueDate(now.occurred_on, newDay), n, newDay);
    }
  }
  if (principal === plan.principal_minor && first === plan.first_statement && now.account_id === plan.card_id) return;
  await db.exec('UPDATE card_plans SET principal_minor = ?, first_statement = ?, card_id = ? WHERE id = ?', [
    principal,
    first,
    now.account_id,
    plan.id,
  ]);
  await materializeCardPlans(db);
}

/** Back to an ordinary entry. Interest and fees already added stay: the bank charged them. */
export async function deleteCardPlan(db: DB, id: string): Promise<void> {
  await db.exec('DELETE FROM card_plans WHERE id = ?', [id]);
}

/**
 * Pay off what's left early: the next statement on or after `on` bills it all,
 * and no more interest is added — interest put on up front for the instalments
 * not billed yet comes back off. A settlement charge, if any, goes on the card that day.
 */
export async function settleCardPlan(db: DB, plan: CardPlanInfo, on: string, charge: number): Promise<void> {
  const unbilledInterest =
    interestUpfront(plan) && plan.billed_through >= plan.tx_date
      ? planSchedule(plan, plan.statement_day)
          .filter((i) => i.statement >= on)
          .reduce((sum, i) => sum + i.interest, 0)
      : 0;
  await db.exec('UPDATE card_plans SET settled_on = ?, settle_fee_minor = ? WHERE id = ?', [on, charge || null, plan.id]);
  if (unbilledInterest > 0) {
    const categoryId = await partCategory(db, 'interest');
    await db.exec(
      `INSERT OR IGNORE INTO transactions (id, account_id, category_id, amount_minor, kind, occurred_on, note, created_at)
       VALUES (?, ?, ?, ?, 'expense', ?, ?, ?)`,
      [`plan:${plan.id}:refund`, plan.card_id, categoryId, unbilledInterest, on, `Interest refunded on early settlement · ${label(plan)}`, nowIso()],
    );
  }
  if (charge > 0) {
    const categoryId = await partCategory(db, 'fee');
    await db.exec(
      `INSERT OR IGNORE INTO transactions (id, account_id, category_id, amount_minor, kind, occurred_on, note, created_at)
       VALUES (?, ?, ?, ?, 'expense', ?, ?, ?)`,
      [`plan:${plan.id}:settle`, plan.card_id, categoryId, -charge, on, `Early settlement · ${label(plan)}`, nowIso()],
    );
  }
}

const label = (plan: Pick<CardPlanInfo, 'tx_note' | 'card_name'>) => plan.tx_note?.trim() || `${plan.card_name} instalments`;

/**
 * Adds each statement's interest (and the first statement's fee) to the card,
 * once the statement has closed — or, when the bank puts it on up front, all
 * the interest on the day of the entry the plan is for. Runs on every open; ids are made from the plan
 * and the statement, so two devices adding the same entry write the same row,
 * and billed_through means one deleted by hand doesn't come back. Writes
 * nothing once caught up.
 */
export async function materializeCardPlans(db: DB, today: string = toDateString()): Promise<void> {
  const plans = await listCardPlans(db);
  let interestCat: string | null = null;
  let feeCat: string | null = null;
  for (const plan of plans) {
    const upfront = interestUpfront(plan);
    // Up front: once, dated with the entry (billed_through then moves to that date).
    const allInterest =
      upfront && plan.billed_through < plan.tx_date && plan.tx_date <= today ? totalInterest(plan, plan.statement_day) : 0;
    const due = planSchedule(plan, plan.statement_day).filter(
      (i) => i.statement <= today && i.statement > plan.billed_through,
    );
    if (due.length === 0 && !(upfront && plan.billed_through < plan.tx_date && plan.tx_date <= today)) continue;
    const name = label(plan);
    // Categories first: making one writes outside the transaction below.
    if (allInterest > 0 || (!upfront && due.some((i) => i.interest > 0))) interestCat ??= await partCategory(db, 'interest');
    if (due.some((i) => i.fee > 0)) feeCat ??= await partCategory(db, 'fee');
    const rows: [string, string, number, string, string][] = [];
    if (allInterest > 0) {
      rows.push([`plan:${plan.id}:interest`, interestCat!, allInterest, plan.tx_date, `Interest for all ${plan.months} instalments · ${name}`]);
    }
    for (const i of due) {
      if (!upfront && i.interest > 0) {
        rows.push([`plan:${plan.id}:${i.statement}:interest`, interestCat!, i.interest, i.statement, `Interest ${i.n}/${plan.months} · ${name}`]);
      }
      if (i.fee > 0) rows.push([`plan:${plan.id}:${i.statement}:fee`, feeCat!, i.fee, i.statement, `Processing fee · ${name}`]);
    }
    await db.tx(async (tx) => {
      for (const [id, categoryId, amount, on, note] of rows) {
        await tx.exec(
          `INSERT OR IGNORE INTO transactions (id, account_id, category_id, amount_minor, kind, occurred_on, note, created_at)
           VALUES (?, ?, ?, ?, 'expense', ?, ?, ?)`,
          [id, plan.card_id, categoryId, -amount, on, note, nowIso()],
        );
      }
      const through = due.length ? due[due.length - 1].statement : plan.tx_date;
      await tx.exec('UPDATE card_plans SET billed_through = ? WHERE id = ?', [
        through > plan.billed_through ? through : plan.billed_through,
        plan.id,
      ]);
    });
  }
}
