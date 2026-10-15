import type { DB } from '@/db/wasm';
import type { ChangeEntity, ChangeOp } from '@/db/types';
import { ENTITY_TABLE, newBatchId, recordChange } from '@/db/changeLog';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { listTags } from '@/db/queries/tags';
import { nowIso } from '@/lib/dates';
import { describeEntry, describeGroup, parseDiff, type Lookups } from '@/features/activity/describe';

/**
 * Quick undo (Ctrl+Z): reverse the latest change made on this device since
 * Copper was opened, using the audit trail's before/after snapshots. Each undo
 * is itself logged (source 'undo'), so other devices' Activity shows it too.
 *
 * Deliberately narrow: only this session's own changes, nothing that was
 * changed again since, and nothing huge — an import is undone by restoring a
 * backup, not row by row.
 */

type Row = Record<string, unknown>;

interface LogRow {
  id: string;
  entity: ChangeEntity;
  entity_id: string;
  op: ChangeOp;
  at: string;
  diff: string;
  batch_id: string | null;
  source: string | null;
}

export type UndoResult = { ok: true; text: string } | { ok: false; reason: string };

const SESSION_START = nowIso();
/** Bigger batches than this are left to Restore. */
const MAX_ROWS = 300;
/** How close an edit and its tag change must be to count as one save. */
const SAME_SAVE_MS = 2000;
/** Groups (batch id, or the ids of unbatched rows) already undone this session. */
const undone = new Set<string>();

const groupKey = (r: LogRow) => r.batch_id ?? r.id;

async function latestGroup(db: DB): Promise<LogRow[] | null> {
  const recent = await db.execO<LogRow>(
    `SELECT id, entity, entity_id, op, at, diff, batch_id, source FROM change_log
     WHERE site_id = ? AND at >= ? AND (source IS NULL OR source <> 'undo')
     ORDER BY at DESC LIMIT ?`,
    [db.siteid, SESSION_START, MAX_ROWS + undone.size + 1],
  );
  const latest = recent.find((r) => !undone.has(groupKey(r)));
  if (!latest) return null;
  if (latest.batch_id) {
    return db.execO<LogRow>(
      `SELECT id, entity, entity_id, op, at, diff, batch_id, source FROM change_log
       WHERE batch_id = ? ORDER BY at LIMIT ?`,
      [latest.batch_id, MAX_ROWS + 1],
    );
  }
  // Saving an edit writes the change, then (separately) its tag change.
  const prev = recent[recent.indexOf(latest) + 1];
  if (
    latest.source === 'tags' &&
    prev &&
    !prev.batch_id &&
    prev.source !== 'tags' &&
    prev.op === 'update' &&
    prev.entity_id === latest.entity_id &&
    Date.parse(latest.at) - Date.parse(prev.at) <= SAME_SAVE_MS &&
    !undone.has(prev.id)
  ) {
    return [prev, latest];
  }
  return [latest];
}

async function loadLookups(db: DB, defaultCurrency: string): Promise<Lookups> {
  const [accounts, categories, tags] = await Promise.all([
    listAccounts(db, true),
    listCategories(db, true),
    listTags(db, true),
  ]);
  return {
    accounts: new Map(accounts.map((a) => [a.id, { name: a.name, currency: a.currency }])),
    categories: new Map(categories.map((c) => [c.id, c.name])),
    tags: new Map(tags.map((t) => [t.id, t.name])),
    defaultCurrency,
  };
}

