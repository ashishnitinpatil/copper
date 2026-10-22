import { useCallback, useEffect, useMemo, useState } from 'react';
import { ACCOUNT_ICON_GROUPS, IconPicker } from '@/components/ui/IconPicker';
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
import { parseAmount, fromMinor, CURRENCY_OPTIONS } from '@/lib/money';
import { Money } from '@/components/ui/Money';
import { Combobox } from '@/components/ui/Combobox';
import { toDateString } from '@/lib/dates';
import { useDefaultCurrency } from './AppSettingsProvider';
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

      {active.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((acct) => (
            <AccountCard
              key={acct.id}
              account={acct}
              balanceMinor={balances.get(acct.id) ?? acct.opening_balance_minor}
              onEdit={() => setEditing(acct)}
            />
          ))}
        </div>
      )}

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
}

function AccountCard({ account, balanceMinor, onEdit }: AccountCardProps) {
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
              <div className="text-xs uppercase tracking-wide text-slate-500">{account.type.replace('_', ' ')}</div>
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
        ) : (
          <Money
            minor={balanceMinor}
            currency={account.currency}
            className={`mt-3 block text-2xl font-semibold tabular-nums ${balanceMinor < 0 ? 'text-clay-400' : 'text-slate-50'}`}
          />
        )}
        {account.type === 'credit_card' && account.due_day && (
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
  const [form, setForm] = useState<AccountInput & { opening_input: string }>(() =>
    emptyForm(defaultCurrency),
  );
  const [submitting, setSubmitting] = useState(false);
  const [mergeImpact, setMergeImpact] = useState<number | null>(null);

  const title = existing ? 'Edit account' : 'New account';

  useEffect(() => {
    if (open) setForm(existing ? toForm(existing) : emptyForm(defaultCurrency));
  }, [open, existing, defaultCurrency]);

  useEffect(() => {
    if (!open || !existing) return;
    setMergeImpact(null);
    previewAccountMerge(db, existing.id).then(setMergeImpact);
  }, [open, existing, db]);

  const update = useCallback(<K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      const payload: AccountInput = {
        name: form.name.trim(),
        type: form.type,
        currency: form.currency,
        opening_balance_minor: parseAmount(form.opening_input || '0', form.currency) ?? 0,
        is_main: form.is_main,
        include_in_total: form.include_in_total,
        credit_limit_minor: form.credit_limit_minor ?? null,
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
        await createAccount(db, payload);
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
          <Select label="Type" value={form.type} onChange={(e) => update('type', e.target.value as AccountType)}>
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
          groups={ACCOUNT_ICON_GROUPS}
          suggestFrom={form.name}
          defaultOption={<AccountGlyph account={{ icon: null, type: form.type }} />}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Starting balance"
            labelHint={
              <InfoHint label="About the starting balance" title="Starting balance">
                The balance on the <span className="font-medium text-slate-300">Balance on</span>{' '}
                date. Transactions dated before it aren’t counted — move that date earlier to fold in
                older history.
              </InfoHint>
            }
            value={form.opening_input}
            inputMode="decimal"
            onChange={(e) => update('opening_input', e.target.value)}
            placeholder="0.00"
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
              value={form.credit_limit_minor != null ? String(fromMinor(form.credit_limit_minor, form.currency)) : ''}
              onChange={(e) => {
                const parsed = parseAmount(e.target.value, form.currency);
                update('credit_limit_minor', parsed);
              }}
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
    opening_input: String(fromMinor(a.opening_balance_minor, a.currency)),
    starts_on: a.starts_on,
    icon: a.icon ?? '',
  };
}
