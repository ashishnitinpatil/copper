import { test, expect, type Page } from '@playwright/test';
import { resetAndLoad, waitForDB, selectCombobox } from './helpers';

// ₹100,000 at 12% a year over 12 months: ₹8,884.88 a month. The first
// month's interest is 1% of what's owed, ₹1,000, so ₹7,884.88 pays it down.

async function createLoan(page: Page, opts: { autopay?: boolean } = {}) {
  await page.goto('/accounts');
  await waitForDB(page);
  await page.getByRole('button', { name: '+ New account' }).click();
  await page.getByLabel('Name').fill('Car loan');
  await page.getByLabel('Type').selectOption('loan');
  await selectCombobox(page, 'Currency', 'INR');
  await page.getByLabel('Amount borrowed').fill('100000');
  await page.getByLabel('Term (months)').fill('12');
  await page.getByLabel('Interest rate (% a year)').fill('12');
  // Worked out from the terms until a figure is typed.
  await expect(page.getByRole('textbox', { name: 'Monthly payment' })).toHaveAttribute('placeholder', '8884.88');
  // The rate the other way round, for comparison.
  await expect(page.getByText(/12% reducing ≈ 6\.\d+% flat/)).toBeVisible();
  await page.getByLabel('Payment day').fill('15');
  await selectCombobox(page, 'Paid from', 'Cash');
  if (opts.autopay) await page.getByLabel('Add each payment automatically on its day').check();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(loanCard(page)).toBeVisible();
}

const loanCard = (page: Page) => page.locator('div.rounded-xl', { hasText: 'Car loan' }).first();

test.describe('Loans', () => {
  test('a payment splits into principal and interest, and shows as one entry', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00'));
    await resetAndLoad(page, '/accounts');
    await createLoan(page);

    const card = loanCard(page);
    await expect(card).toContainText('Still owed₹100,000.00');
    await expect(card).toContainText('₹8,884.88 a month · 12 payments left · paid off Oct 2027');
    await expect(card).toContainText('12% reducing ≈ 6.62% flat');

    // Filled in from the loan's terms.
    await card.getByRole('button', { name: 'Record payment' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Principal')).toHaveValue('7884.88');
    await expect(dialog.getByLabel('Interest')).toHaveValue('1000');
    await dialog.getByRole('button', { name: 'Record payment' }).click();

    await expect(card).toContainText('Still owed₹92,115.12');
    await expect(card).toContainText('Interest paid ₹1,000.00');
    await expect(card).toContainText('8% of ₹100,000.00 paid off');

    // One entry for the whole payment; the interest isn't a row of its own.
    await page.goto('/transactions');
    await waitForDB(page);
    const row = page.locator('main li', { hasText: 'Loan payment' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Cash → Car loan · ₹7,884.88 principal · ₹1,000.00 interest');
    await expect(row).toContainText('₹8,884.88');
    await expect(page.locator('main li', { hasText: 'Loan interest' })).toHaveCount(0);

    // Interest well off what 12% gives suggests the rate changed.
    await row.click();
    await expect(dialog.getByLabel('Interest')).toHaveValue('1000');
    await dialog.getByLabel('Interest').fill('1500');
    await expect(dialog.getByText(/more interest than 12%/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Change the rate to 18%' })).toBeVisible();
    await dialog.getByLabel('Interest').fill('1020');
    await expect(dialog.getByText(/more interest than 12%/)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(row).toContainText('₹8,904.88');

    // Deleting it removes all of it.
    await row.click();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('main li', { hasText: 'Loan payment' })).toHaveCount(0);
    await page.goto('/accounts');
    await waitForDB(page);
    await expect(loanCard(page)).toContainText('Still owed₹100,000.00');
    await expect(loanCard(page)).toContainText('Interest paid ₹0.00');
  });

  test('payments are added automatically on their day, each split on what was owed then', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00'));
    await resetAndLoad(page, '/accounts');
    await createLoan(page, { autopay: true });

    // Five weeks later: the payments on Nov 15 and Dec 15 are in.
    await page.clock.setFixedTime(new Date('2026-12-20T09:00:00'));
    await page.goto('/transactions');
    await waitForDB(page);
    const rows = page.locator('main li', { hasText: 'Loan payment' });
    await expect(rows).toHaveCount(2);
    // December's interest is 1% of the ₹92,115.12 left after November's.
    await expect(rows.first()).toContainText('₹7,963.73 principal · ₹921.15 interest');
    await expect(rows.last()).toContainText('₹7,884.88 principal · ₹1,000.00 interest');

    await page.goto('/accounts');
    await waitForDB(page);
    await expect(loanCard(page)).toContainText('Still owed₹84,151.39');
  });
});
