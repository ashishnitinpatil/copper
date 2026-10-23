import { useCallback, useMemo } from 'react';
import { useQuery } from '@/db/useQuery';
import { useConvert } from '@/app/AppSettingsProvider';
import type { Account } from '@/db/types';

// How accounts are listed, chosen on the Accounts page and remembered on this
// device; the Dashboard shows its first few in the same order.
// (No "by type": the Accounts page groups by type already.)
export type AccountOrder = 'used' | 'balance' | 'name';

export const ORDER_OPTIONS: { value: AccountOrder; label: string }[] = [
  { value: 'used', label: 'Most used' },
  { value: 'balance', label: 'Balance' },
  { value: 'name', label: 'Name' },
];
const ORDER_KEY = 'copper-accounts-order';

export function getSavedOrder(): AccountOrder {
  try {
    const saved = localStorage.getItem(ORDER_KEY);
    return ORDER_OPTIONS.some((o) => o.value === saved) ? (saved as AccountOrder) : 'used';
  } catch {
    return 'used';
  }
}

export function saveOrder(order: AccountOrder) {
  try {
    localStorage.setItem(ORDER_KEY, order);
  } catch {
    /* remembered for this visit only */
  }
}

/** `accounts` sorted by `order`, the main account always first. */
export function useSortedAccounts(accounts: Account[], order: AccountOrder, balances: Map<string, number>): Account[] {
  // Entries in the last 90 days, for "Most used".
  const usage = useQuery(
    useCallback(
      (db) =>
        db.execO<{ account_id: string; uses: number }>(
          `SELECT account_id, COUNT(*) AS uses FROM transactions
           WHERE occurred_on > date('now', 'localtime', '-90 days') AND occurred_on <= date('now', 'localtime')
           GROUP BY account_id`,
        ),
      [],
    ),
    { deps: ['transactions'], cacheKey: 'accounts:usage' },
  );
  const toMain = useConvert();
  return useMemo(() => {
    const uses = new Map((usage.data ?? []).map((u) => [u.account_id, u.uses]));
    const balanceOf = (a: Account) => toMain(balances.get(a.id) ?? a.opening_balance_minor, a.currency);
    const by: Record<AccountOrder, (a: Account, b: Account) => number> = {
      used: (a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0),
      balance: (a, b) => balanceOf(b) - balanceOf(a),
      name: () => 0,
    };
    return [...accounts].sort((a, b) => b.is_main - a.is_main || by[order](a, b) || a.name.localeCompare(b.name));
  }, [accounts, order, usage.data, balances, toMain]);
}
