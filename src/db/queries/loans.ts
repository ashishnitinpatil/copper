import type { DB } from '../wasm';
import type { Account, Transaction } from '../types';
import { uuid } from '../uuid';
import { nowIso, toDateString } from '@/lib/dates';
import { logCreate, logDelete, logUpdate, newBatchId, snapshotEntity } from '../changeLog';
import { dueDatesBetween, splitPayment, type LoanTerms } from '@/features/loans/loanMath';

// A loan payment is a transfer into the loan for the principal — what you owe
// goes down by exactly that — plus an expense for the interest, so the cost of
// borrowing shows in Reports like any other; and, when the bank adds them, one
// for insurance (a mortgage's life insurance, charged on what's owed) and one
// for fees (paying off early, say). Those rows point at the transfer's
// outgoing leg (payment_of) and say which part they are (payment_part; none
// for interest). All of it is shown and edited as one.

export const LOAN_INTEREST_CATEGORY = 'Loan interest';
export const LOAN_INSURANCE_CATEGORY = 'Loan insurance';
export const LOAN_FEES_CATEGORY = 'Loan fees';

type Part = 'interest' | 'insurance' | 'fee';
const PARTS: Part[] = ['interest', 'insurance', 'fee'];
const CATEGORY: Record<Part, [name: string, icon: string, color: string]> = {
  interest: [LOAN_INTEREST_CATEGORY, '💸', '#f43f5e'],
  insurance: [LOAN_INSURANCE_CATEGORY, '🛡️', '#8b5cf6'],
  fee: [LOAN_FEES_CATEGORY, '🧾', '#f59e0b'],
};
const partOf = (t: Transaction): Part => (t.payment_part === 'insurance' || t.payment_part === 'fee' ? t.payment_part : 'interest');

export interface LoanPaymentInput {
  loan_account_id: string;
  from_account_id: string;
  principal_minor: number;
  interest_minor: number;
  /** Insurance paid with it (0 when none). */
  insurance_minor?: number;
  /** Fees paid with it, such as for paying off early (0 when none). */
  fee_minor?: number;
  occurred_on: string;
  note?: string | null;
}

export interface LoanPayment {
  /** Leaves the paying account (negative). */
  from: Transaction;
  /** Arrives in the loan (positive). */
  to: Transaction;
  interest: Transaction | null;
  insurance: Transaction | null;
  fee: Transaction | null;
}

const amountOf = (input: LoanPaymentInput, part: Part) =>
  part === 'interest' ? input.interest_minor : part === 'insurance' ? (input.insurance_minor ?? 0) : (input.fee_minor ?? 0);

/** A loan's terms as the arithmetic needs them. */
export function loanTerms(loan: Account): LoanTerms {
  return {
    method: loan.loan_interest_method === 'flat' ? 'flat' : 'reducing',
    rateBp: loan.loan_rate_bp ?? 0,
    principal: loan.loan_principal_minor ?? Math.max(0, -loan.opening_balance_minor),
    payment: loan.loan_payment_minor ?? 0,
  };
}

/** The expense category a part of payments is filed under, made the first time it's needed. */
async function partCategory(db: DB, part: Part): Promise<string> {
  const [name, icon, color] = CATEGORY[part];
  const [found] = await db.execO<{ id: string }>(
    `SELECT id FROM categories WHERE name = ? AND kind = 'expense' AND archived_at IS NULL LIMIT 1`,
    [name],
  );
  if (found) return found.id;
  const id = uuid();
  const [{ n }] = await db.execO<{ n: number }>('SELECT COUNT(*) AS n FROM categories');
  await db.exec(
    `INSERT INTO categories (id, parent_id, name, kind, icon, color, sort_order, created_at)
     VALUES (?, NULL, ?, 'expense', ?, ?, ?, ?)`,
    [id, name, icon, color, n, nowIso()],
  );
  await logCreate(db, 'category', id);
  return id;
}

