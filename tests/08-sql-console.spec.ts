import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

test.describe('SQL Console', () => {
  test.beforeEach(async ({ page }) => {
    await resetAndLoad(page, '/sql');
    await waitForDB(page);
  });

  test('runs a SELECT query and shows results', async ({ page }) => {
    await page.locator('textarea').fill('SELECT name FROM accounts');
    await page.getByRole('button', { name: /Run/ }).click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Cash', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('1 row')).toBeVisible();
  });

  test('example query buttons fill textarea', async ({ page }) => {
    await page.getByRole('button', { name: 'All tables' }).click();
    const value = await page.locator('textarea').inputValue();
    expect(value).toContain('sqlite_master');
  });

  test('blocks non-SELECT queries', async ({ page }) => {
    await page.locator('textarea').fill('DROP TABLE accounts');
    await page.getByRole('button', { name: /Run/ }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText(/Only SELECT/)).toBeVisible();
  });

  test('a write hidden behind WITH changes nothing', async ({ page }) => {
    await page.locator('textarea').fill('WITH x AS (SELECT 1) DELETE FROM accounts');
    await page.getByRole('button', { name: /Run/ }).click();
    await expect(page.getByText('No rows returned.')).toBeVisible();

    await page.locator('textarea').fill('SELECT name FROM accounts');
    await page.getByRole('button', { name: /Run/ }).click();
    await expect(page.getByText('1 row')).toBeVisible();
  });

  test('shows all seeded tables', async ({ page }) => {
    await page.getByRole('button', { name: 'All tables' }).click();
    await page.getByRole('button', { name: /Run/ }).click();
    await page.waitForTimeout(500);

    for (const table of ['accounts', 'categories', 'transactions', 'budgets']) {
      await expect(page.locator('td').getByText(table, { exact: true }).first()).toBeVisible();
    }
  });
});
