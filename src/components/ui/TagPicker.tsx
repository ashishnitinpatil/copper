import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import type { Tag } from '@/db/types';
import { Glyph } from '@/components/ui/Glyph';

const DEFAULT_DOT = '#94a3b8'; // slate-400, for tags without a color

/** A small read-only pill naming a tag, tinted with its color. */
export function TagChip({ tag, className = '' }: { tag: Pick<Tag, 'name' | 'color' | 'icon'>; className?: string }) {
  const color = tag.color ?? DEFAULT_DOT;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none text-slate-200 ${className}`}
      style={
        {
          borderColor: `${color}55`,
          backgroundColor: `${color}1a`,
        } as CSSProperties
      }
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      <Glyph icon={tag.icon} className="h-3 w-3 opacity-80" />
      {tag.name}
    </span>
  );
}

interface TagPickerProps {
  tags: Tag[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  className?: string;
}

/** Multi-select toggle chips. Tapping a chip adds/removes that tag. */
export function TagPicker({ tags, selected, onToggle, className = '' }: TagPickerProps) {
  if (tags.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {tags.map((t) => {
        const on = selected.has(t.id);
        const color = t.color ?? DEFAULT_DOT;
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition active:scale-95 ${
              on
                ? 'text-slate-50'
                : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600 hover:text-slate-100'
            }`}
            style={
              on
                ? ({ borderColor: color, backgroundColor: `${color}26` } as CSSProperties)
                : undefined
            }
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            <Glyph icon={t.icon} className="h-3 w-3 opacity-80" />
            {t.name}
            {on && <Check className="h-3 w-3" />}
          </button>
        );
      })}
    </div>
  );
}
