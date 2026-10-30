import type { TransactionWithMeta } from '@/db/queries/transactions';
import { formatMoney } from '@/lib/money';

/** "Cash → HDFC" for a transfer row joined to its other leg; null otherwise. */
export function transferRoute(t: TransactionWithMeta): string | null {
  if (t.kind !== 'transfer' || !t.peer_account_name) return null;
  return t.amount_minor < 0 ? `${t.account_name} → ${t.peer_account_name}` : `${t.peer_account_name} → ${t.account_name}`;
}

/** Part of a payment into a loan: the transfer paying it down, or its interest. */
export function isLoanPayment(t: TransactionWithMeta): boolean {
  if (t.payment_of) return true;
  if (t.kind !== 'transfer') return false;
  return t.amount_minor < 0 ? t.peer_account_type === 'loan' : t.account_type === 'loan';
}

/** "$800.00 principal · $200.00 interest" for a loan payment shown with its interest. */
export function paymentSplit(t: TransactionWithMeta): string | null {
  if (!t.interest_minor) return null;
  return `${formatMoney(Math.abs(t.amount_minor), t.account_currency)} principal · ${formatMoney(Math.abs(t.interest_minor), t.account_currency)} interest`;
}

/**
 * A transfer shown once for both accounts: money moved, not spent, so no sign
 * or colour. Across currencies, the amount that arrived is shown under it.
 */
export function TransferAmount({ t, className = '' }: { t: TransactionWithMeta; className?: string }) {
  // A loan payment's interest left the same account with it.
  const sent = Math.abs(t.amount_minor) + Math.abs(t.interest_minor ?? 0);
  const crossCurrency = !!t.peer_account_currency && t.peer_account_currency !== t.account_currency && t.peer_amount_minor != null;
  return (
    <div className="shrink-0 text-right tabular-nums">
      <div className={`text-sm font-semibold text-slate-300 ${className}`}>{formatMoney(sent, t.account_currency)}</div>
      {crossCurrency && (
        <div className="text-xs text-slate-500">→ {formatMoney(Math.abs(t.peer_amount_minor!), t.peer_account_currency!)}</div>
      )}
    </div>
  );
}
