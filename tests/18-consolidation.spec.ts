import { test, expect, type Page } from '@playwright/test';
import { resetAndLoad, waitForDB, navigateTo, selectCombobox } from './helpers';

async function addExpense(page: Page, amount: string, category: RegExp) {
  for (const ch of amount) {
    await page.getByRole('button', { name: ch, exact: true }).click();
  }
  await page.getByRole('button', { name: category }).click();
  await page.waitForTimeout(500);
}

test.describe('Consolidation — merge', () => {
  test('merging a category moves its transactions and deletes it', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);
    await addExpense(page, '500', /Food & Dining/);
    await addExpense(page, '200', /Transport/);

    await navigateTo(page, 'Categories');
    await page.getByRole('button', { name: 'Transport' }).first().click();
    await expect(page.getByRole('heading', { name: 'Edit category' })).toBeVisible();

    await page.getByText('Merge into another category').click();
    await selectCombobox(page, 'Move everything into', 'Food & Dining');
    await page.getByRole('button', { name: /Merge & delete/ }).click();
    await page.getByRole('button', { name: 'Yes, merge & delete' }).click();
    await page.waitForTimeout(500);

    // Transport is gone, and both transactions now sit under Food & Dining.
    await expect(page.getByRole('button', { name: 'Transport' })).toHaveCount(0);

    await navigateTo(page, 'Transactions');
    await expect(page.locator('main li').getByText('Transport')).toHaveCount(0);
    await expect(page.locator('main li').getByText('Food & Dining')).toHaveCount(2);

    // The merge is recorded as one batched change-log group.
    await navigateTo(page, 'SQL');
    await page
      .locator('textarea')
      .fill("SELECT COUNT(*) AS n FROM change_log WHERE source = 'category-merge'");
    await page.getByRole('button', { name: /Run/ }).click();
    await page.waitForTimeout(500);
    expect(Number(await page.locator('td').first().innerText())).toBeGreaterThanOrEqual(2);
  });

  test('merging an account moves its transactions and preserves the combined balance', async ({
    page,
  }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);
    // Cash (the seeded main account) ends at -500 after this expense.
    await addExpense(page, '500', /Food & Dining/);

    // Savings opens at 1000, so the merged account should net to 500.
    await navigateTo(page, 'Accounts');
    await page.getByRole('button', { name: '+ New account' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill('Savings');
    await page.getByLabel('Starting balance', { exact: true }).fill('1000');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Merge the seeded Cash account into Savings.
    await page.getByRole('button', { name: /Cash/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Edit account' })).toBeVisible();
    await page.getByText('Merge into another account').click();
    await selectCombobox(page, 'Move everything into', 'Savings');
    await page.getByRole('button', { name: /Merge & delete/ }).click();
    await page.getByRole('button', { name: 'Yes, merge & delete' }).click();
    await page.waitForTimeout(500);

    // Cash is gone and Savings holds the combined balance (1000 − 500 = 500).
    await expect(page.getByRole('button', { name: /Cash/ })).toHaveCount(0);
    await expect(page.locator('main').getByText(/500\.00/).first()).toBeVisible();

    // The moved expense now belongs to Savings.
    await navigateTo(page, 'Transactions');
    await expect(page.locator('main li').getByText('Savings').first()).toBeVisible();
  });
});
