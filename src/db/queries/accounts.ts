import type { DB } from '../wasm';
import type { Account, AccountType } from '../types';
import { uuid } from '../uuid';
import { nowIso, toDateString } from '@/lib/dates';
import { logCreate, logUpdate, snapshotEntity } from '../changeLog';

export interface AccountInput {
  name: string;
  type: AccountType;
  currency: string;
  opening_balance_minor?: number;
  is_main?: boolean;
  include_in_total?: boolean;
  credit_limit_minor?: number | null;
  statement_day?: number | null;
  due_day?: number | null;
  pay_from_account_id?: string | null;
  loan_principal_minor?: number | null;
  loan_rate_bp?: number | null;
  loan_interest_method?: string | null;
  loan_term_months?: number | null;
  loan_payment_minor?: number | null;
  loan_autopay_from?: string | null;
  color?: string | null;
  icon?: string | null;
  starts_on?: string;
}

// A loan's terms; other accounts have none.
function loanValues(input: AccountInput) {
  const loan = input.type === 'loan';
  return [
    loan ? (input.loan_principal_minor ?? null) : null,
    loan ? (input.loan_rate_bp ?? null) : null,
    loan ? (input.loan_interest_method ?? null) : null,
    loan ? (input.loan_term_months ?? null) : null,
    loan ? (input.loan_payment_minor ?? null) : null,
    loan ? (input.loan_autopay_from ?? null) : null,
  ];
}

export async function listAccounts(db: DB, includeArchived = false): Promise<Account[]> {
  const sql = includeArchived
    ? 'SELECT * FROM accounts ORDER BY is_main DESC, name'
    : 'SELECT * FROM accounts WHERE archived_at IS NULL ORDER BY is_main DESC, name';
  return db.execO<Account>(sql);
}

