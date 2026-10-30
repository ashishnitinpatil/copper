/** How often a recurring entry repeats, as offered in the app. */
export const FREQUENCY_OPTIONS = [
  { label: 'Daily', rrule: 'FREQ=DAILY;INTERVAL=1' },
  { label: 'Weekly', rrule: 'FREQ=WEEKLY;INTERVAL=1' },
  { label: 'Every 2 weeks', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Monthly', rrule: 'FREQ=MONTHLY;INTERVAL=1' },
  { label: 'Every 3 months', rrule: 'FREQ=MONTHLY;INTERVAL=3' },
  { label: 'Yearly', rrule: 'FREQ=YEARLY;INTERVAL=1' },
];

export const MONTHLY = FREQUENCY_OPTIONS[3].rrule;

/** A rule string that starts on `date` (YYYY-MM-DD) and repeats per `freq`. */
export function ruleStarting(date: string, freq: string): string {
  return `DTSTART:${date.replace(/-/g, '')}T000000Z\n${freq}`;
}

/** The frequency part of a stored rule ("FREQ=…;INTERVAL=…"), without its start date. */
export function frequencyOf(rrule: string): string {
  return rrule.split('\n').find((l) => l.startsWith('FREQ=')) ?? rrule.replace(/^DTSTART:[^\n]*\n?/, '');
}

/**
 * The rule to save after an edit. With the date and frequency left as they were,
 * the rule keeps its own start: that day of the month is the one meant. Rebuilt
 * from the next due date instead, a rent on the 31st edited while next due on
 * Nov 30 would fall on the 30th from then on.
 */
export function editedRule(existing: { rrule: string; next_run_on: string }, startDate: string, freq: string): string {
  const unchanged = startDate === existing.next_run_on && freq === frequencyOf(existing.rrule);
  return unchanged ? existing.rrule : ruleStarting(startDate, freq);
}

type RRuleLib = typeof import('rrule');

/**
 * Parse a stored rule. A monthly rule that starts on the 29th–31st falls on the
 * last day of shorter months; plain RFC 5545 would skip those months entirely
 * (a rent on the 31st would only be recorded seven times a year).
 */
export function parseRule(lib: RRuleLib, rule: string) {
  const opts = lib.RRule.parseString(rule);
  const day = opts.dtstart?.getUTCDate() ?? 0;
  if (opts.freq === lib.RRule.MONTHLY && opts.bymonthday == null && day > 28) {
    opts.bymonthday = [day, -1];
    opts.bysetpos = [1];
  }
  return new lib.RRule(opts);
}

const endOfDay = (date: string) => new Date(`${date}T23:59:59Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Occurrences a rule still has to add by `today`, and the date it is next due.
 * A rule that has run before only picks up dates after that run, so an entry the
 * user deleted isn't added back the next time.
 */
export function dueOccurrences(
  lib: RRuleLib,
  rule: { rrule: string; next_run_on: string; last_run_on: string | null },
  today: string,
): { dates: string[]; nextRun: string | null } {
  const rr = parseRule(lib, rule.rrule);
  const after = rule.last_run_on ? endOfDay(rule.last_run_on) : new Date(`${rule.next_run_on}T00:00:00Z`);
  const until = endOfDay(today);
  const dates = rr.between(after, until, true).map(isoDay);
  const next = rr.after(until, false);
  return { dates, nextRun: next ? isoDay(next) : null };
}

/** Occurrences after `today` up to and including `end` (both YYYY-MM-DD). */
export function upcomingOccurrences(lib: RRuleLib, rule: string, today: string, end: string): string[] {
  return parseRule(lib, rule).between(endOfDay(today), endOfDay(end), true).map(isoDay);
}
