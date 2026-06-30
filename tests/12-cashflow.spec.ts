import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB, selectCombobox } from './helpers';

test.describe('Cashflow', () => {
  test('mode toggle and horizon controls work', async ({ page }) => {
    await resetAndLoad(page, '/cashflow');
    await waitForDB(page);

    // Forecast is the default mode.
    await expect(page.getByRole('button', { name: 'Forecast', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '30 days' })).toBeVisible();

    // Horizon buttons switch the forecast window.
    await page.getByRole('button', { name: '60 days' }).click();
    await page.getByRole('button', { name: '90 days' }).click();

    // Switch to Trend mode — its own window controls (3/6/12 mo) appear.
    await page.getByRole('button', { name: 'Trend', exact: true }).click();
    await expect(page.getByRole('button', { name: '6 mo' })).toBeVisible();
    await page.getByRole('button', { name: '12 mo' }).click();
  });

  test('a recurring rule produces a forecast projection', async ({ page }) => {
    await resetAndLoad(page, '/settings');
    await waitForDB(page);

    // A forecast needs at least one future cash event; create a monthly rule.
    await page.getByRole('button', { name: '+ New rule' }).click();
    const modal = page.locator('.fixed');
    await selectCombobox(modal, 'Account', 'Cash');
    await selectCombobox(modal, 'Category', 'Groceries');
    await modal.getByLabel('Amount').fill('1200');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New recurring rule' })).not.toBeVisible();

    await page.getByRole('link', { name: 'Cashflow', exact: true }).first().click();
    await waitForDB(page);

    // With a recurring outflow, the forecast renders the estimated-balance card
    // (not the "Nothing to show yet" empty state).
    await expect(page.getByText('Estimated balance (next 30 days)')).toBeVisible();
    await expect(page.getByText('Nothing to show yet')).toHaveCount(0);
  });
});
