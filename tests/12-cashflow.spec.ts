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
    await page.getByRole('button', { name: '+ New recurring entry' }).click();
    const modal = page.locator('.fixed');
    await selectCombobox(modal, 'Account', 'Cash');
    await selectCombobox(modal, 'Category', 'Groceries');
    await modal.getByLabel('Amount').fill('1200');
    // Weekly (not the default Monthly) so an occurrence always lands inside the
    // 30-day forecast window — a monthly rule's first future occurrence can be 31
    // days out (date-dependent), which would leave the forecast empty.
    await modal.getByLabel('Frequency').selectOption({ label: 'Weekly' });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New recurring entry' })).not.toBeVisible();

    await page.getByRole('link', { name: 'Cashflow', exact: true }).first().click();
    await waitForDB(page);

    // With a recurring outflow, the forecast renders the estimated-balance card
    // (not the "Nothing to show yet" empty state).
    await expect(page.getByText('Estimated balance (next 30 days)')).toBeVisible();
    await expect(page.getByText('Nothing to show yet')).toHaveCount(0);
  });

  test('forecast leaves out accounts not counted in the total', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);

    // A loan you owe, kept out of the total — it must not drag the forecast down.
    await page.getByRole('button', { name: '+ New account' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Loan from Dad');
    await page.getByLabel('Type', { exact: true }).selectOption('loan');
    await page.getByLabel('Starting balance', { exact: true }).fill('-5000');
    await page.getByLabel('Include in total balance').setChecked(false);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    // The forecast needs one future event to render.
    await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
    await waitForDB(page);
    await page.getByRole('button', { name: '+ New recurring entry' }).click();
    const modal = page.locator('.fixed');
    await selectCombobox(modal, 'Account', 'Cash');
    await selectCombobox(modal, 'Category', 'Groceries');
    await modal.getByLabel('Amount').fill('1200');
    await modal.getByLabel('Frequency').selectOption({ label: 'Weekly' });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New recurring entry' })).not.toBeVisible();

    await page.getByRole('link', { name: 'Cashflow', exact: true }).first().click();
    await waitForDB(page);
    const today = page.locator('main div.flex.items-center.justify-between', { hasText: 'Today' }).last();
    await expect(today).toContainText('₹0.00');
    // Cash starts at zero, so the first payment is what tips it negative.
    await expect(page.getByText(/Balance goes negative on/)).toBeVisible();
  });
});
