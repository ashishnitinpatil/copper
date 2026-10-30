import { useEffect, useState } from 'react';
import { DateField } from '@/components/ui/DateField';
import { accountOptions } from '@/components/accountOptions';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Combobox } from '@/components/ui/Combobox';
import { Modal } from '@/components/ui/Modal';
import { useDB } from '@/db/DBProvider';
import { deleteTransaction } from '@/db/queries/transactions';
import {
  createLoanPayment,
  getLoanPayment,
  loanTerms,
  owedBefore,
  updateLoanPayment,
  updateLoanTerms,
} from '@/db/queries/loans';
import type { Account } from '@/db/types';
import { formatMoney, fromMinor, parseAmount } from '@/lib/money';
import { toDateString } from '@/lib/dates';
import { formatRate, impliedRate, splitPayment } from '@/features/loans/loanMath';
import { EntityHistory } from './Activity';
import { offerUndo } from './Shortcuts';

interface Props {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  /** Record a new payment on this loan… */
  loanId?: string | null;
  /** …or edit the payment this entry (any part of it) belongs to. */
  paymentId?: string | null;
}

// Interest this far from what the loan's rate gives (and at least one whole
// unit of money) suggests the rate has changed. Closer than that is ordinary:
// banks count days, so a 31-day month charges more than a 28-day one.
const RATE_HINT_SHARE = 0.1;

/**
 * A payment on a loan: the principal (what you owe goes down by it) and the
 * interest (a cost, in Reports under Loan interest), filled in from the loan's
 * terms and corrected from the statement.
 */
