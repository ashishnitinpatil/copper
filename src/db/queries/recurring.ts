import type { DB } from '../wasm';
import type { RecurringRule, TransactionKind } from '../types';
import { uuid } from '../uuid';
import { nowIso, toDateString } from '@/lib/dates';
import { logCreate, logUpdate, snapshotEntity } from '../changeLog';

export interface RecurringTemplate {
  account_id: string;
  category_id: string | null;
  amount_minor: number;
  kind: TransactionKind;
  note: string | null;
}

export interface RecurringRuleInput {
  template: RecurringTemplate;
  rrule: string;
  next_run_on: string;
}

export async function listRecurringRules(db: DB, includeArchived = false): Promise<RecurringRule[]> {
  const sql = includeArchived
    ? 'SELECT * FROM recurring_rules ORDER BY next_run_on'
    : 'SELECT * FROM recurring_rules WHERE archived_at IS NULL ORDER BY next_run_on';
  return db.execO<RecurringRule>(sql);
}

export async function createRecurringRule(db: DB, input: RecurringRuleInput): Promise<string> {
  const id = uuid();
  await db.exec(
    `INSERT INTO recurring_rules (id, template_json, rrule, next_run_on, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, JSON.stringify(input.template), input.rrule, input.next_run_on, nowIso()],
  );
  await logCreate(db, 'recurring', id);
  return id;
}

export async function updateRecurringRule(
  db: DB,
  id: string,
  input: RecurringRuleInput,
): Promise<void> {
  const before = await snapshotEntity(db, 'recurring', id);
  await db.exec(
    `UPDATE recurring_rules SET template_json = ?, rrule = ?, next_run_on = ? WHERE id = ?`,
    [JSON.stringify(input.template), input.rrule, input.next_run_on, id],
  );
  await logUpdate(db, 'recurring', id, before);
}

export async function archiveRecurringRule(db: DB, id: string): Promise<void> {
  const before = await snapshotEntity(db, 'recurring', id);
  await db.exec('UPDATE recurring_rules SET archived_at = ? WHERE id = ?', [nowIso(), id]);
  await logUpdate(db, 'recurring', id, before);
}

export async function materializeDueRecurrences(db: DB): Promise<number> {
  const today = toDateString();
  const rules = await db.execO<RecurringRule>(
    'SELECT * FROM recurring_rules WHERE archived_at IS NULL AND next_run_on <= ?',
    [today],
  );

  let created = 0;
  const { RRule } = await import('rrule');

  for (const rule of rules) {
    const tpl: RecurringTemplate = JSON.parse(rule.template_json);
    const rr = RRule.fromString(rule.rrule);

    const after = rule.last_run_on ? new Date(rule.last_run_on + 'T00:00:00Z') : new Date(rule.next_run_on + 'T00:00:00Z');
    after.setUTCDate(after.getUTCDate() - 1);
    const until = new Date(today + 'T23:59:59Z');
    const dates = rr.between(after, until, true);

    const nextDates = rr.between(until, new Date(until.getTime() + 400 * 86400000), false);
    const nextRun = nextDates[0] ? nextDates[0].toISOString().slice(0, 10) : null;

    await db.tx(async (tx) => {
      for (const d of dates) {
        const occDate = d.toISOString().slice(0, 10);
        // Deterministic PK per (rule, occurrence date). If two devices both
        // materialize this occurrence, they generate the SAME id, so cr-sqlite
        // merges them into one row instead of keeping two duplicates. OR IGNORE
        // keeps a re-run on the same device idempotent.
        const txId = `rec:${rule.id}:${occDate}`;
        const signedAmount = tpl.kind === 'expense' ? -Math.abs(tpl.amount_minor) : Math.abs(tpl.amount_minor);
        await tx.exec(
          `INSERT OR IGNORE INTO transactions (id, account_id, category_id, amount_minor, kind, occurred_on, note, recurring_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [txId, tpl.account_id, tpl.category_id, signedAmount, tpl.kind, occDate, tpl.note, rule.id, nowIso()],
        );
        created++;
      }

      if (nextRun) {
        await tx.exec('UPDATE recurring_rules SET next_run_on = ?, last_run_on = ? WHERE id = ?', [
          nextRun,
          today,
          rule.id,
        ]);
      } else {
        await tx.exec('UPDATE recurring_rules SET archived_at = ?, last_run_on = ? WHERE id = ?', [
          nowIso(),
          today,
          rule.id,
        ]);
      }
    });
  }

  return created;
}
