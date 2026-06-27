import { getCurrency, SUPPORTED_CURRENCIES } from './money';

const REGION_TO_CURRENCY: Record<string, string> = {
  IN: 'INR',
  US: 'USD',
  GB: 'GBP',
  CA: 'CAD',
  AU: 'AUD',
  SG: 'SGD',
  JP: 'JPY',
  CH: 'CHF',
  AE: 'AED',
  // Eurozone
  DE: 'EUR',
  FR: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  IE: 'EUR',
  PT: 'EUR',
  AT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  LU: 'EUR',
};

const TIMEZONE_TO_REGION: Record<string, string> = {
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Dubai': 'AE',
  'Asia/Tokyo': 'JP',
  'Asia/Singapore': 'SG',
  'Europe/London': 'GB',
  'Europe/Zurich': 'CH',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Dublin': 'IE',
  'Europe/Lisbon': 'PT',
  'Europe/Vienna': 'AT',
  'Europe/Helsinki': 'FI',
  'Europe/Athens': 'GR',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
};

function regionFromLocale(): string | null {
  if (typeof navigator === 'undefined') return null;
  const tag = navigator.language || (navigator.languages && navigator.languages[0]);
  if (!tag) return null;
  try {
    const loc = new Intl.Locale(tag);
    const region = loc.maximize().region;
    return region ? region.toUpperCase() : null;
  } catch {
    const parts = tag.split('-');
    const last = parts[parts.length - 1];
    return last && last.length === 2 ? last.toUpperCase() : null;
  }
}

function regionFromTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONE_TO_REGION[tz] ?? null;
  } catch {
    return null;
  }
}

export function detectDefaultCurrency(): string {
  const region = regionFromLocale() ?? regionFromTimeZone();
  const code = region ? REGION_TO_CURRENCY[region] : null;
  if (code && SUPPORTED_CURRENCIES.some((c) => c.code === code)) return code;
  return 'USD';
}

export function describeCurrency(code: string): string {
  const meta = getCurrency(code);
  return `${meta.symbol} ${meta.code}`;
}
