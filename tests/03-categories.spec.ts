import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

test.describe('Categories', () => {
  test.beforeEach(async ({ page }) => {
    await resetAndLoad(page, '/categories');
    await waitForDB(page);
  });

  test('displays seeded expense and income categories', async ({ page }) => {
    await expect(page.getByText('Food & Dining', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Transport', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Salary', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Refunds', { exact: true }).first()).toBeVisible();
  });

  test('create a new expense category', async ({ page }) => {
    await page.getByRole('button', { name: '+ Expense' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Pet Care');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('Pet Care')).toBeVisible();
  });

  test('create a new income category', async ({ page }) => {
    await page.getByRole('button', { name: '+ Income' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Freelance');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('Freelance')).toBeVisible();
  });

  test('add a subcategory', async ({ page }) => {
    await page.locator('button:has-text("+ sub")').first().click();
    await page.getByLabel('Name', { exact: true }).fill('Coffee');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('Coffee')).toBeVisible();
  });
});
