import type { DB } from '@/db/wasm';
import { toDateString } from '@/lib/dates';
import type { DeltaRow, InOutRow } from './trends';

/**
 * Net change per account per month (all kinds, including transfer legs), bounded
 * to `asOf` and respecting each account's `starts_on` — the same window
 * getAccountBalances uses, so cumulative balances tie out to today's balance.
 */
export async function getMonthlyDeltas(db: DB, asOf: string = toDateString()): Promise<DeltaRow[]> {
  return db.execO<DeltaRow>(
    `SELECT t.account_id AS account_id,
            substr(t.occurred_on, 1, 7) AS ym,
            SUM(t.amount_minor) AS delta_minor
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     WHERE t.occurred_on <= ?
       AND (a.starts_on = '' OR t.occurred_on >= a.starts_on)
     GROUP BY t.account_id, ym`,
    [asOf],
  );
}

export interface FutureTxnRow {
  account_id: string;
  occurred_on: string;
  amount_minor: number; // signed: expense negative, income positive
  kind: 'income' | 'expense';
  currency: string;
  account_name: string;
  category_name: string | null;
  note: string | null;
}

/**
 * Pre-logged transactions dated after `from` and up to `to`, on non-credit
 * accounts (cash flows the running balance tracks). Transfers are excluded —
 * their legs net to zero across accounts and card payments are handled by the
 * statement engine. Used to fold scheduled future entries (e.g. EMIs) into the
 * forecast alongside recurring rules.
 */
export async function getFutureTransactions(db: DB, from: string, to: string): Promise<FutureTxnRow[]> {
  return db.execO<FutureTxnRow>(
    `SELECT t.account_id AS account_id,
            t.occurred_on AS occurred_on,
            t.amount_minor AS amount_minor,
            t.kind AS kind,
            a.currency AS currency,
            a.name AS account_name,
            c.name AS category_name,
            t.note AS note
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.occurred_on > ? AND t.occurred_on <= ?
       AND t.kind IN ('income', 'expense')
       AND a.type != 'credit_card'
       AND a.archived_at IS NULL
     ORDER BY t.occurred_on`,
    [from, to],
  );
}

/** Income/expense magnitude per account per month (transfers excluded). */
export async function getMonthlyInOut(db: DB, asOf: string = toDateString()): Promise<InOutRow[]> {
  return db.execO<InOutRow>(
    `SELECT t.account_id AS account_id,
            substr(t.occurred_on, 1, 7) AS ym,
            t.kind AS kind,
            a.currency AS currency,
            SUM(ABS(t.amount_minor)) AS total_minor
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     WHERE t.kind IN ('income', 'expense') AND t.occurred_on <= ?
     GROUP BY t.account_id, ym, t.kind`,
    [asOf],
  );
}
