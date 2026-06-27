import { describe, expect, it } from 'vitest';
import { categoryStyle } from './categoryStyle';

describe('categoryStyle', () => {
  it('uses a stored icon and color when present (trimmed)', () => {
    const s = categoryStyle('Groceries', '  #123456 ', ' 🛒 ');
    expect(s.color).toBe('#123456');
    expect(s.glyph).toBe('🛒');
    expect(s.isMonogram).toBe(false);
  });

  it('falls back to a monogram glyph when no icon', () => {
    const s = categoryStyle('Groceries', '#123456', null);
    expect(s.glyph).toBe('GR');
    expect(s.isMonogram).toBe(true);
  });

  it('treats blank/whitespace icon and color as absent', () => {
    const s = categoryStyle('Food', '   ', '  ');
    expect(s.isMonogram).toBe(true);
    expect(s.glyph).toBe('FO');
    // color comes from the fallback palette, never an empty string
    expect(s.color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('derives a stable fallback color from the name', () => {
    const a = categoryStyle('Transport').color;
    const b = categoryStyle('Transport').color;
    expect(a).toBe(b);
  });

  describe('monogram', () => {
    it('single word → first two letters uppercased', () => {
      expect(categoryStyle('coffee').glyph).toBe('CO');
    });

    it('multi word → first letter of each of the first two words', () => {
      expect(categoryStyle('Eating Out').glyph).toBe('EO');
    });

    it('splits on slashes, ampersands, underscores and dashes', () => {
      expect(categoryStyle('Food/Drink').glyph).toBe('FD');
      expect(categoryStyle('Bills & Utilities').glyph).toBe('BU');
      expect(categoryStyle('health_care').glyph).toBe('HC');
    });

    it('falls back to a bullet for an empty name', () => {
      expect(categoryStyle('   ').glyph).toBe('•');
    });
  });
});
