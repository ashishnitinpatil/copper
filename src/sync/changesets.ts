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

export interface ChangesetPayload {
  version: 1;
  site_id: string;
  seq: number;
  from_db_version: number;
  to_db_version: number;
  created_at: string;
  rows: ChangeRow[];
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

export async function exportLocalChanges(
  db: DB,
  sinceDbVersion: number,
): Promise<{ rows: ChangeRow[]; maxVersion: number }> {
  const raw = await db.execO<RawChangeRow>(
    `SELECT "table", pk, cid, val, col_version, db_version, site_id, cl, seq
     FROM crsql_changes
     WHERE db_version > ? AND site_id = crsql_site_id()
     ORDER BY db_version ASC, seq ASC`,
    [sinceDbVersion],
  );
  const rows: ChangeRow[] = raw.map((r) => {
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
  });
  const maxVersion = rows.reduce((m, r) => Math.max(m, r.db_version), sinceDbVersion);
  return { rows, maxVersion };
}

export async function applyRemoteChanges(db: DB, rows: ChangeRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  let applied = 0;
  await db.tx(async (tx) => {
    for (const r of rows) {
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
  return applied;
}
