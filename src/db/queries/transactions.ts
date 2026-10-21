import type { DB } from '../wasm';
import type { AccountType, Transaction, TransactionKind } from '../types';
import { uuid } from '../uuid';
import { nowIso, toDateString } from '@/lib/dates';
import { logCreate, logUpdate, logDelete, newBatchId, snapshotEntity } from '../changeLog';
import { fuzzyScore } from '@/lib/fuzzy';
import { parseAmount, getCurrency } from '@/lib/money';
import type { PastNote } from '@/lib/noteSuggestions';

export interface TransactionInput {
  account_id: string;
  category_id: string | null;
  amount_minor: number;
  kind: TransactionKind;
  occurred_on?: string;
  note?: string | null;
  recurring_id?: string | null;
}

export interface TransactionWithMeta extends Transaction {
  account_name: string;
  account_currency: string;
  account_type: AccountType;
  account_icon: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
}

export interface TransactionFilter {
  accountId?: string;
  categoryId?: string;
  tagId?: string;
  kind?: TransactionKind;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function createTransaction(db: DB, input: TransactionInput): Promise<string> {
  const id = uuid();
  const signedAmount = input.kind === 'expense' ? -Math.abs(input.amount_minor) : Math.abs(input.amount_minor);
  await db.exec(
    `INSERT INTO transactions (
      id, account_id, category_id, amount_minor, kind,
      occurred_on, note, recurring_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.account_id,
      input.category_id,
      input.kind === 'transfer' ? input.amount_minor : signedAmount,
      input.kind,
      input.occurred_on ?? toDateString(),
      input.note ?? null,
      input.recurring_id ?? null,
      nowIso(),
    ],
  );
  await logCreate(db, 'transaction', id);
  return id;
}

export async function updateTransaction(
  db: DB,
  id: string,
  input: TransactionInput,
): Promise<void> {
  const before = await snapshotEntity(db, 'transaction', id);
  const signedAmount = input.kind === 'expense' ? -Math.abs(input.amount_minor) : Math.abs(input.amount_minor);
  await db.exec(
    `UPDATE transactions SET
      account_id = ?, category_id = ?, amount_minor = ?, kind = ?,
      occurred_on = ?, note = ?
     WHERE id = ?`,
    [
      input.account_id,
      input.category_id,
      input.kind === 'transfer' ? input.amount_minor : signedAmount,
      input.kind,
      input.occurred_on ?? toDateString(),
      input.note ?? null,
      id,
    ],
  );
  await logUpdate(db, 'transaction', id, before);
}

export async function deleteTransaction(db: DB, id: string): Promise<void> {
  const rows = await db.execO<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!rows[0]) return;
  const peer = rows[0].transfer_peer_id;
  const peerRows = peer
    ? await db.execO<Transaction>('SELECT * FROM transactions WHERE id = ?', [peer])
    : [];
  // One batch ties the two legs of a deleted transfer together.
  const batchId = peer ? newBatchId() : null;
  await db.tx(async (tx) => {
    await tx.exec('DELETE FROM transactions WHERE id = ?', [id]);
    await logDelete(db, 'transaction', rows[0] as unknown as Record<string, unknown>, {
      exec: tx,
      batchId,
    });
    if (peer) {
      await tx.exec('DELETE FROM transactions WHERE id = ?', [peer]);
      if (peerRows[0]) {
        await logDelete(db, 'transaction', peerRows[0] as unknown as Record<string, unknown>, {
          exec: tx,
          batchId,
        });
      }
    }
  });
}

/** Set the category on many transactions at once. Transfers are skipped (they carry no category). */
export async function bulkSetCategory(
  db: DB,
  ids: string[],
  categoryId: string | null,
): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  // Snapshot the rows that will actually change (transfers are excluded) so we
  // can log a per-row update for each — keeping every transaction's history
  // complete even when the category is set in bulk.
  const before = await db.execO<Transaction>(
    `SELECT * FROM transactions WHERE id IN (${placeholders}) AND kind != 'transfer'`,
    ids,
  );
  await db.exec(
    `UPDATE transactions SET category_id = ?
     WHERE id IN (${placeholders}) AND kind != 'transfer'`,
    [categoryId, ...ids],
  );
  const batchId = before.length > 1 ? newBatchId() : null;
  for (const row of before) {
    await logUpdate(db, 'transaction', row.id, row as unknown as Record<string, unknown>, {
      batchId,
      source: 'bulk-category',
    });
  }
}

/** Delete many transactions, pulling in the matching peer leg of any transfer. */
export async function bulkDeleteTransactions(db: DB, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  const peers = await db.execO<{ transfer_peer_id: string | null }>(
    `SELECT transfer_peer_id FROM transactions WHERE id IN (${placeholders})`,
    ids,
  );
  const all = new Set(ids);
  for (const p of peers) if (p.transfer_peer_id) all.add(p.transfer_peer_id);
  const allIds = [...all];
  const delPlaceholders = allIds.map(() => '?').join(', ');
  // Snapshot every row (including pulled-in transfer peers) before deleting, so
  // each delete keeps its last-known state in the audit trail.
  const before = await db.execO<Transaction>(
    `SELECT * FROM transactions WHERE id IN (${delPlaceholders})`,
    allIds,
  );
  const batchId = before.length > 1 ? newBatchId() : null;
  await db.tx(async (tx) => {
    await tx.exec(`DELETE FROM transactions WHERE id IN (${delPlaceholders})`, allIds);
    for (const row of before) {
      await logDelete(db, 'transaction', row as unknown as Record<string, unknown>, {
        exec: tx,
        batchId,
        source: 'bulk-delete',
      });
    }
  });
}

export async function listTransactions(
  db: DB,
  filter: TransactionFilter = {},
): Promise<TransactionWithMeta[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filter.accountId) {
    where.push('t.account_id = ?');
    params.push(filter.accountId);
  }
  if (filter.categoryId) {
    where.push('t.category_id = ?');
    params.push(filter.categoryId);
  }
  if (filter.tagId) {
    where.push(
      'EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = ?)',
    );
    params.push(filter.tagId);
  }
  if (filter.kind) {
    where.push('t.kind = ?');
    params.push(filter.kind);
  }
  if (filter.dateFrom) {
    where.push('t.occurred_on >= ?');
    params.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    where.push('t.occurred_on <= ?');
    params.push(filter.dateTo);
  }
  if (filter.search) {
    where.push('(t.note LIKE ? OR c.name LIKE ?)');
    const q = `%${filter.search}%`;
    params.push(q, q);
  }

  const limit = filter.limit ?? 200;
  const offset = filter.offset ?? 0;

  const sql = `
    SELECT t.*, a.name AS account_name, a.currency AS account_currency, a.type AS account_type, a.icon AS account_icon,
           c.name AS category_name, c.icon AS category_icon, c.color AS category_color
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.occurred_on DESC, t.created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);
  return db.execO<TransactionWithMeta>(sql, params);
}

/**
 * How many minor units to collapse so an amount query matches at the precision
 * the user typed. `48` (0 decimals) → divisor 100 (match the whole unit); `48.9`
 * (1 decimal) → divisor 10; `48.99` (2 decimals) → divisor 1 (exact). Never
 * finer than the currency's own precision.
 */
function amountDivisorFor(query: string, currency: string): number {
  const { decimals } = getCurrency(currency);
  const frac = query.replace(/[, _]/g, '').split('.')[1] ?? '';
  const typed = Math.min(frac.length, decimals);
  return 10 ** (decimals - typed);
}

/**
 * Search transactions by free text (typo-tolerant, fuzzy-ranked) and/or amount.
 * A numeric query matches transactions whose absolute amount equals it; text is
 * matched fuzzily across note, category and account name. The structured filters
 * still apply and narrow the candidate set first; ranking happens in JS since
 * SQLite here has no full-text or edit-distance support. Returns the best
 * matches, highest relevance first.
 */
export async function searchTransactions(
  db: DB,
  query: string,
  filter: TransactionFilter = {},
  currency = 'USD',
): Promise<TransactionWithMeta[]> {
  const q = query.trim();
  if (!q) return listTransactions(db, filter);

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.accountId) {
    where.push('t.account_id = ?');
    params.push(filter.accountId);
  }
  if (filter.categoryId) {
    where.push('t.category_id = ?');
    params.push(filter.categoryId);
  }
  if (filter.tagId) {
    where.push(
      'EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = ?)',
    );
    params.push(filter.tagId);
  }
  if (filter.kind) {
    where.push('t.kind = ?');
    params.push(filter.kind);
  }
  if (filter.dateFrom) {
    where.push('t.occurred_on >= ?');
    params.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    where.push('t.occurred_on <= ?');
    params.push(filter.dateTo);
  }

