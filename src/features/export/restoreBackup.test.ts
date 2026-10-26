import { describe, expect, it } from 'vitest';
import type { DB } from '@/db/wasm';
import { BACKUP_TABLES, type BackupFile } from './exportData';
import { parseBackup, planRestore, restoreBackup } from './restoreBackup';
import { encryptBackup, decryptBackup, isEncryptedBackup } from './crypto';

function makeBackup(tables: Record<string, Record<string, unknown>[]>): BackupFile {
  const full: Record<string, Record<string, unknown>[]> = {};
  for (const t of BACKUP_TABLES) full[t] = tables[t] ?? [];
  return {
    format: 'expense-tracker-backup',
    version: 1,
    exported_at: '2026-06-24T00:00:00.000Z',
    tables: full,
  };
}

// Deterministic id generator so remapping is assertable: n0, n1, n2, …
function counter() {
  let i = 0;
  return () => `n${i++}`;
}

// Decode the rows a plan's INSERT statements carry for a table. Inserts are
// batched (multi-row VALUES), so a statement's params hold N rows back-to-back.
function decodeInserts(
  stmts: { sql: string; params: unknown[] }[],
  table: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const s of stmts) {
    if (!s.sql.startsWith(`INSERT INTO ${table} `)) continue;
    const cols = s.sql.match(/\(([^)]+)\) VALUES/)![1].split(', ');
    for (let i = 0; i < s.params.length; i += cols.length) {
      const obj: Record<string, unknown> = {};
      cols.forEach((c, k) => (obj[c] = s.params[i + k]));
      rows.push(obj);
    }
  }
  return rows;
}

const SAMPLE = {
  accounts: [{ id: 'a1', name: 'Cash', currency: 'AED', include_in_total: 1 }],
  categories: [{ id: 'c1', name: 'Food', parent_id: null, kind: 'expense' }],
  transactions: [
    { id: 't1', account_id: 'a1', category_id: 'c1', amount_minor: -500, kind: 'expense', note: null },
  ],
};

// A graph that exercises every foreign-key path, including self-references.
const GRAPH = {
  accounts: [
    { id: 'a1', name: 'Cash', currency: 'AED' },
    { id: 'a2', name: 'Card', currency: 'AED', pay_from_account_id: 'a1' },
  ],
  categories: [
    { id: 'c1', name: 'Food', parent_id: null, kind: 'expense' },
    { id: 'c2', name: 'Lunch', parent_id: 'c1', kind: 'expense' },
  ],
  transactions: [
    { id: 't1', account_id: 'a1', category_id: 'c1', amount_minor: -500, kind: 'expense' },
    {
      id: 't2',
      account_id: 'a2',
      category_id: 'c2',
      amount_minor: -300,
      kind: 'expense',
      recurring_id: 'r1',
      transfer_peer_id: 't1',
    },
  ],
  recurring_rules: [{ id: 'r1', rrule: 'FREQ=MONTHLY', next_run_on: '2026-07-01' }],
  budgets: [{ id: 'b1', category_id: 'c1', amount_minor: 10000 }],
  tags: [{ id: 'g1', name: 'work' }],
  review_flags: [{ id: 'f1', transaction_id: 't1', reason: 'duplicate' }],
  transaction_tags: [{ transaction_id: 't1', tag_id: 'g1' }],
};

