import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { PageShell } from './PageShell';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Combobox } from '@/components/ui/Combobox';
import { Modal } from '@/components/ui/Modal';
import { CategoryCoin } from '@/components/ui/CategoryCoin';
import { useDB } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import {
  listTagsWithSpend,
  getTagCategorySpend,
  listTransactionsForTag,
  listUntaggedInWindow,
  bulkAddTag,
  createTag,
  updateTag,
  archiveTag,
  type TagWithSpend,
  type TagCategorySpend,
  type TagInput,
} from '@/db/queries/tags';
import type { TransactionWithMeta } from '@/db/queries/transactions';
import { formatMoney, parseAmount, fromMinor, CURRENCY_OPTIONS } from '@/lib/money';
import { formatHumanDate, formatRelativeDate } from '@/lib/dates';
import { useAppSettings, useDefaultCurrency } from './AppSettingsProvider';

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#8b5cf6', '#a855f7', '#ec4899',
];
const PRESET_ICONS = ['🏖️', '✈️', '🏔️', '🎉', '🎁', '🏠', '💼', '🍽️', '🚗', '💍', '🎓', '🩺'];

function isDated(t: { starts_on: string | null; ends_on: string | null }): boolean {
  return !!t.starts_on || !!t.ends_on;
}

/** Compact range like "Jun 1 – Jun 10" / "from Jun 1" / "until Jun 10". */
function formatRange(starts: string | null, ends: string | null): string {
  if (starts && ends) return `${formatHumanDate(starts)} – ${formatHumanDate(ends)}`;
  if (starts) return `from ${formatHumanDate(starts)}`;
  if (ends) return `until ${formatHumanDate(ends)}`;
  return '';
}

