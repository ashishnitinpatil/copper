import { describe, it, expect } from 'vitest';
import { parseMonefyCsv, parseCsv } from './parseMonefy';

const HEADER = 'date,account,category,amount,currency,converted amount,currency,description';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

describe('parseCsv', () => {
  it('handles quoted fields with commas', () => {
    const rows = parseCsv('a,b,c\n1,"2,3",4\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2,3', '4'],
    ]);
  });

  it('handles escaped quotes', () => {
    const rows = parseCsv('a,b\n"hello ""world""","x"\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['hello "world"', 'x'],
    ]);
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseMonefyCsv', () => {
  it('parses basic expense rows', () => {
    const text = csv(
      '22/01/2019,Cash,Eating out,-4.5,AED,-4.5,AED,Breakfast',
      '22/01/2019,Cash,Salary,"6,021",AED,"6,021",AED,December',
    );
    const plan = parseMonefyCsv(text);
    expect(plan.transactions).toHaveLength(2);
    expect(plan.transactions[0]).toMatchObject({
      date: '2019-01-22',
      account: 'Cash',
      category: 'Eating out',
      amountMinor: 450,
      kind: 'expense',
      note: 'Breakfast',
    });
    expect(plan.transactions[1]).toMatchObject({
      category: 'Salary',
      amountMinor: 602100,
      kind: 'income',
    });
  });

  it('extracts initial balance into openingBalanceMinor', () => {
    const text = csv(
      "21/01/2019,ZRAK Red,Initial balance 'ZRAK Red',\"-5,062.35\",AED,\"-5,062.35\",AED,",
      '21/01/2019,ZRAK Red,Eating out,-10,AED,-10,AED,',
    );
    const plan = parseMonefyCsv(text);
    const acct = plan.accounts.find((a) => a.name === 'ZRAK Red');
    expect(acct).toBeDefined();
    expect(acct!.openingBalanceMinor).toBe(-506235);
    expect(plan.transactions).toHaveLength(1);
  });

  it('pairs transfer rows', () => {
    const text = csv(
      "22/01/2019,ZEI Savings,To 'ZRAK Red',\"-1,000\",AED,\"-1,000\",AED,Card payment",
      "22/01/2019,ZRAK Red,From 'ZEI Savings',\"1,000\",AED,\"1,000\",AED,Card payment",
    );
    const plan = parseMonefyCsv(text);
    expect(plan.transfers).toHaveLength(1);
    expect(plan.transfers[0]).toMatchObject({
      date: '2019-01-22',
      fromAccount: 'ZEI Savings',
      toAccount: 'ZRAK Red',
      amountMinor: 100000,
      note: 'Card payment',
    });
    expect(plan.transactions).toHaveLength(0);
  });

  it('flags unpaired transfer rows', () => {
    const text = csv("22/01/2019,ZEI Savings,To 'ZRAK Red',-1000,AED,-1000,AED,");
    const plan = parseMonefyCsv(text);
    expect(plan.transfers).toHaveLength(0);
    expect(plan.unpairedTransfers).toHaveLength(1);
  });

  it('infers category kind by sign majority', () => {
    const text = csv(
      '01/01/2020,Cash,Salary,1000,AED,1000,AED,',
      '02/01/2020,Cash,Salary,500,AED,500,AED,',
      '03/01/2020,Cash,Salary,-50,AED,-50,AED,refund',
      '01/01/2020,Cash,Groceries,-10,AED,-10,AED,',
      '02/01/2020,Cash,Groceries,-20,AED,-20,AED,',
    );
    const plan = parseMonefyCsv(text);
    const salary = plan.categories.find((c) => c.name === 'Salary');
    const groceries = plan.categories.find((c) => c.name === 'Groceries');
    expect(salary?.kind).toBe('income');
    expect(groceries?.kind).toBe('expense');
  });

  it('infers account types', () => {
    const text = csv(
      '01/01/2020,Cash,Groceries,-10,AED,-10,AED,',
      '01/01/2020,FAB Blue CC,Groceries,-10,AED,-10,AED,',
      '01/01/2020,ZEI Savings,Salary,1000,AED,1000,AED,',
      '01/01/2020,Splitwise,Eating out,-10,AED,-10,AED,',
      '01/01/2020,LivX Crypto,Investment,-10,AED,-10,AED,',
    );
    const plan = parseMonefyCsv(text);
    const byName = Object.fromEntries(plan.accounts.map((a) => [a.name, a.type]));
    expect(byName['Cash']).toBe('cash');
    expect(byName['FAB Blue CC']).toBe('credit_card');
    expect(byName['ZEI Savings']).toBe('bank');
    expect(byName['Splitwise']).toBe('loan');
    expect(byName['LivX Crypto']).toBe('other');
  });

  it('handles notes with commas and quotes', () => {
    const text = csv(
      '22/01/2019,Cash,Taxi,-12,AED,-12,AED,"Missed 366, caught it at headquarters"',
      '25/01/2019,Cash,Drinks,-5,AED,-5,AED,"Said ""hello"" to bob"',
    );
    const plan = parseMonefyCsv(text);
    expect(plan.transactions[0].note).toBe('Missed 366, caught it at headquarters');
    expect(plan.transactions[1].note).toBe('Said "hello" to bob');
  });

  it('pairs multiple same-amount transfers on the same day greedily', () => {
    const text = csv(
      "01/01/2020,A,To 'B',-100,AED,-100,AED,one",
      "01/01/2020,B,From 'A',100,AED,100,AED,one",
      "01/01/2020,A,To 'B',-100,AED,-100,AED,two",
      "01/01/2020,B,From 'A',100,AED,100,AED,two",
    );
    const plan = parseMonefyCsv(text);
    expect(plan.transfers).toHaveLength(2);
    expect(plan.unpairedTransfers).toHaveLength(0);
  });

  it('returns warning when CSV is missing columns', () => {
    const plan = parseMonefyCsv('foo,bar\n1,2\n');
    expect(plan.warnings[0]).toContain('Missing expected column');
    expect(plan.accounts).toHaveLength(0);
  });
});
