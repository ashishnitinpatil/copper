import { toDateString } from './dates';

export type PeriodUnit = 'month' | 'quarter' | 'year';

export interface Span {
  from: string;
  to: string;
}

const MONTHS: Record<PeriodUnit, number> = { month: 1, quarter: 3, year: 12 };
const ymd = (y: number, m: number, d: number) => toDateString(new Date(y, m, d));

/** First day of the month, quarter or year that `date` falls in. */
export function periodStart(unit: PeriodUnit, date: string): string {
  const [y, m] = date.split('-').map(Number);
  const month = unit === 'year' ? 0 : unit === 'quarter' ? Math.floor((m - 1) / 3) * 3 : m - 1;
  return ymd(y, month, 1);
}

/** The start of the period `n` periods away from the one starting at `start`. */
export function stepPeriod(unit: PeriodUnit, start: string, n: number): string {
  const [y, m] = start.split('-').map(Number);
  return ymd(y, m - 1 + n * MONTHS[unit], 1);
}

/** The whole period starting at `start`. */
export function periodSpan(unit: PeriodUnit, start: string): Span {
  const [y, m] = start.split('-').map(Number);
  return { from: start, to: ymd(y, m - 1 + MONTHS[unit], 0) };
}

/** "October 2026", "Jul – Sep 2026", "2026". */
export function periodLabel(unit: PeriodUnit, start: string): string {
  const [y, m] = start.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  if (unit === 'year') return String(y);
  if (unit === 'month') return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const end = new Date(y, m + 1, 1);
  return `${d.toLocaleDateString(undefined, { month: 'short' })} – ${end.toLocaleDateString(undefined, { month: 'short' })} ${y}`;
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / DAY);
const plusDays = (s: string, n: number) => {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateString(d);
};

/**
 * What a period report covers and what it's compared with. A period still in
 * progress only counts up to today (later entries are scheduled, not spent),
 * and is compared with the same number of days at the start of the period
 * before, so half a month isn't set against a whole one.
 */
export function periodComparison(unit: PeriodUnit, start: string, today: string): { current: Span; previous: Span; partial: boolean } {
  const full = periodSpan(unit, start);
  const prev = periodSpan(unit, stepPeriod(unit, start, -1));
  if (today < full.from || today >= full.to) return { current: full, previous: prev, partial: false };
  const elapsed = daysBetween(full.from, today);
  const prevTo = plusDays(prev.from, elapsed);
  return {
    current: { from: full.from, to: today },
    previous: { from: prev.from, to: prevTo < prev.to ? prevTo : prev.to },
    partial: true,
  };
}

/** The same number of days immediately before a custom range. */
export function precedingSpan(span: Span): Span {
  const len = daysBetween(span.from, span.to);
  const to = plusDays(span.from, -1);
  return { from: plusDays(to, -len), to };
}
