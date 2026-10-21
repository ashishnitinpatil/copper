import { describe, expect, it } from 'vitest';
import { iconName, searchIcons, suggestIcons } from './iconSearch';
import { ICON_WORDS } from './iconWords';
import { lineIconFor } from './Glyph';
import { ACCOUNT_ICON_GROUPS, CATEGORY_ICON_GROUPS } from './IconPicker';

const all = [...new Set([...CATEGORY_ICON_GROUPS, ...ACCOUNT_ICON_GROUPS].flatMap((g) => g.icons))];

describe('icon search', () => {
  it('has words for every icon the pickers offer, and only for real icons', () => {
    expect(all.filter((i) => iconName(i) === i)).toEqual([]);
    expect(Object.keys(ICON_WORDS).filter((e) => !lineIconFor(e))).toEqual([]);
  });

  it('finds icons by any of their words, from the first letters', () => {
    expect(searchIcons('petrol', all)).toContain('⛽');
    expect(searchIcons('petr', all)).toContain('⛽');
    expect(searchIcons('RENT', all)).toContain('🏠');
    expect(searchIcons('groceries', all)[0]).toBe('🛒');
    expect(searchIcons('zzz', all)).toEqual([]);
    expect(searchIcons('  ', all)).toEqual([]);
  });

  it('needs every word typed to match', () => {
    expect(searchIcons('credit card', all)).toEqual(['💳']);
  });

  it('suggests icons from a name', () => {
    expect(suggestIcons('Petrol', all)[0]).toBe('⛽');
    expect(suggestIcons('Eating out', all)[0]).toBe('🍽️');
    expect(suggestIcons('HDFC Credit Card', all)[0]).toBe('💳');
    expect(suggestIcons('Kids school fees', all)).toContain('🎓');
    expect(suggestIcons('Xy', all)).toEqual([]);
  });

  it('names icons for screen readers', () => {
    expect(iconName('⛽')).toBe('fuel');
    expect(iconName('🍽️')).toBe('food');
  });
});
