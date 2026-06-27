import { describe, it, expect } from 'vitest';
import { toMinor, fromMinor, formatMoney, parseAmount, getCurrency } from './money';

describe('toMinor', () => {
  it('converts INR rupees to paise', () => {
    expect(toMinor(100, 'INR')).toBe(10000);
    expect(toMinor(99.99, 'INR')).toBe(9999);
    expect(toMinor('250.50', 'INR')).toBe(25050);
  });

  it('handles JPY (zero decimals)', () => {
    expect(toMinor(500, 'JPY')).toBe(500);
    expect(toMinor(100.9, 'JPY')).toBe(101);
  });

  it('returns 0 for NaN', () => {
    expect(toMinor('abc', 'INR')).toBe(0);
    expect(toMinor(Infinity, 'INR')).toBe(0);
  });
});

describe('fromMinor', () => {
  it('converts paise back to INR', () => {
    expect(fromMinor(10000, 'INR')).toBe(100);
    expect(fromMinor(9999, 'INR')).toBe(99.99);
    expect(fromMinor(1, 'INR')).toBe(0.01);
  });

  it('handles JPY', () => {
    expect(fromMinor(500, 'JPY')).toBe(500);
  });
});

describe('formatMoney', () => {
  it('formats INR with symbol', () => {
    expect(formatMoney(10050, 'INR')).toBe('₹100.50');
    expect(formatMoney(0, 'INR')).toBe('₹0.00');
  });

  it('formats negative amounts with minus sign', () => {
    const result = formatMoney(-50000, 'INR');
    expect(result).toBe('−₹500.00');
  });

  it('formats with signed option', () => {
    expect(formatMoney(10000, 'INR', { signed: true })).toBe('+₹100.00');
    expect(formatMoney(-10000, 'INR', { signed: true })).toBe('−₹100.00');
    expect(formatMoney(0, 'INR', { signed: true })).toBe('₹0.00');
  });

  it('formats without symbol', () => {
    expect(formatMoney(10000, 'INR', { withSymbol: false })).toBe('100.00');
  });

  it('formats USD', () => {
    expect(formatMoney(1999, 'USD')).toBe('$19.99');
  });

  it('handles unknown currencies gracefully', () => {
    expect(formatMoney(100, 'XYZ')).toContain('1.00');
  });
});

describe('parseAmount', () => {
  it('parses simple numbers', () => {
    expect(parseAmount('100', 'INR')).toBe(10000);
    expect(parseAmount('99.99', 'INR')).toBe(9999);
  });

  it('strips commas and spaces', () => {
    expect(parseAmount('1,000', 'INR')).toBe(100000);
    expect(parseAmount('1 000', 'INR')).toBe(100000);
  });

  it('returns null for empty / invalid input', () => {
    expect(parseAmount('', 'INR')).toBeNull();
    expect(parseAmount('abc', 'INR')).toBeNull();
    expect(parseAmount('-', 'INR')).toBeNull();
  });

  it('handles negative amounts', () => {
    expect(parseAmount('-50', 'INR')).toBe(-5000);
  });

  it('handles JPY (no decimals)', () => {
    expect(parseAmount('1000', 'JPY')).toBe(1000);
  });
});

describe('getCurrency', () => {
  it('returns known currencies', () => {
    expect(getCurrency('INR').symbol).toBe('₹');
    expect(getCurrency('USD').symbol).toBe('$');
    expect(getCurrency('JPY').decimals).toBe(0);
  });

  it('returns fallback for unknown', () => {
    const c = getCurrency('XYZ');
    expect(c.code).toBe('XYZ');
    expect(c.decimals).toBe(2);
  });
});
