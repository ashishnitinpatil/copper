import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

async function addExpense(page: import('@playwright/test').Page, amount: string, category: RegExp) {
  for (const ch of amount) {
    await page.getByRole('button', { name: ch, exact: true }).click();
  }
  await page.getByRole('button', { name: category }).click();
  await page.waitForTimeout(500);
}

test.describe('Reports', () => {
  test('shows category breakdown after adding expenses', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);

    await addExpense(page, '300', /Food & Dining/);
    await addExpense(page, '200', /Transport/);

    await page.getByRole('link', { name: 'Reports', exact: true }).first().click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Food & Dining').first()).toBeVisible();
    await expect(page.getByText('Transport').first()).toBeVisible();
    await expect(page.getByText(/Total:/).first()).toBeVisible();
  });

  test('monthly trend tab works', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);

    await addExpense(page, '100', /Other/);

    await page.getByRole('link', { name: 'Reports', exact: true }).first().click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'Monthly trend' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('Expenses').first()).toBeVisible();
    await expect(page.getByText('Income').first()).toBeVisible();
    await expect(page.getByText('Net').first()).toBeVisible();
  });
});
