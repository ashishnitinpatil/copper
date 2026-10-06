import type { ChangeRow } from './changesets';
import type { BackupFile } from '@/features/export/exportData';

// The shared book: ONE Drive file holding the whole CRDT state of the ledger.
//
// Why one file: under the `drive.file` scope a partner's account can only open
// files it has explicitly picked in the Google Picker. Picking a *folder* does
// not expose the files inside it, so the old folder-of-changesets layout could
// never sync across two Google accounts. A single file the partner picks once
// stays readable and writable for good.
//
// Contents are the full current state (latest value + clocks of every cell, as
// cr-sqlite's crsql_changes reports it), not a growing log, so the file's size
// tracks the book's size rather than its history. Any device can merge it at any
// time: CRDT merges are commutative and idempotent.
//
// Layout is columnar — per table, per column, parallel arrays — because the
// row-per-cell JSON the old changesets used repeats the table name, row key,
// site id and five clocks on every cell (~48 MB for an 11.7k-entry book, vs
// ~8 MB columnar; ~1.3 MB gzipped). Clock arrays whose entries are all equal
// collapse to a single `{ k }` value.

// Hyphens, not spaces, so the name survives downloads, shells and links intact.
export const BOOK_FILE_NAME = 'Copper-Expense-Tracker-shared-book.json.gz';
export const BOOK_MIME = 'application/gzip';

type Packed = number[] | { k: number };

interface BookColumn {
  /** Row indices (into `pks`) this column has a cell for; omitted when every row does. */
  i?: number[];
  /** Cell values; blobs are `{ $b: base64 }`. */
  v: unknown[];
  cv: Packed;
  dbv: Packed;
  /** Index into BookFile.sites. */
  s: Packed;
  cl: Packed;
  seq: Packed;
}

interface BookTable {
  /** cr-sqlite packed primary keys, base64. */
  pks: string[];
  cols: Record<string, BookColumn>;
}

export interface BookFile {
  format: 'copper-book';
  version: 2;
  updated_at: string;
  /** Site id (hex) of the device that wrote this copy. */
  updated_by: string;
  /**
   * Changes whenever the book is overwritten wholesale (restore-while-
   * connected, Overwrite on join). A device that last synced a different
   * generation must not merge its old copy back in — that would bring every
   * replaced row back as a duplicate. Absent on books written before this field.
   */
  generation?: string;
  /** Site ids (base64, as in ChangeRow.site_id) referenced by cells. */
  sites: string[];
  tables: Record<string, BookTable>;
}

function pack(values: number[]): Packed {
  if (values.length > 0 && values.every((x) => x === values[0])) return { k: values[0] };
  return values;
}

function unpack(p: Packed, n: number): number[] {
  return Array.isArray(p) ? p : new Array<number>(n).fill(p.k);
}

function encodeValue(r: ChangeRow): unknown {
  return r.val_is_blob ? { $b: r.val } : r.val;
}

function isBlobValue(v: unknown): v is { $b: string } {
  return !!v && typeof v === 'object' && typeof (v as { $b?: unknown }).$b === 'string';
}

