import { useCallback, useMemo } from 'react';
import { Glyph } from '@/components/ui/Glyph';
import type { Account, AccountType } from '@/db/types';
import { getAccountBalances } from '@/db/queries/accounts';
import { useQuery } from '@/db/useQuery';
import { AccountTypeIcon } from '@/components/ui/AccountTypeIcon';
import type { ComboboxOption } from '@/components/ui/Combobox';
import { formatMoney } from '@/lib/money';

/** An account's own emoji if it has one, else its type's icon, on a small disc. */
export function AccountGlyph({
  account,
  size = 'sm',
}: {
  account: Pick<Account, 'icon' | 'type'>;
  size?: 'xs' | 'sm' | 'md';
}) {
  const box = size === 'md' ? 'h-9 w-9 text-lg' : size === 'xs' ? 'h-4 w-4 text-[10px]' : 'h-6 w-6 text-sm';
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-slate-800/80 text-slate-300 ${box}`}
    >
      {account.icon ? (
        <Glyph icon={account.icon} className={size === 'md' ? 'h-4 w-4' : size === 'xs' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} />
      ) : (
        <AccountTypeIcon type={account.type as AccountType} className={size === 'md' ? 'h-4 w-4' : size === 'xs' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} />
      )}
    </span>
  );
}

/** Today's balance per account id, kept live. */
export function useAccountBalances(): Map<string, number> {
  const state = useQuery(
    useCallback((d) => getAccountBalances(d), []),
    { deps: ['accounts', 'transactions'] },
  );
  return useMemo(
    () => new Map((state.data ?? []).map((b) => [b.account_id, b.balance_minor])),
    [state.data],
  );
}

/** Dropdown options for accounts: icon, name, and (when given) today's balance. */
export function accountOptions(
  accounts: Account[],
  balances?: Map<string, number>,
  size: 'sm' | 'md' = 'sm',
): ComboboxOption[] {
  return accounts.map((a) => {
    const bal = balances?.get(a.id);
    return {
      value: a.id,
      label: a.name,
      icon: <AccountGlyph account={a} size={size} />,
      hint: bal === undefined ? undefined : formatMoney(bal, a.currency),
    };
  });
}
