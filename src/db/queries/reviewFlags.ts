import type { DB } from '../wasm';
import type { ReviewFlag, Transaction } from '../types';
import { uuid } from '../uuid';
import { nowIso, toDateString } from '@/lib/dates';

export interface ReviewFlagWithTx extends ReviewFlag {
  tx_amount: number;
  tx_note: string | null;
  tx_date: string;
  tx_category_name: string | null;
  tx_category_icon: string | null;
  tx_account_name: string;
  related_tx_amount: number | null;
  related_tx_note: string | null;
  related_tx_date: string | null;
}

export async function listOpenFlags(db: DB): Promise<ReviewFlagWithTx[]> {
  return db.execO<ReviewFlagWithTx>(
    `SELECT f.*,
            t.amount_minor AS tx_amount, t.note AS tx_note, t.occurred_on AS tx_date,
            c.name AS tx_category_name, c.icon AS tx_category_icon,
            a.name AS tx_account_name,
            r.amount_minor AS related_tx_amount, r.note AS related_tx_note, r.occurred_on AS related_tx_date
     FROM review_flags f
     JOIN transactions t ON t.id = f.transaction_id
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN transactions r ON r.id = f.related_transaction_id
     WHERE f.status = 'open'
     ORDER BY f.score DESC, f.created_at DESC`,
  );
}

export async function dismissFlag(db: DB, id: string): Promise<void> {
  await db.exec('UPDATE review_flags SET status = ?, resolved_at = ? WHERE id = ?', [
    'dismissed',
    nowIso(),
    id,
  ]);
}

export async function resolveFlag(db: DB, id: string): Promise<void> {
  await db.exec('UPDATE review_flags SET status = ?, resolved_at = ? WHERE id = ?', [
    'resolved',
    nowIso(),
    id,
  ]);
}

export async function resolveDuplicate(db: DB, flagId: string, _keepTxId: string, deleteTxId: string): Promise<void> {
  await db.tx(async (tx) => {
    await tx.exec('DELETE FROM transactions WHERE id = ?', [deleteTxId]);
    await tx.exec('UPDATE review_flags SET status = ?, resolved_at = ? WHERE id = ?', [
      'resolved',
      nowIso(),
      flagId,
    ]);
  });
}

export async function runDuplicateScanner(db: DB, windowDays = 30): Promise<number> {
  const recent = await db.execO<Transaction>(
    `SELECT * FROM transactions
     WHERE occurred_on >= date('now', ?)
       AND kind != 'transfer'
     ORDER BY occurred_on DESC, created_at DESC`,
    [`-${windowDays} days`],
  );

  let flagged = 0;
  for (const tx of recent) {
    const candidates = await db.execO<Transaction>(
      `SELECT * FROM transactions
       WHERE id != ? AND ABS(amount_minor) = ABS(?) AND account_id = ?
         AND occurred_on >= date(?, '-1 day') AND occurred_on <= date(?, '+1 day')
         AND NOT (recurring_id IS NOT NULL AND recurring_id = ?)`,
      [tx.id, tx.amount_minor, tx.account_id, tx.occurred_on, tx.occurred_on, tx.recurring_id ?? ''],
    );

    for (const cand of candidates) {
      const existing = await db.execO<{ c: number }>(
        `SELECT COUNT(*) AS c FROM review_flags
         WHERE (transaction_id = ? AND related_transaction_id = ?)
            OR (transaction_id = ? AND related_transaction_id = ?)`,
        [tx.id, cand.id, cand.id, tx.id],
      );
      if ((existing[0]?.c ?? 0) > 0) continue;

      const sameDate = tx.occurred_on === cand.occurred_on;
      const sameCategory = tx.category_id === cand.category_id;
      const score = (sameDate ? 0.5 : 0.3) + (sameCategory ? 0.3 : 0) + 0.2;

      await db.exec(
        `INSERT INTO review_flags (id, transaction_id, related_transaction_id, reason, score, status, created_at)
         VALUES (?, ?, ?, 'duplicate', ?, 'open', ?)`,
        [uuid(), tx.id, cand.id, score, nowIso()],
      );
      flagged++;
    }
  }

  return flagged;
}

