import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB, selectCombobox } from './helpers';

async function addExpense(page: import('@playwright/test').Page, amount: string, category: RegExp) {
  for (const ch of amount) {
    await page.getByRole('button', { name: ch, exact: true }).click();
  }
  await page.getByRole('button', { name: category }).click();
  await page.waitForTimeout(500);
}

test.describe('Budgets', () => {
  test('create a budget and see progress bar', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);

    await addExpense(page, '500', /Food & Dining/);

    await page.getByRole('link', { name: 'Budgets', exact: true }).first().click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: '+ New budget' }).first().click();
    await selectCombobox(page, 'Category', '🍽️ Food & Dining');
    await page.getByLabel('Monthly cap').fill('2000');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('Food & Dining').first()).toBeVisible();
    await expect(page.getByText('₹500.00').first()).toBeVisible();
  });

  test('over-budget shows warning', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);

    await addExpense(page, '3000', /Shopping/);

    await page.getByRole('link', { name: 'Budgets', exact: true }).first().click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: '+ New budget' }).first().click();
    await selectCombobox(page, 'Category', '🛍️ Shopping');
    await page.getByLabel('Monthly cap').fill('1000');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText(/Over by/).first()).toBeVisible();
  });
});
