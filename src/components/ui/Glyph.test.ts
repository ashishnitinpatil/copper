import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lineIconFor } from './Glyph';
import { ACCOUNT_ICON_GROUPS, CATEGORY_ICON_GROUPS } from './IconPicker';

// Every icon Copper hands out itself — defaults, Monefy import, the pickers —
// must draw as a line icon, or it shows up as a stray emoji.
const quotedEmoji = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/'([^\x00-\x7F][^']{0,8})'/g)].map((m) => m[1]);

describe('line icons', () => {
  it('cover every icon the app assigns', () => {
    const assigned = [
      ...CATEGORY_ICON_GROUPS.flatMap((g) => g.icons),
      ...ACCOUNT_ICON_GROUPS.flatMap((g) => g.icons),
      ...quotedEmoji('src/db/seed.ts'),
      ...quotedEmoji('src/features/import/importMonefy.ts'),
      ...quotedEmoji('src/app/Tags.tsx'),
    ];
    expect(assigned.length).toBeGreaterThan(100);
    expect(assigned.filter((e) => !lineIconFor(e))).toEqual([]);
  });

  it('ignores emoji variation selectors', () => {
    expect(lineIconFor('🍽️')).toBe(lineIconFor('🍽'));
    expect(lineIconFor('✈️')).not.toBeNull();
  });

  it('has no icon for an unknown emoji or an empty value', () => {
    expect(lineIconFor('🦄')).toBeNull();
    expect(lineIconFor('')).toBeNull();
    expect(lineIconFor(null)).toBeNull();
  });
});
