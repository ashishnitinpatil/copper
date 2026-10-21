import { test, expect, type Page } from '@playwright/test';
import { resetAndLoad, waitForDB, selectCombobox } from './helpers';

async function addAccount(page: Page, name: string, currency: string) {
  await page.getByRole('button', { name: '+ New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type', { exact: true }).selectOption('bank');
  await selectCombobox(page.locator('.fixed'), 'Currency', currency);
  await page.getByLabel('Starting balance', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(500);
}

test('converted totals use the rate from your own transfer and say so', async ({ page }) => {
  await resetAndLoad(page, '/accounts');
  await waitForDB(page);
  await addAccount(page, 'Dollar card', 'USD');

  // ₹1,000 sent, $12 arrived: 1 USD = 83.33 INR is the rate this person got.
  await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
  await page.getByRole('button', { name: '↔ Transfer', exact: true }).click();
  const modal = page.locator('.fixed');
  await selectCombobox(modal, 'From', 'Cash');
  await selectCombobox(modal, 'To', 'Dollar card');
  await modal.getByLabel('Amount sent (INR)', { exact: true }).fill('1000');
  await modal.getByLabel('Amount received (USD)', { exact: true }).fill('12');
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  await page.waitForTimeout(500);

  // The next transfer's estimate now uses that rate.
  await page.getByRole('button', { name: '↔ Transfer', exact: true }).click();
  await selectCombobox(modal, 'From', 'Cash');
  await selectCombobox(modal, 'To', 'Dollar card');
  await modal.getByLabel('Amount sent (INR)', { exact: true }).fill('500');
  await expect(modal.getByLabel('Amount received (USD)', { exact: true })).toHaveValue('6');
  await expect(modal.getByText(/Estimated using your transfer on/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Spend $5 on the dollar card and ₹100 in cash, both on Food & Dining.
  await page.getByRole('link', { name: 'Add entry', exact: true }).first().click();
  await waitForDB(page);
  await page.keyboard.type('100');
  await page.getByRole('button', { name: /Food & Dining/ }).click();
  await page.waitForTimeout(500);
  await selectCombobox(page.locator('main'), 'Paid from account', 'Dollar card');
  await page.keyboard.type('5');
  await page.getByRole('button', { name: /Food & Dining/ }).click();
  await page.waitForTimeout(500);

  // Reports adds them up in rupees (₹100 + $5 × 83.33 = ₹516.67), marked ≈.
  await page.getByRole('link', { name: 'Reports', exact: true }).first().click();
  await waitForDB(page);
  await expect(page.getByText('₹516.67').first()).toBeVisible();
  const mark = page.getByRole('button', { name: 'How this was converted' }).first();
  await expect(mark).toHaveText('≈');
  await mark.focus();
  await expect(page.getByText('1 USD ≈ 83.33 INR')).toBeVisible();
  await expect(page.getByText(/your transfer on .*₹1,000\.00 → \$12\.00/)).toBeVisible();
});

test('a single-currency book never shows a conversion mark', async ({ page }) => {
  await resetAndLoad(page, '/add');
  await waitForDB(page);
  await page.keyboard.type('100');
  await page.getByRole('button', { name: /Food & Dining/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole('link', { name: 'Reports', exact: true }).first().click();
  await waitForDB(page);
  await expect(page.getByText('₹100.00').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'How this was converted' })).toHaveCount(0);
});
