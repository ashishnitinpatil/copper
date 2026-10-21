import { useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Glyph, lineIconFor } from './Glyph';
import { iconName, searchIcons, suggestIcons } from './iconSearch';
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

/** Every icon Copper offers, once each — for search and suggestions. */
export function allIcons(): string[] {
  return distinct([...CATEGORY_ICON_GROUPS.flatMap((g) => g.icons), ...ACCOUNT_ICON_GROUPS.flatMap((g) => g.icons)]);
}

/** Drops icons with no line drawing, and ones that look like one already kept. */
function distinct(icons: string[], seen = new Set<LucideIcon>()): string[] {
  return icons.filter((i) => {
    const line = lineIconFor(i);
    if (!line || seen.has(line)) return false;
    seen.add(line);
    return true;
  });
}

/**
 * A grouped grid of simple line icons, searchable by word, with suggestions
 * from `suggestFrom` (the name being typed). `defaultOption` adds a leading
 * "no icon" choice (value ''). Icons that look the same appear once.
 */
export function IconPicker({
  value,
  onChange,
  groups,
  defaultOption,
  suggestFrom,
}: {
  value: string;
  onChange: (icon: string) => void;
  groups: { label: string; icons: string[] }[];
  defaultOption?: ReactNode;
  suggestFrom?: string;
}) {
  const [query, setQuery] = useState('');
  const seen = new Set<LucideIcon>();
  const shown = groups.map((g) => ({ label: g.label, icons: distinct(g.icons, seen) }));
  // Search and suggestions look past this picker's own groups, so any icon
  // can be found by name.
  const everything = distinct([...shown.flatMap((g) => g.icons), ...CATEGORY_ICON_GROUPS.flatMap((g) => g.icons), ...ACCOUNT_ICON_GROUPS.flatMap((g) => g.icons)]);
  const results = query.trim() ? searchIcons(query, everything) : null;
  const suggested = !results && suggestFrom ? suggestIcons(suggestFrom, everything) : [];
  // A stored emoji is "selected" wherever its line icon is shown; one with no
  // match here (picked in an older version) gets its own cell so it stays visible.
  const valueLine = lineIconFor(value);
  const isSelected = (icon: string) => icon === value || (!!valueLine && lineIconFor(icon) === valueLine);
  const extra = value && !everything.some(isSelected) ? value : '';

  const cell = (key: string, content: ReactNode, label: string, icon = key) => (
    <button
      key={key || 'default'}
      type="button"
      role="radio"
      aria-checked={isSelected(icon)}
      aria-label={label}
      title={label}
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
      <div className="flex items-center justify-between gap-3">
        <span className="block text-xs font-medium uppercase tracking-wide text-slate-400">Icon</span>
        <label className="flex min-w-0 max-w-[12rem] flex-1 items-center gap-1.5 rounded-md border border-slate-800 px-2 py-1 focus-within:border-brand-500">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons"
            aria-label="Search icons"
            className="min-w-0 flex-1 bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </label>
      </div>
      <div
        className="mt-2 max-h-60 space-y-3 overflow-y-auto rounded-lg border border-slate-800 p-2"
        role="radiogroup"
        aria-label="Icon"
      >
        {results ? (
          results.length > 0 ? (
            <div className={grid}>{results.map((i) => cell(i, <Glyph icon={i} className="h-[18px] w-[18px]" />, iconName(i)))}</div>
          ) : (
            <p className="px-1 py-3 text-center text-xs text-slate-500">No icon for “{query.trim()}”. Try another word.</p>
          )
        ) : (
          <>
            {(defaultOption || extra) && (
              <div className={grid}>
                {defaultOption && cell('', defaultOption, 'Default icon')}
                {extra && cell(extra, <Glyph icon={extra} className="h-[18px] w-[18px]" />, iconName(extra))}
              </div>
            )}
            {suggested.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-slate-500">Suggested for “{suggestFrom?.trim()}”</div>
                <div className={grid}>
                  {suggested.map((i) => cell(`s:${i}`, <Glyph icon={i} className="h-[18px] w-[18px]" />, iconName(i), i))}
                </div>
              </div>
            )}
            {shown.map((g) => (
              <div key={g.label}>
                <div className="mb-1.5 text-[11px] font-medium text-slate-500">{g.label}</div>
                <div className={grid}>{g.icons.map((i) => cell(i, <Glyph icon={i} className="h-[18px] w-[18px]" />, iconName(i)))}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
