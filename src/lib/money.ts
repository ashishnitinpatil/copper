/**
 * All money in the database is stored as a signed integer count of the
 * minor unit (paise / cents). These helpers convert to / from human input
 * and format for display, never producing IEEE 754 drift.
 */

export interface CurrencyMeta {
  code: string;
  symbol: string;
  decimals: number;
  name: string;
}

const CURRENCIES: Record<string, CurrencyMeta> = {
  INR: { code: 'INR', symbol: '₹', decimals: 2, name: 'Indian Rupee' },
  USD: { code: 'USD', symbol: '$', decimals: 2, name: 'US Dollar' },
  EUR: { code: 'EUR', symbol: '€', decimals: 2, name: 'Euro' },
  GBP: { code: 'GBP', symbol: '£', decimals: 2, name: 'British Pound' },
  JPY: { code: 'JPY', symbol: '¥', decimals: 0, name: 'Japanese Yen' },
  AUD: { code: 'AUD', symbol: 'A$', decimals: 2, name: 'Australian Dollar' },
  CAD: { code: 'CAD', symbol: 'C$', decimals: 2, name: 'Canadian Dollar' },
  SGD: { code: 'SGD', symbol: 'S$', decimals: 2, name: 'Singapore Dollar' },
  // The new (2025) UAE dirham symbol has no font support yet (renders as tofu),
  // so we use the plain "Dh" abbreviation, which is unambiguous and always renders.
  AED: { code: 'AED', symbol: 'Dh ', decimals: 2, name: 'UAE Dirham' },
  CHF: { code: 'CHF', symbol: 'CHF', decimals: 2, name: 'Swiss Franc' },
};

export function getCurrency(code: string): CurrencyMeta {
  return CURRENCIES[code] ?? { code, symbol: code, decimals: 2, name: code };
}

// A strong right-to-left currency symbol makes the Unicode bidi algorithm
// reorder adjacent digits, signs and any following text (a trailing "(76.6%)"
// rendered as "(%76.6)"). Wrap such symbols in a first-strong isolate (FSI…PDI)
// so they stay a self-contained run that neither reorders with nor bleeds into
// neighbours. LTR symbols ($, ₹, €, Dh…) are returned untouched so plain-text
// output is unchanged for them. (Kept as a guard for any future RTL symbol.)
const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
function isolateSymbol(symbol: string): string {
  return RTL_CHARS.test(symbol) ? `⁨${symbol}⁩` : symbol;
}

export const SUPPORTED_CURRENCIES = Object.values(CURRENCIES);

/**
 * Options for a searchable currency picker. The label carries both the code and
 * the full name so a Combobox (which filters on the label) matches queries like
 * "Rupee", "INR" or "Indian" — not just the ISO code.
 */
export const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} — ${c.name}`,
}));

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
  // Drop currency symbols and spaces ("₹1,000", "1 000"), and abbreviations
  // with their dot ("Rs.500"), which would otherwise read as a decimal point.
  let cleaned = input.replace(/[a-z]+\./gi, '').replace(/[^\d.,-]/g, '');
  // A comma that comes last is the decimal mark ("1,5", "1.000,50") unless it
  // groups thousands ("1,000", "1,00,000").
  const comma = cleaned.lastIndexOf(',');
  const dot = cleaned.lastIndexOf('.');
  if (comma > dot && (dot >= 0 || !/,\d{3}$/.test(cleaned))) {
    cleaned = cleaned.replace(/\./g, '').replace(/,(?=\d*$)/, '.');
  }
  cleaned = cleaned.replace(/,/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return toMinor(n, currency);
}
