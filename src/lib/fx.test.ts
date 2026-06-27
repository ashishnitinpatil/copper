import { describe, it, expect } from 'vitest';
import { convert, parseFxRates, missingRates } from './fx';

const RATES = { AED: 22.8, JPY: 0.55 }; // expressed in INR (the default)

describe('convert', () => {
  it('returns the amount untouched for same currency', () => {
    expect(convert(12345, 'INR', 'INR', 'INR', RATES)).toBe(12345);
  });

  it('converts a foreign currency into the default (same decimals)', () => {
    // 100.00 AED * 22.8 = 2280.00 INR
    expect(convert(10000, 'AED', 'INR', 'INR', RATES)).toBe(228000);
  });

  it('is decimal-aware across differing precision (JPY has 0 decimals)', () => {
    // ¥1000 * 0.55 = 550.00 INR
    expect(convert(1000, 'JPY', 'INR', 'INR', RATES)).toBe(55000);
  });

  it('round-trips default -> foreign -> default', () => {
    const inr = 55000; // 550.00 INR
    const jpy = convert(inr, 'INR', 'JPY', 'INR', RATES); // -> ¥1000
    expect(jpy).toBe(1000);
    expect(convert(jpy, 'JPY', 'INR', 'INR', RATES)).toBe(inr);
  });

  it('converts between two non-default currencies via the default', () => {
    // 100.00 AED = 2280 INR; 2280 / 0.55 = 4145.45... -> ¥4145
    expect(convert(10000, 'AED', 'JPY', 'INR', RATES)).toBe(4145);
  });

  it('falls back to 1:1 when a rate is missing', () => {
    expect(convert(10000, 'USD', 'INR', 'INR', RATES)).toBe(10000);
  });
});

describe('parseFxRates', () => {
  it('returns empty for null/blank/garbage', () => {
    expect(parseFxRates(null)).toEqual({});
    expect(parseFxRates('')).toEqual({});
    expect(parseFxRates('not json')).toEqual({});
  });

  it('keeps only positive finite numbers', () => {
    expect(parseFxRates('{"AED":22.8,"USD":0,"EUR":-1,"GBP":"x","JPY":0.55}')).toEqual({
      AED: 22.8,
      JPY: 0.55,
    });
  });
});

describe('missingRates', () => {
  it('lists used currencies without a rate, excluding the default', () => {
    expect(missingRates(['INR', 'AED', 'USD', 'AED'], 'INR', { AED: 22.8 })).toEqual(['USD']);
  });
});
