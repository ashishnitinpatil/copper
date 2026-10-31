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
  return !!(t.amount_minor < 0 ? t.peer_is_loan : t.account_is_loan);
}

/** "$800.00 principal · $200.00 interest · $15.00 insurance" for a loan payment shown with its interest. */
export function paymentSplit(t: TransactionWithMeta): string | null {
  if (!t.interest_minor) return null;
  const money = (n: number) => formatMoney(Math.abs(n), t.account_currency);
  const insurance = t.insurance_minor ?? 0;
  const fee = t.fee_minor ?? 0;
  const interest = t.interest_minor - insurance - fee;
  const parts = [`${money(t.amount_minor)} principal`];
  if (interest || (!insurance && !fee)) parts.push(`${money(interest)} interest`);
  if (insurance) parts.push(`${money(insurance)} insurance`);
  if (fee) parts.push(`${money(fee)} fees`);
  return parts.join(' · ');
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
