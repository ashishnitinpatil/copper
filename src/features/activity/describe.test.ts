import { describe, expect, it } from 'vitest';
import {
  describeEntry,
  describeGroup,
  joinList,
  repeatLabel,
  type DescribableEntry,
  type DescribableGroup,
  type Lookups,
} from './describe';

const L: Lookups = {
  accounts: new Map([
    ['hdfc', { name: 'HDFC', currency: 'INR' }],
    ['cash', { name: 'Cash', currency: 'INR' }],
    ['wise', { name: 'Wise', currency: 'USD' }],
  ]),
  categories: new Map([
    ['food', 'Food & Dining'],
    ['groc', 'Groceries'],
    ['sal', 'Salary'],
  ]),
  tags: new Map([['trip', 'Goa trip']]),
  defaultCurrency: 'INR',
};

// Money is formatted with locale separators and an isolated symbol; compare on
// the visible characters only.
const plain = (s: string) => s.replace(/[⁦-⁩‎‏]/g, '');

const tx = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  account_id: 'hdfc',
  category_id: 'food',
  amount_minor: -50000,
  kind: 'expense',
  occurred_on: '2026-10-12',
  note: 'lunch',
  ...over,
});

function entry(e: Partial<DescribableEntry> & Pick<DescribableEntry, 'entity' | 'op'>, diff: unknown): DescribableEntry {
  return { source: null, current: null, ...e, diff: JSON.stringify(diff) };
}

describe('transactions', () => {
  it('describes an added expense with its account, date and note', () => {
    const d = describeEntry(L, entry({ entity: 'transaction', op: 'insert' }, { after: tx() }));
    expect(plain(d.text)).toMatch(/^added an expense of ₹500\.00 in Food & Dining$/);
    expect(d.detail).toMatch(/^HDFC · .*12.* · “lunch”$/);
  });

  it('describes income', () => {
    const d = describeEntry(
      L,
      entry({ entity: 'transaction', op: 'insert' }, { after: tx({ kind: 'income', amount_minor: 100000, category_id: 'sal' }) }),
    );
    expect(plain(d.text)).toMatch(/^added income of ₹1,000\.00 in Salary$/);
  });

  it('lists what an edit changed, in words', () => {
    const d = describeEntry(
      L,
      entry(
        { entity: 'transaction', op: 'update', current: tx({ amount_minor: -60000, category_id: 'groc' }) },
        { changes: { amount_minor: { old: -50000, new: -60000 }, category_id: { old: 'food', new: 'groc' } } },
      ),
    );
    expect(plain(d.text)).toMatch(/^edited an expense of ₹600\.00 in Groceries$/);
    expect(d.changes.map((c) => [c.label, plain(c.from), plain(c.to)])).toEqual([
      ['Amount', '₹500.00', '₹600.00'],
      ['Category', 'Food & Dining', 'Groceries'],
    ]);
  });

  it('describes the record as the edit left it, not as it is now', () => {
    // Later edits moved it to Groceries; this edit set the amount while it was Food.
    const d = describeEntry(
      L,
      entry(
        { entity: 'transaction', op: 'update', current: tx({ category_id: 'groc', amount_minor: -70000 }) },
        { changes: { amount_minor: { old: -50000, new: -60000 } } },
      ),
    );
    expect(plain(d.text)).toContain('₹600.00');
  });

  it('describes a deleted transaction from its last snapshot', () => {
    const d = describeEntry(L, entry({ entity: 'transaction', op: 'delete' }, { before: tx() }));
    expect(plain(d.text)).toMatch(/^deleted an expense of ₹500\.00 in Food & Dining$/);
  });

  it('describes tagging', () => {
    const d = describeEntry(
      L,
      entry(
        { entity: 'transaction', op: 'update', current: tx() },
        { changes: { tags: { old: [], new: ['trip'] } } },
      ),
    );
    expect(plain(d.text)).toMatch(/^tagged an expense of ₹500\.00 in Food & Dining with Goa trip$/);
  });
});

