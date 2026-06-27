import type { DB } from '@/db/wasm';
import { uuid } from '@/db/uuid';
import { SETTINGS_KEYS } from '@/db/queries/settings';
import { BACKUP_TABLES, type BackupFile } from './exportData';

export interface RestoreStats {
  tables: number;
  rows: number;
}

/** Parse and validate a backup file's text, throwing user-readable errors. */
export function parseBackup(text: string): BackupFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON — pick a backup file exported from this app.");
  }
  if (!json || typeof json !== 'object') {
    throw new Error('Unrecognised backup file.');
  }
  const b = json as Record<string, unknown>;
  if (b.format !== 'expense-tracker-backup') {
    throw new Error("This doesn't look like an Expense Tracker backup file.");
  }
  if (b.version !== 1) {
    throw new Error(`Unsupported backup version (${String(b.version)}). This app reads version 1.`);
  }
  if (!b.tables || typeof b.tables !== 'object') {
    throw new Error('Backup is missing its data.');
  }
  return json as BackupFile;
}

interface Statement {
  sql: string;
  params: unknown[];
}

const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Tables that own a remappable `id` primary key. `transaction_tags` is excluded:
// it has a composite (transaction_id, tag_id) key and no id of its own.
const ENTITY_TABLES = [
  'accounts',
  'categories',
  'transactions',
  'recurring_rules',
  'budgets',
  'tags',
  'review_flags',
] as const;

// Foreign-key columns to rewrite to the freshly-minted ids, keyed by the table
// whose id they point at. The schema declares no FK *constraints* (cr-sqlite
// can't replicate them), so insert order is irrelevant — every id map is built
// before any row is emitted.
const FOREIGN_KEYS: Record<string, Record<string, string>> = {
  accounts: { pay_from_account_id: 'accounts' },
  categories: { parent_id: 'categories' },
  transactions: {
    account_id: 'accounts',
    category_id: 'categories',
    transfer_peer_id: 'transactions',
    recurring_id: 'recurring_rules',
  },
  budgets: { category_id: 'categories' },
  review_flags: { transaction_id: 'transactions', related_transaction_id: 'transactions' },
  transaction_tags: { transaction_id: 'transactions', tag_id: 'tags' },
};

// FK columns that are NOT NULL: if their parent didn't survive the remap the row
// is an orphan and gets dropped rather than inserted with a dangling reference.
const REQUIRED_FKS: Record<string, string[]> = {
  transactions: ['account_id'],
  budgets: ['category_id'],
  review_flags: ['transaction_id'],
  transaction_tags: ['transaction_id', 'tag_id'],
};

/**
 * Build the ordered SQL to restore a backup *in place*: wipe every table
 * (children first) then re-insert every row with a brand-new UUID, rewriting
 * foreign keys to match. Re-using the original primary keys is what corrupts
 * cr-sqlite (the deleted keys are tombstoned, and resurrecting them at scale
 * malforms the CRDT clock) — fresh ids avoid that entirely, the same way the
 * Monefy importer does. Pure, so the remapping is unit-testable without a DB.
 *
 * `newId` is injectable purely so tests can assert the remapping deterministically.
 */
export function planRestore(backup: BackupFile, newId: () => string = uuid): Statement[] {
  const entitySet = new Set<string>(ENTITY_TABLES);

  // Phase 1: mint a fresh id for every entity row up front.
  const idMaps: Record<string, Map<string, string>> = {};
  for (const table of ENTITY_TABLES) {
    const map = new Map<string, string>();
    for (const row of backup.tables[table] ?? []) {
      const oldId = row.id;
      if (typeof oldId === 'string' && oldId !== '') map.set(oldId, newId());
    }
    idMaps[table] = map;
  }

  const remapFk = (table: string, col: string, value: unknown): unknown => {
    const target = FOREIGN_KEYS[table]?.[col];
    if (!target) return value; // not a foreign key
    if (value == null || value === '') return value; // already absent
    return idMaps[target]?.get(value as string) ?? null; // orphan → null
  };

  const stmts: Statement[] = [];

  // Phase 2: wipe children first so nothing outlives its parent.
  for (const table of [...BACKUP_TABLES].reverse()) {
    stmts.push({ sql: `DELETE FROM ${table}`, params: [] });
  }

  // Phase 3: re-insert with remapped ids and foreign keys, one statement per
  // row. Multi-row batched INSERTs were tried for speed but corrupt cr-sqlite's
  // CRR clock at scale (~12k rows) — single-row inserts are the proven-safe form.
  for (const table of BACKUP_TABLES) {
    const isEntity = entitySet.has(table);
    const required = REQUIRED_FKS[table] ?? [];
    for (const row of backup.tables[table] ?? []) {
      const cols = Object.keys(row);
      if (cols.length === 0) continue;
      for (const c of cols) {
        // Column names are interpolated, not bound — reject anything unexpected
        // so a crafted file can't smuggle SQL through an identifier.
        if (!COLUMN_NAME.test(c)) throw new Error(`Backup has an invalid column name: ${c}`);
      }

      // An entity row with no usable id can't be referenced or remapped — skip it.
      const newOwnId = isEntity ? idMaps[table].get(row.id as string) : undefined;
      if (isEntity && !newOwnId) continue;

      const values: Record<string, unknown> = {};
      for (const c of cols) {
        if (isEntity && c === 'id') values[c] = newOwnId;
        else values[c] = remapFk(table, c, row[c] === undefined ? null : row[c]);
      }

      // Drop orphans: a required parent that vanished in the remap.
      if (required.some((c) => c in values && (values[c] == null || values[c] === ''))) continue;

      const placeholders = cols.map(() => '?').join(', ');
      stmts.push({
        sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
        params: cols.map((c) => values[c]),
      });
    }
  }

  return stmts;
}

/** Replace all current data with the contents of a parsed backup, in place. */
export async function restoreBackup(db: DB, backup: BackupFile): Promise<RestoreStats> {
  const stmts = planRestore(backup);
  await db.tx(async (tx) => {
    for (const s of stmts) await tx.exec(s.sql, s.params);
    // The restored book is real data, so make sure setup is marked complete.
    await tx.exec(
      `INSERT INTO meta (key, value) VALUES (?, 'true')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [SETTINGS_KEYS.ONBOARDED],
    );
  });

  const inserts = stmts.filter((s) => s.sql.startsWith('INSERT'));
  const tables = new Set(inserts.map((s) => s.sql.match(/INTO (\w+)/)![1]));
  return { tables: tables.size, rows: inserts.length };
}
