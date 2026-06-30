import { useCallback, useEffect, useMemo, useState } from 'react';
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
  getAccountBalances,
  listAccounts,
  unarchiveAccount,
  updateAccount,
  type AccountInput,
} from '@/db/queries/accounts';
import { mergeAccount, previewAccountMerge } from '@/db/queries/merge';
import { MergeInto } from '@/components/MergeInto';
import type { Account, AccountType } from '@/db/types';
import { parseAmount, fromMinor, SUPPORTED_CURRENCIES } from '@/lib/money';
import { Money } from '@/components/ui/Money';
import { Combobox } from '@/components/ui/Combobox';
import { toDateString } from '@/lib/dates';
import { useDefaultCurrency } from './AppSettingsProvider';

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'loan', label: 'Loan' },
  { value: 'other', label: 'Other' },
];

export function Accounts() {
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);

  const accountsQuery = useQuery(useCallback((db) => listAccounts(db, true), []), {
    deps: ['accounts'],
  });
  const balancesQuery = useQuery(useCallback((db) => getAccountBalances(db), []), {
    deps: ['accounts', 'transactions'],
  });

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of balancesQuery.data ?? []) map.set(b.account_id, b.balance_minor);
    return map;
  }, [balancesQuery.data]);

  const accounts = accountsQuery.data ?? [];
  const active = accounts.filter((a) => !a.archived_at);
  const archived = accounts.filter((a) => a.archived_at);

  return (
    <PageShell
      title="Accounts"
      subtitle="Cash, bank, credit cards and wallets"
      actions={<Button onClick={() => setCreating(true)}>+ New account</Button>}
    >
      {active.length === 0 && !accountsQuery.loading && (
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
                <span>{a.name}</span>
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
        accounts={active}
        onClose={() => setCreating(false)}
      />
      <AccountFormModal
        open={editing !== null}
        accounts={active}
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
  return (
    <button
      onClick={onEdit}
      className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-500 hover:bg-slate-900/70"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">{account.type.replace('_', ' ')}</div>
          <div className="mt-0.5 text-base font-semibold text-slate-50">{account.name}</div>
        </div>
        {account.is_main === 1 && (
          <span className="rounded-md bg-brand-500 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-950">
            Main
          </span>
        )}
      </div>
      <Money
        minor={balanceMinor}
        currency={account.currency}
        className={`mt-3 block text-2xl font-semibold tabular-nums ${balanceMinor < 0 ? 'text-clay-400' : 'text-slate-50'}`}
      />
      {account.type === 'credit_card' && account.due_day && (
        <div className="mt-2 text-xs text-slate-500">
          Payment due day {account.due_day}
          {account.statement_day && ` · Statement closes day ${account.statement_day}`}
        </div>
      )}
    </button>
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
    ? accounts
        .filter((a) => a.id !== existing.id && a.currency === existing.currency)
        .map((a) => ({ value: a.id, label: a.name }))
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
          <Select label="Currency" value={form.currency} onChange={(e) => update('currency', e.target.value)}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.symbol}
              </option>
            ))}
          </Select>
        </div>
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
          <Input
            label="Balance on"
            type="date"
            value={form.starts_on}
            onChange={(e) => update('starts_on', e.target.value)}
          />
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
              options={accounts
                .filter((a) => a.type !== 'credit_card' && a.id !== existing?.id)
                .map((a) => ({ value: a.id, label: a.name }))}
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
            extras="transfers, linked cards and recurring rules"
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
  };
}
