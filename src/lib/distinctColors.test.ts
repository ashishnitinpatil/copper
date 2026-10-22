import { describe, expect, it } from 'vitest';
import { colorDistance, distinctColors } from './distinctColors';

const GREY = '#94a3b8';

describe('distinctColors', () => {
  it('keeps colours that already stand apart', () => {
    const colors = ['#E6A532', '#C792EA', '#3F8F7A'];
    expect(distinctColors(colors)).toEqual(colors);
  });

  it('swaps a later clash, keeping the bigger slice its own colour', () => {
    // Mint and leaf: the two greens imported categories often land on.
    const [first, second] = distinctColors(['#6FBF9B', '#98C379']);
    expect(first).toBe('#6FBF9B');
    expect(colorDistance(first, second)).toBeGreaterThanOrEqual(0.08);
  });

  it('gives the same colour twice two different colours', () => {
    const out = distinctColors(['#6FBF9B', '#6FBF9B', '#6FBF9B']);
    expect(new Set(out).size).toBe(3);
  });

  it('keeps clear of a fixed colour like the grey "more" slice', () => {
    const [sky] = distinctColors(['#7FB3D5'], [GREY]);
    expect(colorDistance(sky, GREY)).toBeGreaterThanOrEqual(0.08);
  });

  it('every pair stays apart even when all slices start the same', () => {
    const out = distinctColors(Array(7).fill('#98C379'), [GREY]);
    for (let i = 0; i < out.length; i++) {
      expect(colorDistance(out[i], GREY)).toBeGreaterThanOrEqual(0.08);
      for (let j = i + 1; j < out.length; j++) expect(colorDistance(out[i], out[j])).toBeGreaterThanOrEqual(0.08);
    }
  });

  it('leaves colours it cannot read alone', () => {
    expect(distinctColors(['tomato', 'tomato'])).toEqual(['tomato', 'tomato']);
  });
});
