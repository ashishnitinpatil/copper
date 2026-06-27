import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

test.describe('Dashboard', () => {
  test('shows account balances on fresh install', async ({ page }) => {
    await resetAndLoad(page, '/dashboard');
    await waitForDB(page);

    await expect(page.locator('main').getByText('Cash', { exact: true }).first()).toBeVisible();
    await expect(page.locator('main').getByText('₹0.00').first()).toBeVisible();
  });

  test('shows recent transactions after adding entries', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);

    for (const ch of '150') {
      await page.getByRole('button', { name: ch, exact: true }).click();
    }
    await page.getByRole('button', { name: /Groceries/ }).click();
    await page.waitForTimeout(500);

    await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Groceries').first()).toBeVisible();
    await expect(page.getByText('Recent transactions')).toBeVisible();
  });

  test('account balance updates after expense', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);

    for (const ch of '1000') {
      await page.getByRole('button', { name: ch, exact: true }).click();
    }
    await page.getByRole('button', { name: /Rent/ }).click();
    await page.waitForTimeout(500);

    await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
    await page.waitForTimeout(500);

    await expect(page.locator('main').getByText('−₹1,000.00').first()).toBeVisible();
  });
});
