import type { DB } from '../wasm';
import type { Budget, BudgetPeriod } from '../types';
import { uuid } from '../uuid';
import { nowIso, startOfMonth, endOfMonth, toDateString } from '@/lib/dates';
import { listCategories, getDescendantIds } from './categories';
import { convert, type FxRates } from '@/lib/fx';
import { logCreate, logUpdate, snapshotEntity } from '../changeLog';

export interface BudgetInput {
  category_id: string;
  period: BudgetPeriod;
  amount_minor: number;
  currency: string;
  starts_on: string;
}

export interface BudgetWithSpent extends Budget {
  category_name: string;
  category_icon: string | null;
  spent_minor: number;
  /** Currencies of spending converted into the budget's currency (usually none). */
  converted_from: string[];
}

export async function listBudgets(db: DB, includeArchived = false): Promise<Budget[]> {
  const sql = includeArchived
    ? 'SELECT * FROM budgets ORDER BY created_at DESC'
    : 'SELECT * FROM budgets WHERE archived_at IS NULL ORDER BY created_at DESC';
  return db.execO<Budget>(sql);
}

/**
 * Spend for each budget over the given month. Spend rolls up the category's
 * whole subtree (a "Food" budget counts "Food › Restaurant" too), and amounts
 * from accounts in other currencies are converted into the budget's currency
 * via the manual FX rates so a single comparable number is shown.
 */
export async function getBudgetsWithSpent(
  db: DB,
  month: string | undefined,
  defaultCurrency: string,
  rates: FxRates,
): Promise<BudgetWithSpent[]> {
  const ref = month ? new Date(month + 'T00:00:00') : new Date();
  const from = toDateString(startOfMonth(ref));
  // This month counts only up to today: later entries are scheduled, not spent.
  const today = toDateString();
  const monthEnd = toDateString(endOfMonth(ref));
  const to = from <= today && today < monthEnd ? today : monthEnd;

  const budgets = await db.execO<BudgetWithSpent>(
    `SELECT b.*, c.name AS category_name, c.icon AS category_icon, 0 AS spent_minor
     FROM budgets b
     JOIN categories c ON c.id = b.category_id
     WHERE b.archived_at IS NULL
     ORDER BY c.sort_order, c.name`,
  );
  if (budgets.length === 0) return [];

  // Expense totals per (category, account-currency) for the month. Grouping by
  // currency lets us convert each slice into the budget currency in JS, which
  // is decimal-aware in a way a flat SQL multiply would not be.
  const spendRows = await db.execO<{ category_id: string; currency: string; spent: number }>(
    `SELECT t.category_id AS category_id, a.currency AS currency, SUM(ABS(t.amount_minor)) AS spent
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     WHERE t.kind = 'expense' AND t.category_id IS NOT NULL
       AND t.occurred_on >= ? AND t.occurred_on <= ?
     GROUP BY t.category_id, a.currency`,
    [from, to],
  );

  const spendByCategory = new Map<string, Map<string, number>>();
  for (const r of spendRows) {
    let byCurrency = spendByCategory.get(r.category_id);
    if (!byCurrency) {
      byCurrency = new Map();
      spendByCategory.set(r.category_id, byCurrency);
    }
    byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.spent);
  }

  const categories = await listCategories(db, true);
  return budgets.map((b) => {
    const ids = [b.category_id, ...getDescendantIds(categories, b.category_id)];
    let spent = 0;
    const convertedFrom = new Set<string>();
    for (const cid of ids) {
      const byCurrency = spendByCategory.get(cid);
      if (!byCurrency) continue;
      for (const [currency, minor] of byCurrency) {
        spent += convert(minor, currency, b.currency, defaultCurrency, rates);
        if (currency !== b.currency) convertedFrom.add(currency);
      }
    }
    return { ...b, spent_minor: spent, converted_from: [...convertedFrom] };
  });
}

export async function createBudget(db: DB, input: BudgetInput): Promise<string> {
  const id = uuid();
  await db.exec(
    `INSERT INTO budgets (id, category_id, period, amount_minor, currency, starts_on, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.category_id, input.period, input.amount_minor, input.currency, input.starts_on, nowIso()],
  );
  await logCreate(db, 'budget', id);
  return id;
}

export async function updateBudget(db: DB, id: string, input: BudgetInput): Promise<void> {
  const before = await snapshotEntity(db, 'budget', id);
  await db.exec(
    `UPDATE budgets SET category_id = ?, period = ?, amount_minor = ?, currency = ?, starts_on = ? WHERE id = ?`,
    [input.category_id, input.period, input.amount_minor, input.currency, input.starts_on, id],
  );
  await logUpdate(db, 'budget', id, before);
}

export async function archiveBudget(db: DB, id: string): Promise<void> {
  const before = await snapshotEntity(db, 'budget', id);
  await db.exec('UPDATE budgets SET archived_at = ? WHERE id = ?', [nowIso(), id]);
  await logUpdate(db, 'budget', id, before);
}
