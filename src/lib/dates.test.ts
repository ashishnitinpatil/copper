import { describe, it, expect } from 'vitest';
import {
  toDateString,
  parseDateString,
  addDays,
  startOfMonth,
  endOfMonth,
  formatRelativeDate,
  formatHumanDate,
} from './dates';

describe('toDateString', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateString(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('pads single-digit month and day', () => {
    expect(toDateString(new Date(2026, 2, 3))).toBe('2026-03-03');
  });
});

describe('parseDateString', () => {
  it('parses YYYY-MM-DD to Date', () => {
    const d = parseDateString('2026-04-12');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(12);
  });
});

describe('addDays', () => {
  it('adds positive days', () => {
    const d = addDays(new Date(2026, 0, 1), 10);
    expect(d.getDate()).toBe(11);
  });

  it('adds negative days', () => {
    const d = addDays(new Date(2026, 0, 15), -5);
    expect(d.getDate()).toBe(10);
  });

  it('crosses month boundaries', () => {
    const d = addDays(new Date(2026, 0, 31), 1);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(1);
  });
});

describe('startOfMonth', () => {
  it('returns first day of month', () => {
    const d = startOfMonth(new Date(2026, 3, 15));
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(3);
  });
});

describe('endOfMonth', () => {
  it('returns last day of month', () => {
    expect(endOfMonth(new Date(2026, 0, 15)).getDate()).toBe(31);
    expect(endOfMonth(new Date(2026, 1, 15)).getDate()).toBe(28);
    expect(endOfMonth(new Date(2026, 3, 15)).getDate()).toBe(30);
  });
});

describe('formatRelativeDate', () => {
  it('returns "Today" for today', () => {
    const today = toDateString(new Date());
    expect(formatRelativeDate(today)).toBe('Today');
  });

  it('returns "Yesterday" for yesterday', () => {
    const yesterday = toDateString(addDays(new Date(), -1));
    expect(formatRelativeDate(yesterday)).toBe('Yesterday');
  });

  it('returns "Tomorrow" for tomorrow', () => {
    const tomorrow = toDateString(addDays(new Date(), 1));
    expect(formatRelativeDate(tomorrow)).toBe('Tomorrow');
  });
});

describe('formatHumanDate', () => {
  it('formats to a readable string', () => {
    const result = formatHumanDate('2026-04-12');
    expect(result).toContain('2026');
    expect(result).toContain('Apr');
    expect(result).toContain('12');
  });
});
