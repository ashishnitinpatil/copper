import { describe, it, expect } from 'vitest';
import { fuzzyScore, levenshtein, tokenize } from './fuzzy';

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenize('Starbucks Coffee — Nov!')).toEqual(['starbucks', 'coffee', 'nov']);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('levenshtein', () => {
  it('measures edits and bails past max', () => {
    expect(levenshtein('starbucks', 'starbucks', 2)).toBe(0);
    expect(levenshtein('starbacks', 'starbucks', 2)).toBe(1); // one substitution
    expect(levenshtein('cat', 'dog', 2)).toBe(3); // exceeds max → max + 1
  });
});

describe('fuzzyScore', () => {
  it('scores an exact word highest', () => {
    expect(fuzzyScore('coffee', 'morning coffee')).toBe(1);
  });

  it('rewards prefix over arbitrary substring', () => {
    const prefix = fuzzyScore('star', 'starbucks downtown');
    const substring = fuzzyScore('buck', 'starbucks downtown');
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(0);
  });

  it('tolerates a dropped letter (subsequence)', () => {
    expect(fuzzyScore('stabuks', 'starbucks coffee')).toBeGreaterThan(0);
  });

  it('tolerates a single typo (substitution)', () => {
    expect(fuzzyScore('starbacks', 'starbucks coffee')).toBeGreaterThan(0);
  });

  it('requires every query word to match (AND)', () => {
    expect(fuzzyScore('coffee zzzzz', 'morning coffee')).toBe(0);
    expect(fuzzyScore('morning coffee', 'morning coffee run')).toBeGreaterThan(0);
  });

  it('is order-independent across words', () => {
    expect(fuzzyScore('coffee morning', 'morning coffee')).toBeGreaterThan(0);
  });

  it('returns 0 for unrelated text', () => {
    expect(fuzzyScore('groceries', 'fuel station')).toBe(0);
  });

  it('does not fuzzy-match very short tokens', () => {
    // 2-char tokens only match exact/prefix/substring, never by edit distance.
    expect(fuzzyScore('xy', 'ab cd')).toBe(0);
  });
});
