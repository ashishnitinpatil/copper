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
    await page.getByRole('button', { name: 'Add expense category' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Pet Care');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('Pet Care')).toBeVisible();
  });

  test('create a new income category', async ({ page }) => {
    await page.getByRole('button', { name: 'Add income category' }).click();
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

  test('pick a line icon from the grid', async ({ page }) => {
    await page.getByRole('button', { name: 'Add expense category' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Pets');
    await page.getByRole('radio', { name: 'dog' }).first().click();
    await expect(page.getByRole('radio', { name: 'dog' }).first()).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Create' }).click();
    // Stored as the emoji, drawn as a simple line icon.
    await expect(page.locator('li', { hasText: 'Pets' }).locator('svg.lucide-dog').first()).toBeVisible();
  });

  test('icons are suggested from the name, and can be searched', async ({ page }) => {
    await page.getByRole('button', { name: 'Add expense category' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Petrol');
    await expect(page.getByText('Suggested for “Petrol”')).toBeVisible();
    await page.getByRole('radio', { name: 'fuel' }).first().click();

    await page.getByLabel('Search icons').fill('rent');
    await expect(page.getByRole('radio', { name: 'home' })).toBeVisible();
    await expect(page.getByText('Suggested for')).toHaveCount(0);
    await page.getByLabel('Search icons').fill('zzzz');
    await expect(page.getByText('No icon for “zzzz”. Try another word.')).toBeVisible();
    await page.getByLabel('Search icons').fill('');

    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.locator('li', { hasText: 'Petrol' }).locator('svg.lucide-fuel').first()).toBeVisible();
  });

  test('offers icons for categories that never got one', async ({ page }) => {
    await page.getByRole('button', { name: 'Add expense category' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Petrol');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('1 category has no icon of its own yet.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Suggest icons' }).click();
    await expect(page.getByRole('dialog').getByText('fuel')).toBeVisible();
    await page.getByRole('button', { name: 'Use 1 icon' }).click();

    await expect(page.locator('li', { hasText: 'Petrol' }).locator('svg.lucide-fuel').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Suggest icons' })).toHaveCount(0);
  });
});