describe('parseBackup', () => {
  it('accepts a well-formed backup', () => {
    const text = JSON.stringify(makeBackup(SAMPLE));
    const parsed = parseBackup(text);
    expect(parsed.format).toBe('expense-tracker-backup');
    expect(parsed.tables.accounts).toHaveLength(1);
  });

  it('rejects non-JSON', () => {
    expect(() => parseBackup('not json {')).toThrow(/doesn't look like a Copper backup/i);
  });

  it('rejects a foreign format', () => {
    expect(() => parseBackup(JSON.stringify({ format: 'something-else', version: 1, tables: {} }))).toThrow(
      /Copper backup/i,
    );
  });

  it('rejects an unsupported version', () => {
    expect(() =>
      parseBackup(JSON.stringify({ format: 'expense-tracker-backup', version: 2, tables: {} })),
    ).toThrow(/version/i);
  });

  it('rejects a backup with no tables', () => {
    expect(() =>
      parseBackup(JSON.stringify({ format: 'expense-tracker-backup', version: 1 })),
    ).toThrow(/missing its data/i);
  });
});

describe('planRestore', () => {
  it('deletes every table (children first) before any insert', () => {
    const stmts = planRestore(makeBackup(SAMPLE), counter());
    const deletes = stmts.filter((s) => s.sql.startsWith('DELETE'));

    expect(deletes.map((s) => s.sql)).toEqual(
      [...BACKUP_TABLES].reverse().map((t) => `DELETE FROM ${t}`),
    );
    const firstInsert = stmts.findIndex((s) => s.sql.startsWith('INSERT'));
    const lastDelete = stmts.map((s) => s.sql.startsWith('DELETE')).lastIndexOf(true);
    expect(lastDelete).toBeLessThan(firstInsert);
  });

  it('mints fresh ids and never reuses an original primary key', () => {
    const stmts = planRestore(makeBackup(GRAPH), counter());
    const idParams = ['accounts', 'categories', 'transactions', 'recurring_rules', 'budgets', 'tags', 'review_flags']
      .flatMap((t) => decodeInserts(stmts, t))
      .map((r) => r.id);
    // Every emitted id is a freshly-generated one, none of the originals.
    for (const id of idParams) expect(String(id)).toMatch(/^n\d+$/);
    expect(idParams).not.toContain('a1');
    expect(idParams).not.toContain('t1');
  });

  it('rewrites foreign keys to the new ids, consistently', () => {
    // counter() mints in ENTITY_TABLES order: accounts(a1=n0,a2=n1),
    // categories(c1=n2,c2=n3), transactions(t1=n4,t2=n5), recurring(r1=n6),
    // budgets(b1=n7), tags(g1=n8), review_flags(f1=n9).
    const stmts = planRestore(makeBackup(GRAPH), counter());
    const rowFor = (table: string, col: string, value: unknown) =>
      decodeInserts(stmts, table).find((o) => o[col] === value)!;

    expect(rowFor('accounts', 'name', 'Card').pay_from_account_id).toBe('n0');
    expect(rowFor('categories', 'name', 'Lunch').parent_id).toBe('n2');
    const t2 = rowFor('transactions', 'amount_minor', -300);
    expect(t2.account_id).toBe('n1');
    expect(t2.category_id).toBe('n3');
    expect(t2.recurring_id).toBe('n6');
    expect(t2.transfer_peer_id).toBe('n4');
    expect(rowFor('budgets', 'amount_minor', 10000).category_id).toBe('n2');
    expect(rowFor('review_flags', 'reason', 'duplicate').transaction_id).toBe('n4');
    const link = rowFor('transaction_tags', 'tag_id', 'n8');
    expect(link.transaction_id).toBe('n4');
  });

  it('points recurring rules at the new account and category', () => {
    const tpl = (account_id: string, category_id: string | null) =>
      JSON.stringify({ account_id, category_id, amount_minor: 100, kind: 'expense', note: 'Rent' });
    const stmts = planRestore(
      makeBackup({
        ...GRAPH,
        recurring_rules: [
          { id: 'r1', template_json: tpl('a2', 'c1'), rrule: 'FREQ=MONTHLY', next_run_on: '2026-07-01' },
          { id: 'r2', template_json: tpl('a1', 'gone'), rrule: 'FREQ=MONTHLY', next_run_on: '2026-07-01' },
          { id: 'r3', template_json: tpl('ghost', null), rrule: 'FREQ=MONTHLY', next_run_on: '2026-07-01' },
        ],
      }),
      counter(),
    );
    const rules = decodeInserts(stmts, 'recurring_rules').map((r) => JSON.parse(r.template_json as string));
    expect(rules).toEqual([
      { account_id: 'n1', category_id: 'n2', amount_minor: 100, kind: 'expense', note: 'Rent' },
      { account_id: 'n0', category_id: null, amount_minor: 100, kind: 'expense', note: 'Rent' },
    ]);
  });

  it('keeps a null nullable foreign key as null', () => {
    const stmts = planRestore(makeBackup(GRAPH), counter());
    const food = decodeInserts(stmts, 'categories').find((o) => o.name === 'Food')!;
    expect(food.parent_id).toBeNull();
  });

  it('drops rows whose required parent did not survive (orphans)', () => {
    const stmts = planRestore(
      makeBackup({
        accounts: [{ id: 'a1', name: 'Cash' }],
        transactions: [
          { id: 't1', account_id: 'a1', amount_minor: -1 },
          { id: 't2', account_id: 'ghost', amount_minor: -2 }, // orphan
        ],
        tags: [{ id: 'g1', name: 'x' }],
        transaction_tags: [
          { transaction_id: 't1', tag_id: 'g1' },
          { transaction_id: 'ghost', tag_id: 'g1' }, // orphan
        ],
      }),
      counter(),
    );
    expect(decodeInserts(stmts, 'transactions')).toHaveLength(1);
    expect(decodeInserts(stmts, 'transaction_tags')).toHaveLength(1);
  });

  it('emits one INSERT statement per row', () => {
    // Single-row inserts are the cr-sqlite-safe form; guard against a
    // reintroduced multi-row batching regression.
    const accounts = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, name: `Acct ${i}` }));
    const stmts = planRestore(makeBackup({ accounts }), counter());
    const inserts = stmts.filter((s) => s.sql.startsWith('INSERT INTO accounts '));
    expect(inserts).toHaveLength(5);
    for (const s of inserts) expect(s.params).toHaveLength(2);
  });

  it('binds undefined values as null', () => {
    const stmts = planRestore(
      makeBackup({ accounts: [{ id: 'a1', name: 'Cash', currency: undefined }] }),
      counter(),
    );
    const insert = stmts.find((s) => s.sql.startsWith('INSERT INTO accounts '))!;
    expect(insert.sql).toBe('INSERT INTO accounts (id, name, currency) VALUES (?, ?, ?)');
    expect(insert.params).toEqual(['n0', 'Cash', null]);
  });

  it('rejects an unsafe column name', () => {
    expect(() =>
      planRestore(makeBackup({ accounts: [{ 'id); DROP TABLE accounts;--': 'x' }] }), counter()),
    ).toThrow(/invalid column name/i);
  });

  it('skips rows with no columns', () => {
    const stmts = planRestore(makeBackup({ accounts: [{}] }), counter());
    expect(stmts.some((s) => s.sql.startsWith('INSERT INTO accounts '))).toBe(false);
  });

  it('remaps change_log.entity_id polymorphically and preserves attribution', () => {
    // ENTITY_TABLES order mints: accounts(a1=n0), transactions(t1=n1),
    // then change_log rows last (l1=n2, l2=n3, l3=n4).
    const stmts = planRestore(
      makeBackup({
        accounts: [{ id: 'a1', name: 'Cash' }],
        transactions: [{ id: 't1', account_id: 'a1', amount_minor: -500 }],
        change_log: [
          { id: 'l1', entity: 'transaction', entity_id: 't1', op: 'insert', site_id: 'dev-A', at: '2026-06-01T00:00:00Z', diff: '{}' },
          { id: 'l2', entity: 'account', entity_id: 'a1', op: 'insert', site_id: 'dev-A', at: '2026-06-01T00:00:00Z', diff: '{}' },
          { id: 'l3', entity: 'transaction', entity_id: 'gone', op: 'delete', site_id: 'dev-B', at: '2026-06-01T00:00:00Z', diff: '{}' },
        ],
      }),
      counter(),
    );
    const logs = decodeInserts(stmts, 'change_log');
    const byEntity = (e: string, id?: string) =>
      logs.find((r) => r.entity === e && (id === undefined || r.entity_id === id))!;

    // entity_id is rewritten through the right table's id map…
    expect(byEntity('transaction', 'n1').entity_id).toBe('n1');
    expect(byEntity('account').entity_id).toBe('n0');
    // …but an entry whose target row is gone keeps its original id (orphan, still readable).
    expect(byEntity('transaction', 'gone').entity_id).toBe('gone');
    // change_log's own id is freshly minted, and site_id is never remapped so
    // attribution survives the round-trip.
    for (const r of logs) expect(String(r.id)).toMatch(/^n\d+$/);
    expect(logs.map((r) => r.site_id).sort()).toEqual(['dev-A', 'dev-A', 'dev-B']);
  });
});

