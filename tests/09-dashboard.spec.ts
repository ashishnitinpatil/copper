import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

test.describe('Dashboard', () => {
  test('shows account balances on fresh install', async ({ page }) => {
    await resetAndLoad(page, '/dashboard');
    await waitForDB(page);

    await expect(page.locator('main').getByText('Cash', { exact: true }).first()).toBeVisible();
    await expect(page.locator('main').getByText('₹0.00').first()).toBeVisible();
  });

  test('lists a few accounts and links to all of them', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);
    for (const name of ['Wallet 1', 'Wallet 2', 'Wallet 3', 'Wallet 4', 'Wallet 5', 'Wallet 6']) {
      await page.getByRole('button', { name: '+ New account' }).click();
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Create' }).click();
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }

    await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
    const card = page.getByRole('heading', { name: 'Accounts', exact: true }).locator('xpath=../..');
    await card.getByRole('link', { name: 'All 7 accounts →' }).click();
    await expect(page).toHaveURL(/\/accounts/);
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

  test('at a glance sums this month, splits by category and switches period', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);
    for (const [amount, category] of [['300', /Groceries/], ['100', /Transport/]] as const) {
      for (const ch of amount) await page.getByRole('button', { name: ch, exact: true }).click();
      await page.getByRole('button', { name: category }).first().click();
      await page.waitForTimeout(400);
    }

    await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
    const glance = page.getByText('At a glance').locator('xpath=../..');
    await expect(glance.getByText('₹400.00').first()).toBeVisible();
    await expect(glance.getByText('75%')).toBeVisible();
    await expect(glance.getByText('25%')).toBeVisible();
    await expect(glance.getByText(/Nothing spent this time last month/)).toBeVisible();

    await glance.getByRole('button', { name: 'Last month' }).click();
    await expect(glance.getByText('No spending in this period yet.')).toBeVisible();
    await glance.getByRole('button', { name: 'All time' }).click();
    await expect(glance.getByText(/a month on average/)).toBeVisible();
  });
});
