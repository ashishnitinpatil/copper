import { useCallback, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AccountGlyph } from '@/components/accountOptions';
import { useQuery } from '@/db/useQuery';
import type { Account } from '@/db/types';
import { getCardBills, statementName, type CardBill } from '@/features/creditCards/statementEngine';
import { listCardPlans } from '@/db/queries/cardPlans';
import { instalmentAmount, planProgress, progressLabel, unbilledAfter } from '@/features/creditCards/plans';
import { Modal } from '@/components/ui/Modal';
import { useNavigate } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { parseDateString, toDateString } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { TransferModal, type TransferDraft } from './TransferModal';

export function useCardBills() {
  return useQuery<CardBill[]>(
    useCallback((d) => getCardBills(d), []),
    { deps: ['accounts', 'transactions', 'card_plans'], cacheKey: 'card-bills' },
  );
}

/** Per card: how many instalment plans are still running, and what they have left to bill. */
export function useCardPlanTotals() {
  return useQuery<Map<string, { count: number; left: number }>>(
    useCallback(async (d) => {
      const today = toDateString();
      const totals = new Map<string, { count: number; left: number }>();
      for (const plan of await listCardPlans(d)) {
        const left = unbilledAfter(plan, plan.statement_day, today);
        if (left <= 0) continue;
        const t = totals.get(plan.card_id) ?? { count: 0, left: 0 };
        totals.set(plan.card_id, { count: t.count + 1, left: t.left + left });
      }
      return totals;
    }, []),
    { deps: ['accounts', 'transactions', 'card_plans'], cacheKey: 'card-plan-totals' },
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
  const amount = formatMoney(bill.amount, bill.account.currency);
  return bill.paid
    ? `Payment recorded for the ${shortDate(bill.statementDate)} statement of ${amount}`
    : `${amount} on the ${shortDate(bill.statementDate)} statement · no payment yet`;
}

/** Where a card's bill is paid from (its own setting, else the main account), for the bill's amount. */
export function payDraft(card: Account, accounts: Account[], bill?: CardBill): TransferDraft {
  const from =
    accounts.find((a) => a.id === card.pay_from_account_id && !a.archived_at) ??
    accounts.find((a) => a.is_main === 1 && a.id !== card.id && !a.archived_at);
  return {
    fromId: from?.id ?? '',
    toId: card.id,
    // Named like people write it on the payment: "August - September statement".
    note: bill && card.statement_day ? statementName(bill.statementDate, card.statement_day) : `${card.name} bill`,
    ...(bill && !bill.paid && from?.currency === card.currency ? { amountMinor: bill.amount } : {}),
  };
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
              <Button size="sm" variant="secondary" onClick={() => setPaying(payDraft(bill.account, accounts, bill))}>
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

/**
 * A card's instalment plans: how far along each is and what's left to bill,
 * running ones first. Tapping one shows its entry in Transactions.
 */
export function CardPlansModal({ card, onClose }: { card: Account | null; onClose: () => void }) {
  const navigate = useNavigate();
  const cardId = card?.id ?? '';
  const plans = useQuery(
    useCallback((d) => (cardId ? listCardPlans(d, cardId) : Promise.resolve([])), [cardId]),
    { deps: ['card_plans', 'transactions', 'accounts'] },
  );
  const today = toDateString();
  const rows = (plans.data ?? [])
    .map((plan) => ({ plan, progress: planProgress(plan, plan.statement_day, today) }))
    .sort((a, b) => Number(a.progress.left <= 0) - Number(b.progress.left <= 0));
  const money = (n: number) => formatMoney(n, card?.currency ?? 'USD');
  return (
    <Modal open={!!card} onClose={onClose} title={card ? `Instalment plans · ${card.name}` : 'Instalment plans'}>
      <ul className="divide-y divide-slate-800">
        {rows.map(({ plan, progress }) => (
          <li key={plan.id}>
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate(`/transactions?account=${plan.card_id}&from=${plan.tx_date}&to=${plan.tx_date}`);
              }}
              className="flex w-full items-start justify-between gap-3 py-3 text-left hover:bg-slate-800/40"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-100">
                  {plan.tx_note || 'Card purchase'}
                  <span className="font-normal text-slate-500"> · {shortDate(plan.tx_date)}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-brand-300">
                  <CalendarClock aria-hidden className="h-3 w-3" />
                  {progressLabel(progress)}
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {progress.left > 0 ? (
                    <>
                      {money(progress.left)} still to be billed
                      {progress.next ? ` · next on the ${shortDate(progress.next)} statement` : ''}
                    </>
                  ) : (
                    'Nothing left to bill'
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums text-slate-100">{money(instalmentAmount(plan))}</div>
                <div className="text-[11px] text-slate-500">a month</div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
