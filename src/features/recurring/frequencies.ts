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
