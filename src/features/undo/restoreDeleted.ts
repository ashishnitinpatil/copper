import type { DB } from '@/db/wasm';
import type { ChangeEntity, ChangeLogEntry, ChangeOp } from '@/db/types';
import { newBatchId, recordChange } from '@/db/changeLog';
import { parseDiff } from '@/features/activity/describe';

type Row = Record<string, unknown>;

// Bringing back a deleted row reuses its id; fine a few hundred at a time, but
// mass resurrection is what a backup restore is for.
const MAX_ROWS = 300;

export type RestoreResult = { ok: true; n: number } | { ok: false; reason: string };

/**
 * Activity offers Restore on a line that only deleted entries (one, a
 * transfer's two legs, or a bulk delete). Deleted accounts and categories
 * changed other rows too, so they go back through a backup instead.
 */
export function isRestorable(group: { total: number; counts: { entity: ChangeEntity; op: ChangeOp }[] }): boolean {
  return (
    group.total <= MAX_ROWS &&
    group.counts.length > 0 &&
    group.counts.every((c) => c.entity === 'transaction' && c.op === 'delete')
  );
}

/** Put back the entries one Activity line deleted, as they were. */
export async function restoreDeleted(db: DB, groupKey: string): Promise<RestoreResult> {
  const rows = await db.execO<ChangeLogEntry>(
    'SELECT * FROM change_log WHERE COALESCE(batch_id, id) = ? ORDER BY at, id',
    [groupKey],
  );
  if (rows.length === 0 || rows.some((r) => r.entity !== 'transaction' || r.op !== 'delete')) {
    return { ok: false, reason: 'Only deleted entries can be restored.' };
  }
  if (rows.length > MAX_ROWS) {
    return { ok: false, reason: 'That was too big a delete to restore here. Restore a backup from Settings › Your data instead.' };
  }

  const befores = rows
    .map((r) => parseDiff(r.diff))
    .map((d) => (d && 'before' in d ? (d.before as Row) : null))
    .filter((b): b is Row => !!b && typeof b.id === 'string');
  const ids = befores.map((b) => b.id as string);
  const marks = ids.map(() => '?').join(',');
  const present = new Set(
    (await db.execO<{ id: string }>(`SELECT id FROM transactions WHERE id IN (${marks})`, ids)).map((r) => r.id),
  );
  const missing = befores.filter((b) => !present.has(b.id as string));
  if (missing.length === 0) return { ok: false, reason: 'Already back.' };

  const columns = new Set(
    (await db.execO<{ name: string }>('SELECT name FROM pragma_table_info(?)', ['transactions'])).map((c) => c.name),
  );
  const existing = async (table: string, values: unknown[]) => {
    const wanted = [...new Set(values.filter((v): v is string => typeof v === 'string' && v !== ''))];
    if (wanted.length === 0) return new Set<string>();
    const rowsFound = await db.execO<{ id: string }>(
      `SELECT id FROM ${table} WHERE id IN (${wanted.map(() => '?').join(',')})`,
      wanted,
    );
    return new Set(rowsFound.map((r) => r.id));
  };
  const accounts = await existing('accounts', missing.map((b) => b.account_id));
  if (missing.some((b) => !accounts.has(b.account_id as string))) {
    return { ok: false, reason: 'Its account isn’t in this book any more (merged or replaced since). To go back, restore a backup from Settings › Your data.' };
  }
  const categories = await existing('categories', missing.map((b) => b.category_id));
  const rules = await existing('recurring_rules', missing.map((b) => b.recurring_id));

  const opts = { batchId: newBatchId(), source: 'restore' };
  await db.tx(async (tx) => {
    for (const before of missing) {
      const row: Row = { ...before };
      // A category or repeating rule removed since leaves the entry without one.
      if (row.category_id && !categories.has(row.category_id as string)) row.category_id = null;
      if (row.recurring_id && !rules.has(row.recurring_id as string)) row.recurring_id = null;
      const keys = Object.keys(row).filter((k) => columns.has(k));
      await tx.exec(
        `INSERT INTO transactions (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        keys.map((k) => row[k]),
      );
      await recordChange(db, 'transaction', row.id as string, 'insert', { after: row }, { ...opts, exec: tx });
    }
  });
  return { ok: true, n: missing.length };
}