async function describe(db: DB, rows: LogRow[], defaultCurrency: string): Promise<string> {
  const L = await loadLookups(db, defaultCurrency);
  const current = async (r: LogRow) =>
    (await db.execO<Row>(`SELECT * FROM ${ENTITY_TABLE[r.entity]} WHERE id = ?`, [r.entity_id]))[0] ?? null;
  const entries = await Promise.all(
    rows.slice(0, 50).map(async (r) => ({ ...r, current: await current(r) })),
  );
  if (rows.length === 1 || !rows[0].batch_id) return describeEntry(L, entries[entries.length - 1]).text;
  const counts = new Map<string, { entity: ChangeEntity; op: ChangeOp; n: number }>();
  for (const r of rows) {
    const k = `${r.entity}:${r.op}`;
    const c = counts.get(k) ?? { entity: r.entity, op: r.op, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  return describeGroup(L, { source: rows[0].source, total: rows.length, counts: [...counts.values()], entries })
    .text;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Undo the latest change this device made since Copper was opened. */
export async function undoLast(db: DB, defaultCurrency: string): Promise<UndoResult> {
  const rows = await latestGroup(db);
  if (!rows || rows.length === 0) {
    return { ok: false, reason: 'Nothing to undo — only changes made since you opened Copper can be undone.' };
  }
  if (rows[0].source === 'monefy-import' || rows.length > MAX_ROWS) {
    return {
      ok: false,
      reason: 'That was too big a change to undo here. To go back, restore a backup from Settings › Your data.',
    };
  }

  const text = await describe(db, rows, defaultCurrency);
  // Read up front: the DB can't be queried outside the transaction while it's open.
  const columns = new Map<string, Set<string>>();
  for (const table of new Set(rows.map((r) => ENTITY_TABLE[r.entity]).filter(Boolean))) {
    const info = await db.execO<{ name: string }>(`PRAGMA table_info(${table})`);
    columns.set(table, new Set(info.map((c) => c.name)));
  }

  const batchId = newBatchId();
  const log = { batchId, source: 'undo' };
  let conflict = false;

  await db.tx(async (tx) => {
    const opts = { ...log, exec: tx };
    // Newest first, so a merge's final delete is undone before the moves.
    for (const r of [...rows].reverse()) {
      const diff = parseDiff(r.diff);
      const table = ENTITY_TABLE[r.entity];
      if (!diff || !table) continue;
      const cols = columns.get(table)!;
      const now = (await tx.execO<Row>(`SELECT * FROM ${table} WHERE id = ?`, [r.entity_id]))[0] ?? null;

      if (r.op === 'insert') {
        if (!now) continue;
        if (r.entity === 'recurring') {
          // Its occurrences were added along with it, without their own log rows.
          const added = await tx.execO<Row>('SELECT * FROM transactions WHERE recurring_id = ?', [r.entity_id]);
          for (const t of added) {
            await tx.exec('DELETE FROM transactions WHERE id = ?', [t.id]);
            await recordChange(db, 'transaction', String(t.id), 'delete', { before: t }, opts);
          }
        }
        if (r.entity === 'transaction') {
          await tx.exec('DELETE FROM transaction_tags WHERE transaction_id = ?', [r.entity_id]);
        }
        await tx.exec(`DELETE FROM ${table} WHERE id = ?`, [r.entity_id]);
        await recordChange(db, r.entity, r.entity_id, 'delete', { before: now }, opts);
      } else if (r.op === 'delete') {
        const before = 'before' in diff ? (diff.before as Row) : null;
        if (!before || now) {
          conflict = conflict || !!now;
          continue;
        }
        const keys = Object.keys(before).filter((k) => cols.has(k));
        await tx.exec(
          `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
          keys.map((k) => before[k]),
        );
        await recordChange(db, r.entity, r.entity_id, 'insert', { after: before }, opts);
      } else {
        const changes = 'changes' in diff ? (diff.changes as Record<string, { old: unknown; new: unknown }>) : {};
        if (!now) {
          conflict = true;
          continue;
        }
        const back: Record<string, { old: unknown; new: unknown }> = {};
        for (const [k, c] of Object.entries(changes)) {
          if (k === 'tags') {
            const links = await tx.execO<{ tag_id: string }>(
              'SELECT tag_id FROM transaction_tags WHERE transaction_id = ?',
              [r.entity_id],
            );
            const have = links.map((l) => l.tag_id).sort();
            if (!same(have, [...((c.new as string[]) ?? [])].sort())) {
              conflict = true;
              continue;
            }
            await tx.exec('DELETE FROM transaction_tags WHERE transaction_id = ?', [r.entity_id]);
            for (const tagId of (c.old as string[]) ?? []) {
              await tx.exec(
                'INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id, created_at) VALUES (?, ?, ?)',
                [r.entity_id, tagId, nowIso()],
              );
            }
            back.tags = { old: c.new, new: c.old };
          } else if (k === 'tag_added') {
            await tx.exec('DELETE FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?', [
              r.entity_id,
              c.new,
            ]);
            back.tags = { old: [c.new], new: [] };
          } else if (cols.has(k)) {
            if (!same(now[k], c.new)) {
              conflict = true;
              continue;
            }
            await tx.exec(`UPDATE ${table} SET ${k} = ? WHERE id = ?`, [c.old, r.entity_id]);
            back[k] = { old: c.new, new: c.old };
          }
        }
        if (Object.keys(back).length > 0) {
          await recordChange(db, r.entity, r.entity_id, 'update', { changes: back }, opts);
        }
      }
    }
    // Something was changed again since (here or on another device): undo
    // nothing rather than leave a half-reverted mix.
    if (conflict) throw new UndoConflict();
  }).catch((e: unknown) => {
    if (!(e instanceof UndoConflict)) throw e;
  });

  if (conflict) {
    return { ok: false, reason: 'That has been changed again since, so it can’t be undone. Edit it directly instead.' };
  }
  for (const r of rows) undone.add(groupKey(r));
  return { ok: true, text };
}

class UndoConflict extends Error {}
