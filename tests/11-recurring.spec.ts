import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB, selectCombobox, pickDate } from './helpers';

// Creates a recurring entry from Transactions › Recurring. The category/account pickers
// are custom Comboboxes; the search input is portalled to <body>, so selectCombobox
// finds it page-level.
async function createRule(page: import('@playwright/test').Page, opts: { category: string; amount: string }) {
  await page.getByRole('button', { name: '+ New recurring entry' }).click();
  await expect(page.getByRole('heading', { name: 'New recurring entry' })).toBeVisible();

  const modal = page.locator('.fixed');
  await selectCombobox(modal, 'Paid from', 'Cash');
  await selectCombobox(modal, 'Category', opts.category);
  await modal.getByLabel('Amount').fill(opts.amount);
  // Frequency defaults to Monthly; start date defaults to today.
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New recurring entry' })).not.toBeVisible();
}

test.describe('Recurring rules', () => {
  test.beforeEach(async ({ page }) => {
    await resetAndLoad(page, '/transactions?view=recurring');
    await waitForDB(page);
  });

  test('create a recurring rule and see it listed', async ({ page }) => {
    await createRule(page, { category: 'Groceries', amount: '500' });

    // The row shows the category, how often, the account and the amount.
    const row = page.locator('main li').filter({ hasText: 'Groceries' }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('₹500.00');
    await expect(row).toContainText('Monthly');
    await expect(row).toContainText('Cash');
  });

  test('a rule starting today adds today’s transaction right away', async ({ page }) => {
    await createRule(page, { category: 'Groceries', amount: '500' });
    await page.getByRole('tab', { name: 'All transactions' }).click();
    await page.waitForTimeout(500);

    // The rule starts today, so exactly one occurrence (today) is materialized.
    const row = page.locator('main li', { hasText: 'Groceries' }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('₹500.00')).toBeVisible();
  });
});

test.describe('Recurring rules over time', () => {
  test('a rule on the 31st lands on shorter months’ last day, and a deleted entry stays deleted', async ({ page }) => {
    // setFixedTime only fixes Date; timers keep running, so the app works normally.
    await page.clock.setFixedTime(new Date('2026-08-31T09:00:00'));
    await resetAndLoad(page, '/transactions?view=recurring');
    await waitForDB(page);
    await createRule(page, { category: 'Groceries', amount: '500' });

    const entries = page.locator('main li', { hasText: 'Groceries' });
    const openAll = async (date: string) => {
      await page.clock.setFixedTime(new Date(`${date}T09:00:00`));
      await page.reload();
      await waitForDB(page);
      await page.getByRole('tab', { name: 'All transactions' }).click();
    };

    const day = (name: string) => page.locator('main').getByRole('heading', { name, exact: true });

    // September has no 31st: the entry falls on the 30th ("Yesterday") instead of being skipped.
    await openAll('2026-10-01');
    await expect(entries).toHaveCount(2);
    await expect(day('Yesterday')).toBeVisible();
    await expect(day('Aug 31, 2026')).toBeVisible();

    // Delete September's; next month must not bring it back.
    await entries.first().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(entries).toHaveCount(1);

    await openAll('2026-11-15');
    await expect(day('Oct 31, 2026')).toBeVisible();
    await expect(day('Aug 31, 2026')).toBeVisible();
    await expect(day('Sep 30, 2026')).toHaveCount(0);
    await expect(entries).toHaveCount(2);
  });

  test('moving a rule’s date back adds the dates it now covers', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-31T09:00:00'));
    await resetAndLoad(page, '/transactions?view=recurring');
    await waitForDB(page);
    await createRule(page, { category: 'Groceries', amount: '500' });

    // Ran today (Aug 31); now say it really started on Aug 1.
    await page.locator('main li', { hasText: 'Groceries' }).first().click();
    const modal = page.locator('.fixed');
    await pickDate(modal.getByRole('button', { name: /^Date:/ }), '2026-08-01');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await page.getByRole('tab', { name: 'All transactions' }).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Aug 1, 2026', exact: true })).toBeVisible();
    await expect(page.locator('main li', { hasText: 'Groceries' })).toHaveCount(2);
  });
});