export async function getAccount(db: DB, id: string): Promise<Account | null> {
  const rows = await db.execO<Account>('SELECT * FROM accounts WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function createAccount(db: DB, input: AccountInput): Promise<string> {
  const id = uuid();
  const now = nowIso();
  const includeInTotal = input.include_in_total ?? true;
  await db.exec(
    `INSERT INTO accounts (
      id, name, type, currency, opening_balance_minor, is_main, include_in_total,
      credit_limit_minor, statement_day, due_day, pay_from_account_id,
      loan_principal_minor, loan_rate_bp, loan_interest_method, loan_term_months, loan_payment_minor, loan_autopay_from,
      color, icon, starts_on, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.type,
      input.currency,
      input.opening_balance_minor ?? 0,
      input.is_main ? 1 : 0,
      includeInTotal ? 1 : 0,
      input.credit_limit_minor ?? null,
      input.statement_day ?? null,
      input.due_day ?? null,
      input.pay_from_account_id ?? null,
      ...loanValues(input),
      input.color ?? null,
      input.icon ?? null,
      input.starts_on ?? toDateString(),
      now,
    ],
  );
  if (input.is_main) {
    await db.exec('UPDATE accounts SET is_main = 0 WHERE id != ?', [id]);
  }
  await logCreate(db, 'account', id);
  return id;
}

export async function updateAccount(db: DB, id: string, input: AccountInput): Promise<void> {
  const before = await snapshotEntity(db, 'account', id);
  const includeInTotal = input.include_in_total ?? true;
  await db.exec(
    `UPDATE accounts SET
      name = ?, type = ?, currency = ?, opening_balance_minor = ?,
      is_main = ?, include_in_total = ?, credit_limit_minor = ?, statement_day = ?, due_day = ?,
      pay_from_account_id = ?, loan_principal_minor = ?, loan_rate_bp = ?, loan_interest_method = ?,
      loan_term_months = ?, loan_payment_minor = ?, loan_autopay_from = ?, color = ?, icon = ?, starts_on = ?
     WHERE id = ?`,
    [
      input.name,
      input.type,
      input.currency,
      input.opening_balance_minor ?? 0,
      input.is_main ? 1 : 0,
      includeInTotal ? 1 : 0,
      input.credit_limit_minor ?? null,
      input.statement_day ?? null,
      input.due_day ?? null,
      input.pay_from_account_id ?? null,
      ...loanValues(input),
      input.color ?? null,
      input.icon ?? null,
      input.starts_on ?? toDateString(),
      id,
    ],
  );
  if (input.is_main) {
    await db.exec('UPDATE accounts SET is_main = 0 WHERE id != ?', [id]);
  }
  await logUpdate(db, 'account', id, before);
}

export async function archiveAccount(db: DB, id: string): Promise<void> {
  const before = await snapshotEntity(db, 'account', id);
  await db.exec('UPDATE accounts SET archived_at = ? WHERE id = ?', [nowIso(), id]);
  await logUpdate(db, 'account', id, before);
}

export async function unarchiveAccount(db: DB, id: string): Promise<void> {
  const before = await snapshotEntity(db, 'account', id);
  await db.exec('UPDATE accounts SET archived_at = NULL WHERE id = ?', [id]);
  await logUpdate(db, 'account', id, before);
}

export interface AccountBalance {
  account_id: string;
  balance_minor: number;
}

export async function getAccountBalances(
  db: DB,
  asOf: string = toDateString(),
): Promise<AccountBalance[]> {
  // Balances are "as of today": future-dated transactions (e.g. scheduled
  // payments logged ahead of time) don't reduce the current balance until
  // their day arrives.
  return db.execO<AccountBalance>(
    `SELECT a.id AS account_id,
            a.opening_balance_minor + COALESCE(SUM(t.amount_minor), 0) AS balance_minor
     FROM accounts a
     LEFT JOIN transactions t ON t.account_id = a.id
       AND (a.starts_on = '' OR t.occurred_on >= a.starts_on)
       AND t.occurred_on <= ?
     GROUP BY a.id`,
    [asOf],
  );
}

/**
 * An account's balance at the end of each day it has entries, counted like
 * getAccountBalances (from its starts_on). Days before starts_on are left out.
 */
export async function getDailyBalances(db: DB, accountId: string): Promise<Map<string, number>> {
  const rows = await db.execA<[string, number, number]>(
    `SELECT t.occurred_on, SUM(t.amount_minor), a.opening_balance_minor
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.account_id = ? AND (a.starts_on = '' OR t.occurred_on >= a.starts_on)
     GROUP BY t.occurred_on
     ORDER BY t.occurred_on`,
    [accountId],
  );
  const byDay = new Map<string, number>();
  let running = rows[0]?.[2] ?? 0;
  for (const [day, sum] of rows) {
    running += sum;
    byDay.set(day, running);
  }
  return byDay;
}

/** Money in and out of one account over a range, as a statement totals it (transfers included). */
export async function getAccountFlows(
  db: DB,
  accountId: string,
  range: { dateFrom?: string; dateTo: string },
): Promise<{ n: number; out: number; in: number }> {
  const [[n, out, inflow]] = await db.execA<[number, number, number]>(
    `SELECT count(*), COALESCE(SUM(CASE WHEN t.amount_minor < 0 THEN -t.amount_minor END), 0),
            COALESCE(SUM(CASE WHEN t.amount_minor > 0 THEN t.amount_minor END), 0)
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.account_id = ? AND (a.starts_on = '' OR t.occurred_on >= a.starts_on)
       AND t.occurred_on >= ? AND t.occurred_on <= ?`,
    [accountId, range.dateFrom ?? '', range.dateTo],
  );
  return { n, out, in: inflow };
}

export interface CurrencyTotal {
  currency: string;
  balance_minor: number;
  account_count: number;
}

export async function getTotalsByCurrency(
  db: DB,
  asOf: string = toDateString(),
): Promise<CurrencyTotal[]> {
  // Counted exactly like getAccountBalances (from each account's starts_on, up
  // to today), so the total always equals the sum of the account cards.
  return db.execO<CurrencyTotal>(
    `SELECT a.currency,
            SUM(a.opening_balance_minor + COALESCE(tx_sum.total, 0)) AS balance_minor,
            COUNT(*) AS account_count
     FROM accounts a
     LEFT JOIN (
       SELECT t.account_id, SUM(t.amount_minor) AS total
       FROM transactions t
       JOIN accounts acc ON acc.id = t.account_id
       WHERE t.occurred_on <= ? AND (acc.starts_on = '' OR t.occurred_on >= acc.starts_on)
       GROUP BY t.account_id
     ) tx_sum ON tx_sum.account_id = a.id
     WHERE a.archived_at IS NULL AND a.include_in_total = 1
     GROUP BY a.currency
     ORDER BY balance_minor DESC`,
    [asOf],
  );
}
