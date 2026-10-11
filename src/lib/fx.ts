/**
 * Foreign-exchange rates for combining multi-currency data.
 *
 * Rates are expressed relative to the user's default currency: `rates['AED']
 * = 22.8` means 1 AED is worth 22.8 of the default currency. The default
 * currency itself is always 1 and is never stored.
 *
 * Nobody has to set anything up: each currency's rate comes from, in order,
 * a rate typed in Settings, the person's own latest transfer between that
 * currency and the default one (what their bank actually gave them), or a
 * built-in table. No network, so the app stays fully offline / local-first.
 */

import { getCurrency } from './money';

export type FxRates = Record<string, number>;

/**
 * Approximate units per 1 USD, as of BUILTIN_RATES_AS_OF — a fallback only,
 * for currency pairs with no transfer and no typed rate. Update by hand when
 * the rates drift (AED is pegged at 3.6725).
 */
export const BUILTIN_PER_USD: Record<string, number> = {
  USD: 1,
  AED: 3.6725,
  INR: 88,
  EUR: 0.86,
  GBP: 0.75,
  JPY: 148,
  AUD: 1.52,
  CAD: 1.38,
  SGD: 1.29,
  CHF: 0.8,
};
export const BUILTIN_RATES_AS_OF = '2026-06';

/** Where a currency's rate came from — shown when explaining a converted figure. */
export type RateSource =
  | { kind: 'manual' }
  | { kind: 'transfer'; date: string; fromCurrency: string; fromMinor: number; toCurrency: string; toMinor: number }
  | { kind: 'builtin' };

export interface FxRate {
  /** What 1 unit is worth in the default currency. */
  rate: number;
  source: RateSource;
}

/** One cross-currency transfer, newest first in the list given to resolveRates. */
export interface TransferRateRow {
  date: string;
  fromCurrency: string;
  fromMinor: number;
  toCurrency: string;
  toMinor: number;
}

/**
 * Every currency's rate against `defaultCurrency`, best source first: typed in
 * Settings, else the latest transfer between it and the default currency, else
 * the built-in table. `transfers` must be newest first.
 */
export function resolveRates(
  defaultCurrency: string,
  currencies: Iterable<string>,
  manual: FxRates,
  transfers: TransferRateRow[],
): Record<string, FxRate> {
  const builtin = (code: string) =>
    BUILTIN_PER_USD[code] && BUILTIN_PER_USD[defaultCurrency]
      ? BUILTIN_PER_USD[defaultCurrency] / BUILTIN_PER_USD[code]
      : null;
  const fromTransfers = new Map<string, FxRate>();
  for (const t of transfers) {
    // Same number on both sides is the old "transfers ignore currency" record,
    // not a rate anyone got.
    if (t.fromMinor <= 0 || t.toMinor <= 0 || t.fromMinor === t.toMinor) continue;
    const from = t.fromMinor / 10 ** getCurrency(t.fromCurrency).decimals;
    const to = t.toMinor / 10 ** getCurrency(t.toCurrency).decimals;
    const source: RateSource = { kind: 'transfer', ...t };
    // Sent default, received foreign: 1 foreign = from/to default. And back.
    const code =
      t.fromCurrency === defaultCurrency ? t.toCurrency : t.toCurrency === defaultCurrency ? t.fromCurrency : null;
    if (!code || fromTransfers.has(code)) continue;
    const rate = t.fromCurrency === defaultCurrency ? from / to : to / from;
    // A typo (an extra zero) would skew every converted total; skip rates far
    // off the market so the next transfer, or the built-in rate, is used.
    const ref = builtin(code);
    if (ref && (rate > ref * 3 || rate < ref / 3)) continue;
    fromTransfers.set(code, { rate, source });
  }

  const out: Record<string, FxRate> = {};
  for (const code of currencies) {
    if (code === defaultCurrency || out[code]) continue;
    if (manual[code]) out[code] = { rate: manual[code], source: { kind: 'manual' } };
    else if (fromTransfers.has(code)) out[code] = fromTransfers.get(code)!;
    else if (builtin(code)) out[code] = { rate: builtin(code)!, source: { kind: 'builtin' } };
  }
  return out;
}

/** Parse the JSON blob stored in `meta.fx_rates`, discarding anything that
 *  isn't a positive finite number so a corrupt value can never poison a sum. */
export function parseFxRates(json: string | null): FxRates {
  if (!json) return {};
  try {
    const obj = JSON.parse(json) as unknown;
    if (!obj || typeof obj !== 'object') return {};
    const out: FxRates = {};
    for (const [code, raw] of Object.entries(obj as Record<string, unknown>)) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) out[code] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Convert a minor-unit amount between currencies. Decimal-aware, so it stays
 * correct across currencies with different precision (e.g. JPY has 0 decimals,
 * INR has 2). Same-currency conversion is returned untouched to avoid rounding
 * drift on the common path. A missing rate falls back to 1:1, which only a
 * currency outside BUILTIN_PER_USD can hit (see resolveRates).
 */
export function convert(
  amountMinor: number,
  from: string,
  to: string,
  defaultCurrency: string,
  rates: FxRates,
): number {
  if (from === to) return amountMinor;
  const rateFrom = from === defaultCurrency ? 1 : rates[from] ?? 1;
  const rateTo = to === defaultCurrency ? 1 : rates[to] ?? 1;
  const decFrom = getCurrency(from).decimals;
  const decTo = getCurrency(to).decimals;
  const valueInDefault = (amountMinor / 10 ** decFrom) * rateFrom;
  const majorTo = valueInDefault / rateTo;
  return Math.round(majorTo * 10 ** decTo);
}

/** Currencies that appear in `used` but have no configured rate (and aren't
 *  the default). Drives the "unset" prompt in Settings. */
export function missingRates(used: Iterable<string>, defaultCurrency: string, rates: FxRates): string[] {
  const out = new Set<string>();
  for (const c of used) {
    if (c !== defaultCurrency && !(c in rates)) out.add(c);
  }
  return [...out].sort();
}
