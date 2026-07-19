import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Plus } from 'lucide-react';
import { PageShell } from './PageShell';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Combobox } from '@/components/ui/Combobox';
import { InfoHint } from '@/components/ui/InfoHint';
import { Modal } from '@/components/ui/Modal';
import { CategoryCoin } from '@/components/ui/CategoryCoin';
import { useDB } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import {
  bulkDeleteTransactions,
  bulkSetCategory,
  createTransfer,
  deleteTransaction,
  listTransactions,
  searchTransactions,
  updateTransaction,
  type TransactionWithMeta,
} from '@/db/queries/transactions';
import {
  listTags,
  listTxTagLinks,
  bulkAddTag,
  getTagIdsForTransaction,
  setTransactionTags,
} from '@/db/queries/tags';
import { TagChip, TagPicker } from '@/components/ui/TagPicker';
import { EntityHistory } from './Activity';
import type { Account, Tag, Transaction, TransactionKind } from '@/db/types';
import { formatMoney, parseAmount, fromMinor } from '@/lib/money';
import { useDefaultCurrency } from './AppSettingsProvider';
import { formatRelativeDate, toDateString } from '@/lib/dates';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}


export function Transactions() {
  const [filters, setFilters] = useState<{
    accountId: string;
    categoryId: string;
    tagId: string;
    kind: '' | TransactionKind;
    dateFrom: string;
    dateTo: string;
    search: string;
  }>({ accountId: '', categoryId: '', tagId: '', kind: '', dateFrom: '', dateTo: '', search: '' });

  const [editing, setEditing] = useState<TransactionWithMeta | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showRecat, setShowRecat] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const navigate = useNavigate();
  const db = useDB();
  const accountsQuery = useQuery(useCallback((db) => listAccounts(db, false), []), { deps: ['accounts'] });
  const categoriesQuery = useQuery(useCallback((db) => listCategories(db, false), []), {
    deps: ['categories'],
  });
  const tagsQuery = useQuery<Tag[]>(useCallback((db) => listTags(db, false), []), { deps: ['tags'] });
  const linksQuery = useQuery(useCallback((db) => listTxTagLinks(db), []), { deps: ['transaction_tags'] });

  const tagsById = useMemo(
    () => new Map((tagsQuery.data ?? []).map((t) => [t.id, t])),
    [tagsQuery.data],
  );
  const tagsByTx = useMemo(() => {
    const m = new Map<string, Tag[]>();
    for (const l of linksQuery.data ?? []) {
      const t = tagsById.get(l.tag_id);
      if (!t) continue;
      const arr = m.get(l.transaction_id) ?? [];
      arr.push(t);
      m.set(l.transaction_id, arr);
    }
    return m;
  }, [linksQuery.data, tagsById]);

  const toggleSelected = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const assignSelectedToTag = async (tagId: string) => {
    if (!tagId || selected.size === 0) return;
    await bulkAddTag(db, [...selected], tagId);
    setSelected(new Set());
  };

  const recategorizeSelected = async (categoryId: string) => {
    if (!categoryId || selected.size === 0) return;
    await bulkSetCategory(db, [...selected], categoryId);
    setShowRecat(false);
    setSelected(new Set());
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    await bulkDeleteTransactions(db, [...selected]);
    setConfirmDelete(false);
    setSelected(new Set());
  };

  const defaultCurrency = useDefaultCurrency();
  // Debounce only the text query so each keystroke doesn't re-scan the table.
  const debouncedSearch = useDebouncedValue(filters.search, 250);

  const loader = useCallback(
    (db: import('@/db/wasm').DB) => {
      const base = {
        accountId: filters.accountId || undefined,
        categoryId: filters.categoryId || undefined,
        tagId: filters.tagId || undefined,
        kind: filters.kind || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        limit: 500,
      };
      const q = debouncedSearch.trim();
      return q
        ? searchTransactions(db, q, base, defaultCurrency)
        : listTransactions(db, base);
    },
    [
      filters.accountId,
      filters.categoryId,
      filters.tagId,
      filters.kind,
      filters.dateFrom,
      filters.dateTo,
      debouncedSearch,
      defaultCurrency,
    ],
  );
  const txQuery = useQuery(loader, {
    deps: ['transactions', 'accounts', 'categories', 'transaction_tags'],
  });

  const grouped = useMemo(() => groupByDate(txQuery.data ?? []), [txQuery.data]);

  return (
    <PageShell
      title="Transactions"
      subtitle="All entries with filters and search"
      actions={
        <div className="flex items-center gap-2">
          <Button onClick={() => navigate('/add')}>
            <Plus className="h-4 w-4" /> Add
          </Button>
          <Button
            variant={selectMode ? 'primary' : 'secondary'}
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          >
            {selectMode ? 'Done' : 'Select'}
          </Button>
          <Button variant="secondary" onClick={() => setShowTransfer(true)}>
            ↔ Transfer
          </Button>
        </div>
      }
    >
      <Card>
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <Combobox
            label="Account"
            value={filters.accountId}
            onChange={(v) => setFilters((f) => ({ ...f, accountId: v }))}
            emptyOption={{ value: '', label: 'All' }}
            options={(accountsQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
          />
          <Combobox
            label="Category"
            value={filters.categoryId}
            onChange={(v) => setFilters((f) => ({ ...f, categoryId: v }))}
            emptyOption={{ value: '', label: 'All' }}
            options={(categoriesQuery.data ?? []).map((c) => ({
              value: c.id,
              label: `${c.icon ?? ''} ${c.name}`.trim(),
            }))}
          />
          <Combobox
            label="Tag"
            value={filters.tagId}
            onChange={(v) => setFilters((f) => ({ ...f, tagId: v }))}
            emptyOption={{ value: '', label: 'All' }}
            options={(tagsQuery.data ?? []).map((t) => ({
              value: t.id,
              label: `${t.icon ?? ''} ${t.name}`.trim(),
            }))}
          />
          <Select
            label="Type"
            value={filters.kind}
            onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value as '' | TransactionKind }))}
          >
            <option value="">All</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </Select>
          <Input
            label="From"
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
          />
          <Input
            label="To"
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
          />
          <Input
            label="Search"
            labelHint={
              <InfoHint label="How search works" title="Search tips" align="right">
                <span className="mb-1.5 block">
                  <span className="font-medium text-slate-300">Text</span> — notes, category &amp;
                  account, and it shrugs off typos.{' '}
                  <span className="text-slate-500">“strbcks” finds “Starbucks”.</span>
                </span>
                <span className="block">
                  <span className="font-medium text-slate-300">Amount</span> — matches the precision
                  you type. <span className="text-slate-500">“48” → 48.00–48.99, “48.99” exact.</span>
                </span>
              </InfoHint>
            }
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Note, category, or amount…"
          />
        </div>
      </Card>

      {txQuery.data && txQuery.data.length === 0 && (
        <EmptyState title="No transactions match" description="Adjust filters or add some entries." />
      )}

      <div className="space-y-6">
        {grouped.map(([date, items]) => {
          const dayTotal = items.reduce((sum, t) => sum + t.amount_minor, 0);
          return (
            <div key={date}>
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{formatRelativeDate(date)}</h3>
                <span className={`text-xs tabular-nums ${dayTotal < 0 ? 'text-clay-400' : 'text-mint-400'}`}>
                  {formatMoney(dayTotal, items[0].account_currency, { signed: true })}
                </span>
              </div>
              <Card className="!p-0">
                <ul className="divide-y divide-slate-800">
                  {items.map((t) => {
                    const txTags = tagsByTx.get(t.id) ?? [];
                    const isSel = selected.has(t.id);
                    return (
                      <li key={t.id}>
                        <button
                          onClick={() => (selectMode ? toggleSelected(t.id) : setEditing(t))}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-800/40 ${
                            isSel ? 'bg-brand-500/10' : ''
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {selectMode && (
                              <span
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                                  isSel ? 'border-brand-400 bg-brand-500 text-white' : 'border-slate-600'
                                }`}
                              >
                                {isSel && <Check className="h-3.5 w-3.5" />}
                              </span>
                            )}
                            {t.kind === 'transfer' ? (
                              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-400">
                                ↔
                              </span>
                            ) : (
                              <CategoryCoin
                                name={t.category_name ?? 'Uncategorised'}
                                color={t.category_color}
                                icon={t.category_icon}
                                size="sm"
                              />
                            )}
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-slate-50">
                                {t.category_name ?? (t.kind === 'transfer' ? 'Transfer' : 'Uncategorised')}
                              </div>
                              <div className="truncate text-xs text-slate-500">
                                {t.account_name}
                                {t.note ? ` · ${t.note}` : ''}
                              </div>
                              {txTags.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {txTags.map((tg) => (
                                    <TagChip key={tg.id} tag={tg} />
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div
                            className={`shrink-0 text-sm font-semibold tabular-nums ${
                              t.amount_minor < 0 ? 'text-clay-400' : 'text-mint-400'
                            }`}
                          >
                            {formatMoney(t.amount_minor, t.account_currency, { signed: true })}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>
          );
        })}
      </div>

      {selectMode && (
        <div className="fixed inset-x-3 bottom-24 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2.5 shadow-2xl lg:bottom-8">
          <span className="whitespace-nowrap text-sm text-slate-300">{selected.size} selected</span>
          {(tagsQuery.data ?? []).length === 0 ? (
            <span className="flex-1 text-xs text-slate-500">Pick rows, then choose an action</span>
          ) : selected.size === 0 ? (
            <span className="flex-1 text-xs text-slate-500">Pick rows, then tap a tag or action</span>
          ) : (
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
              {(tagsQuery.data ?? []).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => assignSelectedToTag(t.id)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:text-slate-50 active:scale-95"
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color ?? '#94a3b8' }} />
                  {t.icon ? `${t.icon} ` : ''}
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={selected.size === 0}
              onClick={() => setShowRecat(true)}
            >
              Category
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={selected.size === 0}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={exitSelect}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <RecategorizeModal
        open={showRecat}
        count={selected.size}
        categories={categoriesQuery.data ?? []}
        onApply={recategorizeSelected}
        onClose={() => setShowRecat(false)}
      />
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete transactions">
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Delete {selected.size} selected {selected.size === 1 ? 'entry' : 'entries'}? Deleting a
            transfer removes both sides. This can't be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={deleteSelected}>
              Delete {selected.size}
            </Button>
          </div>
        </div>
      </Modal>

      <EditTransactionModal
        open={editing !== null}
        existing={editing}
        accounts={accountsQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        tags={tagsQuery.data ?? []}
        onClose={() => setEditing(null)}
      />
      <TransferModal
        open={showTransfer}
        accounts={accountsQuery.data ?? []}
        onClose={() => setShowTransfer(false)}
      />
    </PageShell>
  );
}

function groupByDate(items: TransactionWithMeta[]): [string, TransactionWithMeta[]][] {
  const map = new Map<string, TransactionWithMeta[]>();
  for (const t of items) {
    const list = map.get(t.occurred_on) ?? [];
    list.push(t);
    map.set(t.occurred_on, list);
  }
  return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

interface RecategorizeModalProps {
  open: boolean;
  count: number;
  categories: import('@/db/types').Category[];
  onApply: (categoryId: string) => void;
  onClose: () => void;
}

function RecategorizeModal({ open, count, categories, onApply, onClose }: RecategorizeModalProps) {
  const [categoryId, setCategoryId] = useState('');

  useEffect(() => {
    if (open) setCategoryId('');
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Change category">
      <div className="space-y-4">
        <p className="text-sm text-slate-300">
          Set a category for {count} selected {count === 1 ? 'entry' : 'entries'}. Transfers are left
          unchanged.
        </p>
        <Combobox
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          placeholder="Choose a category…"
          options={categories.map((c) => ({
            value: c.id,
            label: `${c.icon ?? ''} ${c.name}`.trim(),
          }))}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!categoryId} onClick={() => onApply(categoryId)}>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface EditModalProps {
  open: boolean;
  existing: TransactionWithMeta | null;
  accounts: import('@/db/types').Account[];
  categories: import('@/db/types').Category[];
  tags: Tag[];
  onClose: () => void;
}

function EditTransactionModal({ open, existing, accounts, categories, tags, onClose }: EditModalProps) {
  const db = useDB();
  const [form, setForm] = useState({
    account_id: '',
    category_id: '',
    amount_input: '',
    kind: 'expense' as TransactionKind,
    occurred_on: toDateString(),
    note: '',
  });
  const [tagIds, setTagIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !existing) return;
    setForm({
      account_id: existing.account_id,
      category_id: existing.category_id ?? '',
      amount_input: String(fromMinor(Math.abs(existing.amount_minor), existing.account_currency)),
      kind: existing.kind,
      occurred_on: existing.occurred_on,
      note: existing.note ?? '',
    });
    getTagIdsForTransaction(db, existing.id).then((ids) => setTagIds(new Set(ids)));
  }, [open, existing, db]);

  const toggleTag = (id: string) =>
    setTagIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!existing) {
    return <Modal open={open} onClose={onClose} />;
  }

  const handleSave = async () => {
    if (existing.kind === 'transfer') return;
    const amount = parseAmount(form.amount_input, existing.account_currency);
    if (amount == null) return;
    setSubmitting(true);
    try {
      await updateTransaction(db, existing.id, {
        account_id: form.account_id,
        category_id: form.category_id || null,
        amount_minor: amount,
        kind: form.kind,
        occurred_on: form.occurred_on,
        note: form.note || null,
      });
      await setTransactionTags(db, existing.id, [...tagIds]);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setSubmitting(true);
    try {
      await deleteTransaction(db, existing.id);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit transaction">
      {existing.kind === 'transfer' ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-300">Transfer between accounts. Transfers can't be edited — delete it and create a new one to change it.</p>
          <div className="rounded-lg bg-slate-800/50 p-3 text-sm">
            <div>{formatMoney(existing.amount_minor, existing.account_currency, { signed: true })}</div>
            <div className="text-xs text-slate-500">{existing.account_name} · {existing.occurred_on}</div>
          </div>
          <div className="flex justify-between">
            <Button variant="danger" onClick={handleDelete} disabled={submitting}>Delete transfer</Button>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Input
            label="Amount"
            inputMode="decimal"
            value={form.amount_input}
            onChange={(e) => setForm((f) => ({ ...f, amount_input: e.target.value }))}
            autoFocus
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Kind"
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as TransactionKind }))}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </Select>
            <Input
              label="Date"
              type="date"
              value={form.occurred_on}
              onChange={(e) => setForm((f) => ({ ...f, occurred_on: e.target.value }))}
            />
          </div>
          <Combobox
            label="Account"
            value={form.account_id}
            onChange={(v) => setForm((f) => ({ ...f, account_id: v }))}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
          <Combobox
            label="Category"
            value={form.category_id}
            onChange={(v) => setForm((f) => ({ ...f, category_id: v }))}
            emptyOption={{ value: '', label: '— None —' }}
            options={categories
              .filter((c) => c.kind === form.kind)
              .map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim() }))}
          />
          <Textarea
            label="Note"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
          {tags.length > 0 && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">Tags</label>
              <TagPicker tags={tags} selected={tagIds} onToggle={toggleTag} />
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button variant="danger" size="sm" onClick={handleDelete} disabled={submitting}>
              Delete
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={submitting}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      <details className="mt-4 border-t border-slate-800 pt-3">
        <summary className="cursor-pointer list-none text-xs font-medium text-slate-400 hover:text-slate-200">
          History
        </summary>
        <div className="mt-2">
          <EntityHistory entity="transaction" entityId={existing.id} />
        </div>
      </details>
    </Modal>
  );
}

interface TransferModalProps {
  open: boolean;
  accounts: Account[];
  onClose: () => void;
}

function TransferModal({ open, accounts, onClose }: TransferModalProps) {
  const db = useDB();
  const defaultCurrency = useDefaultCurrency();
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [date, setDate] = useState(toDateString());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFromId(accounts[0]?.id ?? '');
    setToId(accounts[1]?.id ?? accounts[0]?.id ?? '');
    setAmountInput('');
    setDate(toDateString());
    setNote('');
  }, [open, accounts]);

  const fromAcct = accounts.find((a) => a.id === fromId);
  const currency = fromAcct?.currency ?? defaultCurrency;

  const handleSubmit = async () => {
    const amount = parseAmount(amountInput, currency);
    if (!fromId || !toId || fromId === toId || !amount || amount <= 0) return;
    setSubmitting(true);
    try {
      await createTransfer(db, {
        from_account_id: fromId,
        to_account_id: toId,
        amount_minor: amount,
        occurred_on: date,
        note: note.trim() || null,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New transfer">
      <div className="space-y-3">
        <Combobox
          label="From"
          value={fromId}
          onChange={setFromId}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        />
        <Combobox
          label="To"
          value={toId}
          onChange={setToId}
          options={accounts.filter((a) => a.id !== fromId).map((a) => ({ value: a.id, label: a.name }))}
        />
        <Input
          label="Amount"
          inputMode="decimal"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          placeholder="0.00"
          autoFocus
        />
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !fromId || !toId || fromId === toId || !amountInput}
          >
            Transfer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export type { Transaction };
