import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ACCOUNT_ICON_GROUPS, CATEGORY_ICON_GROUPS, IconPicker } from '@/components/ui/IconPicker';
import { AccountGlyph, accountOptions, useAccountBalances } from '@/components/accountOptions';
import { DateField } from '@/components/ui/DateField';
import { PageShell } from './PageShell';
import { Button } from '@/components/ui/Button';
import { InfoHint } from '@/components/ui/InfoHint';
import { Card, EmptyState } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useDB } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import {
  archiveAccount,
  createAccount,
  listAccounts,
  unarchiveAccount,
  updateAccount,
  type AccountInput,
} from '@/db/queries/accounts';
import { mergeAccount, previewAccountMerge } from '@/db/queries/merge';
import { MergeInto } from '@/components/MergeInto';
import type { Account, AccountType } from '@/db/types';
import { parseAmount, fromMinor, formatMoney, CURRENCY_OPTIONS } from '@/lib/money';
import { Money } from '@/components/ui/Money';
import { Combobox } from '@/components/ui/Combobox';
import { toDateString } from '@/lib/dates';
import { listCategories } from '@/db/queries/categories';
import { createTransaction, createTransfer } from '@/db/queries/transactions';
import { Glyph } from '@/components/ui/Glyph';
import { useDefaultCurrency } from './AppSettingsProvider';
import {
  dueDateAfter,
  flatEquivalent,
  formatRate,
  interestBefore,
  monthlyPayment,
  nextDueDate,
  reducingEquivalent,
  remainingSchedule,
  type InterestMethod,
} from '@/features/loans/loanMath';
import { getLoanStats, loanTerms, type LoanStats } from '@/db/queries/loans';
import { LoanPaymentModal } from './LoanPaymentModal';
import { TransferModal, type TransferDraft } from './TransferModal';
import { billNote, dueText, payDraft, useCardBills } from './CardBills';
import type { CardBill } from '@/features/creditCards/statementEngine';
import { getSavedOrder, ORDER_OPTIONS, saveOrder, useSortedAccounts, type AccountOrder } from '@/components/accountOrder';

// Offered on top of the default (the account type's own icon).

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'loan', label: 'Loan' },
  { value: 'other', label: 'Other' },
];

type CountedFilter = 'all' | 'counted' | 'not-counted';

// What you have, then what you owe. Cash and wallets are both everyday money.
const ACCOUNT_GROUPS: { label: string; types: AccountType[] }[] = [
  { label: 'Bank accounts', types: ['bank'] },
  { label: 'Cash & wallets', types: ['cash', 'wallet'] },
  { label: 'Credit cards', types: ['credit_card'] },
  { label: 'Loans', types: ['loan'] },
  { label: 'Other', types: ['other'] },
];

const COUNTED_FILTERS: { value: CountedFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'counted', label: 'In total' },
  { value: 'not-counted', label: 'Not counted' },
];

