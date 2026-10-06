import type { DB } from './wasm';
import type { ChangeDiff, ChangeEntity, ChangeLogEntry, ChangeOp, Device } from './types';
import { uuid } from './uuid';
import { nowIso } from '@/lib/dates';

/**
 * The audit trail. Every local create/edit/delete that flows through the
 * central query helpers also writes a row here, so the book carries its own
 * history: which device changed what, when, and exactly which fields moved.
 *
 * Only *locally originated* changes are logged. Remote changes arrive through
 * cr-sqlite's changeset apply (the raw SQL layer, not these helpers), so they
 * are never double-logged — and because the table is append-only with UUID
 * keys, every device's entries merge without conflict.
 */

type Row = Record<string, unknown>;

/** Minimal write surface — satisfied by both `DB` and the `db.tx` handle. */
interface Exec {
  exec(sql: string, params?: unknown[]): Promise<unknown>;
}

const TABLE: Record<ChangeEntity, string> = {
  transaction: 'transactions',
  account: 'accounts',
  category: 'categories',
  tag: 'tags',
  budget: 'budgets',
  recurring: 'recurring_rules',
};

export interface LogOptions {
  /** Groups rows from one bulk operation (an import, a multi-select action). */
  batchId?: string | null;
  /** Where the change came from, e.g. 'monefy-import', 'bulk-delete'. */
  source?: string | null;
  /** Write through an open transaction so the log entry is atomic with the change. */
  exec?: Exec;
}

/** A fresh id to tie together every row written by one bulk operation. */
export function newBatchId(): string {
  return uuid();
}

/** Read the current stored form of a row, for use as a before/after snapshot. */
export async function snapshotEntity(
  db: DB,
  entity: ChangeEntity,
  id: string,
): Promise<Row | null> {
  const rows = await db.execO<Row>(`SELECT * FROM ${TABLE[entity]} WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

/** Changed fields between two row snapshots, as {field:{old,new}}. */
export function diffRows(before: Row, after: Row): Record<string, { old: unknown; new: unknown }> {
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = before[k] ?? null;
    const b = after[k] ?? null;
    if (a !== b) changes[k] = { old: a, new: b };
  }
  return changes;
}

/** Low-level append. Callers usually use the log* helpers below instead. */
export async function recordChange(
  db: DB,
  entity: ChangeEntity,
  entityId: string,
  op: ChangeOp,
  diff: ChangeDiff,
  opts: LogOptions = {},
): Promise<void> {
  const exec = opts.exec ?? db;
  await exec.exec(
    `INSERT INTO change_log (id, entity, entity_id, op, site_id, at, diff, batch_id, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      entity,
      entityId,
      op,
      db.siteid,
      nowIso(),
      JSON.stringify(diff),
      opts.batchId ?? null,
      opts.source ?? null,
    ],
  );
}

/** Log a create. Reads the just-inserted row for a full snapshot. */
export async function logCreate(
  db: DB,
  entity: ChangeEntity,
  id: string,
  opts: LogOptions = {},
): Promise<void> {
  const after = await snapshotEntity(db, entity, id);
  if (after) await recordChange(db, entity, id, 'insert', { after }, opts);
}

/** Log a create from an already-known snapshot (avoids a read inside a tx). */
export async function logCreateSnapshot(
  db: DB,
  entity: ChangeEntity,
  id: string,
  after: Row,
  opts: LogOptions = {},
): Promise<void> {
  await recordChange(db, entity, id, 'insert', { after }, opts);
}

/**
 * Log an update given the row's state *before* the change (capture it with
 * snapshotEntity first). A no-op edit (nothing actually changed) is skipped.
 */
export async function logUpdate(
  db: DB,
  entity: ChangeEntity,
  id: string,
  before: Row | null,
  opts: LogOptions = {},
): Promise<void> {
  const after = await snapshotEntity(db, entity, id);
  if (!after) return;
  const changes = diffRows(before ?? {}, after);
  if (Object.keys(changes).length === 0) return;
  await recordChange(db, entity, id, 'update', { changes }, opts);
}

/** Log a delete from the row's last-known state (capture it before deleting). */
export async function logDelete(
  db: DB,
  entity: ChangeEntity,
  before: Row,
  opts: LogOptions = {},
): Promise<void> {
  await recordChange(db, entity, String(before.id), 'delete', { before }, opts);
}

// --- Devices ----------------------------------------------------------------

export function defaultDeviceName(siteId: string): string {
  return `Device-${siteId.slice(0, 4).toUpperCase()}`;
}

/**
 * Make sure this device has a row in the registry and refresh its last-seen.
 * Runs once per boot. A name the user set earlier is preserved (INSERT OR
 * IGNORE never overwrites it); only last_seen moves forward — at most once a
 * day (the UI shows only the day), because every write to this synced table
 * makes the next sync re-upload the whole shared book.
 */
