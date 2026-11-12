import { useCallback, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AccountGlyph } from '@/components/accountOptions';
import { useQuery } from '@/db/useQuery';
import type { Account } from '@/db/types';
import { getCardBills, type CardBill } from '@/features/creditCards/statementEngine';
import { parseDateString } from '@/lib/dates';
import { TransferModal, type TransferDraft } from './TransferModal';

export function useCardBills() {
  return useQuery<CardBill[]>(
    useCallback((d) => getCardBills(d), []),
    { deps: ['accounts', 'transactions'], cacheKey: 'card-bills' },
  );
}

const shortDate = (s: string) => parseDateString(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** "Due in 6 days", "Due today", "2 days overdue" — with its colour. */
export function dueText(bill: CardBill): { text: string; tone: string } {
  const days = bill.daysUntilDue;
  if (days == null || !bill.dueDate) return { text: 'No due day set', tone: 'text-slate-400' };
  if (days < 0) return { text: `${-days} ${days === -1 ? 'day' : 'days'} overdue`, tone: 'text-danger font-semibold' };
  const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  return { text: `Due ${when} · ${shortDate(bill.dueDate)}`, tone: days <= 5 ? 'text-warning' : 'text-slate-400' };
}

export function billNote(bill: CardBill): string {
  return bill.paid
    ? `Payment recorded for the ${shortDate(bill.statementDate)} statement`
    : `No payment yet for the ${shortDate(bill.statementDate)} statement`;
}

/** Where a card's bill is paid from: its own setting, else the main account. */
export function payDraft(card: Account, accounts: Account[]): TransferDraft {
  const from =
    accounts.find((a) => a.id === card.pay_from_account_id && !a.archived_at) ??
    accounts.find((a) => a.is_main === 1 && a.id !== card.id && !a.archived_at);
  return { fromId: from?.id ?? '', toId: card.id, note: `${card.name} bill` };
}

/**
 * The Dashboard's reminder: cards whose latest statement hasn't had a payment
 * yet. Shows nothing when every bill is paid.
 */
export function CardBillsDue({ accounts }: { accounts: Account[] }) {
  const bills = (useCardBills().data ?? []).filter((b) => !b.paid);
  const [paying, setPaying] = useState<TransferDraft | null>(null);
  if (bills.length === 0) return null;
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold text-slate-300">
        {bills.length === 1 ? 'Card bill to pay' : 'Card bills to pay'}
      </h3>
      <ul className="divide-y divide-slate-800">
        {bills.map((bill) => {
          const due = dueText(bill);
          return (
            <li key={bill.account.id} className="flex items-center gap-3 py-2.5">
              <AccountGlyph account={bill.account} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-50">{bill.account.name}</div>
                <div className={`text-xs ${due.tone}`}>{due.text}</div>
                <div className="text-[11px] text-slate-500">{billNote(bill)}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setPaying(payDraft(bill.account, accounts))}>
                Pay
              </Button>
            </li>
          );
        })}
      </ul>
      <TransferModal open={!!paying} draft={paying} accounts={accounts} onClose={() => setPaying(null)} />
    </Card>
  );
}
