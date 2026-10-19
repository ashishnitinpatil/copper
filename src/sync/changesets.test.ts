import { describe, expect, it } from 'vitest';
import { applyRemoteChanges, type ChangeRow } from './changesets';
import type { DB } from '@/db/wasm';

// A fake cr-sqlite DB that records how work is split across transactions.
// applyRemoteChanges must never pour a whole large changeset into one tx — that
// overflows the IDBBatchAtomicVFS and malforms the database — so the thing worth
// asserting is the batching, not the SQL text.
function fakeDb({ failAt }: { failAt?: number } = {}) {
  const txSizes: number[] = [];
  const outside: string[] = [];
  let total = 0;
  const db = {
    async tx(fn: (tx: { exec: (sql: string, params?: unknown[]) => Promise<void> }) => Promise<void>) {
      let n = 0;
      await fn({
        exec: async () => {
          if (failAt !== undefined && total === failAt) throw new Error('boom');
          n++;
          total++;
        },
      });
      txSizes.push(n);
    },
    // The index statements a large apply drops and rebuilds around itself.
    async execO() {
      return [{ name: 'idx_tx_date', sql: 'CREATE INDEX idx_tx_date ON transactions(occurred_on)' }];
    },
    async exec(sql: string) {
      outside.push(sql);
    },
  } as unknown as DB;
  return { db, txSizes, outside, get total() { return total; } };
}

function rows(n: number): ChangeRow[] {
  return Array.from({ length: n }, (_, i) => ({
    table: 'transactions',
    pk: '',
    cid: 'amount',
    val: i,
    val_is_blob: false,
    col_version: 1,
    db_version: i + 1,
    site_id: '',
    cl: 1,
    seq: i + 1,
  }));
}

describe('applyRemoteChanges', () => {
  it('applies nothing and opens no transaction for an empty changeset', async () => {
    const f = fakeDb();
    expect(await applyRemoteChanges(f.db, [])).toBe(0);
    expect(f.txSizes).toEqual([]);
  });

  it('applies a small changeset in a single transaction', async () => {
    const f = fakeDb();
    expect(await applyRemoteChanges(f.db, rows(500))).toBe(500);
    expect(f.txSizes).toEqual([500]);
  });

  it('splits a large changeset into bounded transactions, applying every row', async () => {
    const f = fakeDb();
    const applied = await applyRemoteChanges(f.db, rows(5000));
    expect(applied).toBe(5000);
    // No single transaction may carry more than the batch cap, or the VFS
    // overflow this guards against comes right back.
    expect(Math.max(...f.txSizes)).toBeLessThanOrEqual(2000);
    // Every row lands exactly once across the batches.
    expect(f.txSizes.reduce((a, b) => a + b, 0)).toBe(5000);
    expect(f.txSizes.length).toBeGreaterThan(1);
  });

  it('leaves indexes alone for a small changeset', async () => {
    const f = fakeDb();
    await applyRemoteChanges(f.db, rows(500));
    expect(f.outside).toEqual([]);
  });

  it('drops indexes for a large changeset and rebuilds them after', async () => {
    const f = fakeDb();
    await applyRemoteChanges(f.db, rows(5000));
    expect(f.outside).toEqual([
      'DROP INDEX IF EXISTS "idx_tx_date"',
      'CREATE INDEX idx_tx_date ON transactions(occurred_on)',
    ]);
  });

  it('rebuilds indexes even when the apply fails part-way', async () => {
    const f = fakeDb({ failAt: 3000 });
    await expect(applyRemoteChanges(f.db, rows(5000))).rejects.toThrow('boom');
    expect(f.outside.at(-1)).toBe('CREATE INDEX idx_tx_date ON transactions(occurred_on)');
  });
});
