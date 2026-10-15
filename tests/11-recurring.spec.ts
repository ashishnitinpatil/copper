import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB, selectCombobox } from './helpers';

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
