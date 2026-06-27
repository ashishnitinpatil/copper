import { describe, expect, it } from 'vitest';
import { buildCategoryPath, getDescendantIds } from './categories';
import type { Category } from '../types';

function cat(id: string, name: string, parent_id: string | null = null): Category {
  return {
    id,
    name,
    parent_id,
    kind: 'expense',
    icon: null,
    color: null,
    sort_order: 0,
    archived_at: null,
    created_at: '',
  };
}

describe('getDescendantIds', () => {
  it('returns empty set for leaf', () => {
    const cats = [cat('a', 'A'), cat('b', 'B', 'a')];
    expect(getDescendantIds(cats, 'b')).toEqual(new Set());
  });

  it('returns direct children', () => {
    const cats = [cat('a', 'A'), cat('b', 'B', 'a'), cat('c', 'C', 'a')];
    expect(getDescendantIds(cats, 'a')).toEqual(new Set(['b', 'c']));
  });

  it('walks deep descendants', () => {
    const cats = [
      cat('a', 'A'),
      cat('b', 'B', 'a'),
      cat('c', 'C', 'b'),
      cat('d', 'D', 'c'),
    ];
    expect(getDescendantIds(cats, 'a')).toEqual(new Set(['b', 'c', 'd']));
  });

  it('handles branching trees', () => {
    const cats = [
      cat('root', 'R'),
      cat('a', 'A', 'root'),
      cat('b', 'B', 'root'),
      cat('a1', 'A1', 'a'),
      cat('b1', 'B1', 'b'),
      cat('other', 'Other'),
    ];
    expect(getDescendantIds(cats, 'root')).toEqual(new Set(['a', 'b', 'a1', 'b1']));
    expect(getDescendantIds(cats, 'a')).toEqual(new Set(['a1']));
  });

  it('does not loop on orphan or self-ref data', () => {
    const cats = [cat('a', 'A', 'b'), cat('b', 'B', 'a')];
    const result = getDescendantIds(cats, 'a');
    expect(result.size).toBeLessThanOrEqual(2);
  });
});

describe('buildCategoryPath', () => {
  it('returns single name for root', () => {
    const cats = [cat('a', 'Food')];
    expect(buildCategoryPath(cats, 'a')).toBe('Food');
  });

  it('joins parent chain with separator', () => {
    const cats = [cat('a', 'Food'), cat('b', 'Eating Out', 'a'), cat('c', 'Coffee', 'b')];
    expect(buildCategoryPath(cats, 'c')).toBe('Food › Eating Out › Coffee');
  });

  it('returns empty for unknown id', () => {
    expect(buildCategoryPath([cat('a', 'A')], 'nope')).toBe('');
  });
});