/** The payment that `id` (either transfer leg, or the interest) belongs to, if it's a payment into a loan. */
export async function getLoanPayment(db: DB, id: string): Promise<LoanPayment | null> {
  const [row] = await db.execO<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!row) return null;
  const legId = row.payment_of ?? id;
  const [leg] = row.payment_of
    ? await db.execO<Transaction>('SELECT * FROM transactions WHERE id = ?', [legId])
    : [row];
  if (!leg || leg.kind !== 'transfer' || !leg.transfer_peer_id) return null;
  const [peer] = await db.execO<Transaction>('SELECT * FROM transactions WHERE id = ?', [leg.transfer_peer_id]);
  if (!peer) return null;
  const [from, to] = leg.amount_minor < 0 ? [leg, peer] : [peer, leg];
  const [loan] = await db.execO<{ type: string }>('SELECT type FROM accounts WHERE id = ?', [to.account_id]);
  if (loan?.type !== 'loan') return null;
  const parts = await db.execO<Transaction>('SELECT * FROM transactions WHERE payment_of = ?', [from.id]);
  return {
    from,
    to,
    interest: parts.find((t) => partOf(t) === 'interest') ?? null,
    insurance: parts.find((t) => partOf(t) === 'insurance') ?? null,
    fee: parts.find((t) => partOf(t) === 'fee') ?? null,
  };
}

/** What's owed on a loan just before `date`'s payments: everything dated earlier counts. */
export async function owedBefore(db: DB, loan: Account, date: string, exceptIds: string[] = []): Promise<number> {
  const skip = exceptIds.length ? `AND id NOT IN (${exceptIds.map(() => '?').join(', ')})` : '';
  const [{ total }] = await db.execO<{ total: number }>(
    `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM transactions
     WHERE account_id = ? AND occurred_on <= ? AND (? = '' OR occurred_on >= ?) ${skip}`,
    [loan.id, date, loan.starts_on, loan.starts_on, ...exceptIds],
  );
  return Math.max(0, -(loan.opening_balance_minor + total));
}

// `automatic`: added on its due date, with ids every device derives the same
// way, so two devices adding it make one payment. Like recurring entries, these
// aren't logged: each device would log its own copy.
async function insertPayment(
  db: DB,
  input: LoanPaymentInput,
  ids: Record<'from' | 'to' | Part, string>,
  automatic = false,
): Promise<boolean> {
  const verb = automatic ? 'INSERT OR IGNORE' : 'INSERT';
  const now = nowIso();
  const note = input.note ?? null;
  const parts: { part: Part; amount: number; categoryId: string }[] = [];
  for (const part of PARTS) {
    const amount = amountOf(input, part);
    if (amount > 0) parts.push({ part, amount, categoryId: await partCategory(db, part) });
  }
  let added = false;
  await db.tx(async (tx) => {
    const [{ n }] = await tx.execO<{ n: number }>('SELECT COUNT(*) AS n FROM transactions WHERE id = ?', [ids.from]);
    if (n > 0) return;
    await tx.exec(
      `${verb} INTO transactions (id, account_id, category_id, amount_minor, kind, transfer_peer_id, occurred_on, note, created_at)
       VALUES (?, ?, NULL, ?, 'transfer', ?, ?, ?, ?)`,
      [ids.from, input.from_account_id, -input.principal_minor, ids.to, input.occurred_on, note, now],
    );
    await tx.exec(
      `${verb} INTO transactions (id, account_id, category_id, amount_minor, kind, transfer_peer_id, occurred_on, note, created_at)
       VALUES (?, ?, NULL, ?, 'transfer', ?, ?, ?, ?)`,
      [ids.to, input.loan_account_id, input.principal_minor, ids.from, input.occurred_on, note, now],
    );
    for (const x of parts) {
      await tx.exec(
        `${verb} INTO transactions (id, account_id, category_id, amount_minor, kind, payment_of, payment_part, occurred_on, note, created_at)
         VALUES (?, ?, ?, ?, 'expense', ?, ?, ?, ?, ?)`,
        [ids[x.part], input.from_account_id, x.categoryId, -x.amount, ids.from, x.part === 'interest' ? null : x.part, input.occurred_on, note, now],
      );
    }
    added = true;
  });
  if (!added || automatic) return added;
  const log = { batchId: newBatchId(), source: 'loan-payment' };
  await logCreate(db, 'transaction', ids.from, log);
  await logCreate(db, 'transaction', ids.to, log);
  for (const x of parts) await logCreate(db, 'transaction', ids[x.part], log);
  return true;
}

