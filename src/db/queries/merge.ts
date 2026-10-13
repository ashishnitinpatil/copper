import type { DB } from '../wasm';
import type { Account, Budget, Category, RecurringRule, Transaction } from '../types';
import { logUpdate, newBatchId, recordChange, snapshotEntity, type LogOptions } from '../changeLog';
import type { RecurringTemplate } from './recurring';
import { getAccountBalances } from './accounts';
import { toDateString } from '@/lib/dates';

/**
 * Consolidating duplicate categories/accounts. A merge reassigns everything
 * that points at the source — transactions, and any budgets, sub-categories,
 * "pay bill from" links, and recurring-rule templates — onto the target, then
 * deletes the source. The whole operation shares one batch_id so the audit
 * trail (and Activity feed) collapses it into a single "Merged …" group, and
 * each moved record keeps a per-row history entry.
 *
 * Not wrapped in a single transaction by design: the change-log helpers read
 * each row's post-update state to compute its diff (the same pattern as the
 * bulk-edit helpers), which an open transaction would not see.
 */

const asRow = (r: object): Record<string, unknown> => r as unknown as Record<string, unknown>;

/** Transactions that would move — the headline figure for the confirm dialog. */
async function countTransactions(db: DB, column: 'category_id' | 'account_id', id: string) {
  const rows = await db.execO<{ c: number }>(
    `SELECT COUNT(*) AS c FROM transactions WHERE ${column} = ?`,
    [id],
  );
  return rows[0]?.c ?? 0;
}

export function previewCategoryMerge(db: DB, sourceId: string): Promise<number> {
  return countTransactions(db, 'category_id', sourceId);
}

export function previewAccountMerge(db: DB, sourceId: string): Promise<number> {
  return countTransactions(db, 'account_id', sourceId);
}

/** Move every recurring-rule template that points at `oldId` to `newId`. */
async function repointRecurringTemplates(
  db: DB,
  field: keyof RecurringTemplate,
  oldId: string,
  newId: string,
  opts: LogOptions,
): Promise<void> {
  const rules = await db.execO<RecurringRule>('SELECT * FROM recurring_rules');
  for (const rule of rules) {
    const tpl = JSON.parse(rule.template_json) as RecurringTemplate;
    if (tpl[field] !== oldId) continue;
    const before = asRow(rule);
    (tpl as unknown as Record<string, unknown>)[field] = newId;
    await db.exec('UPDATE recurring_rules SET template_json = ? WHERE id = ?', [
      JSON.stringify(tpl),
      rule.id,
    ]);
    await logUpdate(db, 'recurring', rule.id, before, opts);
  }
}

export async function mergeCategory(db: DB, sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) throw new Error('Cannot merge a category into itself.');
  const source = (await snapshotEntity(db, 'category', sourceId)) as Category | null;
  const target = (await snapshotEntity(db, 'category', targetId)) as Category | null;
  if (!source || !target) throw new Error('Category not found.');
  if (source.kind !== target.kind) {
    throw new Error('Only categories of the same kind (expense or income) can be merged.');
  }

  const opts: LogOptions = { batchId: newBatchId(), source: 'category-merge' };

  const txns = await db.execO<Transaction>('SELECT * FROM transactions WHERE category_id = ?', [
    sourceId,
  ]);
  await db.exec('UPDATE transactions SET category_id = ? WHERE category_id = ?', [
    targetId,
    sourceId,
  ]);
  for (const row of txns) await logUpdate(db, 'transaction', row.id, asRow(row), opts);

  const budgets = await db.execO<Budget>('SELECT * FROM budgets WHERE category_id = ?', [sourceId]);
  await db.exec('UPDATE budgets SET category_id = ? WHERE category_id = ?', [targetId, sourceId]);
  for (const row of budgets) await logUpdate(db, 'budget', row.id, asRow(row), opts);

  const children = await db.execO<Category>('SELECT * FROM categories WHERE parent_id = ?', [
    sourceId,
  ]);
  await db.exec('UPDATE categories SET parent_id = ? WHERE parent_id = ?', [targetId, sourceId]);
  for (const row of children) await logUpdate(db, 'category', row.id, asRow(row), opts);

  await repointRecurringTemplates(db, 'category_id', sourceId, targetId, opts);

  await db.exec('DELETE FROM categories WHERE id = ?', [sourceId]);
  await recordChange(db, 'category', sourceId, 'delete', { before: asRow(source), merged_into: targetId }, opts);
}

