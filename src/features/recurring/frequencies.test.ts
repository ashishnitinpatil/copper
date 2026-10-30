import { describe, expect, it } from 'vitest';
import * as lib from 'rrule';
import { MONTHLY, dueOccurrences, editedRule, ruleStarting, upcomingOccurrences } from './frequencies';

describe('dueOccurrences', () => {
  const rule = { rrule: ruleStarting('2026-09-01', MONTHLY), next_run_on: '2026-09-01', last_run_on: null };

  it('adds everything due on a rule that has never run', () => {
    expect(dueOccurrences(lib, rule, '2026-10-05')).toEqual({ dates: ['2026-09-01', '2026-10-01'], nextRun: '2026-11-01' });
  });

  it("doesn't bring back an occurrence from the last run (the user may have deleted it)", () => {
    const ran = { ...rule, next_run_on: '2026-11-01', last_run_on: '2026-10-01' };
    expect(dueOccurrences(lib, ran, '2026-11-01').dates).toEqual(['2026-11-01']);
  });

  it('catches up on every month missed since the last run', () => {
    const ran = { ...rule, next_run_on: '2026-11-01', last_run_on: '2026-10-03' };
    expect(dueOccurrences(lib, ran, '2027-01-02').dates).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });
});

describe('monthly rules late in the month', () => {
  const months = (start: string, end: string) => upcomingOccurrences(lib, ruleStarting(start, MONTHLY), '2026-12-31', end);

  it('fall on the last day of shorter months instead of skipping them', () => {
    expect(months('2027-01-31', '2027-05-31')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
    expect(months('2027-01-30', '2027-03-31')).toEqual(['2027-01-30', '2027-02-28', '2027-03-30']);
    expect(months('2028-01-29', '2028-02-29')).toEqual(['2028-01-29', '2028-02-29']);
  });

  it('leave other days alone', () => {
    expect(months('2027-01-15', '2027-03-31')).toEqual(['2027-01-15', '2027-02-15', '2027-03-15']);
  });

  it('every 3 months too', () => {
    const rr = ruleStarting('2026-11-30', 'FREQ=MONTHLY;INTERVAL=3');
    expect(upcomingOccurrences(lib, rr, '2026-11-01', '2027-08-31')).toEqual(['2026-11-30', '2027-02-28', '2027-05-30', '2027-08-30']);
  });
});

describe('editedRule', () => {
  // Rent on the 31st, edited in November while it's next due on Nov 30.
  const rent = { rrule: ruleStarting('2026-01-31', MONTHLY), next_run_on: '2026-11-30' };

  it('keeps a month-end rule on its day when only the amount or note changes', () => {
    const rule = editedRule(rent, '2026-11-30', MONTHLY);
    expect(upcomingOccurrences(lib, rule, '2026-11-30', '2027-03-31')).toEqual([
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
  });

  it('starts from the new date when the date or frequency is changed', () => {
    expect(editedRule(rent, '2026-12-05', MONTHLY)).toBe(ruleStarting('2026-12-05', MONTHLY));
    expect(editedRule(rent, '2026-11-30', 'FREQ=WEEKLY')).toBe(ruleStarting('2026-11-30', 'FREQ=WEEKLY'));
  });
});
