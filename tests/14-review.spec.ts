import { test, expect, type Page } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

async function addExpense(page: Page, digits: string, category: RegExp) {
  await page.goto('/add');
  await waitForDB(page);
  for (const d of digits) {
    await page.getByRole('button', { name: d, exact: true }).click();
  }
  await page.getByRole('button', { name: category }).click();
  await page.waitForTimeout(800);
}

test.describe('Review queue', () => {
  test('flags a duplicate and lets you resolve it', async ({ page }) => {
    await resetAndLoad(page, '/dashboard');
    await waitForDB(page);

    // Two identical expenses (same account, amount, date) trip the duplicate scanner.
    await addExpense(page, '300', /Groceries/);
    await addExpense(page, '300', /Groceries/);

    await page.goto('/review');
    await waitForDB(page);
    // "Run check" is in both the header and the empty state; use the header's.
    await page.locator('header').getByRole('button', { name: 'Run check' }).click();

    await expect(page.getByText('Possible duplicate')).toBeVisible();
    await expect(page.getByText(/item.* to review/)).toBeVisible();

    // Resolve it; the queue empties to the "All clear" state.
    await page.getByRole('button', { name: 'Dismiss' }).first().click();
    await expect(page.getByText('All clear')).toBeVisible();
  });
});
