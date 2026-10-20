import { useCallback, useEffect, useMemo, useState } from 'react';
import { Repeat } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { CategoryCoin } from '@/components/ui/CategoryCoin';
import { Combobox } from '@/components/ui/Combobox';
import { DateField, friendlyDate } from '@/components/ui/DateField';
import { InfoHint } from '@/components/ui/InfoHint';
import { Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { AccountGlyph, accountOptions } from '@/components/accountOptions';
import { useDB } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import {
  archiveRecurringRule,
  createRecurringRule,
  listRecurringRules,
  updateRecurringRule,
  type RecurringTemplate,
} from '@/db/queries/recurring';
import type { Account, Category, RecurringRule } from '@/db/types';
import { formatMoney, fromMinor, parseAmount } from '@/lib/money';
import { toDateString } from '@/lib/dates';
import { FREQUENCY_OPTIONS, MONTHLY, ruleStarting } from '@/features/recurring/frequencies';
import { repeatLabel } from '@/features/activity/describe';
import { useDefaultCurrency } from './AppSettingsProvider';
import { Glyph } from '@/components/ui/Glyph';

/** The frequency part of a stored rule ("FREQ=…;INTERVAL=…"), without its start date. */
function frequencyOf(rrule: string): string {
  return rrule.split('\n').find((l) => l.startsWith('FREQ=')) ?? rrule.replace(/^DTSTART:[^\n]*\n?/, '');
}

/** Everything that repeats — rent, salary, subscriptions — with what's next. */
export function RecurringList() {
  const defaultCurrency = useDefaultCurrency();
  const [editing, setEditing] = useState<RecurringRule | 'new' | null>(null);

  const rulesState = useQuery<RecurringRule[]>(
    useCallback((d) => listRecurringRules(d, true), []),
    { deps: ['recurring_rules'] },
  );
  const accountsState = useQuery<Account[]>(useCallback((d) => listAccounts(d), []), { deps: ['accounts'] });
  const categoriesState = useQuery<Category[]>(useCallback((d) => listCategories(d), []), {
    deps: ['categories'],
  });

  const rules = rulesState.data ?? [];
  const accounts = accountsState.data ?? [];
  const categories = categoriesState.data ?? [];
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const active = rules.filter((r) => !r.archived_at);
  const stopped = rules.filter((r) => r.archived_at);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          Copper adds these on their dates, and Cashflow shows what&rsquo;s coming.
        </p>
        <Button size="sm" className="shrink-0" onClick={() => setEditing('new')}>
          + New recurring entry
        </Button>
      </div>

      {active.length === 0 ? (
        <EmptyState
          title="No recurring entries yet"
          description="Add things that repeat, like rent, salary or subscriptions — here, or with “Repeats” when you add a transaction. Future-dated entries you added or imported (such as Monefy’s scheduled payments) are listed under Upcoming in All, but don’t repeat by themselves."
        />
      ) : (
        <ul className="divide-y divide-slate-800">
          {active.map((rule) => {
            const tpl: RecurringTemplate = JSON.parse(rule.template_json);
            const acct = accountMap.get(tpl.account_id);
            const cat = catMap.get(tpl.category_id ?? '');
            return (
              <li key={rule.id}>
                <button
                  type="button"
                  onClick={() => setEditing(rule)}
                  className="flex w-full items-center gap-3 py-3 text-left hover:bg-slate-900/50"
                >
                  <CategoryCoin name={cat?.name ?? '?'} color={cat?.color} icon={cat?.icon} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-50">
                      {cat?.name ?? 'Uncategorized'}
                      {tpl.note && <span className="text-slate-500"> · {tpl.note}</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                      <Repeat className="h-3 w-3" />
                      {repeatLabel(frequencyOf(rule.rrule)).replace(/^./, (c) => c.toUpperCase())} · next{' '}
                      {friendlyDate(rule.next_run_on)}
                      {acct && (
                        <>
                          {' · '}
                          <AccountGlyph account={acct} />
                          {acct.name}
                        </>
                      )}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-semibold tabular-nums ${
                      tpl.kind === 'income' ? 'text-mint-400' : 'text-slate-100'
                    }`}
                  >
                    {tpl.kind === 'income' ? '+' : '−'}
                    {formatMoney(tpl.amount_minor, acct?.currency ?? defaultCurrency)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {stopped.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
            {stopped.length} stopped
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {stopped.map((r) => {
              const tpl: RecurringTemplate = JSON.parse(r.template_json);
              const cat = catMap.get(tpl.category_id ?? '');
              return (
                <li key={r.id}>
                  <Glyph icon={cat?.icon} className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-slate-400" />
                  {cat?.name ?? 'Uncategorized'} —{' '}
                  {formatMoney(tpl.amount_minor, accountMap.get(tpl.account_id)?.currency ?? defaultCurrency)}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <RecurringFormModal
        open={editing !== null}
        existing={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        accounts={accounts}
        categories={categories}
      />
    </Card>
  );
}

interface RecurringFormModalProps {
  open: boolean;
  existing: RecurringRule | null;
  onClose: () => void;
  accounts: Account[];
  categories: Category[];
}

function RecurringFormModal({ open, existing, onClose, accounts, categories }: RecurringFormModalProps) {
  const db = useDB();
  const defaultCurrency = useDefaultCurrency();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [note, setNote] = useState('');
  const [freq, setFreq] = useState(MONTHLY);
  const [startDate, setStartDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredCats = useMemo(() => categories.filter((c) => c.kind === kind), [categories, kind]);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      const tpl: RecurringTemplate = JSON.parse(existing.template_json);
      const acct = accounts.find((a) => a.id === tpl.account_id);
      setKind(tpl.kind === 'income' ? 'income' : 'expense');
      setAccountId(tpl.account_id);
      setCategoryId(tpl.category_id ?? '');
      setAmountInput(String(fromMinor(tpl.amount_minor, acct?.currency ?? defaultCurrency)));
      setNote(tpl.note ?? '');
      setFreq(frequencyOf(existing.rrule));
      setStartDate(existing.next_run_on);
      return;
    }
    setKind('expense');
    setAccountId(accounts.find((a) => a.is_main)?.id ?? accounts[0]?.id ?? '');
    setCategoryId('');
    setAmountInput('');
    setNote('');
    setFreq(MONTHLY);
    setStartDate(toDateString());
    // Seed only when opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);

  const currency = accounts.find((a) => a.id === accountId)?.currency ?? defaultCurrency;
  const minor = parseAmount(amountInput, currency);
  const valid = !!accountId && !!categoryId && !!minor && minor > 0 && !!startDate;

  const handleSubmit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      const input = {
        template: { account_id: accountId, category_id: categoryId, amount_minor: minor!, kind, note: note.trim() || null },
        rrule: ruleStarting(startDate, freq),
        next_run_on: startDate,
      };
      if (existing) await updateRecurringRule(db, existing.id, input);
      else await createRecurringRule(db, input);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const stop = async () => {
    if (!existing) return;
    await archiveRecurringRule(db, existing.id);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit recurring entry' : 'New recurring entry'}>
      <div className="space-y-3">
        <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
          {(['expense', 'income'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setKind(m);
                setCategoryId('');
              }}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition ${
                kind === m
                  ? m === 'expense'
                    ? 'bg-clay-500/20 text-clay-300'
                    : 'bg-mint-500/20 text-mint-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m === 'expense' ? 'Expense' : 'Income'}
            </button>
          ))}
        </div>
        <Input
          label="Amount"
          inputMode="decimal"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          placeholder="0.00"
          autoFocus
        />
        <Combobox
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          placeholder="Choose a category"
          options={filteredCats.map((c) => ({
            value: c.id,
            label: c.name,
            icon: <CategoryCoin name={c.name} color={c.color} icon={c.icon} size="sm" className="!h-6 !w-6 !text-sm" />,
          }))}
        />
        <Combobox
          label={kind === 'expense' ? 'Paid from' : 'Received into'}
          value={accountId}
          onChange={setAccountId}
          options={accountOptions(accounts)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Repeats" value={freq} onChange={(e) => setFreq(e.target.value)}>
            {FREQUENCY_OPTIONS.map((f) => (
              <option key={f.rrule} value={f.rrule}>
                {f.label}
              </option>
            ))}
          </Select>
          <div className="space-y-1">
            <span className="flex items-center gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {existing ? 'Next on' : 'Starts on'}
              </span>
              <InfoHint label="About the start date" title="Start date">
                Pick a past date and Copper adds every earlier one up to today.
              </InfoHint>
            </span>
            <DateField value={startDate} onChange={setStartDate} />
          </div>
        </div>
        <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        <div className="flex items-center justify-between gap-2 pt-2">
          {existing ? (
            <Button variant="ghost" onClick={stop} className="text-danger">
              Stop repeating
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !valid}>
              {existing ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
