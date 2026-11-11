import { test, expect } from '@playwright/test';
import { appSql, resetAndLoad } from './helpers';

test.describe('Add several', () => {
  test('pasted rows match the book, unknown names wait for a pick, and all save at once', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00'));
    await resetAndLoad(page, '/add');
    await page.getByRole('button', { name: 'Add several' }).click();
    await expect(page).toHaveURL(/\/add\/several$/);

    // What an AI answers with, fences and all.
    await page.getByLabel('Paste rows').fill(
      [
        '```csv',
        'date,amount,type,account,category,note',
        '2026-11-08,120.50,expense,Cash,Groceries,"Milk, eggs"',
        '2026-11-09,40,expense,Wallet,Groceries,Bread',
        '2026-11-09,5000,income,Cash,Gift money,Diwali',
        '```',
      ].join('\n'),
    );
    await page.getByRole('button', { name: 'Read these rows' }).click();

    await expect(page.getByLabel('Note, row 1')).toHaveValue('Milk, eggs');
    await expect(page.getByLabel('Date, row 2')).toHaveValue('2026-11-09');
    await expect(page.getByText('“Wallet” isn’t one of your accounts')).toBeVisible();
    await expect(page.getByText('“Gift money” isn’t one of your income categories')).toBeVisible();
    await expect(page.getByLabel('Type, row 3')).toHaveValue('income');
    // Totals to check against a statement (row 2 counts once it has an account).
    await expect(page.getByText('₹120.50 out · ₹5,000.00 in')).toBeVisible();

    await page.getByRole('button', { name: 'Add 3 entries' }).click();
    await expect(page.getByText('2 rows are missing something: fill in the outlined cells.')).toBeVisible();
    expect(await appSql(page, 'SELECT count(*) FROM transactions')).toEqual([[0]]);

    await page.getByLabel('Account, row 2').selectOption({ label: 'Cash' });
    await page.getByLabel('Category, row 3').selectOption({ label: 'Salary' });
    await page.getByRole('button', { name: 'Add 3 entries' }).click();
    await expect(page.getByText('Added 3 entries.')).toBeVisible();
    expect(
      await appSql(page, 'SELECT occurred_on, amount_minor, kind, note FROM transactions ORDER BY occurred_on, amount_minor'),
    ).toEqual([
      ['2026-11-08', -12050, 'expense', 'Milk, eggs'],
      ['2026-11-09', -4000, 'expense', 'Bread'],
      ['2026-11-09', 500000, 'income', 'Diwali'],
    ]);

    // One Undo takes them all back.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => appSql(page, 'SELECT count(*) FROM transactions')).toEqual([[0]]);
  });

  test('typed in: Enter starts a row with the same date and account, and a draft survives leaving', async ({ page }) => {
    await resetAndLoad(page, '/add/several');
    await page.getByLabel('Date, row 1').fill('2026-11-01');
    await page.getByLabel('Amount, row 1').fill('30');
    await page.getByLabel('Category, row 1').selectOption({ label: 'Transport' });
    await page.getByLabel('Note, row 1').fill('Bus');
    await page.getByLabel('Note, row 1').press('Enter');
    await expect(page.getByLabel('Note, row 2')).toBeFocused();
    await expect(page.getByLabel('Date, row 2')).toHaveValue('2026-11-01');
    await expect(page.getByLabel('Account, row 2')).toHaveValue(await page.getByLabel('Account, row 1').inputValue());

    // A spreadsheet copy pasted into a cell fills rows from there.
    await page.getByLabel('Amount, row 2').focus();
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'Date\tDescription\tAmount\n02/11/2026\tTea\t-20\n03/11/2026\tRefund\t15');
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    });
    await expect(page.getByLabel('Note, row 2')).toHaveValue('Tea');
    await expect(page.getByLabel('Type, row 3')).toHaveValue('income');
    await expect(page.getByLabel('Note, row 4')).toHaveCount(0);

    await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/add/several');
    await expect(page.getByLabel('Note, row 3')).toHaveValue('Refund');
  });

  test('the AI instructions carry the book’s own names', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await resetAndLoad(page, '/add/several');
    await page.getByRole('button', { name: 'Copy instructions for an AI' }).click();
    await expect(page.getByText(/^Copied\./)).toBeVisible();
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain('date,amount,type,account,category,note');
    expect(prompt).toContain('- Cash (INR)');
    expect(prompt).toMatch(/Expense categories:[\s\S]*- Groceries/);
    expect(prompt).toMatch(/Income categories:[\s\S]*- Salary/);
  });

  test('from one account’s transactions, it starts on that account', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await page.locator('div.rounded-xl', { hasText: 'Cash' }).first().getByRole('link', { name: 'Transactions →' }).click();
    await page.getByRole('link', { name: 'Add missing entries' }).click();
    await expect(page).toHaveURL(/\/add\/several\?account=/);
    await expect(page.getByLabel('Account, row 1').locator('option:checked')).toHaveText('Cash');
  });
  test('a pasted statement points out what’s already in, and leaves it out on request', async ({ page }) => {
    await resetAndLoad(page, '/add/several');
    const [[cash]] = (await appSql(page, "SELECT id FROM accounts WHERE name = 'Cash'")) as string[][];
    await appSql(
      page,
      "INSERT INTO transactions (id, account_id, amount_minor, kind, occurred_on, note, created_at) VALUES ('x', ?, -45000, 'expense', '2026-11-06', 'Dinner', '2026-11-06')",
      [cash],
    );
    await page.getByLabel('Paste rows').fill('Date,Description,Amount\n07/11/2026,RESTAURANT,-450.00\n08/11/2026,PHARMACY,-120.00');
    await page.getByRole('button', { name: 'Read these rows' }).click();
    await expect(page.getByText('Looks already in Copper: Nov')).toContainText('Dinner');
    await expect(page.getByLabel('Note, row 1')).toHaveValue('RESTAURANT');
    await page.getByRole('button', { name: 'Leave it out' }).click();
    await expect(page.getByLabel('Note, row 1')).toHaveValue('PHARMACY');
    await expect(page.getByLabel('Note, row 2')).toHaveCount(0);
  });
});
