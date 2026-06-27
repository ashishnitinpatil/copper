import { test, expect, type Page } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

// Adds an expense through the quick-entry keypad: type each digit, then tap the
// category tile to commit.
async function addExpense(page: Page, digits: string, category: RegExp) {
  await page.goto('/add');
  await waitForDB(page);
  for (const d of digits) {
    await page.getByRole('button', { name: d, exact: true }).click();
  }
  await page.getByRole('button', { name: category }).click();
  await page.waitForTimeout(800);
}

test.describe('Tags', () => {
  test.beforeEach(async ({ page }) => {
    await resetAndLoad(page, '/tags');
    await waitForDB(page);
  });

  test('create a tag and see it listed', async ({ page }) => {
    // The empty state also has a "New tag" button; use the page header's.
    await page.locator('header').getByRole('button', { name: 'New tag' }).click();
    await expect(page.getByRole('heading', { name: 'New tag' })).toBeVisible();

    await page.getByLabel('Name').fill('Goa trip');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'New tag' })).not.toBeVisible();
    await expect(page.getByText('Goa trip')).toBeVisible();
  });

  test('assign a tag to a transaction via select mode', async ({ page }) => {
    // Need a transaction to tag.
    await addExpense(page, '750', /Groceries/);

    // Create the tag.
    await page.goto('/tags');
    await waitForDB(page);
    await page.locator('header').getByRole('button', { name: 'New tag' }).click();
    await page.getByLabel('Name').fill('Goa trip');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New tag' })).not.toBeVisible();

    // Tag the transaction in bulk-select mode.
    await page.goto('/transactions');
    await waitForDB(page);
    await page.getByRole('button', { name: 'Select' }).click();
    await page.locator('main li', { hasText: 'Groceries' }).first().click();
    await expect(page.getByText(/1 selected/)).toBeVisible();
    // The floating toolbar shows a pill per tag; click ours to assign immediately.
    await page.getByRole('button', { name: /Goa trip/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Done' }).click();

    // The tag's detail/list now reflects the tagged spend.
    await page.goto('/tags');
    await waitForDB(page);
    await page.getByText('Goa trip').click();
    await expect(page.getByText('₹750.00').first()).toBeVisible();
  });
});
