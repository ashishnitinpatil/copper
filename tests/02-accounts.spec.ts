import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB, selectCombobox } from './helpers';

test.describe('Accounts CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);
  });

  test('create a new bank account', async ({ page }) => {
    await page.getByRole('button', { name: '+ New account' }).click();
    await expect(page.getByRole('heading', { name: 'New account' })).toBeVisible();

    await page.getByLabel('Name').fill('HDFC Savings');
    await page.getByLabel('Type').selectOption('bank');
    // Currency is a searchable Combobox (not a native <select>).
    await selectCombobox(page, 'Currency', 'INR');
    await page.getByLabel('Starting balance', { exact: true }).fill('50000');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('HDFC Savings')).toBeVisible();
    await expect(page.getByText('₹50,000.00')).toBeVisible();
  });

  test('create a credit card account with statement/due day', async ({ page }) => {
    await page.getByRole('button', { name: '+ New account' }).click();
    await page.getByLabel('Name').fill('ICICI Amazon Pay');
    await page.getByLabel('Type').selectOption('credit_card');

    await expect(page.getByText('Billing cycle')).toBeVisible();
    await page.getByLabel('Statement day').fill('15');
    await page.getByLabel('Payment due day').fill('5');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('ICICI Amazon Pay')).toBeVisible();
    await expect(page.getByText(/Payment due day 5/)).toBeVisible();
  });

  test('edit an existing account', async ({ page }) => {
    await page.getByRole('button', { name: /cash Cash Main/ }).click();
    await expect(page.getByRole('heading', { name: 'Edit account' })).toBeVisible();

    await page.getByLabel('Name').fill('Petty Cash');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Petty Cash')).toBeVisible();
  });

  test('archive an account', async ({ page }) => {
    await page.getByRole('button', { name: '+ New account' }).click();
    await page.getByLabel('Name').fill('Old Wallet');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Old Wallet')).toBeVisible();

    await page.getByText('Old Wallet').click();
    await page.getByRole('button', { name: 'Archive' }).click();

    await expect(page.getByText('Archived')).toBeVisible();
    await expect(page.getByText('Old Wallet')).toBeVisible();
  });

  test('setting an account as main demotes others', async ({ page }) => {
    await page.getByRole('button', { name: '+ New account' }).click();
    await page.getByLabel('Name').fill('Primary Bank');
    await page.getByLabel('Type').selectOption('bank');
    await page.getByLabel(/Main account/).check();
    await page.getByRole('button', { name: 'Create' }).click();

    const mainBadges = page.locator('text=Main');
    await expect(mainBadges).toHaveCount(1);
  });
});