// This app's schema, as far as the backup under test needs it: every column
// GRAPH uses.
function fakeRestoreDb(calls: { sql: string; params: unknown[] }[]): DB {
  const schema = new Map<string, Set<string>>();
  for (const [table, rows] of Object.entries(makeBackup(GRAPH).tables)) {
    schema.set(table, new Set(rows.flatMap((r) => Object.keys(r))));
  }
  return {
    execO: async (_sql: string, [table]: string[]) => [...(schema.get(table) ?? [])].map((name) => ({ name })),
    tx: async (fn: (tx: { exec: (sql: string, params?: unknown[]) => Promise<void> }) => Promise<void>) => {
      await fn({
        exec: async (sql: string, params: unknown[] = []) => {
          calls.push({ sql, params });
        },
      });
    },
  } as unknown as DB;
}

describe('restoreBackup', () => {
  it('refuses a backup from a newer Copper before wiping anything', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const withTable = makeBackup(GRAPH);
    withTable.tables.moods = [{ id: 'm1', name: 'happy' }];
    await expect(restoreBackup(fakeRestoreDb(calls), withTable)).rejects.toThrow(/newer version of Copper/);

    const withColumn = makeBackup(GRAPH);
    withColumn.tables.accounts = [{ ...withColumn.tables.accounts[0], nickname: 'wallet' }];
    await expect(restoreBackup(fakeRestoreDb(calls), withColumn)).rejects.toThrow(/newer version of Copper/);
    expect(calls).toEqual([]);
  });


  it('runs wipe + insert in one transaction and marks onboarding done', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const fakeDb = fakeRestoreDb(calls);

    const stats = await restoreBackup(fakeDb, makeBackup(GRAPH));

    // 2 accounts + 2 categories + 2 transactions + 1 recurring + 1 budget +
    // 1 tag + 1 review_flag + 1 link = 11 rows across 8 tables.
    expect(stats).toEqual({ rows: 11, tables: 8 });
    expect(calls.some((c) => c.sql.includes("INSERT INTO meta"))).toBe(true);
  });

  it('restores through the encrypted-backup flow (decrypt → parse → plan)', async () => {
    // Mirrors the Welcome/Settings "unlock" path: an encrypted export is
    // detected, decrypted with the password, then parsed and restored.
    const text = JSON.stringify(makeBackup(GRAPH));
    const envelope = JSON.parse(await encryptBackup(text, 'shared secret'));
    expect(isEncryptedBackup(envelope)).toBe(true);

    const plaintext = await decryptBackup(envelope, 'shared secret');
    const backup = parseBackup(plaintext);
    // The decrypted, parsed backup is a faithful copy the planner accepts.
    expect(backup.tables.accounts).toHaveLength(2);
    const stmts = planRestore(backup, counter());
    expect(stmts.filter((s) => s.sql.startsWith('INSERT INTO accounts ')).length).toBe(2);
  });

  it('preserves data and relationships under remapped ids (round-trip)', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const fakeDb = fakeRestoreDb(calls);

    await restoreBackup(fakeDb, makeBackup(GRAPH));

    const byTable: Record<string, Record<string, unknown>[]> = {};
    for (const { sql, params } of calls) {
      const m = sql.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/);
      if (!m) continue;
      const [, table, colList] = m;
      const cols = colList.split(', ');
      for (let i = 0; i < params.length; i += cols.length) {
        const row: Record<string, unknown> = {};
        cols.forEach((c, k) => (row[c] = params[i + k]));
        (byTable[table] ??= []).push(row);
      }
    }

    // Non-id data survives intact.
    expect(byTable.accounts.map((a) => a.name).sort()).toEqual(['Card', 'Cash']);
    // Ids are all fresh (uuid v4), not the originals.
    const card = byTable.accounts.find((a) => a.name === 'Card')!;
    const cash = byTable.accounts.find((a) => a.name === 'Cash')!;
    expect(card.id).not.toBe('a2');
    expect(card.id).toMatch(/^[0-9a-f-]{36}$/);
    // The self-referential FK points at the remapped parent, not the old id.
    expect(card.pay_from_account_id).toBe(cash.id);
    // A transaction's account_id resolves to the remapped account.
    const t1 = byTable.transactions.find((t) => t.amount_minor === -500)!;
    expect(t1.account_id).toBe(cash.id);
  });
});
