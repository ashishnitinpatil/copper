import { describe, it, expect } from 'vitest';
import { convert, parseFxRates, missingRates, resolveRates } from './fx';

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

describe('resolveRates', () => {
  const sent = (date: string, fromCurrency: string, fromMinor: number, toCurrency: string, toMinor: number) => ({
    date,
    fromCurrency,
    fromMinor,
    toCurrency,
    toMinor,
  });

  it('uses the built-in table when there is nothing better', () => {
    const r = resolveRates('AED', ['AED', 'USD'], {}, []);
    expect(r.USD.rate).toBeCloseTo(3.6725);
    expect(r.USD.source.kind).toBe('builtin');
    expect(r.AED).toBeUndefined();
  });

  it('prefers the latest transfer, in either direction', () => {
    // Newest first: Dh 1,000 → ₹22,600 beats an older one.
    const r = resolveRates('AED', ['INR', 'EUR'], {}, [
      sent('2026-10-03', 'AED', 100_000, 'INR', 2_260_000),
      sent('2026-09-01', 'AED', 100_000, 'INR', 2_000_000),
      sent('2026-08-01', 'EUR', 10_000, 'AED', 42_000),
    ]);
    expect(r.INR.rate).toBeCloseTo(1000 / 22600);
    expect(r.INR.source).toMatchObject({ kind: 'transfer', date: '2026-10-03' });
    expect(r.EUR.rate).toBeCloseTo(4.2);
  });

  it('lets a rate typed in Settings win over transfers', () => {
    const r = resolveRates('AED', ['INR'], { INR: 0.05 }, [sent('2026-10-03', 'AED', 100_000, 'INR', 2_260_000)]);
    expect(r.INR).toEqual({ rate: 0.05, source: { kind: 'manual' } });
  });

  it('ignores transfers that do not touch the default currency', () => {
    const r = resolveRates('AED', ['INR'], {}, [sent('2026-10-03', 'EUR', 10_000, 'INR', 1_000_000)]);
    expect(r.INR.source.kind).toBe('builtin');
  });

  it('is decimal-aware for zero-decimal currencies', () => {
    // Dh 100 → ¥4,000 (JPY has no minor unit): 1 JPY = 0.025 AED.
    const r = resolveRates('AED', ['JPY'], {}, [sent('2026-10-03', 'AED', 10_000, 'JPY', 4_000)]);
    expect(r.JPY.rate).toBeCloseTo(0.025);
  });
});

describe('resolveRates guards', () => {
  const t = (fromMinor: number, toMinor: number) => ({
    date: '2026-10-03',
    fromCurrency: 'AED',
    fromMinor,
    toCurrency: 'INR',
    toMinor,
  });

  it('skips old same-amount transfers and typos, falling back to the next one', () => {
    const r = resolveRates('AED', ['INR'], {}, [
      t(100_000, 100_000), // old record: same number on both sides
      t(100_000, 22_600_000), // typo: an extra zero
      t(100_000, 2_260_000),
    ]);
    expect(r.INR.rate).toBeCloseTo(1000 / 22600);
  });

  it('uses the built-in rate when every transfer is suspect', () => {
    const r = resolveRates('AED', ['INR'], {}, [t(100_000, 100_000)]);
    expect(r.INR.source.kind).toBe('builtin');
  });
});
