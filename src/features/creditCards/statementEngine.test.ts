import { describe, expect, it } from 'vitest';
import { getCreditCardStatements } from './statementEngine';
import type { DB } from '@/db/wasm';
import type { Account } from '@/db/types';

// The cycle/due-date math lives in non-exported helpers, but getCreditCardStatements
// takes an injectable `today` and only reaches the DB via execO — so a tiny fake DB
// lets us exercise the real logic deterministically through the public surface.
function card(over: Partial<Account>): Account {
  return {
    id: 'cc1',
    name: 'Card',
    type: 'credit_card',
    currency: 'INR',
    opening_balance_minor: 0,
    is_main: 0,
    include_in_total: 1,
    credit_limit_minor: null,
    statement_day: 15,
    due_day: 5,
    pay_from_account_id: null,
    color: null,
    icon: null,
    starts_on: '2020-01-01',
    archived_at: null,
    created_at: '',
    ...over,
  };
}

function fakeDB(cards: Account[], balanceMinorById: Record<string, number> = {}): DB {
  return {
    execO: async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM accounts')) return cards as unknown[];
      const id = params?.[0] as string;
      return [{ total: balanceMinorById[id] ?? 0 }];
    },
  } as unknown as DB;
}

describe('getCreditCardStatements', () => {
  it('when today is on/before the statement day, the cycle ends this month', async () => {
    const db = fakeDB([{ ...card({}), statement_day: 15, due_day: 5 }]);
    const [info] = await getCreditCardStatements(db, '2026-06-10');
    expect(info.cycleStart).toBe('2026-05-16'); // day after the previous statement
    expect(info.cycleEnd).toBe('2026-06-15');
    // due day 5 <= cycleEnd day 15, so the due date rolls to the next month
    expect(info.dueDate).toBe('2026-07-05');
    expect(info.daysUntilDue).toBe(25);
    expect(info.isPastDue).toBe(false);
  });

  it('when today is after the statement day, the cycle ends next month', async () => {
    const db = fakeDB([{ ...card({}), statement_day: 15, due_day: 5 }]);
    const [info] = await getCreditCardStatements(db, '2026-06-20');
    expect(info.cycleStart).toBe('2026-06-16');
    expect(info.cycleEnd).toBe('2026-07-15');
    expect(info.dueDate).toBe('2026-08-05');
  });

  it('due day after the cycle-end day stays in the cycle-end month', async () => {
    const db = fakeDB([{ ...card({}), statement_day: 15, due_day: 20 }]);
    const [info] = await getCreditCardStatements(db, '2026-06-10');
    expect(info.cycleEnd).toBe('2026-06-15');
    // due day 20 > 15, so it falls in the same month as the cycle end
    expect(info.dueDate).toBe('2026-06-20');
  });

  it('clamps a statement day of 31 to the last day of a short month (Feb)', async () => {
    const db = fakeDB([{ ...card({}), statement_day: 31, due_day: 20 }]);
    const [info] = await getCreditCardStatements(db, '2026-02-10');
    expect(info.cycleStart).toBe('2026-02-01'); // prev statement Jan 31 + 1 day
    expect(info.cycleEnd).toBe('2026-02-28'); // 2026 is not a leap year
    expect(info.dueDate).toBe('2026-03-20');
  });

  it('falls back to the statement day when no due day is set', async () => {
    const db = fakeDB([{ ...card({}), statement_day: 15, due_day: null }]);
    const [info] = await getCreditCardStatements(db, '2026-06-10');
    // due_day defaults to statement_day (15); 15 is not > cycleEnd day 15, so next month
    expect(info.dueDate).toBe('2026-07-15');
  });

  it('passes the summed statement balance through from the DB', async () => {
    const db = fakeDB([{ ...card({}), id: 'visa' }], { visa: 1234500 });
    const [info] = await getCreditCardStatements(db, '2026-06-10');
    expect(info.statementBalance).toBe(1234500);
    expect(info.account.id).toBe('visa');
  });

  it('reports multiple cards independently', async () => {
    const db = fakeDB([
      { ...card({}), id: 'a', statement_day: 15, due_day: 5 },
      { ...card({}), id: 'b', statement_day: 1, due_day: 28 },
    ]);
    const infos = await getCreditCardStatements(db, '2026-06-10');
    expect(infos.map((i) => i.account.id)).toEqual(['a', 'b']);
    // statement day 1, today June 10 is past it, so card b's cycle ends next month
    expect(infos[1].cycleEnd).toBe('2026-07-01');
  });
});
