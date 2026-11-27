import { test, expect, type Page } from '@playwright/test';
import { resetAndLoad, waitForDB, selectCombobox } from './helpers';

// ₹100,000 at 12% a year over 12 months: ₹8,884.88 a month. Interest is by
// the day: paid on 10 Nov, 26 days after the 15 Oct payment day, it's
// ₹100,000 × 12% × 26/365 = ₹854.79, so ₹8,030.09 pays it down.

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
  if (opts.autopay) {
    await page.getByLabel('Add each payment automatically on its day').check();
    await expect(page.getByText('Earlier payments aren’t filled in')).toBeVisible();
  }
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
    await expect(dialog.getByLabel('Principal')).toHaveValue('8030.09');
    await expect(dialog.getByLabel('Interest')).toHaveValue('854.79');
    await dialog.getByRole('button', { name: 'Record payment' }).click();

    await expect(card).toContainText('Still owed₹91,969.91');
    await expect(card).toContainText('Interest paid ₹854.79');
    await expect(card).toContainText('8% of ₹100,000.00 paid off');

    // One entry for the whole payment; the interest isn't a row of its own.
    await page.goto('/transactions');
    await waitForDB(page);
    const row = page.locator('main li', { hasText: 'Loan payment' });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Cash → Car loan · ₹8,030.09 principal · ₹854.79 interest');
    await expect(row).toContainText('₹8,884.88');
    await expect(page.locator('main li', { hasText: 'Loan interest' })).toHaveCount(0);

    // Interest well off what 12% gives suggests the rate changed.
    await row.click();
    await expect(dialog.getByLabel('Interest')).toHaveValue('854.79');
    await dialog.getByLabel('Interest').fill('1500');
    await expect(dialog.getByText(/more interest than 12%/)).toBeVisible();
    // 1,500 for 26 days is 21.06% a year.
    await expect(dialog.getByRole('button', { name: 'Change the rate to 21.05%' })).toBeVisible();
    await dialog.getByLabel('Interest').fill('870');
    await expect(dialog.getByText(/more interest than 12%/)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(row).toContainText('₹8,900.09');

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
    // November's for its 31 days on ₹100,000; December's for 30 days on the ₹92,134.30 left.
    await expect(rows.first()).toContainText('₹7,976.16 principal · ₹908.72 interest');
    await expect(rows.last()).toContainText('₹7,865.70 principal · ₹1,019.18 interest');

    await page.goto('/accounts');
    await waitForDB(page);
    await expect(loanCard(page)).toContainText('Still owed₹84,158.14');
  });

  test('insurance is what the total paid has beyond principal and interest, and next time follows what is owed', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00'));
    await resetAndLoad(page, '/accounts');
    await createLoan(page);

    const card = loanCard(page);
    await card.getByRole('button', { name: 'Record payment' }).click();
    const dialog = page.getByRole('dialog');
    // The bank took ₹8,984.88: ₹100 more than principal and interest, for insurance.
    await dialog.getByLabel('Total paid').fill('8984.88');
    await expect(dialog.getByLabel('Insurance')).toHaveValue('100');
    await dialog.getByRole('button', { name: 'Record payment' }).click();
    await expect(card).toContainText('Still owed₹91,969.91');
    await expect(card).toContainText('Interest paid ₹854.79');
    await expect(card).toContainText('Insurance paid ₹100.00');

    // A month on, insurance is the same share (0.1%) of the less that's owed.
    await page.clock.setFixedTime(new Date('2026-12-10T09:00:00'));
    await card.getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog.getByLabel('Insurance')).toHaveValue('91.97');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.goto('/transactions');
    await waitForDB(page);
    await expect(page.locator('main li', { hasText: 'Loan payment' })).toContainText(
      '₹8,030.09 principal · ₹854.79 interest · ₹100.00 insurance',
    );
  });

  test('the cashflow forecast takes insurance with the next automatic payment', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00'));
    await resetAndLoad(page, '/accounts');
    await createLoan(page, { autopay: true });
    await loanCard(page).getByRole('button', { name: 'Record payment' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Total paid').fill('8984.88');
    await dialog.getByRole('button', { name: 'Record payment' }).click();
    await expect(loanCard(page)).toContainText('Insurance paid ₹100.00');

    // Nov 15: the monthly ₹8,884.88 plus ₹91.97 insurance (0.1% of ₹91,969.91 owed).
    await page.goto('/cashflow');
    await waitForDB(page);
    const row = page.locator('main div.flex.items-center.justify-between', { hasText: 'Car loan payment' }).last();
    await expect(row).toContainText('Nov 15, 2026−₹8,976.85');
  });

  test('paying off early clears what is owed, with its fee', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00'));
    await resetAndLoad(page, '/accounts');
    await createLoan(page);

    const card = loanCard(page);
    await card.getByRole('button', { name: 'Record payment' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Pay off what’s left/ }).click();
    await expect(dialog.getByLabel('Principal')).toHaveValue('100000');
    await dialog.getByLabel('Interest').fill('0');
    await dialog.getByLabel('Fees').fill('1000');
    await expect(dialog.getByLabel('Total paid')).toHaveValue('101000');
    await dialog.getByRole('button', { name: 'Record payment' }).click();

    await expect(card).toContainText('Paid off');
    await expect(card).toContainText('Fees paid ₹1,000.00');
    await expect(card.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
  });

  test('a new loan’s money can go into an account', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    await page.getByRole('button', { name: '+ New account' }).click();
    await page.getByLabel('Name').fill('Personal loan');
    await page.getByLabel('Type').selectOption('loan');
    await page.getByLabel('Amount borrowed').fill('50000');
    await selectCombobox(page, 'Paid into', 'Cash');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await expect(page.locator('div.rounded-xl', { hasText: 'Personal loan' }).first()).toContainText('Still owed₹50,000.00');
    await expect(page.locator('div.rounded-xl', { hasText: 'Cash' }).first()).toContainText('₹50,000');
    await page.goto('/transactions');
    await waitForDB(page);
    await expect(page.locator('main li').getByText('Personal loan → Cash')).toBeVisible();
  });

  test('a loan without terms stays a plain balance, and paying into it a plain transfer', async ({ page }) => {
    // Like a debt between friends brought over from Monefy.
    await resetAndLoad(page, '/accounts');
    await page.getByRole('button', { name: '+ New account' }).click();
    await page.getByLabel('Name').fill('Dad');
    await page.getByLabel('Type').selectOption('loan');
    await page.getByLabel('Still owed', { exact: true }).fill('500');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const card = page.locator('div.rounded-xl', { hasText: 'Dad' }).first();
    await expect(card).toContainText('₹500');
    await expect(card).not.toContainText('Still owed');
    await expect(card.getByRole('button', { name: 'Record payment' })).toHaveCount(0);

    await page.goto('/transactions');
    await waitForDB(page);
    await page.getByRole('button', { name: '↔ Transfer' }).click();
    await selectCombobox(page.locator('.fixed'), 'From', 'Cash');
    await selectCombobox(page.locator('.fixed'), 'To', 'Dad');
    await page.locator('.fixed').getByLabel('Amount', { exact: true }).fill('200');
    await page.getByRole('button', { name: 'Transfer', exact: true }).click();
    await expect(page.locator('main li').getByText('Cash → Dad')).toBeVisible();
    await expect(page.locator('main li').getByText('Transfer', { exact: true })).toHaveCount(1);
    await expect(page.locator('main li', { hasText: 'Loan payment' })).toHaveCount(0);
  });
});