export function Accounts() {
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);
  const [counted, setCounted] = useState<CountedFilter>('all');
  const [order, setOrder] = useState<AccountOrder>(getSavedOrder);

  const accountsQuery = useQuery(useCallback((db) => listAccounts(db, true), []), {
    deps: ['accounts'],
  });
  const balances = useAccountBalances();
  const loanStats = useQuery(useCallback((db) => getLoanStats(db), []), { deps: ['transactions'] });
  const paidOnLoans = useMemo(
    () => new Map((loanStats.data ?? []).map((l) => [l.account_id, l])),
    [loanStats.data],
  );
  const [payingLoan, setPayingLoan] = useState<string | null>(null);
  const [payingCard, setPayingCard] = useState<TransferDraft | null>(null);
  const billsQuery = useCardBills();
  const bills = useMemo(() => new Map((billsQuery.data ?? []).map((b) => [b.account.id, b])), [billsQuery.data]);

  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const archived = accounts.filter((a) => a.archived_at);
  const unarchived = useMemo(() => accounts.filter((a) => !a.archived_at), [accounts]);
  const anyNotCounted = unarchived.some((a) => a.include_in_total === 0);
  const filter = anyNotCounted ? counted : 'all';

  const shown = useMemo(
    () => unarchived.filter((a) => filter === 'all' || (filter === 'counted') === (a.include_in_total === 1)),
    [unarchived, filter],
  );
  const active = useSortedAccounts(shown, order, balances);
  // Headings only once there's more than one kind.
  const groups = ACCOUNT_GROUPS.map((g) => ({ ...g, accounts: active.filter((a) => g.types.includes(a.type)) })).filter(
    (g) => g.accounts.length > 0,
  );

  const chooseOrder = (next: AccountOrder) => {
    setOrder(next);
    saveOrder(next);
  };

  return (
    <PageShell
      title="Accounts"
      subtitle="Cash, bank, credit cards and wallets"
      actions={<Button onClick={() => setCreating(true)}>+ New account</Button>}
    >
      {unarchived.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {anyNotCounted && (
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="group" aria-label="Show">
              {COUNTED_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={filter === f.value}
                  onClick={() => setCounted(f.value)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                    filter === f.value ? 'bg-brand-500 text-slate-950' : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
            <span className="sr-only sm:not-sr-only">Order by</span>
            <select
              value={order}
              onChange={(e) => chooseOrder(e.target.value as AccountOrder)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
            >
              {ORDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {unarchived.length === 0 && !accountsQuery.loading && (
        <EmptyState
          title="No active accounts"
          description="Add your first account to start tracking expenses."
          action={<Button onClick={() => setCreating(true)}>+ New account</Button>}
        />
      )}

      {groups.map((g) => (
        <section key={g.label} className="space-y-2">
          {groups.length > 1 && (
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {g.label} <span className="font-normal">· {g.accounts.length}</span>
            </h2>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.accounts.map((acct) => (
              <AccountCard
                key={acct.id}
                account={acct}
                balanceMinor={balances.get(acct.id) ?? acct.opening_balance_minor}
                onEdit={() => setEditing(acct)}
                // The heading already names the type, unless the group mixes them.
                showType={groups.length === 1 || g.types.length > 1}
                paid={paidOnLoans.get(acct.id)}
                onPay={() => setPayingLoan(acct.id)}
                bill={bills.get(acct.id)}
                onPayBill={() => setPayingCard(payDraft(acct, accounts))}
              />
            ))}
          </div>
        </section>
      ))}

      {archived.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Archived</h3>
          <ul className="space-y-2 text-sm text-slate-400">
            {archived.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <AccountGlyph account={a} />
                  {a.name}
                </span>
                <button
                  className="text-xs text-brand-400 hover:underline"
                  onClick={() => setEditing(a)}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <TransferModal open={!!payingCard} draft={payingCard} accounts={unarchived} onClose={() => setPayingCard(null)} />
      <LoanPaymentModal
        open={payingLoan !== null}
        loanId={payingLoan}
        accounts={unarchived}
        onClose={() => setPayingLoan(null)}
      />
      <AccountFormModal
        open={creating}
        accounts={unarchived}
        onClose={() => setCreating(false)}
      />
      <AccountFormModal
        open={editing !== null}
        accounts={unarchived}
        existing={editing}
        onClose={() => setEditing(null)}
      />
    </PageShell>
  );
}

interface AccountCardProps {
  account: Account;
  balanceMinor: number;
  onEdit: () => void;
  showType: boolean;
  paid?: LoanStats;
  onPay: () => void;
  /** A card's latest bill, when it owed money at its statement. */
  bill?: CardBill;
  onPayBill: () => void;
}

function AccountCard({ account, balanceMinor, onEdit, showType, paid, onPay, bill, onPayBill }: AccountCardProps) {
  // A loan with its terms filled in gets the loan view. Without them (say, a
  // debt between friends brought over from Monefy) it's a plain balance, which
  // may run either way.
  const isLoan =
    account.type === 'loan' &&
    (account.loan_principal_minor != null || account.loan_payment_minor != null || account.loan_rate_bp != null);
  const limit = account.type === 'credit_card' ? (account.credit_limit_minor ?? 0) : 0;
  // A card in credit (paid more than owed) has more than its limit to spend.
  const available = limit + balanceMinor;
  // The usage row has its own "why" button, so it sits outside the card's
  // edit button (a button can't hold another).
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 transition hover:-translate-y-0.5 hover:border-brand-500 hover:bg-slate-900/70">
      <button onClick={onEdit} className="block w-full rounded-xl p-4 text-left">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <AccountGlyph account={account} size="md" />
            <div className="min-w-0">
              {showType && (
                <div className="text-xs uppercase tracking-wide text-slate-500">{account.type.replace('_', ' ')}</div>
              )}
              <div className="mt-0.5 truncate text-base font-semibold text-slate-50">{account.name}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {account.include_in_total === 0 && (
              <span
                title="Not included in your total balance"
                className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"
              >
                not counted
              </span>
            )}
            {account.is_main === 1 && (
              <span className="rounded-md bg-brand-500 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-950">
                Main
              </span>
            )}
          </div>
        </div>
        {limit > 0 ? (
          // With a limit, a card reads the way the bank shows it: what you owe,
          // and what you can still spend.
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-slate-500">Outstanding</div>
              <Money
                minor={Math.max(0, -balanceMinor)}
                currency={account.currency}
                className={`block text-2xl font-semibold tabular-nums ${balanceMinor < 0 ? 'text-clay-400' : 'text-slate-50'}`}
              />
            </div>
            <div>
              <div className={`text-xs ${available < 0 ? 'text-danger' : 'text-slate-500'}`}>
                {available < 0 ? 'Over limit by' : 'Available'}
              </div>
              <Money
                minor={Math.abs(available)}
                currency={account.currency}
                className={`block text-2xl font-semibold tabular-nums ${available < 0 ? 'text-danger' : 'text-slate-50'}`}
              />
            </div>
          </div>
        ) : isLoan ? (
          <LoanSummary loan={account} owed={Math.max(0, -balanceMinor)} paid={paid} />
        ) : (
          <Money
            minor={balanceMinor}
            currency={account.currency}
            className={`mt-3 block text-2xl font-semibold tabular-nums ${balanceMinor < 0 ? 'text-clay-400' : 'text-slate-50'}`}
          />
        )}
        {bill && !bill.paid ? (
          <div className="mt-2 text-xs">
            <span className={dueText(bill).tone}>{dueText(bill).text}</span>
            <span className="block text-slate-500">{billNote(bill)}</span>
          </div>
        ) : bill ? (
          <div className="mt-2 text-xs text-slate-500">{billNote(bill)}</div>
        ) : account.type === 'credit_card' && !account.statement_day ? (
          <div className="mt-2 text-xs text-slate-500">Add its statement day to be reminded of unpaid bills</div>
        ) : account.type === 'credit_card' && account.due_day && (
          <div className="mt-2 text-xs text-slate-500">
            Payment due day {account.due_day}
            {account.statement_day && ` · Statement closes day ${account.statement_day}`}
          </div>
        )}
      </button>
      {limit > 0 && (
        <div className="-mt-2 px-4 pb-4">
          <LimitUsage owed={Math.max(0, -balanceMinor)} limit={limit} />
        </div>
      )}
      <div className="-mt-1 flex items-center gap-3 px-4 pb-4">
        {isLoan && balanceMinor < 0 && (
          <Button size="sm" variant="secondary" onClick={onPay}>
            Record payment
          </Button>
        )}
        {bill && !bill.paid && (
          <Button size="sm" variant="secondary" onClick={onPayBill}>
            Pay bill
          </Button>
        )}
        <Link
          to={`/transactions?account=${account.id}`}
          className="text-sm font-medium text-brand-400 hover:text-brand-300"
        >
          Transactions →
        </Link>
      </div>
    </div>
  );
}

const monthYear = (date: string) =>
  new Date(date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

/** What's left on a loan, how it's going, and what the borrowing costs. */
function LoanSummary({ loan, owed, paid }: { loan: Account; owed: number; paid?: LoanStats }) {
  const terms = loanTerms(loan);
  const interestPaid = paid?.interest_paid ?? 0;
  const insurancePaid = paid?.insurance_paid ?? 0;
  const feesPaid = paid?.fees_paid ?? 0;
  // Added part-way through: roughly what went on interest before then.
  const before = interestBefore(Math.max(0, -loan.opening_balance_minor), terms, loan.loan_term_months);
  const money = (n: number) => formatMoney(n, loan.currency);
  const paidShare = loan.loan_principal_minor ? Math.min(1, Math.max(0, 1 - owed / loan.loan_principal_minor)) : null;
  const schedule = terms.payment > 0 && owed > 0 ? remainingSchedule(owed, terms) : null;
  const payoff =
    schedule && loan.due_day
      ? dueDateAfter(nextDueDate(toDateString(), loan.due_day), schedule.payments - 1, loan.due_day)
      : null;
  const months = loan.loan_term_months;
  return (
    <div className="mt-3 space-y-2">
      <div>
        <div className="text-xs text-slate-500">{owed > 0 ? 'Still owed' : 'Paid off'}</div>
        <Money minor={owed} currency={loan.currency} className="block text-2xl font-semibold tabular-nums text-clay-400" />
      </div>
      {paidShare != null && (
        <div>
          <div
            role="meter"
            aria-label="Paid off"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(paidShare * 100)}
            className="h-1.5 overflow-hidden rounded-full bg-slate-800"
          >
            <div className="h-full rounded-full bg-mint-400" style={{ width: `${paidShare * 100}%` }} />
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {Math.round(paidShare * 100)}% of {money(loan.loan_principal_minor!)} paid off
          </div>
        </div>
      )}
      {terms.payment > 0 && owed > 0 && (
        <div className="text-xs text-slate-400">
          {money(terms.payment)} a month
          {schedule
            ? ` · ${schedule.payments} ${schedule.payments === 1 ? 'payment' : 'payments'} left${payoff ? ` · paid off ${monthYear(payoff)}` : ''}`
            : ' · doesn’t cover the interest'}
        </div>
      )}
      {terms.rateBp > 0 && months ? (
        <div className="text-xs text-slate-400">{otherRate(terms.method, terms.rateBp, months)}</div>
      ) : null}
      {(interestPaid > 0 || before != null || schedule) && (
        <div className="text-xs text-slate-400">
          Interest paid {money(interestPaid)}
          {before != null && ` · about ${money(before)} before you added it here`}
          {schedule && ` · about ${money(schedule.interest)} to go`}
        </div>
      )}
      {(insurancePaid > 0 || feesPaid > 0) && (
        <div className="text-xs text-slate-400">
          {[insurancePaid > 0 && `Insurance paid ${money(insurancePaid)}`, feesPaid > 0 && `Fees paid ${money(feesPaid)}`]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}
    </div>
  );
}

// Using much of a card's limit tends to lower a credit score; past these
// shares the bar warns, then turns red.
const USAGE_WARN = 0.6;
const USAGE_HIGH = 0.9;

function LimitUsage({ owed, limit }: { owed: number; limit: number }) {
  const share = owed / limit;
  const pct = Math.round(share * 100);
  const tone = share >= USAGE_HIGH ? 'danger' : share >= USAGE_WARN ? 'warning' : null;
  return (
    <div>
      <div
        role="meter"
        aria-label="Credit limit used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(pct, 100)}
        className="h-1.5 overflow-hidden rounded-full bg-slate-800"
      >
        <div
          className={`h-full rounded-full ${tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-slate-500'}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span className={`text-xs ${tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-slate-500'}`}>
          {pct}% of limit used
          {tone && ' · high use can lower your credit score'}
        </span>
        <InfoHint label="Why the colours" title="Credit limit used">
          Lenders and credit bureaus look at how much of your card limits you use. Lower is
          usually better: under about 30% is commonly seen as healthy. The bar turns amber from
          60% and red from 90%, where it tends to weigh on a credit score most. Paying the card
          down before the statement closes lowers the amount that gets reported.
        </InfoHint>
      </div>
    </div>
  );
}

interface AccountFormModalProps {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  existing?: Account | null;
}

function AccountFormModal({ open, onClose, accounts, existing }: AccountFormModalProps) {
  const db = useDB();
  const defaultCurrency = useDefaultCurrency();
  const [form, setForm] = useState<FormState>(() =>
    emptyForm(defaultCurrency),
  );
  const [submitting, setSubmitting] = useState(false);
  const [mergeImpact, setMergeImpact] = useState<number | null>(null);

  const title = existing ? 'Edit account' : 'New account';

  // Fill the form as the dialog opens, during render: an effect would first
  // show the last account's values, and re-running it later (the default
  // currency is re-derived after each save) would wipe what's being typed.
  const [shownFor, setShownFor] = useState<Account | null | undefined>(undefined);
  const openedFor = open ? (existing ?? null) : undefined;
  if (openedFor !== shownFor) {
    setShownFor(openedFor);
    if (open) setForm(existing ? toForm(existing) : emptyForm(defaultCurrency));
  }

  useEffect(() => {
    if (!open || !existing) return;
    setMergeImpact(null);
    previewAccountMerge(db, existing.id).then(setMergeImpact);
  }, [open, existing, db]);

  const update = useCallback(<K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  // A loan shows what's owed as a plain amount, other accounts their balance:
  // moving between them flips the figure so the balance itself stays put.
  const changeType = (type: AccountType) =>
    setForm((f) => {
      const flips = (f.type === 'loan') !== (type === 'loan');
      const n = parseAmount(f.opening_input, f.currency);
      const opening_input = flips && n ? String(fromMinor(-n, f.currency)) : f.opening_input;
      // A new loan stays out of the total balance, as the checkbox below advises.
      const include_in_total = !existing && flips ? type !== 'loan' : f.include_in_total;
      return { ...f, type, opening_input, include_in_total };
    });

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      const isLoan = form.type === 'loan';
      const loan = loanFromForm(form);
      // A loan's balance is what's still owed, entered as a plain amount; a new
      // loan with it left empty owes everything borrowed.
      const opening = parseAmount(form.opening_input || '0', form.currency) ?? 0;
      const owedInput = form.opening_input.trim() ? opening : (loan.principal ?? 0);
      // A new loan's money recorded going somewhere: that entry makes it owed,
      // so the loan starts from nothing.
      const proceeds = isLoan && !existing && owedInput > 0 && (form.proceeds_to || form.proceeds_category);
      const payload: AccountInput = {
        name: form.name.trim(),
        type: form.type,
        currency: form.currency,
        opening_balance_minor: isLoan ? (proceeds ? 0 : -owedInput) : opening,
        loan_principal_minor: loan.principal,
        loan_rate_bp: loan.rateBp,
        loan_interest_method: loan.method,
        loan_term_months: loan.months,
        loan_payment_minor: loan.payment,
        // Switched on: payments due from today on are added; left on: carry on where it was.
        loan_autopay_from:
          form.loan_autopay && form.due_day && form.pay_from_account_id && loan.payment
            ? (existing?.loan_autopay_from ?? toDateString())
            : null,
        is_main: form.is_main,
        include_in_total: form.include_in_total,
        credit_limit_minor: form.limit_input.trim() ? parseAmount(form.limit_input, form.currency) : null,
        statement_day: form.statement_day ?? null,
        due_day: form.due_day ?? null,
        pay_from_account_id: form.pay_from_account_id ?? null,
        // Carried through unchanged so saving never wipes a colour set elsewhere (e.g. import).
        color: existing?.color ?? null,
        icon: form.icon || null,
        starts_on: form.starts_on,
      };
      if (existing) {
        await updateAccount(db, existing.id, payload);
      } else {
        const id = await createAccount(db, payload);
        if (proceeds && form.proceeds_to) {
          await createTransfer(db, {
            from_account_id: id,
            to_account_id: form.proceeds_to,
            amount_minor: owedInput,
            occurred_on: form.starts_on,
          });
        } else if (proceeds && form.proceeds_category) {
          await createTransaction(db, {
            account_id: id,
            category_id: form.proceeds_category,
            amount_minor: owedInput,
            kind: 'expense',
            occurred_on: form.starts_on,
          });
        }
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!existing) return;
    await archiveAccount(db, existing.id);
    onClose();
  };

  const handleRestore = async () => {
    if (!existing) return;
    await unarchiveAccount(db, existing.id);
    onClose();
  };

  const handleMerge = async (targetId: string) => {
    if (!existing) return;
    await mergeAccount(db, existing.id, targetId);
    onClose();
  };

  const isArchived = !!existing?.archived_at;
  // Merging mixes balances, so only same-currency accounts are valid targets.
  const mergeOptions = existing
    ? accountOptions(accounts.filter((a) => a.id !== existing.id && a.currency === existing.currency))
    : [];

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-3">
        <Input
          label="Name"
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="HDFC Savings"
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Type" value={form.type} onChange={(e) => changeType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Combobox
            label="Currency"
            value={form.currency}
            onChange={(v) => update('currency', v)}
            options={CURRENCY_OPTIONS}
          />
        </div>
        <IconPicker
          value={form.icon ?? ''}
          onChange={(icon) => update('icon', icon)}
          // Account icons first, then every other icon, so the choice isn't limited to a few.
          groups={[...ACCOUNT_ICON_GROUPS, ...CATEGORY_ICON_GROUPS]}
          suggestFrom={form.name}
          defaultOption={<AccountGlyph account={{ icon: null, type: form.type }} />}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={form.type === 'loan' ? 'Still owed' : 'Starting balance'}
            labelHint={
              form.type === 'loan' ? (
                <InfoHint label="About what's still owed" title="Still owed">
                  What you owed on the <span className="font-medium text-slate-300">Balance on</span>{' '}
                  date — the outstanding principal on your statement. For a new loan, leave it empty:
                  it’s the amount borrowed.
                </InfoHint>
              ) : (
                <InfoHint label="About the starting balance" title="Starting balance">
                  The balance on the <span className="font-medium text-slate-300">Balance on</span>{' '}
                  date. Transactions dated before it aren’t counted — move that date earlier to fold in
                  older history.
                </InfoHint>
              )
            }
            value={form.opening_input}
            inputMode="decimal"
            onChange={(e) => update('opening_input', e.target.value)}
            placeholder={form.type === 'loan' && form.loan_principal_input ? form.loan_principal_input : '0.00'}
          />
          <DateField label="Balance on" value={form.starts_on ?? ''} onChange={(v) => update('starts_on', v)} />
        </div>
        {form.type === 'credit_card' && (
          <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-500">
              Billing cycle
              <InfoHint label="How billing affects Cashflow" title="Drives the bill forecast">
                Set a <span className="font-medium text-slate-300">Statement day</span> for
                this card to appear under Upcoming card bills. Its payment is only projected
                into Cashflow once you pick a <span className="font-medium text-slate-300">Pay
                bill from</span> account below.
              </InfoHint>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Statement day"
                type="number"
                min={1}
                max={31}
                value={form.statement_day ?? ''}
                onChange={(e) => update('statement_day', e.target.value ? Number(e.target.value) : null)}
              />
              <Input
                label="Payment due day"
                type="number"
                min={1}
                max={31}
                value={form.due_day ?? ''}
                onChange={(e) => update('due_day', e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <Input
              label="Credit limit"
              inputMode="decimal"
              value={form.limit_input}
              onChange={(e) => update('limit_input', e.target.value)}
            />
            <Combobox
              label="Pay bill from"
              value={form.pay_from_account_id ?? ''}
              onChange={(v) => update('pay_from_account_id', v || null)}
              emptyOption={{ value: '', label: '— None —' }}
              options={accountOptions(
                accounts.filter((a) => a.type !== 'credit_card' && a.id !== existing?.id),
              )}
            />
          </div>
        )}
        {form.type === 'loan' && (
          <LoanTermsFields form={form} update={update} accounts={accounts.filter((a) => a.id !== existing?.id)} />
        )}
        {form.type === 'loan' && !existing && <LoanProceedsFields form={form} update={update} accounts={accounts} />}
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={form.is_main}
            onChange={(e) => update('is_main', e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-brand-500 focus:ring-brand-400"
          />
          Main account (used by default for quick add)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={form.include_in_total}
            onChange={(e) => update('include_in_total', e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-brand-500 focus:ring-brand-400"
          />
          Include in total balance
          <span className="text-xs text-slate-500">
            (turn off for loans or money you don't own)
          </span>
        </label>
        <div className="flex items-center justify-between gap-2 pt-2">
          {existing ? (
            isArchived ? (
              <Button variant="secondary" size="sm" onClick={handleRestore}>
                Restore
              </Button>
            ) : (
              <Button variant="danger" size="sm" onClick={handleArchive}>
                Archive
              </Button>
            )
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !form.name.trim()}>
              {existing ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
        {existing && (
          <MergeInto
            key={existing.id}
            noun="account"
            extras="transfers, linked cards and recurring entries"
            sourceName={existing.name}
            impact={mergeImpact}
            options={mergeOptions}
            onMerge={handleMerge}
          />
        )}
      </div>
    </Modal>
  );
}

interface FormState extends AccountInput {
  opening_input: string;
  limit_input: string;
  loan_principal_input: string;
  loan_rate_input: string;
  loan_method: InterestMethod;
  loan_term_input: string;
  loan_payment_input: string;
  loan_autopay: boolean;
  /** A new loan's money: paid into this account… */
  proceeds_to: string;
  /** …or spent straight on this (an expense category). */
  proceeds_category: string;
  is_main: boolean;
  include_in_total: boolean;
  starts_on: string;
  icon: string;
}

function emptyForm(currency: string): FormState {
  return {
    name: '',
    type: 'cash',
    currency,
    opening_balance_minor: 0,
    is_main: false,
    include_in_total: true,
    credit_limit_minor: null,
    statement_day: null,
    due_day: null,
    pay_from_account_id: null,
    opening_input: '',
    limit_input: '',
    loan_principal_input: '',
    loan_rate_input: '',
    loan_method: 'reducing',
    loan_term_input: '',
    loan_payment_input: '',
    loan_autopay: false,
    proceeds_to: '',
    proceeds_category: '',
    starts_on: toDateString(),
    icon: '',
  };
}

function toForm(a: Account): FormState {
  return {
    name: a.name,
    type: a.type,
    currency: a.currency,
    opening_balance_minor: a.opening_balance_minor,
    is_main: a.is_main === 1,
    include_in_total: a.include_in_total === 1,
    credit_limit_minor: a.credit_limit_minor,
    statement_day: a.statement_day,
    due_day: a.due_day,
    pay_from_account_id: a.pay_from_account_id,
    // A loan shows what's owed as a plain amount (its balance is negative).
    opening_input: String(fromMinor(a.type === 'loan' ? -a.opening_balance_minor : a.opening_balance_minor, a.currency)),
    limit_input: a.credit_limit_minor != null ? String(fromMinor(a.credit_limit_minor, a.currency)) : '',
    loan_principal_input: a.loan_principal_minor != null ? String(fromMinor(a.loan_principal_minor, a.currency)) : '',
    loan_rate_input: a.loan_rate_bp != null ? String(a.loan_rate_bp / 100) : '',
    loan_method: a.loan_interest_method === 'flat' ? 'flat' : 'reducing',
    loan_term_input: a.loan_term_months != null ? String(a.loan_term_months) : '',
    loan_payment_input: a.loan_payment_minor != null ? String(fromMinor(a.loan_payment_minor, a.currency)) : '',
    loan_autopay: a.loan_autopay_from != null,
    proceeds_to: '',
    proceeds_category: '',
    starts_on: a.starts_on,
    icon: a.icon ?? '',
  };
}

/** The loan terms typed into the form; the monthly payment is worked out unless one is typed. */
function loanFromForm(form: FormState) {
  const principal = form.loan_principal_input.trim() ? parseAmount(form.loan_principal_input, form.currency) : null;
  const rate = Number(form.loan_rate_input);
  const rateBp = form.loan_rate_input.trim() && Number.isFinite(rate) && rate >= 0 ? Math.round(rate * 100) : null;
  const months = Math.round(Number(form.loan_term_input)) || null;
  const computed =
    principal && rateBp != null && months ? monthlyPayment(form.loan_method, principal, rateBp, months) : null;
  const typed = form.loan_payment_input.trim() ? parseAmount(form.loan_payment_input, form.currency) : null;
  return { principal, rateBp, method: form.loan_method, months, computed, payment: typed ?? computed };
}

const METHOD_LABEL: Record<InterestMethod, string> = { reducing: 'reducing', flat: 'flat' };

/** The same loan's rate the other way: reducing loans as flat, flat ones as reducing. */
function otherRate(method: InterestMethod, rateBp: number, months: number): string {
  const other: InterestMethod = method === 'flat' ? 'reducing' : 'flat';
  const bp = method === 'flat' ? reducingEquivalent(rateBp, months) : flatEquivalent(rateBp, months);
  return `${formatRate(rateBp)} ${METHOD_LABEL[method]} ≈ ${formatRate(bp)} ${METHOD_LABEL[other]}`;
}

/**
 * Where a new loan's money went: into one of your accounts (a personal loan
 * paid into the bank, a card's balance turned into a loan), or straight into
 * something bought (a car, paid to the dealer). Recorded on the Balance on
 * date, so what's owed comes from that entry.
 */
function LoanProceedsFields({
  form,
  update,
  accounts,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  accounts: Account[];
}) {
  const categories = useQuery(useCallback((d) => listCategories(d), []), { deps: ['categories'] });
  // The same figure leaves the loan and arrives: same currency only.
  const into = accounts.filter((a) => a.type !== 'loan' && !a.archived_at && a.currency === form.currency);
  const intoGone = !!form.proceeds_to && !into.some((a) => a.id === form.proceeds_to);
  useEffect(() => {
    if (intoGone) update('proceeds_to', '');
  }, [intoGone, update]);
  const spentOn = (categories.data ?? []).filter((c) => c.kind === 'expense' && !c.archived_at);
  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-500">
        Where the money went
        <InfoHint label="About where the money went" title="For a loan you're taking now">
          Records the amount borrowed on the <span className="font-medium text-slate-300">Balance on</span> date:
          paid into one of your accounts, or spent straight on something, such as a car paid to the dealer. Leave
          both empty for a loan you took out earlier.
        </InfoHint>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Combobox
          label="Paid into"
          value={form.proceeds_to}
          onChange={(v) => {
            update('proceeds_to', v);
            if (v) update('proceeds_category', '');
          }}
          emptyOption={{ value: '', label: '— None —' }}
          options={accountOptions(into)}
        />
        <Combobox
          label="Or spent on"
          value={form.proceeds_category}
          onChange={(v) => {
            update('proceeds_category', v);
            if (v) update('proceeds_to', '');
          }}
          emptyOption={{ value: '', label: '— None —' }}
          options={spentOn.map((c) => ({
            value: c.id,
            label: c.name,
            icon: <Glyph icon={c.icon} className="h-4 w-4 text-slate-400" />,
          }))}
        />
      </div>
    </div>
  );
}

function LoanTermsFields({
  form,
  update,
  accounts,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  accounts: Account[];
}) {
  const loan = loanFromForm(form);
  const canAutopay = !!form.due_day && !!form.pay_from_account_id && !!loan.payment;
  // A payment moves the same figure out of one account and into the loan, so
  // both must be in the same currency.
  const payFrom = accounts.filter((a) => a.type !== 'loan' && a.currency === form.currency);
  const payFromGone = !!form.pay_from_account_id && !payFrom.some((a) => a.id === form.pay_from_account_id);
  useEffect(() => {
    if (payFromGone) update('pay_from_account_id', null);
  }, [payFromGone, update]);
  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-500">
        Loan terms
        <InfoHint label="About loan terms" title="From your loan papers">
          With these, Copper splits each payment into principal (what you owe goes down by it) and
          interest (a cost, shown in Reports), and works out when the loan is paid off. If the bank
          changes your rate, change it here: later payments use the new one.
        </InfoHint>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Amount borrowed"
          inputMode="decimal"
          value={form.loan_principal_input}
          onChange={(e) => update('loan_principal_input', e.target.value)}
          placeholder="0.00"
        />
        <Input
          label="Term (months)"
          type="number"
          min={1}
          value={form.loan_term_input}
          onChange={(e) => update('loan_term_input', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Interest rate (% a year)"
          inputMode="decimal"
          value={form.loan_rate_input}
          onChange={(e) => update('loan_rate_input', e.target.value)}
          placeholder="8.5"
        />
        <Select
          label="Interest"
          value={form.loan_method}
          onChange={(e) => update('loan_method', e.target.value as InterestMethod)}
        >
          <option value="reducing">On what’s owed (reducing)</option>
          <option value="flat">On the amount borrowed (flat)</option>
        </Select>
      </div>
      {loan.rateBp != null && loan.rateBp > 0 && loan.months && (
        <p className="-mt-1 text-xs text-slate-400">{otherRate(loan.method, loan.rateBp, loan.months)}</p>
      )}
      <Input
        label="Monthly payment"
        inputMode="decimal"
        value={form.loan_payment_input}
        onChange={(e) => update('loan_payment_input', e.target.value)}
        placeholder={loan.computed ? String(fromMinor(loan.computed, form.currency)) : '0.00'}
        labelHint={
          <InfoHint label="About the monthly payment" title="Monthly payment">
            Worked out from the amount, rate and term. If your bank’s figure is a little different,
            type it here.
          </InfoHint>
        }
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Payment day"
          type="number"
          min={1}
          max={31}
          value={form.due_day ?? ''}
          onChange={(e) => update('due_day', e.target.value ? Number(e.target.value) : null)}
        />
        <Combobox
          label="Paid from"
          value={form.pay_from_account_id ?? ''}
          onChange={(v) => update('pay_from_account_id', v || null)}
          emptyOption={{ value: '', label: '— None —' }}
          options={accountOptions(payFrom)}
        />
      </div>
      <label className={`flex items-center gap-2 text-sm ${canAutopay ? 'text-slate-300' : 'text-slate-500'}`}>
        <input
          type="checkbox"
          checked={form.loan_autopay && canAutopay}
          disabled={!canAutopay}
          onChange={(e) => update('loan_autopay', e.target.checked)}
          className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-brand-500 focus:ring-brand-400"
        />
        Add each payment automatically on its day
      </label>
    </div>
  );
}