export async function mergeAccount(db: DB, sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) throw new Error('Cannot merge an account into itself.');
  const source = (await snapshotEntity(db, 'account', sourceId)) as Account | null;
  const target = (await snapshotEntity(db, 'account', targetId)) as Account | null;
  if (!source || !target) throw new Error('Account not found.');
  if (source.currency !== target.currency) {
    throw new Error('Only accounts in the same currency can be merged.');
  }

  const opts: LogOptions = { batchId: newBatchId(), source: 'account-merge' };

  // Capture both balances (as of today) *before* moving anything, so we can
  // restore the combined balance afterwards. This matters because each account's
  // opening balance is anchored to its own `starts_on`: a moved transaction
  // dated before the target's `starts_on` would otherwise drop out of the sum.
  const today = toDateString();
  const balances = await getAccountBalances(db, today);
  const balanceOf = (id: string, fallback: number) =>
    balances.find((b) => b.account_id === id)?.balance_minor ?? fallback;
  const combinedBalance =
    balanceOf(sourceId, source.opening_balance_minor) +
    balanceOf(targetId, target.opening_balance_minor);

  // Reassigning account_id also moves any transfer legs (each leg carries its
  // own account_id), so transfers follow the account automatically.
  const txns = await db.execO<Transaction>('SELECT * FROM transactions WHERE account_id = ?', [
    sourceId,
  ]);
  await db.exec('UPDATE transactions SET account_id = ? WHERE account_id = ?', [targetId, sourceId]);
  for (const row of txns) await logUpdate(db, 'transaction', row.id, asRow(row), opts);

  // Credit cards that paid their bill from the source now pay from the target.
  const payers = await db.execO<Account>('SELECT * FROM accounts WHERE pay_from_account_id = ?', [
    sourceId,
  ]);
  await db.exec('UPDATE accounts SET pay_from_account_id = ? WHERE pay_from_account_id = ?', [
    targetId,
    sourceId,
  ]);
  for (const row of payers) await logUpdate(db, 'account', row.id, asRow(row), opts);

  await repointRecurringTemplates(db, 'account_id', sourceId, targetId, opts);

  // Set the target's opening balance so its recomputed balance equals the two
  // accounts combined — opening = combined − (transactions that still count
  // under the target's own `starts_on`). When the dates match this reduces to
  // the plain sum of the two openings; when they differ it stays exact. Also
  // carry over the "main" flag if either account had it.
  const countedRows = await db.execO<{ s: number }>(
    `SELECT COALESCE(SUM(amount_minor), 0) AS s FROM transactions
     WHERE account_id = ? AND (? = '' OR occurred_on >= ?) AND occurred_on <= ?`,
    [targetId, target.starts_on, target.starts_on, today],
  );
  const newOpening = combinedBalance - (countedRows[0]?.s ?? 0);
  const targetBefore = asRow(target);
  await db.exec('UPDATE accounts SET opening_balance_minor = ?, is_main = ? WHERE id = ?', [
    newOpening,
    target.is_main || source.is_main ? 1 : 0,
    targetId,
  ]);
  await logUpdate(db, 'account', targetId, targetBefore, opts);

  await db.exec('DELETE FROM accounts WHERE id = ?', [sourceId]);
  await recordChange(db, 'account', sourceId, 'delete', { before: asRow(source), merged_into: targetId }, opts);
}
