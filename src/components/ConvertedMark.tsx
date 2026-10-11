import { useAppSettings } from '@/app/AppSettingsProvider';
import { InfoHint } from '@/components/ui/InfoHint';
import type { RateSource } from '@/lib/fx';
import { formatHumanDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';

interface ConvertedMarkProps {
  /** Currencies of the amounts behind the figure. */
  currencies: Iterable<string>;
  /** The currency the figure is shown in. */
  target: string;
  align?: 'left' | 'right';
}

/**
 * A "≈" beside a figure that mixes currencies, explaining in plain words which
 * amounts were converted and with what rate. Renders nothing when every amount
 * was already in the figure's currency — the common, single-currency case.
 */
export function ConvertedMark({ currencies, target, align = 'left' }: ConvertedMarkProps) {
  const { defaultCurrency, rateInfo } = useAppSettings();
  const foreign = [...new Set(currencies)].filter((c) => c !== target).sort();
  if (foreign.length === 0) return null;

  // Rates are held against the default currency, so a figure in another
  // currency also leans on that currency's own rate.
  const shown = [...new Set([...foreign, target])].filter((c) => c !== defaultCurrency);

  return (
    <InfoHint label="How this was converted" title="Converted amounts" trigger="≈" align={align}>
      <span className="mb-1.5 block">
        Includes amounts in {foreign.join(' and ')}, converted to {target}.
      </span>
      {shown.map((code) => {
        const info = rateInfo[code];
        if (!info) return null;
        return (
          <span key={code} className="mb-1.5 block">
            <span className="font-medium text-slate-300">{rateLine(code, defaultCurrency, info.rate)}</span>{' '}
            — {describeSource(info.source)}
          </span>
        );
      })}
      <span className="block text-slate-500">You can set your own rate in Settings → Exchange rates.</span>
    </InfoHint>
  );
}

export function describeSource(source: RateSource): string {
  switch (source.kind) {
    case 'manual':
      return 'your rate in Settings';
    case 'transfer':
      return `your transfer on ${formatHumanDate(source.date)} (${formatMoney(
        source.fromMinor,
        source.fromCurrency,
      )} → ${formatMoney(source.toMinor, source.toCurrency)})`;
    case 'builtin':
      return 'an approximate built-in rate';
  }
}

/** "1 USD ≈ 3.673 AED", or "1 AED ≈ 22.6 INR" — whichever way reads as a number above 1. */
export function rateLine(code: string, defaultCurrency: string, rate: number): string {
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  return rate >= 1 ? `1 ${code} ≈ ${fmt(rate)} ${defaultCurrency}` : `1 ${defaultCurrency} ≈ ${fmt(1 / rate)} ${code}`;
}
