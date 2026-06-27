import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeCurrency, detectDefaultCurrency } from './locale';

describe('describeCurrency', () => {
  it('formats a known currency as "symbol code"', () => {
    expect(describeCurrency('INR')).toBe('₹ INR');
    expect(describeCurrency('USD')).toBe('$ USD');
  });
});

describe('detectDefaultCurrency', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps the browser locale region to a supported currency', () => {
    vi.stubGlobal('navigator', { language: 'en-IN' });
    expect(detectDefaultCurrency()).toBe('INR');
  });

  it('maps a eurozone locale to EUR', () => {
    vi.stubGlobal('navigator', { language: 'de-DE' });
    expect(detectDefaultCurrency()).toBe('EUR');
  });

  it('falls back to USD for an unmapped region', () => {
    // Brazil is not in the region→currency table, and BRL is unsupported anyway.
    vi.stubGlobal('navigator', { language: 'pt-BR' });
    expect(detectDefaultCurrency()).toBe('USD');
  });
});
