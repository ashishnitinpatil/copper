import { describe, expect, it } from 'vitest';
import {
  bookToBackup,
  decodeBook,
  diffBook,
  encodeBook,
  gunzipJson,
  gzipJson,
  unpackPk,
  type BookFile,
} from './bookFile';
import type { ChangeRow } from './changesets';

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
// crsql_pack_columns('<text>') for a single TEXT key.
const textPk = (s: string) => b64([1, (1 << 3) | 3, s.length, ...Array.from(s, (c) => c.charCodeAt(0))]);
const SITE_A = b64(Array(16).fill(0xaa));
const SITE_B = b64(Array(16).fill(0xbb));

function cell(over: Partial<ChangeRow>): ChangeRow {
  return {
    table: 'transactions',
    pk: textPk('t1'),
    cid: 'note',
    val: 'x',
    val_is_blob: false,
    col_version: 1,
    db_version: 1,
    site_id: SITE_A,
    cl: 1,
    seq: 0,
    ...over,
  };
}

const sortRows = (rows: ChangeRow[]) =>
  [...rows].sort((a, b) => `${a.table}${a.pk}${a.cid}`.localeCompare(`${b.table}${b.pk}${b.cid}`));

describe('book encode/decode', () => {
  it('round-trips cells, including sparse columns, blobs, nulls and mixed clocks', () => {
    const rows = [
      cell({ pk: textPk('t1'), cid: 'note', val: 'lunch' }),
      cell({ pk: textPk('t1'), cid: 'amount_minor', val: -1200, col_version: 3, site_id: SITE_B, db_version: 9 }),
      cell({ pk: textPk('t2'), cid: 'note', val: null, seq: 4 }),
      // t2 has no amount_minor cell → sparse column with an explicit index list.
      cell({ pk: textPk('t3'), cid: '-1', val: null, cl: 2 }),
      cell({ table: 'tags', pk: textPk('g1'), cid: 'icon', val: 'AAEC', val_is_blob: true }),
    ];
    const book = encodeBook(rows, 'aa');
    expect(sortRows(decodeBook(book))).toEqual(sortRows(rows));
  });

  it('collapses uniform clock columns to a single value', () => {
    const rows = ['a', 'b', 'c'].map((id) => cell({ pk: textPk(id) }));
    const col = encodeBook(rows, 'aa').tables.transactions.cols.note;
    expect(col.cv).toEqual({ k: 1 });
    expect(col.s).toEqual({ k: 0 });
    expect(col.i).toBeUndefined();
  });

  it('rejects files that are not a book', () => {
    expect(() => decodeBook({ format: 'expense-tracker-backup' } as unknown as BookFile)).toThrow();
  });

  it('survives gzip', async () => {
    const book = encodeBook([cell({})], 'aa');
    expect(await gunzipJson(await gzipJson(book))).toEqual(book);
  });
});

describe('diffBook', () => {
  it('applies only remote cells that differ, ignoring local-only bookkeeping', () => {
    const same = cell({ cid: 'note' });
    const local = [same, cell({ cid: 'kind', val: 'expense' })];
    // Same merged value but a different local db_version/seq → not a difference.
    const remote = [{ ...same, db_version: 77, seq: 5 }, cell({ cid: 'kind', val: 'income', col_version: 2 })];
    const d = diffBook(local, remote);
    expect(d.toApply.map((r) => r.cid)).toEqual(['kind']);
    expect(d.localAhead).toBe(1);
  });

  it('reports nothing to do when both sides match', () => {
    const rows = [cell({}), cell({ cid: 'kind' })];
    expect(diffBook(rows, rows.map((r) => ({ ...r })))).toEqual({ toApply: [], localAhead: 0 });
  });

  it('counts cells the book lacks as local-ahead', () => {
    expect(diffBook([cell({})], []).localAhead).toBe(1);
  });
});

describe('unpackPk', () => {
  // Byte strings below are real crsql_pack_columns output from the browser.
  const hex = (h: string) => b64(h.match(/../g)!.map((x) => parseInt(x, 16)));
  it('decodes real cr-sqlite packed keys', () => {
    expect(unpackPk(hex('010B03616263'))).toEqual(['abc']);
    expect(unpackPk(hex('0109FF'))).toEqual([255]);
    expect(unpackPk(hex('0141FFFFFFFFFFFFFED4'))).toEqual([-300]);
    expect(unpackPk(hex('01023FF8000000000000'))).toEqual([1.5]);
    expect(unpackPk(hex('0105'))).toEqual([null]);
    expect(unpackPk(hex('010C0200FF'))).toEqual([Uint8Array.from([0, 255])]);
    // (300, 'x', -1)
    expect(unpackPk(hex('0311012C0B017841FFFFFFFFFFFFFFFF'))).toEqual([300, 'x', -1]);
  });
});

describe('bookToBackup', () => {
  it('rebuilds live rows with their keys and drops deleted ones', () => {
    const book = encodeBook(
      [
        cell({ pk: textPk('t1'), cid: 'note', val: 'lunch' }),
        cell({ pk: textPk('t1'), cid: 'amount_minor', val: -500 }),
        cell({ pk: textPk('t2'), cid: '-1', val: null, cl: 2 }),
      ],
      'aa',
    );
    const backup = bookToBackup(book, { transactions: ['id'] });
    expect(backup.format).toBe('expense-tracker-backup');
    expect(backup.tables.transactions).toEqual([{ id: 't1', note: 'lunch', amount_minor: -500 }]);
  });
});
