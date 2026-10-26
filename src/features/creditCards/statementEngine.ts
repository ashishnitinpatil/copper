import type { DB } from '@/db/wasm';
import type { Account } from '@/db/types';
import { toDateString } from '@/lib/dates';

export interface StatementInfo {
  account: Account;
  cycleStart: string;
  cycleEnd: string;
  statementBalance: number;
  dueDate: string;
  daysUntilDue: number;
  isPastDue: boolean;
}

export async function getCreditCardStatements(
  db: DB,
  today?: string,
): Promise<StatementInfo[]> {
  const todayStr = today ?? toDateString();
  const todayDate = new Date(todayStr + 'T00:00:00');

  const cards = await db.execO<Account>(
    `SELECT * FROM accounts WHERE type = 'credit_card' AND archived_at IS NULL AND statement_day IS NOT NULL`,
  );

  const results: StatementInfo[] = [];

  for (const card of cards) {
    const stDay = card.statement_day!;
    const dueDay = card.due_day ?? stDay;

    const open = getCycleDates(todayDate, stDay);
    const closedEnd = dayBefore(open.cycleStart);
    const closed = getCycleDates(new Date(closedEnd + 'T00:00:00'), stDay);

    // A cycle's bill is its charges less refunds. Payments into the card after
    // the statement closes go to that statement first; anything over it counts
    // toward the open cycle.
    const cycleNet = `COALESCE(SUM(CASE WHEN occurred_on >= ? AND occurred_on <= ? AND (
         (amount_minor < 0 AND kind IN ('expense', 'transfer')) OR (amount_minor > 0 AND kind = 'income')
       ) THEN -amount_minor END), 0)`;
    const rows = await db.execO<{ closed: number; paid: number; open: number }>(
      `SELECT ${cycleNet} AS closed, ${cycleNet} AS open,
              COALESCE(SUM(CASE WHEN occurred_on > ? AND occurred_on <= ? AND amount_minor > 0 AND kind = 'transfer'
                THEN amount_minor END), 0) AS paid
       FROM transactions WHERE account_id = ?`,
      [closed.cycleStart, closed.cycleEnd, open.cycleStart, open.cycleEnd, closedEnd, todayStr, card.id],
    );
    const sums = rows[0] ?? { closed: 0, paid: 0, open: 0 };
    const closedBill = Math.max(0, sums.closed);
    // The closed statement stays up until payments cover it.
    const showClosed = closedBill > sums.paid;
    const { cycleStart, cycleEnd } = showClosed ? closed : open;
    const statementBalance = showClosed
      ? closedBill - sums.paid
      : Math.max(0, sums.open - (sums.paid - closedBill));
    const dueDate = getNextDueDate(todayDate, cycleEnd, dueDay);

    const dueDateObj = new Date(dueDate + 'T00:00:00');
    const diffMs = dueDateObj.getTime() - todayDate.getTime();
    const daysUntilDue = Math.ceil(diffMs / 86400000);

    results.push({
      account: card,
      cycleStart,
      cycleEnd,
      statementBalance,
      dueDate,
      daysUntilDue,
      isPastDue: daysUntilDue < 0,
    });
  }

  return results;
}

function getCycleDates(today: Date, statementDay: number): { cycleStart: string; cycleEnd: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const dayOfMonth = today.getDate();

  let cycleEndDate: Date;
  if (dayOfMonth <= statementDay) {
    cycleEndDate = clampToMonth(y, m, statementDay);
  } else {
    cycleEndDate = clampToMonth(y, m + 1, statementDay);
  }

  const prevMonthEnd = clampToMonth(cycleEndDate.getFullYear(), cycleEndDate.getMonth() - 1, statementDay);
  const cycleStartDate = new Date(prevMonthEnd);
  cycleStartDate.setDate(prevMonthEnd.getDate() + 1);

  return {
    cycleStart: toDateString(cycleStartDate),
    cycleEnd: toDateString(cycleEndDate),
  };
}

function dayBefore(date: string): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return toDateString(d);
}

function clampToMonth(year: number, month: number, day: number): Date {
  const d = new Date(year, month, day);
  if (d.getMonth() !== ((month % 12) + 12) % 12) {
    return new Date(year, month + 1, 0);
  }
  return d;
}

function getNextDueDate(_: Date, cycleEnd: string, dueDay: number): string {
  const endDate = new Date(cycleEnd + 'T00:00:00');
  let dueDate: Date;
  if (dueDay > endDate.getDate()) {
    dueDate = clampToMonth(endDate.getFullYear(), endDate.getMonth(), dueDay);
  } else {
    dueDate = clampToMonth(endDate.getFullYear(), endDate.getMonth() + 1, dueDay);
  }
  return toDateString(dueDate);
}
