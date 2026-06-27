import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageShell } from './PageShell';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Combobox } from '@/components/ui/Combobox';
import { Modal } from '@/components/ui/Modal';
import { useDB } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import {
  getBudgetsWithSpent,
  createBudget,
  updateBudget,
  archiveBudget,
  type BudgetInput,
  type BudgetWithSpent,
} from '@/db/queries/budgets';
import { listCategories } from '@/db/queries/categories';
import type { Category } from '@/db/types';
import { formatMoney, parseAmount, fromMinor, SUPPORTED_CURRENCIES } from '@/lib/money';
import { convert } from '@/lib/fx';
import { toDateString, startOfMonth } from '@/lib/dates';
import { useAppSettings, useDefaultCurrency } from './AppSettingsProvider';

export function Budgets() {
  const [editing, setEditing] = useState<BudgetWithSpent | null>(null);
  const [creating, setCreating] = useState(false);
  const { defaultCurrency, fxRates } = useAppSettings();

  const [month, setMonth] = useState(() => toDateString().slice(0, 7));
  const refDate = month + '-01';

  const budgetsState = useQuery<BudgetWithSpent[]>(
    useCallback(
      (d) => getBudgetsWithSpent(d, refDate, defaultCurrency, fxRates),
      [refDate, defaultCurrency, fxRates],
    ),
    { deps: ['budgets', 'transactions', 'accounts', 'categories'] },
  );

  const categoriesState = useQuery<Category[]>(
    useCallback((d) => listCategories(d), []),
    { deps: ['categories'] },
  );

  const budgets = budgetsState.data ?? [];
  const categories = categoriesState.data ?? [];
  const expenseCategories = useMemo(
    () => categories.filter((c) => c.kind === 'expense'),
    [categories],
  );

  const totalBudgeted = budgets.reduce(
    (s, b) => s + convert(b.amount_minor, b.currency, defaultCurrency, defaultCurrency, fxRates),
    0,
  );
  const totalSpent = budgets.reduce(
    (s, b) => s + convert(b.spent_minor, b.currency, defaultCurrency, defaultCurrency, fxRates),
    0,
  );

  return (
    <PageShell
      title="Budgets"
      subtitle="Monthly spending limits by category"
      actions={<Button onClick={() => setCreating(true)}>+ New budget</Button>}
    >
      <div className="flex items-center gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-50 focus:border-brand-500 focus:outline-none"
        />
        {budgets.length > 0 && (
          <div className="text-sm text-slate-400">
            {formatMoney(totalSpent, defaultCurrency, { withSymbol: false })} /{' '}
            {formatMoney(totalBudgeted, defaultCurrency, { withSymbol: false })} spent
          </div>
        )}
      </div>

      {budgets.length === 0 && !budgetsState.loading && (
        <EmptyState
          title="No budgets set"
          description="Set monthly caps for expense categories to track spending."
          action={<Button onClick={() => setCreating(true)}>+ New budget</Button>}
        />
      )}

      {budgets.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((b) => (
            <BudgetCard key={b.id} budget={b} onEdit={() => setEditing(b)} />
          ))}
        </div>
      )}

      <BudgetFormModal
        open={creating}
        categories={expenseCategories}
        onClose={() => setCreating(false)}
      />
      <BudgetFormModal
        open={editing !== null}
        categories={expenseCategories}
        existing={editing}
        onClose={() => setEditing(null)}
      />
    </PageShell>
  );
}

function BudgetCard({ budget, onEdit }: { budget: BudgetWithSpent; onEdit: () => void }) {
  const pct = budget.amount_minor > 0 ? Math.min((budget.spent_minor / budget.amount_minor) * 100, 100) : 0;
  const over = budget.spent_minor > budget.amount_minor;
  const barColor = over ? 'bg-clay-500' : pct > 80 ? 'bg-amber-500' : 'bg-mint-500';

  return (
    <button
      onClick={onEdit}
      className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-500"
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{budget.category_icon ?? '•'}</span>
        <span className="text-sm font-medium text-slate-50">{budget.category_name}</span>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <span className={`text-lg font-semibold tabular-nums ${over ? 'text-clay-400' : 'text-slate-50'}`}>
          {formatMoney(budget.spent_minor, budget.currency)}
        </span>
        <span className="text-sm text-slate-500">
          / {formatMoney(budget.amount_minor, budget.currency)}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-800">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {over && (
        <div className="mt-1 text-xs text-clay-400">
          Over by {formatMoney(budget.spent_minor - budget.amount_minor, budget.currency)}
        </div>
      )}
    </button>
  );
}

interface BudgetFormModalProps {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  existing?: BudgetWithSpent | null;
}

function BudgetFormModal({ open, onClose, categories, existing }: BudgetFormModalProps) {
  const db = useDB();
  const defaultCurrency = useDefaultCurrency();
  const [categoryId, setCategoryId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setCategoryId(existing.category_id);
      setAmountInput(String(fromMinor(existing.amount_minor, existing.currency)));
      setCurrency(existing.currency);
    } else {
      setCategoryId(categories[0]?.id ?? '');
      setAmountInput('');
      setCurrency(defaultCurrency);
    }
  }, [open, existing, categories, defaultCurrency]);

  const handleSubmit = async () => {
    const minor = parseAmount(amountInput, currency);
    if (!categoryId || !minor || minor <= 0) return;
    setSubmitting(true);
    try {
      const input: BudgetInput = {
        category_id: categoryId,
        period: 'monthly',
        amount_minor: minor,
        currency,
        starts_on: toDateString(startOfMonth()),
      };
      if (existing) {
        await updateBudget(db, existing.id, input);
      } else {
        await createBudget(db, input);
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!existing) return;
    await archiveBudget(db, existing.id);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit budget' : 'New budget'}>
      <div className="space-y-3">
        <Combobox
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          emptyOption={{ value: '', label: 'Select…' }}
          options={categories.map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim() }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Monthly cap"
            inputMode="decimal"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            placeholder="5000"
            autoFocus
          />
          <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.symbol}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2">
          {existing ? (
            <Button variant="danger" size="sm" onClick={handleArchive}>
              Archive
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || !categoryId || !amountInput}>
              {existing ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
