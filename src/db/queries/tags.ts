import type { DB } from '../wasm';
import type { Tag } from '../types';
import type { TransactionWithMeta } from './transactions';
import { uuid } from '../uuid';
import { nowIso } from '@/lib/dates';
import { convert, type FxRates } from '@/lib/fx';
import { logCreate, logUpdate, newBatchId, recordChange, snapshotEntity } from '../changeLog';

export interface TagInput {
  name: string;
  color?: string | null;
  icon?: string | null;
  starts_on?: string | null;
  ends_on?: string | null;
  budget_minor?: number | null;
  currency: string;
}

/** A tag plus its rolled-up spend, converted into the tag's own currency. */
export interface TagWithSpend extends Tag {
  expense_minor: number;
  income_minor: number;
  tx_count: number;
  /** Currencies of tagged amounts converted into the tag's currency (usually none). */
  converted_from: string[];
}

export interface TagCategorySpend {
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  total: number;
}

export async function listTags(db: DB, includeArchived = false): Promise<Tag[]> {
  const sql = includeArchived
    ? 'SELECT * FROM tags ORDER BY created_at DESC'
    : 'SELECT * FROM tags WHERE archived_at IS NULL ORDER BY created_at DESC';
  return db.execO<Tag>(sql);
}

export async function createTag(db: DB, input: TagInput): Promise<string> {
  const id = uuid();
  await db.exec(
    `INSERT INTO tags (id, name, color, icon, starts_on, ends_on, budget_minor, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.color ?? null,
      input.icon ?? null,
      input.starts_on ?? null,
      input.ends_on ?? null,
      input.budget_minor ?? null,
      input.currency,
      nowIso(),
    ],
  );
  await logCreate(db, 'tag', id);
  return id;
}

export async function updateTag(db: DB, id: string, input: TagInput): Promise<void> {
  const before = await snapshotEntity(db, 'tag', id);
  await db.exec(
    `UPDATE tags SET name = ?, color = ?, icon = ?, starts_on = ?, ends_on = ?,
       budget_minor = ?, currency = ?
     WHERE id = ?`,
    [
      input.name,
      input.color ?? null,
      input.icon ?? null,
      input.starts_on ?? null,
      input.ends_on ?? null,
      input.budget_minor ?? null,
      input.currency,
      id,
    ],
  );
  await logUpdate(db, 'tag', id, before);
}

export async function archiveTag(db: DB, id: string): Promise<void> {
  const before = await snapshotEntity(db, 'tag', id);
  await db.exec('UPDATE tags SET archived_at = ? WHERE id = ?', [nowIso(), id]);
  await logUpdate(db, 'tag', id, before);
}

// --- Links -----------------------------------------------------------------

export interface TxTagLink {
  transaction_id: string;
  tag_id: string;
}

/** Every (transaction, tag) link — small table, fetched whole for in-memory joins. */
export async function listTxTagLinks(db: DB): Promise<TxTagLink[]> {
  return db.execO<TxTagLink>('SELECT transaction_id, tag_id FROM transaction_tags');
}

export async function getTagIdsForTransaction(db: DB, txId: string): Promise<string[]> {
  const rows = await db.execO<{ tag_id: string }>(
    'SELECT tag_id FROM transaction_tags WHERE transaction_id = ?',
    [txId],
  );
  return rows.map((r) => r.tag_id);
}

/** Replace a transaction's tag set with exactly `tagIds` (diff insert/delete). */
export async function setTransactionTags(db: DB, txId: string, tagIds: string[]): Promise<void> {
  const current = new Set(await getTagIdsForTransaction(db, txId));
  const next = new Set(tagIds);
  const toAdd = tagIds.filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !next.has(id));
  if (toAdd.length === 0 && toRemove.length === 0) return;
  const now = nowIso();
  await db.tx(async (tx) => {
    for (const tagId of toAdd) {
      await tx.exec(
        'INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id, created_at) VALUES (?, ?, ?)',
        [txId, tagId, now],
      );
    }
    for (const tagId of toRemove) {
      await tx.exec('DELETE FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?', [
        txId,
        tagId,
      ]);
    }
    // Tag links live on the transaction, so a tag change shows up in that
    // transaction's history as an update to its `tags` set.
    await recordChange(
      db,
      'transaction',
      txId,
      'update',
      { changes: { tags: { old: [...current], new: tagIds } } },
      { exec: tx, source: 'tags' },
    );
  });
}

/** Attach a single tag to many transactions (used by bulk-assign). */
export async function bulkAddTag(db: DB, txIds: string[], tagId: string): Promise<void> {
  if (txIds.length === 0) return;
  const now = nowIso();
  const batchId = txIds.length > 1 ? newBatchId() : null;
  await db.tx(async (tx) => {
    for (const txId of txIds) {
      await tx.exec(
        'INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id, created_at) VALUES (?, ?, ?)',
        [txId, tagId, now],
      );
      await recordChange(
        db,
        'transaction',
        txId,
        'update',
        { changes: { tag_added: { old: null, new: tagId } } },
        { exec: tx, batchId, source: 'tags' },
      );
    }
  });
}

// --- Rollups ----------------------------------------------------------------

interface TagSpendRow {
  tag_id: string;
  kind: string;
  currency: string;
  total: number;
  cnt: number;
}

/**
 * Tags with their expense/income totals and transaction counts. Each account's
 * slice is converted into the tag's own currency before summing (see lib/fx).
 */
export async function listTagsWithSpend(
  db: DB,
  defaultCurrency: string,
  fxRates: FxRates,
  includeArchived = false,
): Promise<TagWithSpend[]> {
  const tags = await listTags(db, includeArchived);
  const rows = await db.execO<TagSpendRow>(
    `SELECT tt.tag_id AS tag_id, t.kind AS kind, a.currency AS currency,
            SUM(ABS(t.amount_minor)) AS total, COUNT(*) AS cnt
     FROM transaction_tags tt
     JOIN transactions t ON t.id = tt.transaction_id
     JOIN accounts a ON a.id = t.account_id
     WHERE t.kind IN ('expense', 'income')
     GROUP BY tt.tag_id, t.kind, a.currency`,
  );
  const byTag = new Map<string, { expense: number; income: number; count: number; from: Set<string> }>();
  const cur = new Map(tags.map((t) => [t.id, t.currency]));
  for (const r of rows) {
    const target = cur.get(r.tag_id);
    if (!target) continue; // archived/filtered tag
    const agg = byTag.get(r.tag_id) ?? { expense: 0, income: 0, count: 0, from: new Set<string>() };
    const conv = convert(r.total, r.currency, target, defaultCurrency, fxRates);
    if (r.currency !== target) agg.from.add(r.currency);
    if (r.kind === 'expense') agg.expense += conv;
    else agg.income += conv;
    agg.count += r.cnt;
    byTag.set(r.tag_id, agg);
  }
  return tags.map((t) => {
    const agg = byTag.get(t.id);
    return {
      ...t,
      expense_minor: agg?.expense ?? 0,
      income_minor: agg?.income ?? 0,
      tx_count: agg?.count ?? 0,
      converted_from: agg ? [...agg.from] : [],
    };
  });
}

interface TagCategoryRow {
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  currency: string;
  total: number;
}

/** Expense breakdown by category for a single tag, in the tag's currency. */
export async function getTagCategorySpend(
  db: DB,
  tagId: string,
  tagCurrency: string,
  defaultCurrency: string,
  fxRates: FxRates,
): Promise<TagCategorySpend[]> {
  const rows = await db.execO<TagCategoryRow>(
    `SELECT c.id AS category_id, c.name AS category_name, c.icon AS category_icon,
            c.color AS category_color, a.currency AS currency,
            SUM(ABS(t.amount_minor)) AS total
     FROM transaction_tags tt
     JOIN transactions t ON t.id = tt.transaction_id
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE tt.tag_id = ? AND t.kind = 'expense'
     GROUP BY c.id, a.currency`,
    [tagId],
  );
  const map = new Map<string, TagCategorySpend>();
  for (const r of rows) {
    const key = r.category_id ?? '__none';
    const ex = map.get(key) ?? {
      category_id: r.category_id,
      category_name: r.category_name,
      category_icon: r.category_icon,
      category_color: r.category_color,
      total: 0,
    };
    ex.total += convert(r.total, r.currency, tagCurrency, defaultCurrency, fxRates);
    map.set(key, ex);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

/** All transactions carrying a given tag, newest first. */
export async function listTransactionsForTag(
  db: DB,
  tagId: string,
): Promise<TransactionWithMeta[]> {
  return db.execO<TransactionWithMeta>(
    `SELECT t.*, a.name AS account_name, a.currency AS account_currency,
            c.name AS category_name, c.icon AS category_icon, c.color AS category_color
     FROM transaction_tags tt
     JOIN transactions t ON t.id = tt.transaction_id
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE tt.tag_id = ?
     ORDER BY t.occurred_on DESC, t.created_at DESC`,
    [tagId],
  );
}

/**
 * Transactions inside a dated tag's window that aren't tagged with it yet —
 * the "12 entries during this trip aren't tagged, add them?" suggestion list.
 */
export async function listUntaggedInWindow(
  db: DB,
  tagId: string,
  from: string,
  to: string,
): Promise<TransactionWithMeta[]> {
  return db.execO<TransactionWithMeta>(
    `SELECT t.*, a.name AS account_name, a.currency AS account_currency,
            c.name AS category_name, c.icon AS category_icon, c.color AS category_color
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.kind IN ('expense', 'income')
       AND t.occurred_on >= ? AND t.occurred_on <= ?
       AND t.id NOT IN (SELECT transaction_id FROM transaction_tags WHERE tag_id = ?)
     ORDER BY t.occurred_on DESC, t.created_at DESC`,
    [from, to, tagId],
  );
}
