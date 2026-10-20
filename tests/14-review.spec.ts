import { test, expect, type Page } from '@playwright/test';
import { resetAndLoad, waitForDB, navigateTo } from './helpers';

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
    await expect(page.getByText(/transaction.* to review/)).toBeVisible();

    // Resolve it; the queue empties to the "All clear" state.
    await page.getByRole('button', { name: 'Dismiss' }).first().click();
    await expect(page.getByText('All clear')).toBeVisible();
  });

  test('suggests and merges a duplicate category', async ({ page }) => {
    await resetAndLoad(page, '/');
    await waitForDB(page);

    // Create a second "Transport" category alongside the seeded one.
    await navigateTo(page, 'Categories');
    await page.getByRole('button', { name: 'Add expense category' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Transport');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // Review surfaces it as a duplicate suggestion (no scan needed — it's live).
    await navigateTo(page, 'Review');
    await expect(page.getByText('Possible duplicate categories')).toBeVisible();
    await expect(page.getByText(/2 entries named .Transport./)).toBeVisible();

    // Merge them through the two-step confirm; the suggestion clears.
    await page.getByRole('button', { name: /Merge into/ }).click();
    await page.getByRole('button', { name: 'Yes, merge' }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Possible duplicate categories')).toHaveCount(0);

    // Only one Transport category remains.
    await navigateTo(page, 'Categories');
    await expect(page.getByRole('button', { name: 'Transport' })).toHaveCount(1);
  });

  test('suggests a duplicate account', async ({ page }) => {
    await resetAndLoad(page, '/');
    await waitForDB(page);

    // Create a second "Cash" account alongside the one made at onboarding.
    await navigateTo(page, 'Accounts');
    await page.getByRole('button', { name: '+ New account' }).first().click();
    await page.getByLabel('Name', { exact: true }).fill('Cash');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    await navigateTo(page, 'Review');
    await expect(page.getByText('Possible duplicate accounts')).toBeVisible();
    await expect(page.getByText(/2 entries named .Cash./)).toBeVisible();

    // "Not duplicates" dismisses the suggestion for the session.
    await page.getByRole('button', { name: 'Not duplicates' }).click();
    await expect(page.getByText('Possible duplicate accounts')).toHaveCount(0);
  });
});