export async function ensureLocalDevice(db: DB): Promise<void> {
  const now = nowIso();
  await db.exec('INSERT OR IGNORE INTO devices (site_id, name, last_seen) VALUES (?, ?, ?)', [
    db.siteid,
    defaultDeviceName(db.siteid),
    now,
  ]);
  await db.exec(
    'UPDATE devices SET last_seen = ? WHERE site_id = ? AND substr(last_seen, 1, 10) <> substr(?, 1, 10)',
    [now, db.siteid, now],
  );
}

/**
 * A reset gives this device a new identity (site id). Once the book has synced
 * back in, retire the old one: keep its row so past activity still shows its
 * name, carry a name the person chose over to this identity, and stop listing it
 * as a device. Returns whether anything changed (so it can be synced).
 */
export async function retireDevice(db: DB, oldSiteId: string): Promise<boolean> {
  if (oldSiteId === db.siteid) return false;
  const [old] = await db.execO<Device>('SELECT * FROM devices WHERE site_id = ?', [oldSiteId]);
  if (!old || old.retired_at) return false;
  if (old.name !== defaultDeviceName(oldSiteId)) {
    await db.exec('UPDATE devices SET name = ? WHERE site_id = ? AND name = ?', [
      old.name,
      db.siteid,
      defaultDeviceName(db.siteid),
    ]);
  }
  await db.exec('UPDATE devices SET retired_at = ? WHERE site_id = ?', [nowIso(), oldSiteId]);
  return true;
}

export async function listDevices(db: DB): Promise<Device[]> {
  return db.execO<Device>('SELECT * FROM devices ORDER BY last_seen DESC');
}

export async function getLocalDeviceName(db: DB): Promise<string> {
  const rows = await db.execO<{ name: string }>('SELECT name FROM devices WHERE site_id = ?', [
    db.siteid,
  ]);
  return rows[0]?.name ?? defaultDeviceName(db.siteid);
}

export async function setLocalDeviceName(db: DB, name: string): Promise<void> {
  const trimmed = name.trim() || defaultDeviceName(db.siteid);
  await db.exec(
    `INSERT INTO devices (site_id, name, last_seen) VALUES (?, ?, ?)
     ON CONFLICT(site_id) DO UPDATE SET name = excluded.name`,
    [db.siteid, trimmed, nowIso()],
  );
}

// --- Reading the trail ------------------------------------------------------

export interface ActivityEntry extends ChangeLogEntry {
  device_name: string | null;
  /** The record's *current* name, resolved live (null if it has none or was deleted). */
  entity_name: string | null;
  /** Current note, for transactions (null otherwise). */
  entity_note: string | null;
}

// Resolve the live device name and the record's current label. The entity_id is
// polymorphic, so each name-bearing table is joined on a guard matching `entity`;
// COALESCE picks whichever matched. A deleted record yields null here, and the UI
// falls back to the name captured in the diff snapshot.
const ACTIVITY_SELECT = `
  SELECT cl.*, d.name AS device_name,
         COALESCE(a.name, c.name, tg.name) AS entity_name,
         t.note AS entity_note
  FROM change_log cl
  LEFT JOIN devices d ON d.site_id = cl.site_id
  LEFT JOIN accounts a ON cl.entity = 'account' AND a.id = cl.entity_id
  LEFT JOIN categories c ON cl.entity = 'category' AND c.id = cl.entity_id
  LEFT JOIN tags tg ON cl.entity = 'tag' AND tg.id = cl.entity_id
  LEFT JOIN transactions t ON cl.entity = 'transaction' AND t.id = cl.entity_id`;

/** Recent activity across the whole book, newest first, with device + record names. */
export async function listActivity(db: DB, limit = 200, offset = 0): Promise<ActivityEntry[]> {
  return db.execO<ActivityEntry>(
    `${ACTIVITY_SELECT}
     ORDER BY cl.at DESC, cl.id DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
}

/** The full history of a single record, newest first. */
export async function listEntityHistory(
  db: DB,
  entity: ChangeEntity,
  entityId: string,
): Promise<ActivityEntry[]> {
  return db.execO<ActivityEntry>(
    `${ACTIVITY_SELECT}
     WHERE cl.entity = ? AND cl.entity_id = ?
     ORDER BY cl.at DESC, cl.id DESC`,
    [entity, entityId],
  );
}

export async function countActivity(db: DB): Promise<number> {
  const rows = await db.execO<{ c: number }>('SELECT COUNT(*) AS c FROM change_log');
  return rows[0]?.c ?? 0;
}

/** Wipe the entire audit trail (manual "clear log" — no automatic trimming). */
export async function clearActivity(db: DB): Promise<void> {
  await db.exec('DELETE FROM change_log');
}