export async function runAnomalyScanner(db: DB): Promise<number> {
  const today = toDateString();
  let flagged = 0;

  // Future-dated transactions that look like part of a recurring series are expected, not
  // suspicious. A "series" is any other transaction sharing the same account + amount
  // (past OR future), regardless of whether there's a formal recurring_rules row
  // (Monefy-imported series arrive as raw dated rows without a rule link, and sometimes
  // with no prior occurrence if the user just imported forward-scheduled entries).
  await db.exec(
    `DELETE FROM review_flags
     WHERE reason = 'future_dated' AND status = 'open'
       AND transaction_id IN (
         SELECT t.id FROM transactions t
         WHERE t.occurred_on > ?
           AND (
             t.recurring_id IS NOT NULL
             OR EXISTS (
               SELECT 1 FROM transactions other
               WHERE other.id != t.id
                 AND other.account_id = t.account_id
                 AND other.amount_minor = t.amount_minor
             )
           )
       )`,
    [today],
  );

  const futureDated = await db.execO<{ id: string }>(
    `SELECT t.id FROM transactions t
     WHERE t.occurred_on > ?
       AND t.recurring_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM transactions other
         WHERE other.id != t.id
           AND other.account_id = t.account_id
           AND other.amount_minor = t.amount_minor
       )
       AND t.id NOT IN (SELECT transaction_id FROM review_flags WHERE reason = 'future_dated')`,
    [today],
  );
  for (const tx of futureDated) {
    await db.exec(
      `INSERT INTO review_flags (id, transaction_id, reason, score, status, created_at)
       VALUES (?, ?, 'future_dated', 0.8, 'open', ?)`,
      [uuid(), tx.id, nowIso()],
    );
    flagged++;
  }

  const emptyCat = await db.execO<{ id: string }>(
    `SELECT id FROM transactions WHERE category_id IS NULL AND kind != 'transfer'
     AND id NOT IN (SELECT transaction_id FROM review_flags WHERE reason = 'empty_category')`,
  );
  for (const tx of emptyCat) {
    await db.exec(
      `INSERT INTO review_flags (id, transaction_id, reason, score, status, created_at)
       VALUES (?, ?, 'empty_category', 0.5, 'open', ?)`,
      [uuid(), tx.id, nowIso()],
    );
    flagged++;
  }

  const outliers = await db.execO<{ id: string; amount_minor: number; category_id: string }>(
    `SELECT t.id, t.amount_minor, t.category_id FROM transactions t
     WHERE t.kind = 'expense' AND t.category_id IS NOT NULL
       AND t.occurred_on >= date('now', '-7 days')
       AND t.id NOT IN (SELECT transaction_id FROM review_flags WHERE reason = 'outlier')`,
  );
  for (const tx of outliers) {
    const stats = await db.execO<{ avg_amt: number | null; std_amt: number | null; cnt: number }>(
      `SELECT AVG(ABS(amount_minor)) AS avg_amt,
              CASE WHEN COUNT(*) > 2 THEN
                SQRT(SUM((ABS(amount_minor) - (SELECT AVG(ABS(amount_minor)) FROM transactions WHERE category_id = ? AND id != ? AND occurred_on >= date('now', '-90 days')))
                  * (ABS(amount_minor) - (SELECT AVG(ABS(amount_minor)) FROM transactions WHERE category_id = ? AND id != ? AND occurred_on >= date('now', '-90 days'))))
                  / (COUNT(*) - 1))
              ELSE NULL END AS std_amt,
              COUNT(*) AS cnt
       FROM transactions
       WHERE category_id = ? AND id != ? AND occurred_on >= date('now', '-90 days')`,
      [tx.category_id, tx.id, tx.category_id, tx.id, tx.category_id, tx.id],
    );
    const { avg_amt, std_amt } = stats[0] ?? { avg_amt: null, std_amt: null, cnt: 0 };
    if (avg_amt != null && std_amt != null && std_amt > 0 && Math.abs(tx.amount_minor) > avg_amt + 3 * std_amt) {
      await db.exec(
        `INSERT INTO review_flags (id, transaction_id, reason, score, status, created_at)
         VALUES (?, ?, 'outlier', 0.7, 'open', ?)`,
        [uuid(), tx.id, nowIso()],
      );
      flagged++;
    }
  }

  return flagged;
}
