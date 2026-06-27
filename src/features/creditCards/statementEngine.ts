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

    const { cycleStart, cycleEnd } = getCycleDates(todayDate, stDay);
    const dueDate = getNextDueDate(todayDate, cycleEnd, dueDay);

    const rows = await db.execO<{ total: number }>(
      `SELECT COALESCE(SUM(ABS(amount_minor)), 0) AS total
       FROM transactions
       WHERE account_id = ? AND kind IN ('expense', 'transfer') AND amount_minor < 0 AND occurred_on >= ? AND occurred_on <= ?`,
      [card.id, cycleStart, cycleEnd],
    );
    const statementBalance = rows[0]?.total ?? 0;

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
