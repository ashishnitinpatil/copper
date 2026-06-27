/**
 * Manual foreign-exchange rates for combining multi-currency data.
 *
 * Rates are expressed relative to the user's default currency: `rates['AED']
 * = 22.8` means 1 AED is worth 22.8 of the default currency. The default
 * currency itself is always 1 and is never stored. Rates are entered by hand
 * in Settings (no network), keeping the app fully offline / local-first.
 */

import { getCurrency } from './money';

export type FxRates = Record<string, number>;

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
 * drift on the common path. A missing rate falls back to 1:1 — use
 * `missingRates` to warn the user before trusting a converted total.
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
