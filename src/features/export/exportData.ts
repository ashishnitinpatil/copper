import type { DB } from '@/db/wasm';
import { fromMinor } from '@/lib/money';
import { toDateString } from '@/lib/dates';

/** Tables included in a full backup, in dependency order (parents first). */
export const BACKUP_TABLES = [
  'accounts',
  'categories',
  'transactions',
  'recurring_rules',
  'budgets',
  'review_flags',
  'tags',
  'transaction_tags',
  // The audit trail and device registry travel with the data so history and
  // attribution survive a backup/restore round-trip.
  'change_log',
  'devices',
  'themes',
] as const;

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

interface TxExportRow {
  date: string;
  account: string;
  currency: string;
  category: string | null;
  kind: string;
  amount_minor: number;
  note: string | null;
  tags: string | null;
}

/** Flat, human-readable CSV of every entry in each account's native currency. */
export async function buildTransactionsCsv(db: DB): Promise<string> {
  const rows = await db.execO<TxExportRow>(
    `SELECT t.occurred_on AS date, a.name AS account, a.currency AS currency,
            c.name AS category, t.kind AS kind, t.amount_minor AS amount_minor, t.note AS note,
            (SELECT GROUP_CONCAT(tg.name, ' | ')
             FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id
             WHERE tt.transaction_id = t.id) AS tags
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     ORDER BY t.occurred_on DESC, t.created_at DESC`,
  );
  const header = ['Date', 'Account', 'Category', 'Type', 'Amount', 'Currency', 'Note', 'Tags'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        csvCell(r.account),
        csvCell(r.category ?? ''),
        r.kind,
        fromMinor(r.amount_minor, r.currency),
        r.currency,
        csvCell(r.note ?? ''),
        csvCell(r.tags ?? ''),
      ].join(','),
    );
  }
  return lines.join('\n');
}

export interface BackupFile {
  format: 'expense-tracker-backup';
  version: 1;
  exported_at: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/** Full snapshot of every user table — a portable, restore-capable backup. */
export async function buildFullBackup(db: DB): Promise<BackupFile> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const name of BACKUP_TABLES) {
    tables[name] = await db.execO<Record<string, unknown>>(`SELECT * FROM ${name}`);
  }
  return {
    format: 'expense-tracker-backup',
    version: 1,
    exported_at: new Date().toISOString(),
    tables,
  };
}

/** Trigger a browser download of in-memory text content. */
export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportFileName(kind: 'transactions' | 'backup', ext: string): string {
  return `copper-${kind}-${toDateString()}.${ext}`;
}
