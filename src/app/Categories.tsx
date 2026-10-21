import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATEGORY_ICON_GROUPS, IconPicker } from '@/components/ui/IconPicker';
import { Pipette, Plus } from 'lucide-react';
import { PageShell } from './PageShell';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Combobox } from '@/components/ui/Combobox';
import { Modal } from '@/components/ui/Modal';
import { CategoryCoin } from '@/components/ui/CategoryCoin';
import { MergeInto } from '@/components/MergeInto';
import { useDB } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import {
  archiveCategory,
  buildCategoryPath,
  buildCategoryTree,
  createCategory,
  getDescendantIds,
  listCategories,
  updateCategory,
  type CategoryNode,
} from '@/db/queries/categories';
import { mergeCategory, previewCategoryMerge } from '@/db/queries/merge';
import type { Category, CategoryKind } from '@/db/types';

// Ordered by hue (red → orange → yellow → green → cyan → blue → purple → pink).
const PRESET_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#84cc16', // lime
  '#22c55e', // green
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#ec4899', // pink
];
const RAINBOW_GRADIENT =
  'conic-gradient(from 0deg, #ef4444, #f97316, #f59e0b, #84cc16, #22c55e, #10b981, #06b6d4, #0ea5e9, #3b82f6, #8b5cf6, #a855f7, #ec4899, #ef4444)';

