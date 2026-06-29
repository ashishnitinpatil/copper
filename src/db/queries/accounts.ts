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
  color?: string | null;
  icon?: string | null;
  starts_on?: string;
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
  const includeInTotal = input.include_in_total ?? defaultIncludeInTotal(input.type);
  await db.exec(
    `INSERT INTO accounts (
      id, name, type, currency, opening_balance_minor, is_main, include_in_total,
      credit_limit_minor, statement_day, due_day, pay_from_account_id,
      color, icon, starts_on, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  const includeInTotal = input.include_in_total ?? defaultIncludeInTotal(input.type);
  await db.exec(
    `UPDATE accounts SET
      name = ?, type = ?, currency = ?, opening_balance_minor = ?,
      is_main = ?, include_in_total = ?, credit_limit_minor = ?, statement_day = ?, due_day = ?,
      pay_from_account_id = ?, color = ?, icon = ?, starts_on = ?
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

export interface CurrencyTotal {
  currency: string;
  balance_minor: number;
  account_count: number;
}

export async function getTotalsByCurrency(
  db: DB,
  asOf: string = toDateString(),
): Promise<CurrencyTotal[]> {
  // As-of-today, matching getAccountBalances: exclude future-dated transactions.
  return db.execO<CurrencyTotal>(
    `SELECT a.currency,
            SUM(a.opening_balance_minor + COALESCE(tx_sum.total, 0)) AS balance_minor,
            COUNT(*) AS account_count
     FROM accounts a
     LEFT JOIN (
       SELECT account_id, SUM(amount_minor) AS total
       FROM transactions
       WHERE occurred_on <= ?
       GROUP BY account_id
     ) tx_sum ON tx_sum.account_id = a.id
     WHERE a.archived_at IS NULL AND a.include_in_total = 1
     GROUP BY a.currency
     ORDER BY balance_minor DESC`,
    [asOf],
  );
}

function defaultIncludeInTotal(type: AccountType): boolean {
  return type !== 'loan';
}
