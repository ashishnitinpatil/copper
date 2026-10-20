import { describe, expect, it } from 'vitest';
import { periodComparison, periodSpan, periodStart, precedingSpan, stepPeriod } from './reportPeriods';

describe('report periods', () => {
  it('finds the start of the month, quarter and year', () => {
    expect(periodStart('month', '2026-10-20')).toBe('2026-10-01');
    expect(periodStart('quarter', '2026-10-20')).toBe('2026-10-01');
    expect(periodStart('quarter', '2026-09-30')).toBe('2026-07-01');
    expect(periodStart('year', '2026-10-20')).toBe('2026-01-01');
  });

  it('steps across year ends', () => {
    expect(stepPeriod('quarter', '2026-01-01', -1)).toBe('2025-10-01');
    expect(stepPeriod('month', '2025-12-01', 1)).toBe('2026-01-01');
    expect(stepPeriod('year', '2026-01-01', -1)).toBe('2025-01-01');
  });

  it('spans whole periods', () => {
    expect(periodSpan('quarter', '2026-01-01')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(periodSpan('month', '2028-02-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodSpan('year', '2025-01-01')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('compares a finished period with the whole one before', () => {
    expect(periodComparison('quarter', '2026-07-01', '2026-10-20')).toEqual({
      current: { from: '2026-07-01', to: '2026-09-30' },
      previous: { from: '2026-04-01', to: '2026-06-30' },
      partial: false,
    });
  });

  it('compares a period in progress, up to today, with the same days of the one before', () => {
    expect(periodComparison('quarter', '2026-10-01', '2026-10-20')).toEqual({
      current: { from: '2026-10-01', to: '2026-10-20' },
      previous: { from: '2026-07-01', to: '2026-07-20' },
      partial: true,
    });
    // 30 days into March runs past the end of February: stop at its end.
    expect(periodComparison('month', '2026-03-01', '2026-03-31').previous).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodComparison('year', '2026-01-01', '2026-10-20').previous).toEqual({ from: '2025-01-01', to: '2025-10-20' });
  });

  it('compares custom dates with as many days just before', () => {
    expect(precedingSpan({ from: '2026-10-11', to: '2026-10-20' })).toEqual({ from: '2026-10-01', to: '2026-10-10' });
    expect(precedingSpan({ from: '2026-03-01', to: '2026-03-01' })).toEqual({ from: '2026-02-28', to: '2026-02-28' });
  });
});