export function LoanPaymentModal({ open, onClose, accounts, loanId, paymentId }: Props) {
  const db = useDB();
  const [loanAcctId, setLoanAcctId] = useState('');
  const [fromId, setFromId] = useState('');
  const [date, setDate] = useState(toDateString());
  const [principalInput, setPrincipalInput] = useState('');
  const [interestInput, setInterestInput] = useState('');
  const [note, setNote] = useState('');
  // What was owed just before this payment, for the interest the rate implies.
  const [owed, setOwed] = useState<number | null>(null);
  // The payment's ids (editing), to leave it out of what was owed before it.
  const [ownIds, setOwnIds] = useState<string[]>([]);
  const [automatic, setAutomatic] = useState(false);
  const [keepAsMonthly, setKeepAsMonthly] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const editing = !!paymentId;
  const key = paymentId ?? loanId ?? '';

  const loan = accounts.find((a) => a.id === loanAcctId);
  const currency = accounts.find((a) => a.id === fromId)?.currency ?? loan?.currency ?? 'USD';

  // Fill the form as it opens.
  useEffect(() => {
    if (!open) return;
    setLoadedFor(null);
    let cancelled = false;
    void (async () => {
      if (paymentId) {
        const p = await getLoanPayment(db, paymentId);
        if (!p || cancelled) return;
        const cur = accounts.find((a) => a.id === p.from.account_id)?.currency ?? 'USD';
        setLoanAcctId(p.to.account_id);
        setFromId(p.from.account_id);
        setDate(p.from.occurred_on);
        setPrincipalInput(String(fromMinor(Math.abs(p.from.amount_minor), cur)));
        setInterestInput(p.interest ? String(fromMinor(Math.abs(p.interest.amount_minor), cur)) : '');
        setNote(p.from.note ?? '');
        setOwnIds([p.from.id, p.to.id, ...(p.interest ? [p.interest.id] : [])]);
        setAutomatic(p.from.id.startsWith('loan:'));
      } else if (loanId) {
        const l = accounts.find((a) => a.id === loanId);
        if (!l) return;
        const today = toDateString();
        const from =
          l.pay_from_account_id ??
          accounts.find((a) => a.type !== 'loan' && !a.archived_at && a.currency === l.currency)?.id ??
          '';
        const cur = accounts.find((a) => a.id === from)?.currency ?? l.currency;
        const split = splitPayment(await owedBefore(db, l, today), loanTerms(l));
        if (cancelled) return;
        const show = (n: number) => (l.loan_payment_minor ? String(fromMinor(n, cur)) : '');
        setLoanAcctId(l.id);
        setFromId(from);
        setDate(today);
        setPrincipalInput(show(split.principal));
        setInterestInput(show(split.interest));
        setNote('');
        setOwnIds([]);
        setAutomatic(false);
      }
      setKeepAsMonthly(true);
      setLoadedFor(key);
    })();
    return () => {
      cancelled = true;
    };
    // Re-seed only when the dialog opens, not on every accounts refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paymentId, loanId, db]);

  // What was owed before the payment's date, for the rate check below.
  useEffect(() => {
    if (!open || !loan) return;
    let cancelled = false;
    void owedBefore(db, loan, date, ownIds).then((o) => !cancelled && setOwed(o));
    return () => {
      cancelled = true;
    };
  }, [open, loan, date, ownIds, db]);

  const principal = parseAmount(principalInput, currency) ?? 0;
  const interest = parseAmount(interestInput || '0', currency) ?? 0;
  const total = principal + interest;
  const ready = loadedFor === key && !!loan;
  const valid = ready && !!fromId && principal > 0 && interest >= 0;

  // Interest well off what the loan's rate gives: offer to record the rate that matches.
  const terms = loan ? loanTerms(loan) : null;
  const expected = terms && owed != null && owed > 0 ? splitPayment(owed, terms).interest : null;
  const off =
    expected != null &&
    terms!.rateBp > 0 &&
    interest > 0 &&
    Math.abs(interest - expected) >= Math.max(expected * RATE_HINT_SHARE, 100);
  const suggestedRate = off ? impliedRate(interest, terms!.method === 'flat' ? terms!.principal : owed!) : null;
  // An automatic payment corrected to a different total: next month's should match.
  const newMonthly = editing && automatic && loan?.loan_payment_minor != null && total > 0 && total !== loan.loan_payment_minor;

  const handleSave = async () => {
    if (!valid || !loan) return;
    setSubmitting(true);
    try {
      const input = {
        loan_account_id: loan.id,
        from_account_id: fromId,
        principal_minor: principal,
        interest_minor: interest,
        occurred_on: date,
        note: note.trim() || null,
      };
      if (paymentId) await updateLoanPayment(db, paymentId, input);
      else await createLoanPayment(db, input);
      if (newMonthly && keepAsMonthly) await updateLoanTerms(db, loan.id, { payment_minor: total });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!paymentId) return;
    await deleteTransaction(db, paymentId);
    offerUndo(`Deleted payment ${formatMoney(total, currency)}`);
    onClose();
  };

  // The same figure leaves the account and pays down the loan: same currency only.
  const payFrom = accountOptions(
    accounts.filter((a) => a.type !== 'loan' && !a.archived_at && a.currency === loan?.currency),
  );

  return (
    <Modal open={open} onClose={onClose} title={loan ? `${editing ? 'Payment' : 'Pay'} · ${loan.name}` : 'Loan payment'}>
      {!ready ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          <Combobox label="Paid from" value={fromId} onChange={setFromId} options={payFrom} />
          <DateField label="Date" value={date} onChange={setDate} />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Principal"
              inputMode="decimal"
              value={principalInput}
              onChange={(e) => setPrincipalInput(e.target.value)}
              placeholder="0.00"
            />
            <Input
              label="Interest"
              inputMode="decimal"
              value={interestInput}
              onChange={(e) => setInterestInput(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="flex items-baseline justify-between rounded-lg bg-slate-900/60 px-3 py-2 text-sm">
            <span className="text-slate-400">Total paid</span>
            <span className="font-semibold tabular-nums text-slate-50">{formatMoney(total, currency)}</span>
          </div>
          <p className="text-xs text-slate-500">
            Filled in from the loan’s terms. If your statement splits it differently, type its figures.
          </p>
          {off && suggestedRate != null && (
            <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-slate-300">
              That’s {interest > expected! ? 'more' : 'less'} interest than {formatRate(terms!.rateBp)} gives (
              {formatMoney(expected!, currency)}). If your rate has changed, record it so later payments split
              right.
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void updateLoanTerms(db, loan!.id, { rate_bp: suggestedRate })}
                >
                  Change the rate to {formatRate(suggestedRate)}
                </Button>
              </div>
            </div>
          )}
          {newMonthly && (
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={keepAsMonthly}
                onChange={(e) => setKeepAsMonthly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-brand-500 focus:ring-brand-400"
              />
              Pay {formatMoney(total, currency)} each month from now on
            </label>
          )}
          <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          <div className="flex items-center justify-between gap-2 pt-2">
            {editing ? (
              <Button variant="danger" onClick={handleDelete} disabled={submitting}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!valid || submitting}>
                {editing ? 'Save' : 'Record payment'}
              </Button>
            </div>
          </div>
          {editing && ownIds[0] && <EntityHistory entity="transaction" entityId={ownIds[0]} />}
        </div>
      )}
    </Modal>
  );
}
