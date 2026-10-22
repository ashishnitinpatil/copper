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

    // One row for both sides, saying where the money went.
    await expect(page.locator('main li').getByText('Transfer', { exact: true })).toHaveCount(1);
    await expect(page.locator('main li').getByText('Bank → Cash')).toBeVisible();
    await expect(page.locator('main li').getByText('−₹2,000.00')).toHaveCount(0);

    // One account's view shows its own side, signed.
    await selectCombobox(page, 'Account', 'Cash');
    await expect(page.locator('main li').getByText('+₹2,000.00')).toBeVisible();

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
    await expect(page.locator('main li').getByText('₹1,500.00')).toBeVisible();

    await page.getByRole('link', { name: 'Accounts', exact: true }).first().click();
    await page.waitForTimeout(500);
    await expect(page.getByText('₹8,500.00').first()).toBeVisible();
    await expect(page.getByText('₹1,500.00').first()).toBeVisible();
  });

  test('a deleted transfer comes back whole from Activity', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);
    await addAccount(page, 'Bank', '10000');
    await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
    await page.getByRole('button', { name: '↔ Transfer' }).click();
    await selectCombobox(page.locator('.fixed'), 'From', 'Bank');
    await selectCombobox(page.locator('.fixed'), 'To', 'Cash');
    await page.locator('.fixed').getByLabel('Amount', { exact: true }).fill('2000');
    await page.getByRole('button', { name: 'Transfer', exact: true }).click();
    await page.locator('main li').getByText('Bank → Cash').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('main li').getByText('Bank → Cash')).toHaveCount(0);

    await page.getByRole('link', { name: 'Activity', exact: true }).first().click();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByText(/restored the transfer of ₹2,000\.00 from Bank to Cash/)).toBeVisible();

    await page.getByRole('link', { name: 'Accounts', exact: true }).first().click();
    await expect(page.getByText('₹8,000.00').first()).toBeVisible();
    await expect(page.getByText('₹2,000.00').first()).toBeVisible();
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
    // With no transfer between these currencies yet, the estimate uses the
    // built-in rate (1 USD ≈ 88 INR) and says so; the person enters what arrived.
    await expect(page.locator('.fixed').getByLabel('Amount received (USD)', { exact: true })).toHaveValue('11.36');
    await expect(page.locator('.fixed').getByText(/approximate built-in rate/)).toBeVisible();
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

  test('the Add screen moves money from one account to another', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);
    await addAccount(page, 'Bank', '10000');

    await page.getByRole('link', { name: 'Add entry', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Transfer' }).click();
    // From defaults to the main account (Cash), To to the other one (Bank).
    await expect(page.getByLabel('From account')).toContainText('Cash');
    await expect(page.getByLabel('To account')).toContainText('Bank');
    await page.keyboard.type('500');
    await page.getByRole('button', { name: /^Transfer .500\.00$/ }).click();
    await expect(page.getByText(/500\.00 to Bank/)).toBeVisible();

    await page.getByRole('link', { name: 'Accounts', exact: true }).first().click();
    await page.waitForTimeout(500);
    await expect(page.getByText('₹10,500.00').first()).toBeVisible();
    await expect(page.getByText(/[-−]₹500\.00/).first()).toBeVisible();
  });

  test('the Add screen asks what arrived when the currencies differ', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);
    await addAccount(page, 'Dollar card', '0', 'USD');

    await page.getByRole('link', { name: 'Add entry', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Transfer' }).click();
    await page.keyboard.type('250');
    await expect(page.getByLabel('To account')).toContainText('Dollar card');
    await page.getByLabel('Amount received in Dollar card (USD)').fill('3');
    await page.getByRole('button', { name: /^Transfer .250\.00$/ }).click();
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
