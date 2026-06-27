import type { DB } from './wasm';
import { uuid } from './uuid';
import { SETTINGS_KEYS } from './queries/settings';

interface DefaultCategory {
  name: string;
  icon: string;
  color: string;
  kind: 'expense' | 'income';
}

const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Food & Dining', icon: '🍽️', color: '#f59e0b', kind: 'expense' },
  { name: 'Groceries', icon: '🛒', color: '#84cc16', kind: 'expense' },
  { name: 'Transport', icon: '🚗', color: '#0ea5e9', kind: 'expense' },
  { name: 'Bills & Utilities', icon: '💡', color: '#a855f7', kind: 'expense' },
  { name: 'Rent', icon: '🏠', color: '#ef4444', kind: 'expense' },
  { name: 'Health', icon: '🏥', color: '#ec4899', kind: 'expense' },
  { name: 'Shopping', icon: '🛍️', color: '#f97316', kind: 'expense' },
  { name: 'Entertainment', icon: '🎬', color: '#8b5cf6', kind: 'expense' },
  { name: 'Travel', icon: '✈️', color: '#06b6d4', kind: 'expense' },
  { name: 'Education', icon: '📚', color: '#3b82f6', kind: 'expense' },
  { name: 'Subscriptions', icon: '🔁', color: '#64748b', kind: 'expense' },
  { name: 'Gifts', icon: '🎁', color: '#d946ef', kind: 'expense' },
  { name: 'Other', icon: '➕', color: '#94a3b8', kind: 'expense' },
  { name: 'Salary', icon: '💼', color: '#10b981', kind: 'income' },
  { name: 'Bonus', icon: '🎯', color: '#22c55e', kind: 'income' },
  { name: 'Refunds', icon: '↩️', color: '#14b8a6', kind: 'income' },
];

export async function seedIfEmpty(db: DB): Promise<void> {
  const [{ c: catCount }] = await db.execO<{ c: number }>(
    'SELECT COUNT(*) AS c FROM categories',
  );
  const [{ c: acctCount }] = await db.execO<{ c: number }>(
    'SELECT COUNT(*) AS c FROM accounts',
  );

  const now = new Date().toISOString();

  await db.tx(async (tx) => {
    if (catCount === 0) {
      for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
        const cat = DEFAULT_CATEGORIES[i];
        await tx.exec(
          `INSERT INTO categories (id, parent_id, name, kind, icon, color, sort_order, created_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
          [uuid(), cat.name, cat.kind, cat.icon, cat.color, i, now],
        );
      }
    }

    if (acctCount > 0) {
      await tx.exec(
        `INSERT INTO meta (key, value) VALUES (?, 'true')
         ON CONFLICT(key) DO NOTHING`,
        [SETTINGS_KEYS.ONBOARDED],
      );
    }
  });
}
