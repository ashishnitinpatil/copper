import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resetAndLoad, waitForDB, pickDate } from './helpers';

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

    // No keyboard on a phone: the notice offers the way back.
    await expect(page.getByText('Deleted Transport ₹200.00')).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('main li').getByText('Transport').first()).toBeVisible();
  });

  test('searches by amount', async ({ page }) => {
    await page.getByLabel('Search', { exact: true }).fill('500');
    await page.waitForTimeout(500);

    await expect(page.locator('main li').getByText('Food & Dining').first()).toBeVisible();
    expect(await page.locator('main li').getByText('Transport').count()).toBe(0);
    // What the matches add up to.
    await expect(page.getByText('1 entry · ₹500.00 spent')).toBeVisible();
  });

  test('searches text with typo tolerance', async ({ page }) => {
    // "transprot" is a transposed misspelling of the "Transport" category.
    await page.getByLabel('Search', { exact: true }).fill('transprot');
    await page.waitForTimeout(500);

    await expect(page.locator('main li').getByText('Transport').first()).toBeVisible();
    expect(await page.locator('main li').getByText('Food & Dining').count()).toBe(0);
  });

  test('scheduled entries fold into Upcoming and stay out of Recent', async ({ page }) => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    const iso = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    await page.getByRole('link', { name: 'Add', exact: true }).first().click();
    await waitForDB(page);
    await pickDate(page.getByRole('button', { name: /^Date:/ }), iso);
    await addExpense(page, '300', /Transport/);

    await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
    await waitForDB(page);
    await expect(page.getByText(/1 scheduled · next/)).toBeVisible();
    // Folded: today's entries lead, the scheduled one is hidden until opened.
    await expect(page.locator('main').getByText('₹500.00').first()).toBeVisible();
    await expect(page.locator('main').getByText(/₹300\.00/).first()).toBeHidden();
    await page.getByText('Upcoming', { exact: true }).click();
    await expect(page.locator('main').getByText(/₹300\.00/).first()).toBeVisible();

    await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
    await waitForDB(page);
    await expect(page.locator('main').getByText('₹500.00').first()).toBeVisible();
    await expect(page.locator('main').getByText(/₹300\.00/)).toHaveCount(0);
  });
});

test.describe('Transactions paging', () => {
  test('shows 50 past entries, loads more, and scheduled ones never crowd them out', async ({ page }) => {
    await resetAndLoad(page, '/settings#data');
    await waitForDB(page);
    await page.getByRole('button', { name: 'Import Monefy CSV' }).click();
    await page
      .locator('input[type="file"][accept*="csv"]')
      .setInputFiles(fileURLToPath(new URL('./fixtures/monefy-paging.csv', import.meta.url)));
    await page
      .getByLabel('Import from Monefy')
      .getByRole('button', { name: 'Replace and import', exact: true })
      .click();
    await expect(page.getByText(/Imported .*transactions/)).toBeVisible({ timeout: 30000 });

    await page.goto('/transactions');
    await waitForDB(page);
    // All 60 scheduled entries are in Upcoming, yet the newest past ones still show.
    await expect(page.getByText(/60 scheduled/)).toBeVisible();
    await expect(page.getByText('Cash · Past 60', { exact: true })).toBeVisible();
    await expect(page.getByText('Cash · Past 11', { exact: true })).toBeVisible();
    await expect(page.getByText('Cash · Past 10', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Showing 50 of 60')).toBeVisible();

    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page.getByText('Cash · Past 1', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  });
});
