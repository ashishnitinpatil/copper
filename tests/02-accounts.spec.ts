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

  test('a card with a limit shows what is owed and what is left', async ({ page }) => {
    await page.getByRole('button', { name: '+ New account' }).click();
    await page.getByLabel('Name').fill('HDFC Regalia');
    await page.getByLabel('Type').selectOption('credit_card');
    await page.getByRole('textbox', { name: 'Starting balance' }).fill('-5000');
    await page.getByLabel('Credit limit').fill('20000');
    await page.getByRole('button', { name: 'Create' }).click();

    const card = page.getByRole('button', { name: /HDFC Regalia/ });
    await expect(card.getByText('Outstanding')).toBeVisible();
    await expect(card.getByText('₹5,000.00')).toBeVisible();
    await expect(card.getByText('Available')).toBeVisible();
    await expect(card.getByText('₹15,000.00')).toBeVisible();
    await expect(page.getByText('25% of limit used', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Why the colours' }).click();
    await expect(page.getByText(/under about 30% is commonly seen as healthy/)).toBeVisible();
    await page.keyboard.press('Escape');

    // Spent past the limit.
    await card.click();
    await page.getByRole('textbox', { name: 'Starting balance' }).fill('-21000');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByText('Over limit by')).toBeVisible();
    await expect(card.getByText('₹1,000.00')).toBeVisible();
    await expect(page.getByText('105% of limit used · high use can lower your credit score')).toBeVisible();
  });

  test('edit an existing account', async ({ page }) => {
    await page.getByRole('button', { name: /cash Cash Main/ }).click();
    await expect(page.getByRole('heading', { name: 'Edit account' })).toBeVisible();

    await page.getByLabel('Name').fill('Petty Cash');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Petty Cash')).toBeVisible();
  });

  test('filter out not-counted accounts and change the order', async ({ page }) => {
    await page.getByRole('button', { name: '+ New account' }).click();
    await page.getByLabel('Name').fill('Home loan');
    await page.getByLabel('Type').selectOption('loan');
    await page.getByLabel('Starting balance', { exact: true }).fill('-500000');
    await page.getByLabel('Include in total balance').uncheck();
    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByRole('button', { name: '+ New account' }).click();
    await page.getByLabel('Name').fill('Zeta Wallet');
    await page.getByLabel('Starting balance', { exact: true }).fill('100');
    await page.getByRole('button', { name: 'Create' }).click();

    const names = page.locator('main .grid > div > button .text-base');
    const loanCard = page.locator('main .grid > div > button', { hasText: 'Home loan' });
    await expect(loanCard.getByText('not counted')).toBeVisible();

    await page.getByRole('button', { name: 'Not counted', exact: true }).click();
    await expect(names).toHaveText(['Home loan']);
    await page.getByRole('button', { name: 'In total', exact: true }).click();
    await expect(loanCard).toHaveCount(0);
    await page.getByRole('button', { name: 'All', exact: true }).click();

    // Main stays first; the rest follow the chosen order.
    await page.getByLabel('Order by').selectOption('name');
    const byName = await names.allTextContents();
    expect(byName[0]).toBe('Cash');
    expect(byName.slice(1)).toEqual([...byName.slice(1)].sort((x, y) => x.localeCompare(y)));
    await page.getByLabel('Order by').selectOption('balance');
    await expect(names.last()).toHaveText('Home loan');

    // The order is remembered.
    await page.reload();
    await waitForDB(page);
    await expect(page.getByLabel('Order by')).toHaveValue('balance');
  });

  test('archive an account', async ({ page }) => {
    await page.getByRole('button', { name: '+ New account' }).click();
    await page.getByLabel('Name').fill('Old Wallet');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Old Wallet')).toBeVisible();
    // The list can show the new account a moment before the form closes.
    await expect(page.getByRole('dialog')).toHaveCount(0);

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
