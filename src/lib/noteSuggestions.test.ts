import { describe, expect, it } from 'vitest';
import { suggestNotes, type PastNote } from './noteSuggestions';

const past: PastNote[] = [
  { note: 'Coffee at Starbucks', uses: 12, last_on: '2026-10-01' },
  { note: 'Iced coffee', uses: 30, last_on: '2026-10-10' },
  { note: 'Coffee beans', uses: 2, last_on: '2026-10-15' },
  { note: 'Lunch with team', uses: 5, last_on: '2026-09-01' },
  { note: 'Decoffee', uses: 50, last_on: '2026-10-18' },
];

describe('suggestNotes', () => {
  it('offers nothing before anything is typed', () => {
    expect(suggestNotes(past, '  ')).toEqual([]);
  });

  it('puts notes starting with the text first, then word starts, then the rest', () => {
    expect(suggestNotes(past, 'cof')).toEqual(['Coffee at Starbucks', 'Coffee beans', 'Iced coffee', 'Decoffee']);
  });

  it('is case-insensitive and skips a note already typed in full', () => {
    expect(suggestNotes(past, 'LUNCH WITH TEAM')).toEqual([]);
    expect(suggestNotes(past, 'lunch')).toEqual(['Lunch with team']);
  });

  it('caps the list', () => {
    expect(suggestNotes(past, 'e', 2)).toHaveLength(2);
  });
});
