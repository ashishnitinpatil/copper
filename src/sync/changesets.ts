import type { DB } from '@/db/wasm';

export interface ChangeRow {
  table: string;
  pk: string;
  cid: string;
  val: unknown;
  val_is_blob: boolean;
  col_version: number;
  db_version: number;
  site_id: string;
  cl: number;
  seq: number;
}

interface RawChangeRow {
  table: string;
  pk: Uint8Array | null;
  cid: string;
  val: unknown;
  col_version: number | bigint;
  db_version: number | bigint;
  site_id: Uint8Array | null;
  cl: number | bigint;
  seq: number | bigint;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toNumber(v: number | bigint): number {
  return typeof v === 'bigint' ? Number(v) : v;
}

function encodeVal(val: unknown): { val: unknown; val_is_blob: boolean } {
  if (val instanceof Uint8Array) return { val: bytesToBase64(val), val_is_blob: true };
  return { val, val_is_blob: false };
}

function decodeVal(val: unknown, isBlob: boolean): unknown {
  if (isBlob && typeof val === 'string') return base64ToBytes(val);
  return val;
}

export async function getLocalDbVersion(db: DB): Promise<number> {
  const rows = await db.execO<{ v: number | bigint }>('SELECT crsql_db_version() AS v');
  return toNumber(rows[0]?.v ?? 0);
}

export async function getLocalSiteIdHex(db: DB): Promise<string> {
  const rows = await db.execO<{ sid: Uint8Array }>('SELECT crsql_site_id() AS sid');
  const sid = rows[0]?.sid;
  if (!sid) throw new Error('crsql_site_id returned null');
  return Array.from(sid)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toChangeRow(r: RawChangeRow): ChangeRow {
  const { val, val_is_blob } = encodeVal(r.val);
  return {
    table: r.table,
    pk: r.pk ? bytesToBase64(r.pk) : '',
    cid: r.cid,
    val,
    val_is_blob,
    col_version: toNumber(r.col_version),
    db_version: toNumber(r.db_version),
    site_id: r.site_id ? bytesToBase64(r.site_id) : '',
    cl: toNumber(r.cl),
    seq: toNumber(r.seq),
  };
}

// Every cell of the book, from every device — the full CRDT state that goes
// into the shared book file (see bookFile.ts).
export async function exportAllChanges(db: DB): Promise<ChangeRow[]> {
  const raw = await db.execO<RawChangeRow>(
    `SELECT "table", pk, cid, val, col_version, db_version, site_id, cl, seq FROM crsql_changes`,
  );
  return raw.map(toChangeRow);
}

/**
 * Cells changed on this device (its own edits and merged ones) after
 * `dbVersion`. cr-sqlite indexes db_version, so this costs what changed, not
 * the size of the book.
 */
export async function exportChangesSince(db: DB, dbVersion: number): Promise<ChangeRow[]> {
  const raw = await db.execO<RawChangeRow>(
    `SELECT "table", pk, cid, val, col_version, db_version, site_id, cl, seq FROM crsql_changes
     WHERE db_version > ?`,
    [dbVersion],
  );
  return raw.map(toChangeRow);
}

// How many merge rows to apply per transaction. Each INSERT INTO crsql_changes
// is a CRDT merge that cr-sqlite expands into writes across its internal clock
// tables, and the IDBBatchAtomicVFS holds every dirty page of an open
// transaction in memory until it commits atomically. A single peer changeset on
// a large ledger can carry hundreds of thousands of merge rows (a real 23k-txn
// book produced a 52 MB / ~200k-row changeset), and applying them all in one
// transaction balloons the in-memory page set past what the VFS can commit —
// the transaction fails with "database disk image is malformed" and takes the
// local database with it.
//
// Committing in bounded batches keeps each commit's dirty-page footprint small
// and lets the VFS flush to IndexedDB and release memory between them. This is
// safe because CRDT merges are commutative and idempotent and the caller only
// advances a changeset's watermark after applyRemoteChanges returns: an apply
// interrupted between batches is simply re-merged in full next time, with no
// double-counting. The proven restore path tolerates ~23k single-row *table*
// inserts in one transaction; crsql_changes merges are heavier, so this stays
// well below that with a wide safety margin.
const APPLY_CHUNK_ROWS = 2000;

// Above this many rows (a first-time join, a big catch-up), the app's own
// indexes are dropped for the apply and rebuilt after: every merged cell
// otherwise updates each index on its table, which made setting up a real book
// take minutes on a phone. Measured: 17k rows in 7.9s with indexes, 1.2s
// without (rebuild included), with identical results. cr-sqlite's own clock
// indexes are left alone.
const BULK_APPLY_ROWS = 5000;

async function dropAppIndexes(db: DB): Promise<{ name: string; sql: string }[]> {
  const indexes = await db.execO<{ name: string; sql: string }>(
    `SELECT name, sql FROM sqlite_master
     WHERE type = 'index' AND sql IS NOT NULL AND tbl_name NOT LIKE '%crsql%'`,
  );
  for (const i of indexes) await db.exec(`DROP INDEX IF EXISTS "${i.name}"`);
  return indexes;
}

export async function applyRemoteChanges(
  db: DB,
  rows: ChangeRow[],
  onProgress?: (applied: number) => void,
): Promise<number> {
  if (rows.length === 0) return 0;
  if (rows.length < BULK_APPLY_ROWS) return applyInBatches(db, rows, onProgress);
  // If the page dies before the rebuild, ensureIndexes() restores them at the
  // next start-up.
  const indexes = await dropAppIndexes(db);
  try {
    return await applyInBatches(db, rows, onProgress);
  } finally {
    for (const i of indexes) await db.exec(i.sql);
  }
}

async function applyInBatches(
  db: DB,
  rows: ChangeRow[],
  onProgress?: (applied: number) => void,
): Promise<number> {
  let applied = 0;
  for (let start = 0; start < rows.length; start += APPLY_CHUNK_ROWS) {
    const chunk = rows.slice(start, start + APPLY_CHUNK_ROWS);
    await db.tx(async (tx) => {
      for (const r of chunk) {
        await tx.exec(
          `INSERT INTO crsql_changes ("table", pk, cid, val, col_version, db_version, site_id, cl, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.table,
            base64ToBytes(r.pk),
            r.cid,
            decodeVal(r.val, r.val_is_blob),
            r.col_version,
            r.db_version,
            base64ToBytes(r.site_id),
            r.cl,
            r.seq,
          ],
        );
        applied++;
      }
    });
    onProgress?.(applied);
    // Yield between batches so the main thread (sqlite runs on it) can repaint
    // and the VFS can settle before the next transaction opens.
    if (start + APPLY_CHUNK_ROWS < rows.length) {
      await new Promise((resolve) => setTimeout(resolve));
    }
  }
  return applied;
}

