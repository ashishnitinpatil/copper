import { describe, expect, it } from 'vitest';
import { findAlreadyAdded, guessDateOrder, matchAccount, matchCategory, parseDate, parsePasted } from './pasteRows';
import type { Account, Category } from '@/db/types';

describe('parseDate', () => {
  it('reads the ways dates get written', () => {
    expect(parseDate('2026-11-08')).toBe('2026-11-08');
    expect(parseDate('2026/11/08 14:20')).toBe('2026-11-08');
    expect(parseDate('08/11/2026')).toBe('2026-11-08');
    expect(parseDate('08/11/2026', 'mdy')).toBe('2026-08-11');
    expect(parseDate('8-11-26')).toBe('2026-11-08');
    expect(parseDate('8 Nov 2026')).toBe('2026-11-08');
    expect(parseDate('08-Nov-26')).toBe('2026-11-08');
    expect(parseDate('Nov 8, 2026')).toBe('2026-11-08');
    expect(parseDate('November 8 2026')).toBe('2026-11-08');
  });
  it('refuses what isn’t a date', () => {
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('lunch')).toBeNull();
    expect(parseDate('1200')).toBeNull();
  });
  it('a day over 12 tells which way round the dates go', () => {
    expect(guessDateOrder(['03/04/2026', '25/04/2026'], 'mdy')).toBe('dmy');
    expect(guessDateOrder(['04/25/2026'], 'dmy')).toBe('mdy');
    expect(guessDateOrder(['03/04/2026'], 'mdy')).toBe('mdy');
  });
});

describe('parsePasted', () => {
  it('reads the CSV an AI is asked for, fences and all', () => {
    const rows = parsePasted(
      [
        '```csv',
        'date,amount,type,account,category,note',
        '2026-11-08,120.50,expense,Cash,Groceries,"Milk, eggs"',
        '2026-11-09,5000,income,HDFC,Salary,',
        '```',
      ].join('\n'),
    );
    expect(rows).toEqual([
      { date: '2026-11-08', amount: '120.50', kind: 'expense', account: 'Cash', category: 'Groceries', note: 'Milk, eggs' },
      { date: '2026-11-09', amount: '5000', kind: 'income', account: 'HDFC', category: 'Salary', note: '' },
    ]);
  });

  it('reads a spreadsheet copy (tabs) with a statement’s signed amounts', () => {
    const rows = parsePasted('Date\tDescription\tAmount\n25/10/2026\tCARREFOUR\t-1,234.00\n26/10/2026\tRefund\t200.00');
    expect(rows.map((r) => [r.date, r.note, r.amount, r.kind])).toEqual([
      ['2026-10-25', 'CARREFOUR', '1,234.00', 'expense'],
      ['2026-10-26', 'Refund', '200.00', 'income'],
    ]);
  });

  it('reads separate debit and credit columns', () => {
    const rows = parsePasted('Txn Date,Narration,Debit,Credit\n01/11/2026,ATM,500.00,\n02/11/2026,Interest,,12.40');
    expect(rows.map((r) => [r.amount, r.kind])).toEqual([
      ['500.00', 'expense'],
      ['12.40', 'income'],
    ]);
  });

  it('unsigned amounts with no type are spending', () => {
    const rows = parsePasted('date,note,amount\n2026-11-01,Tea,20\n2026-11-01,Bus,15');
    expect(rows.every((r) => r.kind === 'expense')).toBe(true);
  });

  it('without a header, finds the date and amount by what’s in them', () => {
    const rows = parsePasted('Coffee\t08/11/2026\t4.50\nTaxi\t09/11/2026\t30');
    expect(rows[0]).toMatchObject({ date: '2026-11-08', amount: '4.50', note: 'Coffee', kind: 'expense' });
    expect(rows).toHaveLength(2);
  });

  it('DR/CR after the amount, and brackets for money out', () => {
    const rows = parsePasted('date,amount,note\n2026-11-01,250.00 DR,Fuel\n2026-11-02,(99),Fee\n2026-11-03,1000 CR,Refund');
    expect(rows.map((r) => [r.amount, r.kind])).toEqual([
      ['250.00', 'expense'],
      ['99', 'expense'],
      ['1000', 'income'],
    ]);
  });

  it('nothing pasted, nothing read', () => {
    expect(parsePasted('  \n ')).toEqual([]);
  });
});

describe('matching names', () => {
  const accounts = [
    { id: 'a1', name: 'Cash' },
    { id: 'a2', name: 'HDFC Bank' },
  ] as Account[];
  const categories = [
    { id: 'c1', name: 'Food', parent_id: null, kind: 'expense' },
    { id: 'c2', name: 'Groceries', parent_id: 'c1', kind: 'expense' },
    { id: 'c3', name: 'Other', parent_id: 'c1', kind: 'expense' },
    { id: 'c4', name: 'Other', parent_id: null, kind: 'income' },
    { id: 'c5', name: 'Transport', parent_id: null, kind: 'expense' },
    { id: 'c6', name: 'Other', parent_id: 'c5', kind: 'expense' },
    { id: 'c7', name: 'Rent', parent_id: null, kind: 'expense' },
    { id: 'c8', name: 'Rent', parent_id: null, kind: 'expense' },
  ] as Category[];

  it('accounts match by name, ignoring case and spacing', () => {
    expect(matchAccount(' hdfc  bank', accounts)).toBe('a2');
    expect(matchAccount('HDFC', accounts)).toBeNull();
  });

  it('categories match by name or path, of the entry’s kind', () => {
    expect(matchCategory('groceries', categories, 'expense')).toBe('c2');
    expect(matchCategory('Food > Groceries', categories, null)).toBe('c2');
    expect(matchCategory('Food / Other', categories, 'expense')).toBe('c3');
    expect(matchCategory('Other', categories, 'income')).toBe('c4');
    // Two expense categories are called Other: which one isn't ours to guess.
    expect(matchCategory('Other', categories, 'expense')).toBeNull();
    expect(matchCategory('Groceries', categories, 'income')).toBeNull();
    // Two called just Rent look the same everywhere: either is right.
    expect(matchCategory('rent', categories, 'expense')).toBe('c7');
  });
});

describe('findAlreadyAdded', () => {
  const tx = (id: string, day: string, amount: number, account = 'a1') => ({
    id,
    account_id: account,
    occurred_on: day,
    amount_minor: amount,
  });
  const row = (key: number, date: string, amountMinor: number, accountId = 'a1') => ({ key, date, amountMinor, accountId });

  it('same account and amount within a few days', () => {
    const found = findAlreadyAdded(
      [row(1, '2026-11-08', -500), row(2, '2026-11-08', -500, 'a2'), row(3, '2026-11-01', -500), row(4, '2026-11-08', 500)],
      [tx('t1', '2026-11-06', -500)],
    );
    expect([...found.keys()]).toEqual([1]);
  });

  it('one entry in the book covers one row: the closest', () => {
    const found = findAlreadyAdded(
      [row(1, '2026-11-05', -350), row(2, '2026-11-08', -350)],
      [tx('t1', '2026-11-07', -350)],
    );
    expect([...found.entries()].map(([k, t]) => [k, t.id])).toEqual([[2, 't1']]);
  });
});
