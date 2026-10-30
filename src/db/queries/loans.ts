import type { DB } from '../wasm';
import type { Account, Transaction } from '../types';
import { uuid } from '../uuid';
import { nowIso, toDateString } from '@/lib/dates';
import { logCreate, logDelete, logUpdate, newBatchId, snapshotEntity } from '../changeLog';
import { dueDatesBetween, splitPayment, type LoanTerms } from '@/features/loans/loanMath';

// A loan payment is a transfer into the loan for the principal — what you owe
// goes down by exactly that — plus an expense for the interest, so the cost of
// borrowing shows in Reports like any other. The interest row points at the
// transfer's outgoing leg (payment_of); the three are shown and edited as one.

export const LOAN_INTEREST_CATEGORY = 'Loan interest';

export interface LoanPaymentInput {
  loan_account_id: string;
  from_account_id: string;
  principal_minor: number;
  interest_minor: number;
  occurred_on: string;
  note?: string | null;
}

export interface LoanPayment {
  /** Leaves the paying account (negative). */
  from: Transaction;
  /** Arrives in the loan (positive). */
  to: Transaction;
  interest: Transaction | null;
}

/** A loan's terms as the arithmetic needs them. */
export function loanTerms(loan: Account): LoanTerms {
  return {
    method: loan.loan_interest_method === 'flat' ? 'flat' : 'reducing',
    rateBp: loan.loan_rate_bp ?? 0,
    principal: loan.loan_principal_minor ?? Math.max(0, -loan.opening_balance_minor),
    payment: loan.loan_payment_minor ?? 0,
  };
}

/** The expense category interest is filed under, made the first time it's needed. */
async function interestCategory(db: DB): Promise<string> {
  const [found] = await db.execO<{ id: string }>(
    `SELECT id FROM categories WHERE name = ? AND kind = 'expense' AND archived_at IS NULL LIMIT 1`,
    [LOAN_INTEREST_CATEGORY],
  );
  if (found) return found.id;
  const id = uuid();
  const [{ n }] = await db.execO<{ n: number }>('SELECT COUNT(*) AS n FROM categories');
  await db.exec(
    `INSERT INTO categories (id, parent_id, name, kind, icon, color, sort_order, created_at)
     VALUES (?, NULL, ?, 'expense', '💸', '#f43f5e', ?, ?)`,
    [id, LOAN_INTEREST_CATEGORY, n, nowIso()],
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
  const [interest] = await db.execO<Transaction>('SELECT * FROM transactions WHERE payment_of = ?', [from.id]);
  return { from, to, interest: interest ?? null };
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
  ids: { from: string; to: string; interest: string },
  automatic = false,
): Promise<boolean> {
  const verb = automatic ? 'INSERT OR IGNORE' : 'INSERT';
  const now = nowIso();
  const note = input.note ?? null;
  const categoryId = input.interest_minor > 0 ? await interestCategory(db) : null;
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
    if (categoryId) {
      await tx.exec(
        `${verb} INTO transactions (id, account_id, category_id, amount_minor, kind, payment_of, occurred_on, note, created_at)
         VALUES (?, ?, ?, ?, 'expense', ?, ?, ?, ?)`,
        [ids.interest, input.from_account_id, categoryId, -input.interest_minor, ids.from, input.occurred_on, note, now],
      );
    }
    added = true;
  });
  if (!added || automatic) return added;
  const log = { batchId: newBatchId(), source: 'loan-payment' };
  await logCreate(db, 'transaction', ids.from, log);
  await logCreate(db, 'transaction', ids.to, log);
  if (categoryId) await logCreate(db, 'transaction', ids.interest, log);
  return true;
}

export async function createLoanPayment(db: DB, input: LoanPaymentInput): Promise<string> {
  const ids = { from: uuid(), to: uuid(), interest: uuid() };
  await insertPayment(db, input, ids);
  return ids.from;
}

/** Change a payment: its legs, and its interest added, changed or removed with it, as one change. */
export async function updateLoanPayment(db: DB, id: string, input: LoanPaymentInput): Promise<void> {
  const p = await getLoanPayment(db, id);
  if (!p) throw new Error('Payment not found');
  const note = input.note ?? null;
  const log = { batchId: newBatchId(), source: 'loan-payment' };
  const before = {
    from: await snapshotEntity(db, 'transaction', p.from.id),
    to: await snapshotEntity(db, 'transaction', p.to.id),
    interest: p.interest ? await snapshotEntity(db, 'transaction', p.interest.id) : null,
  };
  const categoryId = input.interest_minor > 0 ? await interestCategory(db) : null;
  const newInterestId = uuid();
  await db.tx(async (tx) => {
    await tx.exec('UPDATE transactions SET account_id = ?, amount_minor = ?, occurred_on = ?, note = ? WHERE id = ?', [
      input.from_account_id, -input.principal_minor, input.occurred_on, note, p.from.id,
    ]);
    await tx.exec('UPDATE transactions SET account_id = ?, amount_minor = ?, occurred_on = ?, note = ? WHERE id = ?', [
      input.loan_account_id, input.principal_minor, input.occurred_on, note, p.to.id,
    ]);
    if (p.interest && categoryId) {
      await tx.exec('UPDATE transactions SET account_id = ?, amount_minor = ?, occurred_on = ?, note = ? WHERE id = ?', [
        input.from_account_id, -input.interest_minor, input.occurred_on, note, p.interest.id,
      ]);
    } else if (p.interest) {
      await tx.exec('DELETE FROM transactions WHERE id = ?', [p.interest.id]);
    } else if (categoryId) {
      await tx.exec(
        `INSERT INTO transactions (id, account_id, category_id, amount_minor, kind, payment_of, occurred_on, note, created_at)
         VALUES (?, ?, ?, ?, 'expense', ?, ?, ?, ?)`,
        [newInterestId, input.from_account_id, categoryId, -input.interest_minor, p.from.id, input.occurred_on, note, nowIso()],
      );
    }
  });
  await logUpdate(db, 'transaction', p.from.id, before.from, log);
  await logUpdate(db, 'transaction', p.to.id, before.to, log);
  if (p.interest && categoryId) await logUpdate(db, 'transaction', p.interest.id, before.interest, log);
  else if (p.interest && before.interest) await logDelete(db, 'transaction', before.interest, log);
  else if (categoryId) await logCreate(db, 'transaction', newInterestId, log);
}

export interface LoanStats {
  account_id: string;
  /** Interest paid on this loan so far. */
  interest_paid: number;
}

/** Interest paid so far on each loan, from the payments recorded against it. */
export async function getLoanStats(db: DB): Promise<LoanStats[]> {
  return db.execO<LoanStats>(
    `SELECT r.account_id AS account_id, COALESCE(SUM(-i.amount_minor), 0) AS interest_paid
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
});

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