export function Tags() {
  const { defaultCurrency, fxRates } = useAppSettings();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TagWithSpend | null>(null);

  const tagsState = useQuery<TagWithSpend[]>(
    useCallback((d) => listTagsWithSpend(d, defaultCurrency, fxRates), [defaultCurrency, fxRates]),
    { deps: ['tags', 'transaction_tags', 'transactions', 'accounts'] },
  );

  const tags = tagsState.data ?? [];
  const open = tags.find((t) => t.id === openId) ?? null;

  const { trips, labels } = useMemo(() => {
    const trips: TagWithSpend[] = [];
    const labels: TagWithSpend[] = [];
    for (const t of tags) (isDated(t) ? trips : labels).push(t);
    return { trips, labels };
  }, [tags]);

  if (open) {
    return (
      <TagDetail
        tag={open}
        onBack={() => setOpenId(null)}
        onEdit={() => setEditing(open)}
        formModal={
          <TagFormModal open={editing?.id === open.id} existing={editing} onClose={() => setEditing(null)} />
        }
      />
    );
  }

  return (
    <PageShell
      title="Tags"
      subtitle="Group spending across categories — trips, projects, anything"
      actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New tag</Button>}
    >
      {tags.length === 0 && !tagsState.loading && (
        <EmptyState
          title="No tags yet"
          description="Tag transactions to track a vacation, a project, or anything that spans categories. Add dates to turn a tag into a trip with budget progress."
          action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New tag</Button>}
        />
      )}

      {trips.length > 0 && (
        <section className="space-y-3">
          {labels.length > 0 && (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trips &amp; events</h2>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((t) => (
              <TagCard key={t.id} tag={t} onOpen={() => setOpenId(t.id)} />
            ))}
          </div>
        </section>
      )}

      {labels.length > 0 && (
        <section className="space-y-3">
          {trips.length > 0 && (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Labels</h2>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {labels.map((t) => (
              <TagCard key={t.id} tag={t} onOpen={() => setOpenId(t.id)} />
            ))}
          </div>
        </section>
      )}

      <TagFormModal open={creating} onClose={() => setCreating(false)} />
    </PageShell>
  );
}

function TagCard({ tag, onOpen }: { tag: TagWithSpend; onOpen: () => void }) {
  const color = tag.color ?? '#94a3b8';
  const dated = isDated(tag);
  const hasBudget = tag.budget_minor != null && tag.budget_minor > 0;
  const pct = hasBudget ? Math.min((tag.expense_minor / tag.budget_minor!) * 100, 100) : 0;
  const over = hasBudget && tag.expense_minor > tag.budget_minor!;
  const barColor = over ? 'bg-clay-500' : pct > 80 ? 'bg-amber-500' : 'bg-mint-500';

  return (
    <button
      onClick={onOpen}
      className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-500"
    >
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate text-sm font-medium text-slate-50">
          {tag.icon ? `${tag.icon} ` : ''}
          {tag.name}
        </span>
      </div>
      {dated && (
        <div className="mt-1 text-xs text-slate-500">{formatRange(tag.starts_on, tag.ends_on)}</div>
      )}
      <div className="mt-3 flex items-baseline justify-between">
        <span className={`font-display text-2xl font-semibold tabular-nums ${over ? 'text-clay-400' : 'text-slate-50'}`}>
          {formatMoney(tag.expense_minor, tag.currency)}
        </span>
        {hasBudget ? (
          <span className="text-xs text-slate-500">/ {formatMoney(tag.budget_minor!, tag.currency)}</span>
        ) : (
          <span className="text-xs text-slate-500">{tag.tx_count} entr{tag.tx_count === 1 ? 'y' : 'ies'}</span>
        )}
      </div>
      {hasBudget && (
        <div className="mt-2 h-1.5 rounded-full bg-slate-800">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </button>
  );
}

interface TagDetailProps {
  tag: TagWithSpend;
  onBack: () => void;
  onEdit: () => void;
  formModal: ReactNode;
}

function TagDetail({ tag, onBack, onEdit, formModal }: TagDetailProps) {
  const db = useDB();
  const { defaultCurrency, fxRates } = useAppSettings();
  const color = tag.color ?? '#94a3b8';
  const hasBudget = tag.budget_minor != null && tag.budget_minor > 0;
  const net = tag.income_minor - tag.expense_minor;

  const catState = useQuery<TagCategorySpend[]>(
    useCallback((d) => getTagCategorySpend(d, tag.id, tag.currency, defaultCurrency, fxRates),
      [tag.id, tag.currency, defaultCurrency, fxRates]),
    { deps: ['transaction_tags', 'transactions', 'accounts', 'categories'] },
  );
  const txState = useQuery<TransactionWithMeta[]>(
    useCallback((d) => listTransactionsForTag(d, tag.id), [tag.id]),
    { deps: ['transaction_tags', 'transactions', 'accounts', 'categories'] },
  );
  const windowComplete = !!tag.starts_on && !!tag.ends_on;
  const suggState = useQuery<TransactionWithMeta[]>(
    useCallback(
      (d) => (windowComplete ? listUntaggedInWindow(d, tag.id, tag.starts_on!, tag.ends_on!) : Promise.resolve([])),
      [tag.id, tag.starts_on, tag.ends_on, windowComplete],
    ),
    { deps: ['transaction_tags', 'transactions', 'accounts'] },
  );

  const cats = catState.data ?? [];
  const grandTotal = cats.reduce((s, c) => s + c.total, 0);
  const suggestions = suggState.data ?? [];

  const pct = hasBudget ? Math.min((tag.expense_minor / tag.budget_minor!) * 100, 100) : 0;
  const over = hasBudget && tag.expense_minor > tag.budget_minor!;
  const barColor = over ? 'bg-clay-500' : pct > 80 ? 'bg-amber-500' : 'bg-mint-500';

  const addAll = async () => {
    await bulkAddTag(db, suggestions.map((t) => t.id), tag.id);
  };

  return (
    <PageShell
      title={`${tag.icon ? tag.icon + ' ' : ''}${tag.name}`}
      subtitle={isDated(tag) ? formatRange(tag.starts_on, tag.ends_on) : `${tag.tx_count} tagged entries`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back</Button>
          <Button variant="secondary" onClick={onEdit}>Edit</Button>
        </div>
      }
    >
      <Card>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          Total spent
        </div>
        <div className={`mt-1 font-display text-4xl font-semibold tabular-nums sm:text-5xl ${over ? 'text-clay-400' : 'text-slate-50'}`}>
          {formatMoney(tag.expense_minor, tag.currency)}
        </div>
        {hasBudget && (
          <>
            <div className="mt-3 h-2 rounded-full bg-slate-800">
              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-sm text-slate-400">
              {over ? (
                <span className="text-clay-400">
                  Over by {formatMoney(tag.expense_minor - tag.budget_minor!, tag.currency)}
                </span>
              ) : (
                <>{formatMoney(tag.budget_minor! - tag.expense_minor, tag.currency)} left of {formatMoney(tag.budget_minor!, tag.currency)}</>
              )}
            </div>
          </>
        )}
        {tag.income_minor > 0 && (
          <div className="mt-2 text-sm text-slate-400">
            +{formatMoney(tag.income_minor, tag.currency)} income tagged · net{' '}
            <span className={net >= 0 ? 'text-mint-400' : 'text-clay-400'}>
              {formatMoney(net, tag.currency, { signed: true })}
            </span>
          </div>
        )}
      </Card>

      {windowComplete && suggestions.length > 0 && (
        <Card className="border-brand-500/30">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-300">
              {suggestions.length} entr{suggestions.length === 1 ? 'y' : 'ies'} during this window {suggestions.length === 1 ? "isn't" : "aren't"} tagged yet.
            </div>
            <Button size="sm" onClick={addAll}>Add all</Button>
          </div>
        </Card>
      )}

      {cats.length > 0 && (
        <Card className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">By category</h2>
          {cats.map((c) => {
            const p = grandTotal > 0 ? (c.total / grandTotal) * 100 : 0;
            return (
              <div key={c.category_id ?? '__none'}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-slate-50">{c.category_icon ?? '•'} {c.category_name ?? 'Uncategorised'}</span>
                  <span className="tabular-nums text-slate-300">
                    {formatMoney(c.total, tag.currency)} <span className="text-slate-500">({p.toFixed(1)}%)</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${p}%` }} />
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {(txState.data?.length ?? 0) > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Tagged transactions</h2>
          <Card className="!p-0">
            <ul className="divide-y divide-slate-800">
              {(txState.data ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="flex items-center gap-3">
                    {t.kind === 'transfer' ? (
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-400">↔</span>
                    ) : (
                      <CategoryCoin name={t.category_name ?? 'Uncategorised'} color={t.category_color} icon={t.category_icon} size="sm" />
                    )}
                    <div>
                      <div className="text-sm font-medium text-slate-50">
                        {t.category_name ?? (t.kind === 'transfer' ? 'Transfer' : 'Uncategorised')}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatRelativeDate(t.occurred_on)} · {t.account_name}{t.note ? ` · ${t.note}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className={`text-sm font-semibold tabular-nums ${t.amount_minor < 0 ? 'text-clay-400' : 'text-mint-400'}`}>
                    {formatMoney(t.amount_minor, t.account_currency, { signed: true })}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {tag.tx_count === 0 && (
        <EmptyState
          title="Nothing tagged yet"
          description="Pick this tag while adding a transaction, or select rows on the Transactions page and assign them here."
        />
      )}

      {formModal}
    </PageShell>
  );
}

interface TagFormModalProps {
  open: boolean;
  existing?: TagWithSpend | null;
  onClose: () => void;
}

function TagFormModal({ open, existing, onClose }: TagFormModalProps) {
  const db = useDB();
  const defaultCurrency = useDefaultCurrency();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState(PRESET_COLORS[8]);
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [budgetInput, setBudgetInput] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setIcon(existing?.icon ?? null);
    setColor(existing?.color ?? PRESET_COLORS[8]);
    setStartsOn(existing?.starts_on ?? '');
    setEndsOn(existing?.ends_on ?? '');
    setBudgetInput(
      existing?.budget_minor != null ? String(fromMinor(existing.budget_minor, existing.currency)) : '',
    );
    setCurrency(existing?.currency ?? defaultCurrency);
  }, [open, existing, defaultCurrency]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    const budgetMinor = budgetInput.trim() ? parseAmount(budgetInput, currency) : null;
    setSubmitting(true);
    try {
      const input: TagInput = {
        name: name.trim(),
        icon: icon || null,
        color,
        starts_on: startsOn || null,
        ends_on: endsOn || null,
        budget_minor: budgetMinor && budgetMinor > 0 ? budgetMinor : null,
        currency,
      };
      if (existing) await updateTag(db, existing.id, input);
      else await createTag(db, input);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!existing) return;
    await archiveTag(db, existing.id);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit tag' : 'New tag'}>
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Goa trip" autoFocus />

        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">Icon</label>
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            <button
              type="button"
              onClick={() => setIcon(null)}
              className={`flex h-9 items-center justify-center rounded-md text-xs ${
                icon === null ? 'bg-brand-500/30 ring-1 ring-brand-400 text-slate-50' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              None
            </button>
            {PRESET_ICONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setIcon(emoji)}
                className={`flex h-9 items-center justify-center rounded-md text-lg ${
                  icon === emoji ? 'bg-brand-500/30 ring-1 ring-brand-400' : 'bg-slate-800 hover:bg-slate-700'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">Color</label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-md ${
                  color.toLowerCase() === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' : ''
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-xs text-slate-400">Add dates to track this as a trip with budget progress (optional).</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Input label="From" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            <Input label="To" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Input
              label="Budget"
              inputMode="decimal"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              placeholder="Optional"
            />
            <Combobox
              label="Currency"
              value={currency}
              onChange={setCurrency}
              options={CURRENCY_OPTIONS}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          {existing ? (
            <Button variant="danger" size="sm" onClick={handleArchive}>Archive</Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
              {existing ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
