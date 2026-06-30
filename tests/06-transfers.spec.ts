import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB, selectCombobox } from './helpers';

test.describe('Transfers', () => {
  test('create a transfer between two accounts', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);

    await page.getByRole('button', { name: '+ New account' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Bank');
    await page.getByLabel('Type', { exact: true }).selectOption('bank');
    await page.getByLabel('Starting balance', { exact: true }).fill('10000');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(500);

    await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: '↔ Transfer' }).click();
    await expect(page.getByRole('heading', { name: 'New transfer' })).toBeVisible();

    await selectCombobox(page.locator('.fixed'), 'From', 'Bank');
    await selectCombobox(page.locator('.fixed'), 'To', 'Cash');
    await page.locator('.fixed').getByLabel('Amount', { exact: true }).fill('2000');
    await page.getByRole('button', { name: 'Transfer', exact: true }).click();
    await page.waitForTimeout(500);

    await expect(page.locator('main li').getByText('Transfer').first()).toBeVisible();

    await page.getByRole('link', { name: 'Accounts', exact: true }).first().click();
    await page.waitForTimeout(500);
    await expect(page.getByText('₹8,000.00').first()).toBeVisible();
    await expect(page.getByText('₹2,000.00').first()).toBeVisible();
  });
});
