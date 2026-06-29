import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

async function addExpense(page: import('@playwright/test').Page, amount: string, category: RegExp) {
  for (const ch of amount) {
    await page.getByRole('button', { name: ch, exact: true }).click();
  }
  await page.getByRole('button', { name: category }).click();
  await page.waitForTimeout(500);
}

test.describe('Transactions', () => {
  test.beforeEach(async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);

    await addExpense(page, '500', /Food & Dining/);
    await addExpense(page, '200', /Transport/);

    await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
    await page.waitForTimeout(500);
  });

  test('shows transactions grouped by date', async ({ page }) => {
    await expect(page.locator('main li').getByText('Food & Dining').first()).toBeVisible();
    await expect(page.locator('main li').getByText('Transport').first()).toBeVisible();
  });

  test('edit a transaction amount', async ({ page }) => {
    await page.locator('main li').getByText('Food & Dining').first().click();
    await expect(page.getByRole('heading', { name: 'Edit transaction' })).toBeVisible();

    await page.getByLabel('Amount', { exact: true }).fill('600');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(500);

    await expect(page.locator('main').getByText('600.00').first()).toBeVisible();
  });

  test('delete a transaction', async ({ page }) => {
    await page.locator('main li').getByText('Transport').first().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(500);

    const count = await page.locator('main li').getByText('Transport').count();
    expect(count).toBe(0);
  });

  test('searches by amount', async ({ page }) => {
    await page.getByLabel('Search').fill('500');
    await page.waitForTimeout(500);

    await expect(page.locator('main li').getByText('Food & Dining').first()).toBeVisible();
    expect(await page.locator('main li').getByText('Transport').count()).toBe(0);
  });

  test('searches text with typo tolerance', async ({ page }) => {
    // "transprot" is a transposed misspelling of the "Transport" category.
    await page.getByLabel('Search').fill('transprot');
    await page.waitForTimeout(500);

    await expect(page.locator('main li').getByText('Transport').first()).toBeVisible();
    expect(await page.locator('main li').getByText('Food & Dining').count()).toBe(0);
  });
});
