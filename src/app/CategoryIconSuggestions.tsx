import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Glyph } from '@/components/ui/Glyph';
import { allIcons } from '@/components/ui/IconPicker';
import { iconName, suggestIcons } from '@/components/ui/iconSearch';
import { useDB } from '@/db/DBProvider';
import { updateCategory } from '@/db/queries/categories';
import type { Category } from '@/db/types';

const normalize = (icon: string | null) => (icon ?? '').trim().replace(/️/g, '');

/** Empty, or the placeholder an import or a new category starts with. */
function hasNoIconOfItsOwn(c: Category): boolean {
  const i = normalize(c.icon);
  return i === '' || i === '🏷' || i === '➕' || (c.kind === 'income' && i === '💰');
}

/**
 * Categories still on the placeholder icon (common after a Monefy import) get
 * a one-step review: an icon suggested from each name, ticked by default,
 * applied together. Hidden when there's nothing to suggest.
 */
export function CategoryIconSuggestions({ categories }: { categories: Category[] }) {
  const db = useDB();
  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const suggestions = useMemo(() => {
    const icons = allIcons();
    return categories
      .filter(hasNoIconOfItsOwn)
      .map((c) => ({ category: c, icon: suggestIcons(c.name, icons, 1)[0] }))
      .filter((s): s is { category: Category; icon: string } => !!s.icon && normalize(s.icon) !== normalize(s.category.icon));
  }, [categories]);

  if (suggestions.length === 0) return null;
  const chosen = suggestions.filter((s) => !skip.has(s.category.id));

  const apply = async () => {
    setSaving(true);
    try {
      for (const { category: c, icon } of chosen) {
        await updateCategory(db, c.id, {
          parent_id: c.parent_id,
          name: c.name,
          kind: c.kind,
          icon,
          color: c.color,
          sort_order: c.sort_order,
        });
      }
      setOpen(false);
      setSkip(new Set());
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Sparkles className="h-4 w-4 shrink-0 text-brand-400" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-slate-300">
            {suggestions.length === 1 ? '1 category has' : `${suggestions.length} categories have`} no icon of
            {suggestions.length === 1 ? ' its' : ' their'} own yet. Copper can suggest one from the name.
          </p>
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Suggest icons
          </Button>
        </div>
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Suggested icons">
        <p className="mb-3 text-xs text-slate-500">Untick any you'd rather pick yourself.</p>
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
          {suggestions.map(({ category: c, icon }) => (
            <li key={c.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-800/60">
                <input
                  type="checkbox"
                  checked={!skip.has(c.id)}
                  onChange={(e) =>
                    setSkip((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-brand-500"
                />
                <Glyph icon={icon} className="h-[18px] w-[18px] text-slate-300" />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{c.name}</span>
                <span className="text-xs text-slate-500">{iconName(icon)}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={saving || chosen.length === 0} onClick={() => void apply()}>
            {chosen.length === 1 ? 'Use 1 icon' : `Use ${chosen.length} icons`}
          </Button>
        </div>
      </Modal>
    </>
  );
}