  // Pull the filtered candidates (capped for safety) and rank them in JS.
  const candidates = await db.execO<TransactionWithMeta>(
    `SELECT t.*, a.name AS account_name, a.currency AS account_currency, a.type AS account_type, a.icon AS account_icon,
            c.name AS category_name, c.icon AS category_icon, c.color AS category_color
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.occurred_on DESC, t.created_at DESC
     LIMIT 20000`,
    params,
  );

  const amountMinor = parseAmount(q, currency);
  const absAmount = amountMinor != null ? Math.abs(amountMinor) : null;
  // Match amounts at the precision the user typed: "1467" finds 1467.00–1467.99,
  // "48.9" finds 48.90–48.99, "48.99" matches exactly. We compare both values
  // truncated to the typed number of decimals (`amountDivisor` drops the rest).
  const amountDivisor = amountDivisorFor(q, currency);

  const scored: { row: TransactionWithMeta; score: number }[] = [];
  for (const row of candidates) {
    let score = 0;
    if (absAmount != null) {
      const rowAbs = Math.abs(row.amount_minor);
      if (Math.floor(rowAbs / amountDivisor) === Math.floor(absAmount / amountDivisor)) {
        score = 1;
      }
    }
    const text = `${row.note ?? ''} ${row.category_name ?? ''} ${row.account_name}`;
    const textScore = fuzzyScore(q, text);
    if (textScore > score) score = textScore;
    if (score > 0) scored.push({ row, score });
  }
  scored.sort(
    (x, y) => y.score - x.score || y.row.occurred_on.localeCompare(x.row.occurred_on),
  );
  return scored.slice(0, filter.limit ?? 500).map((s) => s.row);
}