export async function createLoanPayment(db: DB, input: LoanPaymentInput): Promise<string> {
  const ids = { from: uuid(), to: uuid(), interest: uuid(), insurance: uuid(), fee: uuid() };
  await insertPayment(db, input, ids);
  return ids.from;
}

/** Change a payment: its legs, and its interest, insurance and fees added, changed or removed with it, as one change. */
export async function updateLoanPayment(db: DB, id: string, input: LoanPaymentInput): Promise<void> {
  const p = await getLoanPayment(db, id);
  if (!p) throw new Error('Payment not found');
  const note = input.note ?? null;
  const log = { batchId: newBatchId(), source: 'loan-payment' };
  const snap = (t: Transaction | null) => (t ? snapshotEntity(db, 'transaction', t.id) : Promise.resolve(null));
  const before = { from: await snap(p.from), to: await snap(p.to) };
  // Each extra part: changed, removed, or added, by whether it was and is there.
  const parts = await Promise.all(
    PARTS.map(async (part) => ({ part, row: p[part], amount: amountOf(input, part), before: await snap(p[part]), newId: uuid() })),
  );
  const categories = new Map<string, string>();
  for (const x of parts) if (x.amount > 0 && !x.row) categories.set(x.part, await partCategory(db, x.part));
  await db.tx(async (tx) => {
    const set = 'UPDATE transactions SET account_id = ?, amount_minor = ?, occurred_on = ?, note = ? WHERE id = ?';
    await tx.exec(set, [input.from_account_id, -input.principal_minor, input.occurred_on, note, p.from.id]);
    await tx.exec(set, [input.loan_account_id, input.principal_minor, input.occurred_on, note, p.to.id]);
    for (const x of parts) {
      if (x.row && x.amount > 0) {
        await tx.exec(set, [input.from_account_id, -x.amount, input.occurred_on, note, x.row.id]);
      } else if (x.row) {
        await tx.exec('DELETE FROM transactions WHERE id = ?', [x.row.id]);
      } else if (x.amount > 0) {
        await tx.exec(
          `INSERT INTO transactions (id, account_id, category_id, amount_minor, kind, payment_of, payment_part, occurred_on, note, created_at)
           VALUES (?, ?, ?, ?, 'expense', ?, ?, ?, ?, ?)`,
          [x.newId, input.from_account_id, categories.get(x.part)!, -x.amount, p.from.id, x.part === 'interest' ? null : x.part, input.occurred_on, note, nowIso()],
        );
      }
    }
  });
  await logUpdate(db, 'transaction', p.from.id, before.from, log);
  await logUpdate(db, 'transaction', p.to.id, before.to, log);
  for (const x of parts) {
    if (x.row && x.amount > 0) await logUpdate(db, 'transaction', x.row.id, x.before, log);
    else if (x.row && x.before) await logDelete(db, 'transaction', x.before, log);
    else if (x.amount > 0) await logCreate(db, 'transaction', x.newId, log);
  }
}

export interface LoanStats {
  account_id: string;
  /** Interest paid on this loan so far. */
  interest_paid: number;
  /** Insurance paid with it so far. */
  insurance_paid: number;
  /** Fees paid on it so far. */
  fees_paid: number;
}

/** Interest, insurance and fees paid so far on each loan, from the payments recorded against it. */
export async function getLoanStats(db: DB): Promise<LoanStats[]> {
  return db.execO<LoanStats>(
    `SELECT r.account_id AS account_id,
       COALESCE(SUM(CASE WHEN i.payment_part IS NULL THEN -i.amount_minor ELSE 0 END), 0) AS interest_paid,
       COALESCE(SUM(CASE WHEN i.payment_part = 'insurance' THEN -i.amount_minor ELSE 0 END), 0) AS insurance_paid,
       COALESCE(SUM(CASE WHEN i.payment_part = 'fee' THEN -i.amount_minor ELSE 0 END), 0) AS fees_paid
     FROM transactions i
     JOIN transactions s ON s.id = i.payment_of
     JOIN transactions r ON r.id = s.transfer_peer_id
     WHERE i.occurred_on <= ?
     GROUP BY r.account_id`,
    [toDateString()],
  );
}

