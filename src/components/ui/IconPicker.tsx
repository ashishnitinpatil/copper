import type { ReactNode } from 'react';
import { Glyph, lineIconFor } from './Glyph';
import type { LucideIcon } from 'lucide-react';

// Each choice is stored as an emoji (plain text that shows sensibly on any
// device or older copy of the app) and drawn as the matching line icon — see
// Glyph.tsx. Every emoji listed here must have a line icon there.
export const CATEGORY_ICON_GROUPS: { label: string; icons: string[] }[] = [
  { label: 'Food & drink', icons: ['🍽️', '🛒', '🍔', '🍕', '🍜', '🍣', '🥗', '🥐', '🍰', '🍦', '☕', '🍵', '🍺', '🍷', '🍸', '🥤', '🍎', '🥦', '🥩', '🍳', '🥡', '🍿'] },
  { label: 'Home & bills', icons: ['🏠', '🔑', '💡', '🔌', '💧', '🔥', '📶', '📱', '📺', '🛋️', '🛏️', '🧹', '🧺', '🧼', '🔧', '🪴', '🧾', '🗑️'] },
  { label: 'Getting around', icons: ['🚗', '⛽', '🅿️', '🚕', '🚌', '🚇', '🚆', '🛵', '🚲', '✈️', '🧳', '🏨', '🗺️', '🛣️', '🔩', '🚙'] },
  { label: 'Shopping', icons: ['🛍️', '👕', '👗', '👟', '👜', '💄', '💍', '👓', '⌚', '💻', '🎧', '📷', '🎮', '🧸', '🎁', '📦'] },
  { label: 'Health & care', icons: ['🏥', '💊', '🩺', '🦷', '👁️', '💪', '🧘', '🏋️', '💇', '💅', '🧴', '🩹'] },
  { label: 'Fun & hobbies', icons: ['🎬', '🎵', '🎤', '🎨', '📚', '🎲', '⚽', '🏏', '🎾', '🏊', '⛳', '🎟️', '🎉', '🎸', '📸', '🏕️'] },
  { label: 'Family & pets', icons: ['👶', '🍼', '🧒', '🎓', '🏫', '✏️', '👪', '❤️', '💐', '🐶', '🐱', '🐾', '🐟', '🐦'] },
  { label: 'Money & work', icons: ['💼', '💰', '💵', '💳', '🏦', '📈', '📉', '🪙', '💸', '🧮', '🏛️', '🤝', '🎯', '📊', '🔁', '↩️'] },
  { label: 'Other', icons: ['➕', '⭐', '📌', '🔔', '🌍', '🙏', '⛪', '🕌', '🛕', '🎗️', '🚬', '🧧', '❓', '⚠️'] },
];

export const ACCOUNT_ICON_GROUPS: { label: string; icons: string[] }[] = [
  { label: 'Money', icons: ['🏦', '💳', '💵', '👛', '💰', '🪙', '💶', '💷', '💴', '🧧', '🐷', '🏧'] },
  { label: 'Savings & loans', icons: ['📈', '📊', '🏠', '🚗', '🎓', '🏥', '💍', '🌴', '🛡️', '🧾', '📜', '🤝'] },
  { label: 'Other', icons: ['✈️', '🛒', '📱', '💼', '👶', '❤️', '⭐', '🔒'] },
];

/**
 * A grouped grid of simple line icons. `defaultOption` adds a leading
 * "no icon" choice (value ''). Icons that look the same appear once.
 */
export function IconPicker({
  value,
  onChange,
  groups,
  defaultOption,
}: {
  value: string;
  onChange: (icon: string) => void;
  groups: { label: string; icons: string[] }[];
  defaultOption?: ReactNode;
}) {
  const seen = new Set<LucideIcon>();
  const shown = groups.map((g) => ({
    label: g.label,
    icons: g.icons.filter((i) => {
      const line = lineIconFor(i);
      if (!line || seen.has(line)) return false;
      seen.add(line);
      return true;
    }),
  }));
  // A stored emoji is "selected" wherever its line icon is shown; one with no
  // match here (picked in an older version) gets its own cell so it stays visible.
  const valueLine = lineIconFor(value);
  const isSelected = (icon: string) => icon === value || (!!valueLine && lineIconFor(icon) === valueLine);
  const extra = value && !shown.some((g) => g.icons.some(isSelected)) ? value : '';

  const cell = (icon: string, content: ReactNode, label: string) => (
    <button
      key={icon || 'default'}
      type="button"
      role="radio"
      aria-checked={isSelected(icon)}
      aria-label={label}
      onClick={() => onChange(icon)}
      className={`flex h-9 items-center justify-center rounded-md transition ${
        isSelected(icon)
          ? 'bg-brand-500/20 text-brand-300 ring-1 ring-brand-400'
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
      }`}
    >
      {content}
    </button>
  );
  const grid = 'grid grid-cols-7 gap-1 sm:grid-cols-9';

  return (
    <div>
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-400">Icon</span>
      <div
        className="mt-2 max-h-60 space-y-3 overflow-y-auto rounded-lg border border-slate-800 p-2"
        role="radiogroup"
        aria-label="Icon"
      >
        {(defaultOption || extra) && (
          <div className={grid}>
            {defaultOption && cell('', defaultOption, 'Default icon')}
            {extra && cell(extra, <Glyph icon={extra} className="h-[18px] w-[18px]" />, extra)}
          </div>
        )}
        {shown.map((g) => (
          <div key={g.label}>
            <div className="mb-1.5 text-[11px] font-medium text-slate-500">{g.label}</div>
            <div className={grid}>{g.icons.map((i) => cell(i, <Glyph icon={i} className="h-[18px] w-[18px]" />, i))}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