export function encodeBook(rows: ChangeRow[], updatedBy: string, generation?: string): BookFile {
  const sites: string[] = [];
  const siteIdx = new Map<string, number>();
  const site = (s: string) => {
    let i = siteIdx.get(s);
    if (i === undefined) {
      i = sites.length;
      sites.push(s);
      siteIdx.set(s, i);
    }
    return i;
  };

  // Group cells: table -> pk -> row index, and table -> cid -> cells.
  const byTable = new Map<string, { pkIdx: Map<string, number>; pks: string[]; cols: Map<string, ChangeRow[]> }>();
  for (const r of rows) {
    let t = byTable.get(r.table);
    if (!t) {
      t = { pkIdx: new Map(), pks: [], cols: new Map() };
      byTable.set(r.table, t);
    }
    if (!t.pkIdx.has(r.pk)) {
      t.pkIdx.set(r.pk, t.pks.length);
      t.pks.push(r.pk);
    }
    const list = t.cols.get(r.cid) ?? [];
    list.push(r);
    t.cols.set(r.cid, list);
  }

  const tables: Record<string, BookTable> = {};
  for (const [name, t] of byTable) {
    const cols: Record<string, BookColumn> = {};
    for (const [cid, cells] of t.cols) {
      cells.sort((a, b) => t.pkIdx.get(a.pk)! - t.pkIdx.get(b.pk)!);
      const idx = cells.map((c) => t.pkIdx.get(c.pk)!);
      const col: BookColumn = {
        v: cells.map(encodeValue),
        cv: pack(cells.map((c) => c.col_version)),
        dbv: pack(cells.map((c) => c.db_version)),
        s: pack(cells.map((c) => site(c.site_id))),
        cl: pack(cells.map((c) => c.cl)),
        seq: pack(cells.map((c) => c.seq)),
      };
      // Every row has this column in order → the index list is implied.
      if (!(idx.length === t.pks.length && idx.every((x, j) => x === j))) col.i = idx;
      cols[cid] = col;
    }
    tables[name] = { pks: t.pks, cols };
  }
  return {
    format: 'copper-book',
    version: 2,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
    ...(generation ? { generation } : {}),
    sites,
    tables,
  };
}

export function decodeBook(book: BookFile): ChangeRow[] {
  if (book?.format !== 'copper-book' || book.version !== 2) {
    throw new Error("This doesn't look like a Copper shared book.");
  }
  const out: ChangeRow[] = [];
  for (const [table, t] of Object.entries(book.tables)) {
    for (const [cid, c] of Object.entries(t.cols)) {
      const n = c.v.length;
      const idx = c.i ?? t.pks.map((_, j) => j);
      const cv = unpack(c.cv, n);
      const dbv = unpack(c.dbv, n);
      const s = unpack(c.s, n);
      const cl = unpack(c.cl, n);
      const seq = unpack(c.seq, n);
      for (let j = 0; j < n; j++) {
        const raw = c.v[j];
        const blob = isBlobValue(raw);
        out.push({
          table,
          pk: t.pks[idx[j]],
          cid,
          val: blob ? raw.$b : raw,
          val_is_blob: blob,
          col_version: cv[j],
          db_version: dbv[j],
          site_id: book.sites[s[j]],
          cl: cl[j],
          seq: seq[j],
        });
      }
    }
  }
  return out;
}

const cellKey = (r: ChangeRow) => `${r.table}\u0000${r.pk}\u0000${r.cid}`;
// The parts of a cell that decide a CRDT merge. db_version/seq are local
// bookkeeping (they differ per device for the same merged cell), so they're
// deliberately left out — including them would make every pull look "different".
const cellSig = (r: ChangeRow) =>
  `${r.col_version}|${r.cl}|${r.site_id}|${r.val_is_blob ? 'b' : ''}${JSON.stringify(r.val)}`;

export interface BookDiff {
  /** Remote cells this device doesn't hold identically — to merge locally. */
  toApply: ChangeRow[];
  /** Local cells the book doesn't hold identically — if any, the book needs a re-upload. */
  localAhead: number;
}

// Compare local state with the book's. Merging only the cells that differ keeps a
// routine pull (a partner added one entry) to a handful of CRDT inserts instead
// of re-merging the whole book.
export function diffBook(local: ChangeRow[], remote: ChangeRow[]): BookDiff {
  const localSig = new Map<string, string>();
  for (const r of local) localSig.set(cellKey(r), cellSig(r));
  const remoteSig = new Map<string, string>();
  const toApply: ChangeRow[] = [];
  for (const r of remote) {
    const k = cellKey(r);
    const sig = cellSig(r);
    remoteSig.set(k, sig);
    if (localSig.get(k) !== sig) toApply.push(r);
  }
  let localAhead = 0;
  for (const [k, sig] of localSig) if (remoteSig.get(k) !== sig) localAhead++;
  return { toApply, localAhead };
}