describe('transfers', () => {
  const legs = (op: 'insert' | 'delete', toAccount = 'cash', toAmount = 100000) => [
    entry({ entity: 'transaction', op, source: 'transfer' }, {
      [op === 'insert' ? 'after' : 'before']: tx({ kind: 'transfer', category_id: null, amount_minor: -100000, note: null }),
    }),
    entry({ entity: 'transaction', op, source: 'transfer' }, {
      [op === 'insert' ? 'after' : 'before']: tx({ kind: 'transfer', category_id: null, account_id: toAccount, amount_minor: toAmount, note: null }),
    }),
  ];
  const group = (entries: DescribableEntry[], source: string | null = 'transfer'): DescribableGroup => ({
    source,
    total: entries.length,
    counts: [],
    entries,
  });

  it('reads as money moving between accounts', () => {
    expect(plain(describeGroup(L, group(legs('insert'))).text)).toBe('moved ₹1,000.00 from HDFC to Cash');
  });

  it('says what arrived when the currencies differ', () => {
    expect(plain(describeGroup(L, group(legs('insert', 'wise', 1200))).text)).toBe(
      'moved ₹1,000.00 from HDFC to Wise ($12.00 arrived)',
    );
  });

  it('says a restored transfer was restored', () => {
    expect(plain(describeGroup(L, group(legs('insert'), 'restore')).text)).toBe(
      'restored the transfer of ₹1,000.00 from HDFC to Cash',
    );
  });

  it('says a restored entry was restored', () => {
    const one = [entry({ entity: 'transaction', op: 'insert', source: 'restore' }, { after: tx() })];
    expect(plain(describeGroup(L, { source: 'restore', total: 1, counts: [], entries: one }).text)).toMatch(
      /^restored an expense of ₹500\.00 in Food & Dining/,
    );
  });

  it('recognises a deleted transfer (logged without a source)', () => {
    expect(plain(describeGroup(L, group(legs('delete'), null)).text)).toBe(
      'deleted the transfer of ₹1,000.00 from HDFC to Cash',
    );
  });
});

describe('accounts, categories, budgets', () => {
  const acct = { id: 'hdfc', name: 'HDFC', currency: 'INR', include_in_total: 1 };

  it('says when an account stops counting in the total', () => {
    const d = describeEntry(
      L,
      entry({ entity: 'account', op: 'update', current: { ...acct, include_in_total: 0 } }, {
        changes: { include_in_total: { old: 1, new: 0 } },
      }),
    );
    expect(d.text).toBe('stopped counting HDFC in the total balance');
  });

  it('describes a rename', () => {
    const d = describeEntry(
      L,
      entry({ entity: 'category', op: 'update', current: { name: 'Eating out' } }, {
        changes: { name: { old: 'Food', new: 'Eating out' } },
      }),
    );
    expect(d.text).toBe('renamed the category “Food” to “Eating out”');
  });

  it('describes archiving', () => {
    const d = describeEntry(
      L,
      entry({ entity: 'account', op: 'update', current: acct }, {
        changes: { archived_at: { old: null, new: '2026-10-12T10:00:00Z' } },
      }),
    );
    expect(d.text).toBe('archived the account HDFC');
  });

  it('describes a budget amount change in one sentence', () => {
    const d = describeEntry(
      L,
      entry({ entity: 'budget', op: 'update', current: { category_id: 'food', amount_minor: 600000, currency: 'INR' } }, {
        changes: { amount_minor: { old: 500000, new: 600000 } },
      }),
    );
    expect(plain(d.text)).toBe('changed the Food & Dining budget from ₹5,000.00 to ₹6,000.00');
  });

  it('describes a repeating entry', () => {
    const d = describeEntry(
      L,
      entry({ entity: 'recurring', op: 'insert' }, {
        after: {
          template_json: JSON.stringify({ account_id: 'hdfc', category_id: 'food', amount_minor: 30000, kind: 'expense', note: null }),
          rrule: 'FREQ=MONTHLY;INTERVAL=1',
        },
      }),
    );
    expect(plain(d.text)).toBe('set up a recurring expense of ₹300.00 in Food & Dining (monthly)');
  });
});

describe('bulk operations', () => {
  it('summarises an import from its counts, not just the loaded rows', () => {
    const d = describeGroup(L, {
      source: 'monefy-import',
      total: 11814,
      counts: [
        { entity: 'transaction', op: 'insert', n: 11720 },
        { entity: 'account', op: 'insert', n: 26 },
        { entity: 'category', op: 'insert', n: 68 },
      ],
      entries: [],
    });
    expect(d.text).toBe(`imported ${(11720).toLocaleString()} transactions, 26 accounts and 68 categories from Monefy`);
  });

  it('names both sides of a merge', () => {
    const d = describeGroup(L, {
      source: 'category-merge',
      total: 3,
      counts: [
        { entity: 'transaction', op: 'update', n: 2 },
        { entity: 'category', op: 'delete', n: 1 },
      ],
      entries: [entry({ entity: 'category', op: 'delete' }, { before: { name: 'Food' }, merged_into: 'groc' })],
    });
    expect(d.text).toBe('merged the category Food into Groceries');
    expect(d.detail).toBe('2 transactions moved across');
  });
});

describe('helpers', () => {
  it('joins lists in prose', () => {
    expect(joinList(['a'])).toBe('a');
    expect(joinList(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('labels repeat rules', () => {
    expect(repeatLabel('FREQ=WEEKLY;INTERVAL=2')).toBe('every 2 weeks');
    expect(repeatLabel('FREQ=DAILY;INTERVAL=1')).toBe('daily');
  });
});