/** The id an automatic payment gets, the same on every device so two of them adding it make one. */
export const autopayIds = (loanId: string, date: string) => ({
  from: `loan:${loanId}:${date}:from`,
  to: `loan:${loanId}:${date}:to`,
  interest: `loan:${loanId}:${date}:interest`,
  insurance: `loan:${loanId}:${date}:insurance`,
  fee: `loan:${loanId}:${date}:fee`,
});

/**
 * Insurance as a share of what's owed, from the latest payment on `loan`
 * before `date` that had any: banks charge it on the balance, so it shrinks
 * as the loan does. 0 when no payment has had insurance.
 */
export async function insuranceShare(db: DB, loan: Account, date: string): Promise<number> {
  const [last] = await db.execO<{ amount: number; occurred_on: string; peer: string }>(
    `SELECT -i.amount_minor AS amount, i.occurred_on, r.id AS peer
     FROM transactions i
     JOIN transactions s ON s.id = i.payment_of
     JOIN transactions r ON r.id = s.transfer_peer_id
     WHERE i.payment_part = 'insurance' AND r.account_id = ? AND i.occurred_on < ?
     ORDER BY i.occurred_on DESC LIMIT 1`,
    [loan.id, date],
  );
  if (!last) return 0;
  const owed = await owedBefore(db, loan, last.occurred_on, [last.peer]);
  return owed > 0 ? last.amount / owed : 0;
}

/**
 * Add the loans' automatic payments that have come due: on each payment day
 * since the last one added, the monthly payment, split at the loan's current
 * rate on what was owed then. The person corrects it from their statement if
 * the bank's figure differs.
 */
export async function materializeLoanPayments(db: DB): Promise<number> {
  const today = toDateString();
  const loans = await db.execO<Account>(
    `SELECT * FROM accounts
     WHERE type = 'loan' AND archived_at IS NULL AND loan_autopay_from IS NOT NULL AND loan_autopay_from < ?
       AND due_day IS NOT NULL AND pay_from_account_id IS NOT NULL AND loan_payment_minor > 0`,
    [today],
  );
  let added = 0;
  for (const loan of loans) {
    for (const date of dueDatesBetween(loan.loan_autopay_from!, today, loan.due_day!)) {
      const owed = await owedBefore(db, loan, date);
      if (owed <= 0) break;
      const split = splitPayment(owed, loanTerms(loan));
      if (split.principal <= 0) break;
      const input = {
        loan_account_id: loan.id,
        from_account_id: loan.pay_from_account_id!,
        principal_minor: split.principal,
        interest_minor: split.interest,
        insurance_minor: Math.round(owed * (await insuranceShare(db, loan, date))),
        occurred_on: date,
      };
      if (await insertPayment(db, input, autopayIds(loan.id, date), true)) added++;
    }
    await db.exec('UPDATE accounts SET loan_autopay_from = ? WHERE id = ?', [today, loan.id]);
  }
  return added;
}

/** Record a new rate or monthly payment on a loan (from a statement); later payments use it. */
export async function updateLoanTerms(
  db: DB,
  loanId: string,
  terms: { rate_bp?: number; payment_minor?: number },
): Promise<void> {
  const before = await snapshotEntity(db, 'account', loanId);
  if (terms.rate_bp != null) await db.exec('UPDATE accounts SET loan_rate_bp = ? WHERE id = ?', [terms.rate_bp, loanId]);
  if (terms.payment_minor != null) {
    await db.exec('UPDATE accounts SET loan_payment_minor = ? WHERE id = ?', [terms.payment_minor, loanId]);
  }
  await logUpdate(db, 'account', loanId, before);
}