export async function countTransactions(db: DB, filter: TransactionFilter = {}): Promise<number> {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filter.accountId) {
    where.push('account_id = ?');
    params.push(filter.accountId);
  }
  if (filter.categoryId) {
    where.push('category_id = ?');
    params.push(filter.categoryId);
  }
  if (filter.dateFrom) {
    where.push('occurred_on >= ?');
    params.push(filter.dateFrom);
  }
  if (filter.kind) {
    where.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.dateTo) {
    where.push('occurred_on <= ?');
    params.push(filter.dateTo);
  }

  const rows = await db.execO<{ c: number }>(
    `SELECT COUNT(*) AS c FROM transactions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
    params,
  );
  return rows[0]?.c ?? 0;
}

export interface TransferInput {
  from_account_id: string;
  to_account_id: string;
  /** Amount sent, in the from-account's currency. */
  amount_minor: number;
  /** Amount received, in the to-account's currency. Defaults to the amount sent
   *  — only differs when the two accounts hold different currencies. */
  to_amount_minor?: number;
  occurred_on?: string;
  note?: string | null;
}

export interface TransferLegs {
  /** The leg that left an account (negative amount). */
  from: Transaction;
  /** The leg that arrived (positive amount). */
  to: Transaction;
}

/** Both legs of the transfer that `id` (either leg) belongs to. */
export async function getTransfer(db: DB, id: string): Promise<TransferLegs | null> {
  const [leg] = await db.execO<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!leg || leg.kind !== 'transfer' || !leg.transfer_peer_id) return null;
  const [peer] = await db.execO<Transaction>('SELECT * FROM transactions WHERE id = ?', [
    leg.transfer_peer_id,
  ]);
  if (!peer) return null;
  return leg.amount_minor < 0 ? { from: leg, to: peer } : { from: peer, to: leg };
}

/** Change a transfer: both legs move together, logged as one change. */
export async function updateTransfer(db: DB, id: string, input: TransferInput): Promise<void> {
  const legs = await getTransfer(db, id);
  if (!legs) throw new Error('Transfer not found');
  const amount = Math.abs(input.amount_minor);
  const toAmount = Math.abs(input.to_amount_minor ?? input.amount_minor);
  const occurred = input.occurred_on ?? legs.from.occurred_on;
  const beforeFrom = await snapshotEntity(db, 'transaction', legs.from.id);
  const beforeTo = await snapshotEntity(db, 'transaction', legs.to.id);
  await db.tx(async (tx) => {
    await tx.exec(
      'UPDATE transactions SET account_id = ?, amount_minor = ?, occurred_on = ?, note = ? WHERE id = ?',
      [input.from_account_id, -amount, occurred, input.note ?? null, legs.from.id],
    );
    await tx.exec(
      'UPDATE transactions SET account_id = ?, amount_minor = ?, occurred_on = ?, note = ? WHERE id = ?',
      [input.to_account_id, toAmount, occurred, input.note ?? null, legs.to.id],
    );
  });
  const batchId = newBatchId();
  await logUpdate(db, 'transaction', legs.from.id, beforeFrom, { batchId, source: 'transfer' });
  await logUpdate(db, 'transaction', legs.to.id, beforeTo, { batchId, source: 'transfer' });
}

export async function createTransfer(db: DB, input: TransferInput): Promise<[string, string]> {
  const fromId = uuid();
  const toId = uuid();
  const occurred = input.occurred_on ?? toDateString();
  const now = nowIso();
  const amount = Math.abs(input.amount_minor);
  const toAmount = Math.abs(input.to_amount_minor ?? input.amount_minor);

  await db.tx(async (tx) => {
    await tx.exec(
      `INSERT INTO transactions (id, account_id, category_id, amount_minor, kind, transfer_peer_id, occurred_on, note, created_at)
       VALUES (?, ?, NULL, ?, 'transfer', ?, ?, ?, ?)`,
      [fromId, input.from_account_id, -amount, toId, occurred, input.note ?? null, now],
    );
    await tx.exec(
      `INSERT INTO transactions (id, account_id, category_id, amount_minor, kind, transfer_peer_id, occurred_on, note, created_at)
       VALUES (?, ?, NULL, ?, 'transfer', ?, ?, ?, ?)`,
      [toId, input.to_account_id, toAmount, fromId, occurred, input.note ?? null, now],
    );
  });

  // Both legs share one batch so the UI can show them as a single transfer.
  const batchId = newBatchId();
  await logCreate(db, 'transaction', fromId, { batchId, source: 'transfer' });
  await logCreate(db, 'transaction', toId, { batchId, source: 'transfer' });

  return [fromId, toId];
}

/** Notes used before for this kind of entry, for suggesting while typing one. */
export async function listPastNotes(db: DB, kind: TransactionKind): Promise<PastNote[]> {
  return db.execO<PastNote>(
    // With a single MAX(), SQLite takes bare columns (category_id) from that
    // row: the category this note was last used with.
    `SELECT TRIM(note) AS note, COUNT(*) AS uses, MAX(occurred_on) AS last_on, category_id
     FROM transactions
     WHERE kind = ? AND note IS NOT NULL AND TRIM(note) <> ''
     GROUP BY TRIM(note)
     ORDER BY last_on DESC
     LIMIT 500`,
    [kind],
  );
}

/** Entries matching a filter (and search), counted and summed per kind and currency. */
export interface TransactionSummaryRow {
  kind: TransactionKind;
  currency: string;
  n: number;
  total: number;
}

export async function summarizeTransactions(
  db: DB,
  filter: TransactionFilter,
  query: string,
  currency: string,
): Promise<TransactionSummaryRow[]> {
  const add = (map: Map<string, TransactionSummaryRow>, kind: TransactionKind, cur: string, amount: number) => {
    const key = `${kind}|${cur}`;
    const row = map.get(key) ?? { kind, currency: cur, n: 0, total: 0 };
    row.n += 1;
    row.total += Math.abs(amount);
    map.set(key, row);
  };
  if (query.trim()) {
    // Search ranks in JS, so sum what it matched.
    const rows = await searchTransactions(db, query, { ...filter, limit: 1_000_000 }, currency);
    const map = new Map<string, TransactionSummaryRow>();
    for (const r of rows) add(map, r.kind, r.account_currency, r.amount_minor);
    return [...map.values()];
  }
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.accountId) {
    where.push('t.account_id = ?');
    params.push(filter.accountId);
  }
  if (filter.categoryId) {
    where.push('t.category_id = ?');
    params.push(filter.categoryId);
  }
  if (filter.tagId) {
    where.push('EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = ?)');
    params.push(filter.tagId);
  }
  if (filter.kind) {
    where.push('t.kind = ?');
    params.push(filter.kind);
  }
  if (filter.dateFrom) {
    where.push('t.occurred_on >= ?');
    params.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    where.push('t.occurred_on <= ?');
    params.push(filter.dateTo);
  }
  return db.execO<TransactionSummaryRow>(
    `SELECT t.kind AS kind, a.currency AS currency, COUNT(*) AS n, SUM(ABS(t.amount_minor)) AS total
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY t.kind, a.currency`,
    params,
  );
}
