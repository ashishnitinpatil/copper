import { test, expect, type Page } from '@playwright/test';
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

  test('edit a transfer moves both sides', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);
    await addAccount(page, 'Bank', '10000');

    await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
    await page.getByRole('button', { name: '↔ Transfer' }).click();
    await selectCombobox(page.locator('.fixed'), 'From', 'Bank');
    await selectCombobox(page.locator('.fixed'), 'To', 'Cash');
    await page.locator('.fixed').getByLabel('Amount', { exact: true }).fill('2000');
    await page.getByRole('button', { name: 'Transfer', exact: true }).click();
    await page.waitForTimeout(500);

    await page.locator('main li').getByText('Transfer').first().click();
    await expect(page.getByRole('heading', { name: 'Edit transfer' })).toBeVisible();
    await expect(page.locator('.fixed').getByLabel('Amount', { exact: true })).toHaveValue('2000');
    await page.locator('.fixed').getByLabel('Amount', { exact: true }).fill('1500');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit transfer' })).toBeHidden();
    await expect(page.locator('main').getByText('+₹1,500.00')).toBeVisible();

    await page.getByRole('link', { name: 'Accounts', exact: true }).first().click();
    await page.waitForTimeout(500);
    await expect(page.getByText('₹8,500.00').first()).toBeVisible();
    await expect(page.getByText('₹1,500.00').first()).toBeVisible();
  });

  test('a transfer between currencies records the amount received', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);
    await addAccount(page, 'Dollar card', '0', 'USD');

    await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
    await page.getByRole('button', { name: '↔ Transfer' }).click();
    await selectCombobox(page.locator('.fixed'), 'From', 'Cash');
    await selectCombobox(page.locator('.fixed'), 'To', 'Dollar card');
    await page.locator('.fixed').getByLabel('Amount sent (INR)', { exact: true }).fill('1000');
    // No INR/USD rate is set, so nothing is guessed — the person enters it.
    await expect(page.locator('.fixed').getByLabel('Amount received (USD)', { exact: true })).toHaveValue('');
    await page.locator('.fixed').getByLabel('Amount received (USD)', { exact: true }).fill('12');
    await page.getByRole('button', { name: 'Transfer', exact: true }).click();
    await page.waitForTimeout(500);

    // Re-opening it shows both sides as saved — not a re-estimate.
    await page.locator('main li').getByText('Transfer').first().click();
    await expect(page.locator('.fixed').getByLabel('Amount sent (INR)', { exact: true })).toHaveValue('1000');
    await expect(page.locator('.fixed').getByLabel('Amount received (USD)', { exact: true })).toHaveValue('12');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('link', { name: 'Accounts', exact: true }).first().click();
    await page.waitForTimeout(500);
    await expect(page.getByText('$12.00').first()).toBeVisible();
    await expect(page.getByText(/[-−]₹1,000\.00/).first()).toBeVisible();
  });

  test('the Add screen saves a transfer by tapping the destination account', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);
    await addAccount(page, 'Bank', '10000');

    await page.getByRole('link', { name: 'Add', exact: true }).first().click();
    await page.getByRole('button', { name: 'Transfer', exact: true }).click();
    await page.keyboard.type('500');
    await page.locator('main').getByRole('button', { name: /Bank/ }).click();
    await expect(page.getByText(/↔ Bank/)).toBeVisible();

    await page.getByRole('link', { name: 'Accounts', exact: true }).first().click();
    await page.waitForTimeout(500);
    await expect(page.getByText('₹10,500.00').first()).toBeVisible();
    await expect(page.getByText(/[-−]₹500\.00/).first()).toBeVisible();
  });

  test('the Add screen asks what arrived when the currencies differ', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);
    await addAccount(page, 'Dollar card', '0', 'USD');

    await page.getByRole('link', { name: 'Add', exact: true }).first().click();
    await page.getByRole('button', { name: 'Transfer', exact: true }).click();
    await page.keyboard.type('250');
    await page.locator('main').getByRole('button', { name: /Dollar card/ }).click();

    const modal = page.locator('.fixed');
    await expect(page.getByRole('heading', { name: 'New transfer' })).toBeVisible();
    await expect(modal.getByLabel('Amount sent (INR)', { exact: true })).toHaveValue('250');
    await modal.getByLabel('Amount received (USD)', { exact: true }).fill('3');
    await page.getByRole('button', { name: 'Transfer', exact: true }).last().click();
    await page.waitForTimeout(500);

    await page.getByRole('link', { name: 'Accounts', exact: true }).first().click();
    await page.waitForTimeout(500);
    await expect(page.getByText('$3.00').first()).toBeVisible();
  });
});

async function addAccount(page: Page, name: string, balance: string, currency?: string) {
  await page.getByRole('button', { name: '+ New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type', { exact: true }).selectOption('bank');
  if (currency) await selectCombobox(page.locator('.fixed'), 'Currency', currency);
  await page.getByLabel('Starting balance', { exact: true }).fill(balance);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(500);
}
