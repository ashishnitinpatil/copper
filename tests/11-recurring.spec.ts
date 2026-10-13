import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB, selectCombobox } from './helpers';

// Creates a recurring rule through the Settings UI. The category/account pickers
// are custom Comboboxes; the search input is portalled to <body>, so selectCombobox
// finds it page-level.
async function createRule(page: import('@playwright/test').Page, opts: { category: string; amount: string }) {
  await page.getByRole('button', { name: '+ New recurring entry' }).click();
  await expect(page.getByRole('heading', { name: 'New recurring entry' })).toBeVisible();

  const modal = page.locator('.fixed');
  await selectCombobox(modal, 'Account', 'Cash');
  await selectCombobox(modal, 'Category', opts.category);
  await modal.getByLabel('Amount').fill(opts.amount);
  // Frequency defaults to Monthly; start date defaults to today.
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New recurring entry' })).not.toBeVisible();
}

test.describe('Recurring rules', () => {
  test.beforeEach(async ({ page }) => {
    await resetAndLoad(page, '/settings');
    await waitForDB(page);
  });

  test('create a recurring rule and see it listed', async ({ page }) => {
    await createRule(page, { category: 'Groceries', amount: '500' });

    // The new rule row shows "<icon> Groceries · ₹500.00" then "Expense · Cash · next: …".
    const row = page.locator('main div').filter({ hasText: 'Groceries' }).filter({ hasText: 'Expense' }).last();
    await expect(row).toBeVisible();
    await expect(row).toContainText('₹500.00');
    await expect(row).toContainText('Cash');
  });

  test('a due rule materializes a transaction on next boot', async ({ page }) => {
    await createRule(page, { category: 'Groceries', amount: '500' });
    // Let the relaxed-durability write flush to IndexedDB before reloading, so the
    // reopened DB sees the rule and materializeDueRecurrences (runs at openDB) fires.
    await page.waitForTimeout(1500);
    await page.reload();
    await waitForDB(page);

    await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
    await page.waitForTimeout(500);

    // The rule starts today, so exactly one occurrence (today) is materialized.
    const row = page.locator('main li', { hasText: 'Groceries' }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('₹500.00')).toBeVisible();
  });
});
