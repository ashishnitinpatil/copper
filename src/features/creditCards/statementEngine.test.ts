import { describe, expect, it } from 'vitest';
import { getCardBills, getCreditCardStatements } from './statementEngine';
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
    loan_principal_minor: null,
    loan_rate_bp: null,
    loan_interest_method: null,
    loan_term_months: null,
    loan_payment_minor: null,
    loan_autopay_from: null,
    color: null,
    icon: null,
    starts_on: '2020-01-01',
    archived_at: null,
    created_at: '',
    ...over,
  };
}

type Sums = { closed?: number; paid?: number; open?: number };

function fakeDB(cards: Account[], sumsById: Record<string, Sums> = {}): DB {
  return {
    execO: async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM accounts')) return cards as unknown[];
      const id = params?.[params.length - 1] as string;
      const s = sumsById[id] ?? {};
      return [{ closed: s.closed ?? 0, paid: s.paid ?? 0, open: s.open ?? 0 }];
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

  it('shows the open cycle once the closed statement is paid', async () => {
    const db = fakeDB([{ ...card({}), id: 'visa' }], { visa: { closed: 500, paid: 500, open: 1234500 } });
    const [info] = await getCreditCardStatements(db, '2026-06-20');
    expect(info.statementBalance).toBe(1234500);
    expect(info.cycleEnd).toBe('2026-07-15');
    expect(info.account.id).toBe('visa');
  });

  it('keeps showing the closed statement until payments cover it', async () => {
    const db = fakeDB([card({})], { cc1: { closed: 10000, paid: 4000, open: 2500 } });
    const [info] = await getCreditCardStatements(db, '2026-06-20');
    expect(info.cycleStart).toBe('2026-05-16');
    expect(info.cycleEnd).toBe('2026-06-15');
    expect(info.statementBalance).toBe(6000); // what's left to pay
    expect(info.dueDate).toBe('2026-07-05');
  });

  it('an unpaid statement past its due date is past due', async () => {
    const db = fakeDB([card({})], { cc1: { closed: 10000 } });
    const [info] = await getCreditCardStatements(db, '2026-07-08');
    expect(info.cycleEnd).toBe('2026-06-15');
    expect(info.isPastDue).toBe(true);
    expect(info.daysUntilDue).toBe(-3);
  });

  it('paying more than the statement counts toward the open cycle', async () => {
    const db = fakeDB([card({})], { cc1: { closed: 10000, paid: 12000, open: 5000 } });
    const [info] = await getCreditCardStatements(db, '2026-06-20');
    expect(info.cycleEnd).toBe('2026-07-15');
    expect(info.statementBalance).toBe(3000);
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

describe('getCardBills', () => {
  // Answers the bill query with what the card owed at the statement and how
  // many payments came after it, and notes the dates asked about.
  function billDB(cards: Account[], owed: number, paid: number, asked: unknown[][] = []): DB {
    return {
      execO: async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM accounts')) return cards as unknown[];
        asked.push(params ?? []);
        return [{ owed, paid }];
      },
    } as unknown as DB;
  }

  it('a card that owed money at its statement has an unpaid bill until a payment goes in', async () => {
    const asked: unknown[][] = [];
    const [bill] = await getCardBills(billDB([card({ statement_day: 3, due_day: 18 })], -500000, 0, asked), '2026-11-12');
    expect(bill.statementDate).toBe('2026-11-03');
    expect(bill.dueDate).toBe('2026-11-18');
    expect(bill.daysUntilDue).toBe(6);
    expect(bill.paid).toBe(false);
    // Owed is counted up to the statement; payments after it, up to the due date
    // (a payment scheduled for it counts).
    expect(asked[0]).toEqual([0, '2026-11-03', '2020-01-01', '2020-01-01', '2026-11-03', '2026-11-18', 'cc1']);

    const [paid] = await getCardBills(billDB([card({ statement_day: 3, due_day: 18 })], -500000, 1), '2026-11-12');
    expect(paid.paid).toBe(true);
  });

  it('no bill when nothing was owed at the statement', async () => {
    expect(await getCardBills(billDB([card({})], 0, 0), '2026-11-12')).toEqual([]);
    expect(await getCardBills(billDB([card({})], 2500, 0), '2026-11-12')).toEqual([]);
  });

  it('a missed due date shows as negative days; no due day, no due date', async () => {
    const [late] = await getCardBills(billDB([card({ statement_day: 3, due_day: 18 })], -100, 0), '2026-11-20');
    expect(late.daysUntilDue).toBe(-2);
    const [undated] = await getCardBills(billDB([card({ statement_day: 3, due_day: null })], -100, 0), '2026-11-20');
    expect(undated.dueDate).toBeNull();
    expect(undated.daysUntilDue).toBeNull();
  });

  it('on the statement day itself, the bill is still the previous one', async () => {
    const [bill] = await getCardBills(billDB([card({ statement_day: 3, due_day: 18 })], -100, 0), '2026-12-03');
    expect(bill.statementDate).toBe('2026-11-03');
  });
});
