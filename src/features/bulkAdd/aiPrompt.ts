import type { Account, Category } from '@/db/types';

/**
 * Instructions to paste into an AI chat along with a statement, receipts or a
 * list: it answers with rows Add several reads straight in. Carries this book's
 * own account and category names so its answer matches them.
 */
export function buildAiPrompt(accounts: Account[], categories: Category[], today: string): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path = (c: Category) => {
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    return parent ? `${parent.name} > ${c.name}` : c.name;
  };
  const list = (kind: 'expense' | 'income') =>
    [...new Set(categories.filter((c) => c.kind === kind && !c.archived_at).map(path))]
      .sort((a, b) => a.localeCompare(b))
      .map((p) => `- ${p}`)
      .join('\n');
  const accountList = accounts
    .filter((a) => !a.archived_at)
    .map((a) => `- ${a.name} (${a.currency})`)
    .join('\n');

  return `I keep my spending in an expense tracker called Copper. Turn what I give you (a statement, receipts, a photo or a list) into rows I can paste into it.

Reply with only a CSV code block, with this header and one row per entry:

date,amount,type,account,category,note

- date: YYYY-MM-DD. Today is ${today}; for a date without a year, use the most recent one that isn't in the future.
- amount: a plain positive number in the account's currency, with a dot for decimals and no currency sign or thousands separator (1234.50).
- type: expense for money spent or paid out, income for money received.
- account: one of my accounts below, written exactly as shown, or blank if you can't tell.
- category: one of my categories below for that type, written exactly as shown, or blank if none fits. Don't make up new ones.
- note: a few words saying what it was (the shop, person or item). Put it in double quotes if it has a comma.

Leave out transfers between my own accounts, card bill payments from my bank account, and anything that isn't real spending or income. Don't add totals. If something is unclear, still include the row and leave the unsure cell blank; I'll fill it in.

My accounts:
${accountList}

Expense categories:
${list('expense')}

Income categories:
${list('income')}`;
}
