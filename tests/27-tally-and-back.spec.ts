import { test, expect } from '@playwright/test';
import { appSql, resetAndLoad, waitForDB } from './helpers';

test.describe('One account’s transactions', () => {
  test('each day shows the balance it ended on, and the filter survives leaving the page', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00'));
    await resetAndLoad(page, '/accounts');
    const [[cash]] = (await appSql(page, "SELECT id FROM accounts WHERE name = 'Cash'")) as string[][];
    await appSql(page, "UPDATE accounts SET opening_balance_minor = 100000, starts_on = '' WHERE id = ?", [cash]);
    const add = (id: string, amount: number, day: string) =>
      appSql(
        page,
        "INSERT INTO transactions (id, account_id, amount_minor, kind, occurred_on, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [id, cash, amount, amount < 0 ? 'expense' : 'income', day, day],
      );
    await add('a', -20000, '2026-11-08');
    await add('b', -5000, '2026-11-09');
    await add('c', 30000, '2026-11-09');

    // From the account's card.
    await page.reload();
    await waitForDB(page);
    await page.locator('div.rounded-xl', { hasText: 'Cash' }).first().getByRole('link', { name: 'Transactions →' }).click();
    await expect(page).toHaveURL(/\/transactions\?account=/);
    await expect(page.getByText('Cash balance today ₹1,050.00')).toBeVisible();
    // ₹1,000 − ₹200 on the 8th; − ₹50 + ₹300 on the 9th.
    await expect(page.getByText('−₹200.00 · balance ₹800.00')).toBeVisible();
    await expect(page.getByText('+₹250.00 · balance ₹1,050.00')).toBeVisible();
    // What a statement totals: every entry, money out and in.
    await expect(page.getByText('3 entries · ₹250.00 out · ₹300.00 in')).toBeVisible();

    // Narrowed further, it's no longer every entry, so no balances.
    await page.getByLabel('Type').selectOption('expense');
    await expect(page.getByText(/balance ₹/)).toHaveCount(0);
    await page.getByLabel('Type').selectOption('');

    // Off to add something and back: still Cash.
    await page.getByRole('button', { name: 'Add' }).first().click();
    await expect(page).toHaveURL(/\/add/);
    await page.goBack();
    await expect(page.getByText('Cash balance today ₹1,050.00')).toBeVisible();
  });
});

test.describe('Back button', () => {
  test('goes to the Dashboard from any page, then leaves the app', async ({ page }) => {
    await resetAndLoad(page, '/dashboard');
    const nav = (name: string) => page.locator('nav').getByRole('link', { name, exact: true }).first();
    const before = await page.evaluate(() => history.length);
    await nav('Transactions').click();
    await expect(page).toHaveURL(/\/transactions$/);
    await nav('Accounts').click();
    await expect(page).toHaveURL(/\/accounts$/);
    await nav('Reports').click();
    await expect(page).toHaveURL(/\/reports$/);
    // One page on top of the Dashboard, however many were visited.
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);

    // The Dashboard link from a page goes back to it rather than adding another.
    await nav('Accounts').click();
    await nav('Dashboard').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await nav('Accounts').click();
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
  });
});
