import type { DB } from '@/db/wasm';
import type { AccountType, CategoryKind } from '@/db/types';
import { uuid } from '@/db/uuid';
import { nowIso } from '@/lib/dates';
import { SETTINGS_KEYS } from '@/db/queries/settings';
import type { ImportPlan } from './parseMonefy';

const ACCOUNT_TYPE_EMOJI: Record<AccountType, string> = {
  cash: '💵',
  bank: '🏦',
  credit_card: '💳',
  wallet: '👛',
  loan: '🤝',
  other: '📦',
};

const CATEGORY_EMOJI: Record<string, string> = {
  groceries: '🛒',
  'eating out': '🍔',
  'drinks & snacks': '🥤',
  house: '🏠',
  taxi: '🚕',
  health: '🩺',
  'hygiene / grooming': '🧼',
  'fees / charges': '💸',
  utility: '💡',
  entertainment: '🎬',
  clothes: '👕',
  'misc. purchases': '🛍️',
  'balance correction': '⚖️',
  investment: '📈',
  gifts: '🎁',
  'sports / gym': '🏋️',
  party: '🎉',
  outing: '🚶',
  'bus / metro': '🚌',
  cashback: '💰',
  mobile: '📱',
  salary: '💼',
  water: '💧',
  vacation: '✈️',
  interest: '📊',
  refund: '↩️',
  car: '🚗',
  gift: '🎁',
  rent: '🏘️',
  education: '📚',
  fuel: '⛽',
  pets: '🐾',
  family: '👨‍👩‍👧',
  crypto: '₿',
  'capital appreciation': '📈',
  prize: '🏆',
  offer: '🎟️',
};

function guessCategoryEmoji(name: string, kind: CategoryKind): string {
  const lower = name.toLowerCase();
  if (CATEGORY_EMOJI[lower]) return CATEGORY_EMOJI[lower];
  for (const [k, v] of Object.entries(CATEGORY_EMOJI)) {
    if (lower.includes(k)) return v;
  }
  return kind === 'income' ? '💰' : '🏷️';
}

export interface ImportOverrides {
  accountTypes: Record<string, AccountType>;
  /** Final account name, keyed by the original name parsed from the CSV. */
  names: Record<string, string>;
  /** Whether each account counts toward the dashboard total, keyed by original name. */
  includeInTotal: Record<string, boolean>;
  mainAccount: string | null;
  wipeFirst: boolean;
}

export interface ImportResult {
  accountsCreated: number;
  categoriesCreated: number;
  transactionsCreated: number;
  transfersCreated: number;
}

export async function runMonefyImport(
  db: DB,
  plan: ImportPlan,
  overrides: ImportOverrides,
): Promise<ImportResult> {
  const now = nowIso();
  const accountIds = new Map<string, string>();
  const categoryIds = new Map<string, string>();

  await db.tx(async (tx) => {
    if (overrides.wipeFirst) {
      await tx.exec('DELETE FROM review_flags');
      await tx.exec('DELETE FROM transaction_tags');
      await tx.exec('DELETE FROM tags');
      await tx.exec('DELETE FROM budgets');
      await tx.exec('DELETE FROM recurring_rules');
      await tx.exec('DELETE FROM transactions');
      await tx.exec('DELETE FROM categories');
      await tx.exec('DELETE FROM accounts');
    }

    let sortOrder = 0;
    for (const acct of plan.accounts) {
      const id = uuid();
      accountIds.set(acct.name, id);
      const type = overrides.accountTypes[acct.name] ?? acct.type;
      const finalName = (overrides.names[acct.name] ?? acct.name).trim() || acct.name;
      const isMain =
        overrides.mainAccount === acct.name || (!overrides.mainAccount && sortOrder === 0) ? 1 : 0;
      const includeInTotal = (overrides.includeInTotal[acct.name] ?? type !== 'loan') ? 1 : 0;
      const icon = ACCOUNT_TYPE_EMOJI[type];
      await tx.exec(
        `INSERT INTO accounts (
          id, name, type, currency, opening_balance_minor, is_main, include_in_total,
          credit_limit_minor, statement_day, due_day, pay_from_account_id,
          color, icon, starts_on, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
        [id, finalName, type, acct.currency, acct.openingBalanceMinor, isMain, includeInTotal, icon, '', now],
      );
      sortOrder++;
    }

    let catSort = 0;
    for (const cat of plan.categories) {
      const id = uuid();
      categoryIds.set(cat.name, id);
      const icon = guessCategoryEmoji(cat.name, cat.kind);
      await tx.exec(
        `INSERT INTO categories (id, parent_id, name, kind, icon, color, sort_order, created_at)
         VALUES (?, NULL, ?, ?, ?, NULL, ?, ?)`,
        [id, cat.name, cat.kind, icon, catSort++, now],
      );
    }

    for (const t of plan.transactions) {
      const accountId = accountIds.get(t.account);
      const categoryId = categoryIds.get(t.category);
      if (!accountId || !categoryId) continue;
      const signed = t.kind === 'expense' ? -t.amountMinor : t.amountMinor;
      await tx.exec(
        `INSERT INTO transactions (
          id, account_id, category_id, amount_minor, kind,
          transfer_peer_id, occurred_on, note, recurring_id, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)`,
        [uuid(), accountId, categoryId, signed, t.kind, t.date, t.note ?? null, now],
      );
    }

    for (const tr of plan.transfers) {
      const fromId = accountIds.get(tr.fromAccount);
      const toId = accountIds.get(tr.toAccount);
      if (!fromId || !toId) continue;
      const a = uuid();
      const b = uuid();
      await tx.exec(
        `INSERT INTO transactions (id, account_id, category_id, amount_minor, kind, transfer_peer_id, occurred_on, note, recurring_id, created_at)
         VALUES (?, ?, NULL, ?, 'transfer', ?, ?, ?, NULL, ?)`,
        [a, fromId, -tr.amountMinor, b, tr.date, tr.note ?? null, now],
      );
      await tx.exec(
        `INSERT INTO transactions (id, account_id, category_id, amount_minor, kind, transfer_peer_id, occurred_on, note, recurring_id, created_at)
         VALUES (?, ?, NULL, ?, 'transfer', ?, ?, ?, NULL, ?)`,
        [b, toId, tr.amountMinor, a, tr.date, tr.note ?? null, now],
      );
    }

    await tx.exec(
      `INSERT INTO meta (key, value) VALUES (?, 'true')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [SETTINGS_KEYS.ONBOARDED],
    );
    await tx.exec(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [SETTINGS_KEYS.DEFAULT_CURRENCY, plan.currency],
    );
  });

  return {
    accountsCreated: plan.accounts.length,
    categoriesCreated: plan.categories.length,
    transactionsCreated: plan.transactions.length,
    transfersCreated: plan.transfers.length,
  };
}