/** Distinct site ids (hex) that have written cells in the book. */
// ── gzip ────────────────────────────────────────────────────────────────────

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function gzipJson(value: unknown): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(JSON.stringify(value)), new CompressionStream('gzip'));
}

export async function gunzipJson<T>(bytes: Uint8Array): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')))) as T;
}

// ── cr-sqlite packed primary keys ───────────────────────────────────────────
// crsql_changes.pk is `crsql_pack_columns(...)` of the row's primary key: one
// byte column count, then per column a header byte `(len_bytes << 3) | type`
// (1 INTEGER, 2 FLOAT, 3 TEXT, 4 BLOB, 5 NULL) followed by the value — a
// big-endian integer of len_bytes, an 8-byte float, or a len_bytes length
// prefix and that many bytes of text/blob. (Checked against the real
// crsql_pack_columns: 'abc' → 010B03616263, 255 → 0109FF, -300 →
// 0141FFFFFFFFFFFFFED4, 1.5 → 01023FF8…, NULL → 0105, x'00ff' → 010C0200FF.)

export function unpackPk(b64: string): unknown[] {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  let o = 0;
  const readInt = (len: number) => {
    let v = 0n;
    for (let i = 0; i < len; i++) v = (v << 8n) | BigInt(bytes[o++]);
    // Non-negative values use the fewest bytes (255 is one 0xFF byte); negative
    // ones are always a full 8-byte two's-complement i64.
    return len === 8 ? BigInt.asIntN(64, v) : v;
  };
  const n = bytes[o++];
  const out: unknown[] = [];
  for (let c = 0; c < n; c++) {
    const header = bytes[o++];
    const type = header & 0x07;
    const len = header >> 3;
    if (type === 1) out.push(Number(readInt(len)));
    else if (type === 2) {
      out.push(view.getFloat64(o));
      o += 8;
    } else if (type === 3 || type === 4) {
      const size = Number(readInt(len));
      const slice = bytes.slice(o, o + size);
      o += size;
      out.push(type === 3 ? new TextDecoder().decode(slice) : slice);
    } else if (type === 5) out.push(null);
    else throw new Error(`Unknown packed column type ${type}`);
  }
  return out;
}

// ── book → restorable backup ────────────────────────────────────────────────

// Turn a book snapshot into the ordinary backup format, so Drive backups (which
// are copies of the book file) restore through the same proven path as a backup
// file picked from disk. A row is live when its cells' causal length is odd; a
// deleted row's sentinel ('-1') carries an even one. `pkColumns` names each
// table's primary-key columns in key order (read from the local schema).
export function bookToBackup(book: BookFile, pkColumns: Record<string, string[]>): BackupFile {
  const rowsByTable = new Map<string, Map<string, { cl: number; row: Record<string, unknown> }>>();
  for (const cell of decodeBook(book)) {
    let rows = rowsByTable.get(cell.table);
    if (!rows) rowsByTable.set(cell.table, (rows = new Map()));
    let entry = rows.get(cell.pk);
    if (!entry) {
      const row: Record<string, unknown> = {};
      const keys = pkColumns[cell.table] ?? [];
      unpackPk(cell.pk).forEach((v, j) => {
        if (keys[j]) row[keys[j]] = v;
      });
      entry = { cl: 0, row };
      rows.set(cell.pk, entry);
    }
    entry.cl = Math.max(entry.cl, cell.cl);
    if (cell.cid !== '-1') entry.row[cell.cid] = cell.val;
  }
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [table, rows] of rowsByTable) {
    tables[table] = [...rows.values()].filter((e) => e.cl % 2 === 1).map((e) => e.row);
  }
  return { format: 'expense-tracker-backup', version: 1, exported_at: book.updated_at, tables };
}
