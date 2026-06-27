import type { DB } from '../wasm';
import type { Transaction, TransactionKind } from '../types';
import { uuid } from '../uuid';
import { nowIso, toDateString } from '@/lib/dates';

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
  return id;
}

export async function updateTransaction(
  db: DB,
  id: string,
  input: TransactionInput,
): Promise<void> {
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
}

export async function deleteTransaction(db: DB, id: string): Promise<void> {
  const rows = await db.execO<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!rows[0]) return;
  const peer = rows[0].transfer_peer_id;
  await db.tx(async (tx) => {
    await tx.exec('DELETE FROM transactions WHERE id = ?', [id]);
    if (peer) {
      await tx.exec('DELETE FROM transactions WHERE id = ?', [peer]);
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
  await db.exec(
    `UPDATE transactions SET category_id = ?
     WHERE id IN (${placeholders}) AND kind != 'transfer'`,
    [categoryId, ...ids],
  );
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
  await db.exec(`DELETE FROM transactions WHERE id IN (${delPlaceholders})`, allIds);
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
    SELECT t.*, a.name AS account_name, a.currency AS account_currency,
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
  amount_minor: number;
  occurred_on?: string;
  note?: string | null;
}

export async function createTransfer(db: DB, input: TransferInput): Promise<[string, string]> {
  const fromId = uuid();
  const toId = uuid();
  const occurred = input.occurred_on ?? toDateString();
  const now = nowIso();
  const amount = Math.abs(input.amount_minor);

  await db.tx(async (tx) => {
    await tx.exec(
      `INSERT INTO transactions (id, account_id, category_id, amount_minor, kind, transfer_peer_id, occurred_on, note, created_at)
       VALUES (?, ?, NULL, ?, 'transfer', ?, ?, ?, ?)`,
      [fromId, input.from_account_id, -amount, toId, occurred, input.note ?? null, now],
    );
    await tx.exec(
      `INSERT INTO transactions (id, account_id, category_id, amount_minor, kind, transfer_peer_id, occurred_on, note, created_at)
       VALUES (?, ?, NULL, ?, 'transfer', ?, ?, ?, ?)`,
      [toId, input.to_account_id, amount, fromId, occurred, input.note ?? null, now],
    );
  });

  return [fromId, toId];
}
