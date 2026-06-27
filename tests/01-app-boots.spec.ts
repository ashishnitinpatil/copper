import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

test.describe('App bootstrap', () => {
  test('loads dashboard without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await resetAndLoad(page, '/dashboard');
    await waitForDB(page);

    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    const critical = errors.filter((e) => !e.includes('favicon'));
    expect(critical).toEqual([]);
  });

  test('seeds default Cash account', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);

    await expect(page.getByText('Cash', { exact: true }).first()).toBeVisible();
  });

  test('seeds 16 default categories', async ({ page }) => {
    await resetAndLoad(page, '/categories');
    await waitForDB(page);

    await expect(page.getByText('13 categories', { exact: true })).toBeVisible();
    await expect(page.getByText('3 categories', { exact: true })).toBeVisible();
    await expect(page.getByText('Food & Dining', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Salary', { exact: true }).first()).toBeVisible();
  });

  test('navigation links work', async ({ page }) => {
    await resetAndLoad(page, '/dashboard');
    await waitForDB(page);

    for (const label of ['Transactions', 'Accounts', 'Budgets', 'Reports', 'SQL', 'Settings']) {
      await page.getByRole('link', { name: label, exact: true }).first().click();
      await page.waitForTimeout(200);
      await expect(page.locator('h1').first()).toBeVisible();
    }
  });
});
