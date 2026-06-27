/**
 * All money in the database is stored as a signed integer count of the
 * minor unit (paise / cents). These helpers convert to / from human input
 * and format for display, never producing IEEE 754 drift.
 */

export interface CurrencyMeta {
  code: string;
  symbol: string;
  decimals: number;
}

const CURRENCIES: Record<string, CurrencyMeta> = {
  INR: { code: 'INR', symbol: '₹', decimals: 2 },
  USD: { code: 'USD', symbol: '$', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', decimals: 2 },
  GBP: { code: 'GBP', symbol: '£', decimals: 2 },
  JPY: { code: 'JPY', symbol: '¥', decimals: 0 },
  AUD: { code: 'AUD', symbol: 'A$', decimals: 2 },
  CAD: { code: 'CAD', symbol: 'C$', decimals: 2 },
  SGD: { code: 'SGD', symbol: 'S$', decimals: 2 },
  AED: { code: 'AED', symbol: 'د.إ', decimals: 2 },
  CHF: { code: 'CHF', symbol: 'CHF', decimals: 2 },
};

export function getCurrency(code: string): CurrencyMeta {
  return CURRENCIES[code] ?? { code, symbol: code, decimals: 2 };
}

// Some currency symbols (e.g. AED "د.إ") are strong right-to-left, which makes
// the Unicode bidi algorithm reorder adjacent digits, signs and any following
// text (a trailing "(76.6%)" rendered as "(%76.6)"). Wrap such symbols in a
// first-strong isolate (FSI…PDI) so they stay a self-contained run that neither
// reorders with nor bleeds into neighbours. LTR symbols ($, ₹, €…) are returned
// untouched so plain-text output is unchanged for them.
const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
function isolateSymbol(symbol: string): string {
  return RTL_CHARS.test(symbol) ? `⁨${symbol}⁩` : symbol;
}

export const SUPPORTED_CURRENCIES = Object.values(CURRENCIES);

export function toMinor(amount: number | string, currency: string): number {
  const { decimals } = getCurrency(currency);
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** decimals);
}

export function fromMinor(minor: number, currency: string): number {
  const { decimals } = getCurrency(currency);
  return minor / 10 ** decimals;
}

export function formatMoney(
  minor: number,
  currency: string,
  opts: { withSymbol?: boolean; signed?: boolean } = {},
): string {
  const { withSymbol = true, signed = false } = opts;
  const meta = getCurrency(currency);
  const major = fromMinor(Math.abs(minor), currency);
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  }).format(major);
  const sign = signed ? (minor < 0 ? '−' : minor > 0 ? '+' : '') : minor < 0 ? '−' : '';
  const body = withSymbol ? `${isolateSymbol(meta.symbol)}${formatted}` : formatted;
  return `${sign}${body}`;
}

export interface MoneyParts {
  sign: string;
  symbol: string;
  integer: string;
  separator: string;
  fraction: string;
}

export function formatMoneyParts(
  minor: number,
  currency: string,
  opts: { withSymbol?: boolean; signed?: boolean } = {},
): MoneyParts {
  const { withSymbol = true, signed = false } = opts;
  const meta = getCurrency(currency);
  const major = fromMinor(Math.abs(minor), currency);
  const formatter = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  });
  let integer = '';
  let fraction = '';
  let separator = '';
  let afterDecimal = false;
  for (const p of formatter.formatToParts(major)) {
    if (p.type === 'decimal') {
      separator = p.value;
      afterDecimal = true;
    } else if (p.type === 'fraction') {
      fraction = p.value;
    } else if (!afterDecimal) {
      integer += p.value;
    }
  }
  const sign = signed ? (minor < 0 ? '−' : minor > 0 ? '+' : '') : minor < 0 ? '−' : '';
  const symbol = withSymbol ? isolateSymbol(meta.symbol) : '';
  return { sign, symbol, integer, separator, fraction };
}

/** Parse a free-form user-typed amount into minor units. */
export function parseAmount(input: string, currency: string): number | null {
  const cleaned = input.replace(/[, _]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return toMinor(n, currency);
}
