import type { ReactNode } from 'react';

// Emoji are plain text, so a chosen icon shows the same in every list,
// dropdown and on every synced device — no icon set to keep in step.
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

/** The last character typed or pasted, so tapping a new emoji replaces the old one. */
function lastGlyph(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)];
    return parts[parts.length - 1].segment;
  }
  return Array.from(trimmed).pop() ?? '';
}

/**
 * A grouped grid of emoji to choose from, plus a box for any other emoji.
 * `defaultOption` adds a leading "no icon" choice (value '').
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
  const cell = (icon: string, content: ReactNode, label: string) => (
    <button
      key={icon || 'default'}
      type="button"
      role="radio"
      aria-checked={value === icon}
      aria-label={label}
      onClick={() => onChange(icon)}
      className={`flex h-9 items-center justify-center rounded-md text-lg transition ${
        value === icon ? 'bg-brand-500/30 ring-1 ring-brand-400' : 'bg-slate-800/70 hover:bg-slate-700'
      }`}
    >
      {content}
    </button>
  );

  return (
    <div>
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-400">Icon</span>
      <div
        className="mt-2 max-h-60 space-y-3 overflow-y-auto rounded-lg border border-slate-800 p-2"
        role="radiogroup"
        aria-label="Icon"
      >
        {defaultOption && (
          <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-9">{cell('', defaultOption, 'Default icon')}</div>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="mb-1.5 text-[11px] font-medium text-slate-500">{g.label}</div>
            <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-9">{g.icons.map((i) => cell(i, i, i))}</div>
          </div>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
        Or any emoji
        <input
          // Shows the current icon so one picked earlier (or typed) stays visible.
          value={value}
          onChange={(e) => onChange(lastGlyph(e.target.value))}
          aria-label="Any emoji"
          className="h-9 w-14 rounded-md border border-slate-700 bg-slate-900 text-center text-lg text-slate-100 focus:border-brand-400 focus:outline-none"
        />
      </label>
    </div>
  );
}