export function Categories() {
  const [editing, setEditing] = useState<Category | null>(null);
  const [creatingUnder, setCreatingUnder] = useState<{ parentId: string | null; kind: CategoryKind } | null>(null);

  const categoriesQuery = useQuery(useCallback((db) => listCategories(db, false), []), {
    deps: ['categories'],
  });
  const allCategories = categoriesQuery.data ?? [];
  const tree = buildCategoryTree(allCategories);

  const expenseRoots = tree.filter((n) => n.kind === 'expense');
  const incomeRoots = tree.filter((n) => n.kind === 'income');

  return (
    <PageShell
      title="Categories"
      subtitle="Your expense and income categories, organised into groups"
    >
      {expenseRoots.length === 0 && incomeRoots.length === 0 && !categoriesQuery.loading && (
        <EmptyState title="No categories yet" description="Start by adding a top-level expense category." />
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-300">Expense</h3>
              <p className="text-xs text-slate-500">{countTree(expenseRoots)} categories</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              aria-label="Add expense category"
              onClick={() => setCreatingUnder({ parentId: null, kind: 'expense' })}
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <CategoryTreeView
            nodes={expenseRoots}
            onEdit={setEditing}
            onAddChild={(parentId) => setCreatingUnder({ parentId, kind: 'expense' })}
          />
        </Card>
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-300">Income</h3>
              <p className="text-xs text-slate-500">{countTree(incomeRoots)} categories</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              aria-label="Add income category"
              onClick={() => setCreatingUnder({ parentId: null, kind: 'income' })}
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          <CategoryTreeView
            nodes={incomeRoots}
            onEdit={setEditing}
            onAddChild={(parentId) => setCreatingUnder({ parentId, kind: 'income' })}
          />
        </Card>
      </div>

      <CategoryFormModal
        open={creatingUnder !== null}
        onClose={() => setCreatingUnder(null)}
        initialParentId={creatingUnder?.parentId ?? null}
        kind={creatingUnder?.kind ?? 'expense'}
        existing={null}
        allCategories={allCategories}
      />
      <CategoryFormModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        initialParentId={editing?.parent_id ?? null}
        kind={editing?.kind ?? 'expense'}
        existing={editing}
        allCategories={allCategories}
      />
    </PageShell>
  );
}

function countTree(nodes: CategoryNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countTree(n.children), 0);
}

interface CategoryTreeViewProps {
  nodes: CategoryNode[];
  depth?: number;
  onEdit: (cat: Category) => void;
  onAddChild: (parentId: string) => void;
}

function CategoryTreeView({ nodes, depth = 0, onEdit, onAddChild }: CategoryTreeViewProps) {
  if (nodes.length === 0) {
    return <p className="text-xs text-slate-500">None yet — tap Add to create one.</p>;
  }
  return (
    <ul className="space-y-1">
      {nodes.map((n) => (
        <li key={n.id}>
          <div
            className="group flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-800/60"
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
          >
            <button onClick={() => onEdit(n)} className="flex flex-1 items-center gap-2 text-left">
              <CategoryCoin name={n.name} color={n.color} icon={n.icon} size="sm" />
              <span className="text-slate-200">{n.name}</span>
            </button>
            <button
              onClick={() => onAddChild(n.id)}
              className="rounded px-2 py-0.5 text-xs text-slate-500 opacity-0 transition group-hover:opacity-100 hover:bg-slate-700 hover:text-slate-50"
              title="Add subcategory"
            >
              + Subcategory
            </button>
          </div>
          {n.children.length > 0 && (
            <CategoryTreeView nodes={n.children} depth={depth + 1} onEdit={onEdit} onAddChild={onAddChild} />
          )}
        </li>
      ))}
    </ul>
  );
}

interface CategoryFormModalProps {
  open: boolean;
  onClose: () => void;
  initialParentId: string | null;
  kind: CategoryKind;
  existing: Category | null;
  allCategories: Category[];
}

function CategoryFormModal({
  open,
  onClose,
  initialParentId,
  kind,
  existing,
  allCategories,
}: CategoryFormModalProps) {
  const db = useDB();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('➕');
  const [color, setColor] = useState('#94a3b8');
  const [parentId, setParentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mergeImpact, setMergeImpact] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setIcon(existing?.icon ?? '➕');
    setColor(existing?.color ?? '#94a3b8');
    setParentId(existing?.parent_id ?? initialParentId);
  }, [open, existing, initialParentId]);

  useEffect(() => {
    if (!open || !existing) return;
    setMergeImpact(null);
    previewCategoryMerge(db, existing.id).then(setMergeImpact);
  }, [open, existing, db]);

  const parentOptions = useMemo(() => {
    const excluded = new Set<string>();
    if (existing) {
      excluded.add(existing.id);
      for (const id of getDescendantIds(allCategories, existing.id)) excluded.add(id);
    }
    return allCategories
      .filter((c) => c.kind === kind && !excluded.has(c.id))
      .map((c) => ({ id: c.id, label: buildCategoryPath(allCategories, c.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allCategories, kind, existing]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      if (existing) {
        await updateCategory(db, existing.id, {
          parent_id: parentId,
          name: name.trim(),
          kind,
          icon,
          color,
          sort_order: existing.sort_order,
        });
      } else {
        await createCategory(db, {
          parent_id: parentId,
          name: name.trim(),
          kind,
          icon,
          color,
          sort_order: 0,
        });
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!existing) return;
    await archiveCategory(db, existing.id);
    onClose();
  };

  const handleMerge = async (targetId: string) => {
    if (!existing) return;
    await mergeCategory(db, existing.id, targetId);
    onClose();
  };

  const title = existing ? 'Edit category' : parentId ? 'New subcategory' : `New ${kind} category`;

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Groceries" autoFocus />
        <Combobox
          label="Parent"
          value={parentId ?? ''}
          onChange={(v) => setParentId(v || null)}
          emptyOption={{ value: '', label: '— None (top level) —' }}
          options={parentOptions.map((o) => ({ value: o.id, label: o.label }))}
        />
        <IconPicker value={icon} onChange={setIcon} groups={CATEGORY_ICON_GROUPS} suggestFrom={name} />
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
            <label
              className={`relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-md ${
                !PRESET_COLORS.includes(color.toLowerCase())
                  ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900'
                  : ''
              }`}
              style={{ background: RAINBOW_GRADIENT }}
              title="Pick a custom color"
            >
              <Pipette className="h-3.5 w-3.5 text-slate-50 mix-blend-difference" />
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus:outline-none"
              />
            </label>
          </div>
          {!PRESET_COLORS.includes(color.toLowerCase()) && (
            <p className="mt-1 font-mono text-xs text-slate-500">{color.toUpperCase()}</p>
          )}
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
            <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
              {existing ? 'Save' : 'Create'}
            </Button>
          </div>
        </div>
        {existing && (
          <MergeInto
            key={existing.id}
            noun="category"
            extras="budgets, sub-categories and recurring entries"
            sourceName={existing.name}
            impact={mergeImpact}
            options={parentOptions.map((o) => ({ value: o.id, label: o.label }))}
            onMerge={handleMerge}
          />
        )}
      </div>
    </Modal>
  );
}
