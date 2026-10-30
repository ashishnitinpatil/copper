import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

test.describe('Quick Entry', () => {
  test.beforeEach(async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);
  });

  test('shows keypad buttons', async ({ page }) => {
    for (const d of ['0', '1', '5', '9']) {
      await expect(page.getByRole('button', { name: d, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: '⌫' })).toBeVisible();
  });

  test('tap keypad to enter amount', async ({ page }) => {
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('button', { name: '5', exact: true }).click();
    await page.getByRole('button', { name: '0', exact: true }).click();

    await expect(page.locator('main').getByText('₹250')).toBeVisible();
  });

  test('add an expense via category tap', async ({ page }) => {
    await page.getByRole('button', { name: '1', exact: true }).click();
    await page.getByRole('button', { name: '0', exact: true }).click();
    await page.getByRole('button', { name: '0', exact: true }).click();

    await page.getByRole('button', { name: /Food & Dining/ }).click();
    await page.waitForTimeout(800);

    await expect(page.locator('main').getByText('₹0')).toBeVisible();
  });

  test('add income entry', async ({ page }) => {
    await page.locator('main button', { hasText: 'Income' }).click();

    await page.getByRole('button', { name: '5', exact: true }).click();
    await page.getByRole('button', { name: '0', exact: true }).click();
    await page.getByRole('button', { name: '0', exact: true }).click();
    await page.getByRole('button', { name: '0', exact: true }).click();
    await page.getByRole('button', { name: '0', exact: true }).click();

    await page.getByRole('button', { name: /Salary/ }).click();
    await page.waitForTimeout(800);

    await expect(page.locator('main').getByText('₹0')).toBeVisible();
  });

  test('suggests notes used before, and taps one in', async ({ page }) => {
    const note = page.getByRole('textbox', { name: 'Note' });
    await page.getByRole('button', { name: '5', exact: true }).click();
    await note.fill('Coffee with Sam');
    await page.getByRole('button', { name: /Food & Dining/ }).click();
    await expect(note).toHaveValue('');

    await note.fill('cof');
    const chips = page.getByLabel("Notes you've used before");
    await chips.getByRole('button', { name: 'Coffee with Sam' }).click();
    await expect(note).toHaveValue('Coffee with Sam');
    await expect(chips).toHaveCount(0);
    // The category it went under last time is marked.
    const usual = page.getByRole('button', { name: /Food & Dining/ });
    await expect(usual.getByText('Last time')).toBeVisible();
    await expect(page.getByText('Last time')).toHaveCount(1);
  });

  test('backspace removes last digit', async ({ page }) => {
    await page.getByRole('button', { name: '1', exact: true }).click();
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('button', { name: '3', exact: true }).click();
    await expect(page.locator('main').getByText('₹123')).toBeVisible();

    await page.getByRole('button', { name: '⌫' }).click();
    await expect(page.locator('main').getByText('₹12')).toBeVisible();
  });

  test('transaction appears in transactions list after adding', async ({ page }) => {
    await page.getByRole('button', { name: '7', exact: true }).click();
    await page.getByRole('button', { name: '5', exact: true }).click();
    await page.getByRole('button', { name: '0', exact: true }).click();
    await page.getByRole('button', { name: /Groceries/ }).click();
    await page.waitForTimeout(800);

    await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
    await page.waitForTimeout(500);

    await expect(page.locator('main li').getByText('Groceries').first()).toBeVisible();
  });
});

test.describe('Quick Entry on a phone', () => {
  test('Choose category opens the categories and saves', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const choose = page.getByRole('button', { name: 'Type an amount' });
    await expect(choose).toBeDisabled();
    await expect(choose).toBeInViewport();

    await page.getByRole('button', { name: '4', exact: true }).click();
    await page.getByRole('textbox', { name: 'Note' }).fill('Lunch');
    await page.screenshot({ path: test.info().outputPath('phone-add.png') });
    await page.getByRole('button', { name: 'Choose category' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toContainText('choose a category');
    await page.screenshot({ path: test.info().outputPath('phone-sheet.png') });
    await sheet.getByRole('button', { name: /Food & Dining/ }).click();

    await expect(sheet).toHaveCount(0);
    await expect(page.getByText(/✓ Food & Dining/)).toBeVisible();
    await expect(page.locator('main').getByText('₹0')).toBeVisible();
  });
});
