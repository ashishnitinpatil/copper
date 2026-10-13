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
  /** First name of whoever was signed in on the originating device ('' / null if unknown). */
  device_person: string | null;
  /** The record as it is now (or as it was when deleted), to describe edits in context. */
  current: Row | null;
}

/**
 * One line of the feed: a single change, or every row of one bulk operation
 * (an import, a merge, both legs of a transfer). Big batches carry only their
 * first rows in `entries`; `counts` always covers the whole batch.
 */
export interface ActivityGroup {
  key: string;
  batch_id: string | null;
  source: string | null;
  at: string;
  site_id: string;
  device_name: string | null;
  device_person: string | null;
  total: number;
  counts: { entity: ChangeEntity; op: ChangeOp; n: number }[];
  entries: ActivityEntry[];
}

const ENTRY_SELECT = `
  SELECT cl.*, d.name AS device_name, d.person AS device_person
  FROM change_log cl
  LEFT JOIN devices d ON d.site_id = cl.site_id`;

/** Rows of a batch loaded for display; the rest are only counted. */
const BATCH_PREVIEW = 50;

/** Attach each entry's live record (one query per table, not per row). */
async function attachCurrent(db: DB, rows: Omit<ActivityEntry, 'current'>[]): Promise<ActivityEntry[]> {
  const ids = new Map<ChangeEntity, Set<string>>();
  for (const r of rows) {
    if (!TABLE[r.entity]) continue;
    if (!ids.has(r.entity)) ids.set(r.entity, new Set());
    ids.get(r.entity)!.add(r.entity_id);
  }
  const live = new Map<string, Row>();
  for (const [entity, set] of ids) {
    const list = [...set];
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      const found = await db.execO<Row>(
        `SELECT * FROM ${TABLE[entity]} WHERE id IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      );
      for (const f of found) live.set(`${entity}:${String(f.id)}`, f);
      // Deleted since: its last-known state is the delete entry's snapshot.
      const missing = chunk.filter((id) => !live.has(`${entity}:${id}`));
      if (missing.length === 0) continue;
      const gone = await db.execO<{ entity_id: string; diff: string }>(
        `SELECT entity_id, diff FROM change_log
         WHERE op = 'delete' AND entity = ? AND entity_id IN (${missing.map(() => '?').join(',')})`,
        [entity, ...missing],
      );
      for (const g of gone) {
        try {
          const before = (JSON.parse(g.diff) as { before?: Row }).before;
          if (before) live.set(`${entity}:${g.entity_id}`, before);
        } catch {
          // An unreadable snapshot just leaves the entry without context.
        }
      }
    }
  }
  return rows.map((r) => ({ ...r, current: live.get(`${r.entity}:${r.entity_id}`) ?? null }));
}

/**
 * Recent activity, newest first, one item per action: a bulk operation counts
 * once however many rows it wrote, so a 12,000-row import doesn't push
 * everything else off the page.
 */
export async function listActivityGroups(
  db: DB,
  limit = 100,
): Promise<{ groups: ActivityGroup[]; hasMore: boolean }> {
  const heads = await db.execO<{ gkey: string; batch_id: string | null; at: string; total: number }>(
    `SELECT COALESCE(batch_id, id) AS gkey, batch_id, MAX(at) AS at, COUNT(*) AS total
     FROM change_log
     GROUP BY gkey
     ORDER BY at DESC, gkey DESC
     LIMIT ?`,
    [limit + 1],
  );
  const hasMore = heads.length > limit;
  const page = heads.slice(0, limit);
  const singles = page.filter((h) => !h.batch_id).map((h) => h.gkey);
  const batches = page.filter((h) => h.batch_id).map((h) => h.gkey);

  const raw: Omit<ActivityEntry, 'current'>[] = [];
  const counts = new Map<string, ActivityGroup['counts']>();
  for (let i = 0; i < singles.length; i += 500) {
    const chunk = singles.slice(i, i + 500);
    raw.push(
      ...(await db.execO<Omit<ActivityEntry, 'current'>>(
        `${ENTRY_SELECT} WHERE cl.id IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      )),
    );
  }
  for (const batchId of batches) {
    raw.push(
      ...(await db.execO<Omit<ActivityEntry, 'current'>>(
        `${ENTRY_SELECT} WHERE cl.batch_id = ? ORDER BY cl.at, cl.id LIMIT ${BATCH_PREVIEW}`,
        [batchId],
      )),
    );
    counts.set(
      batchId,
      await db.execO<{ entity: ChangeEntity; op: ChangeOp; n: number }>(
        'SELECT entity, op, COUNT(*) AS n FROM change_log WHERE batch_id = ? GROUP BY entity, op',
        [batchId],
      ),
    );
  }
  const entries = await attachCurrent(db, raw);

  const byKey = new Map<string, ActivityEntry[]>();
  for (const e of entries) {
    const k = e.batch_id ?? e.id;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(e);
  }
  const groups: ActivityGroup[] = [];
  for (const h of page) {
    const list = (byKey.get(h.gkey) ?? []).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const head = list[0];
    if (!head) continue;
    groups.push({
      key: h.gkey,
      batch_id: h.batch_id,
      source: head.source,
      at: h.at,
      site_id: head.site_id,
      device_name: head.device_name,
      device_person: head.device_person,
      total: h.total,
      counts: counts.get(h.gkey) ?? [{ entity: head.entity, op: head.op, n: 1 }],
      entries: list,
    });
  }
  return { groups, hasMore };
}

/** The full history of a single record, newest first. */
export async function listEntityHistory(
  db: DB,
  entity: ChangeEntity,
  entityId: string,
): Promise<ActivityEntry[]> {
  const rows = await db.execO<Omit<ActivityEntry, 'current'>>(
    `${ENTRY_SELECT}
     WHERE cl.entity = ? AND cl.entity_id = ?
     ORDER BY cl.at DESC, cl.id DESC`,
    [entity, entityId],
  );
  return attachCurrent(db, rows);
}

/**
 * Remember who is signed in on this device, so other devices' logs can name
 * them. Only writes when it changed: every write to this synced table makes the
 * next sync re-upload the book.
 */
export async function setLocalDevicePerson(db: DB, person: string): Promise<void> {
  await db.exec('UPDATE devices SET person = ? WHERE site_id = ? AND person <> ?', [
    person,
    db.siteid,
    person,
  ]);
}

/** Wipe the entire audit trail (manual "clear log" — no automatic trimming). */
export async function clearActivity(db: DB): Promise<void> {
  await db.exec('DELETE FROM change_log');
}
