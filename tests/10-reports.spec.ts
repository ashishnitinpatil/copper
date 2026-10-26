import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB, pickDate } from './helpers';

async function addExpense(page: import('@playwright/test').Page, amount: string, category: RegExp) {
  for (const ch of amount) {
    await page.getByRole('button', { name: ch, exact: true }).click();
  }
  await page.getByRole('button', { name: category }).click();
  await page.waitForTimeout(500);
}

test.describe('Reports', () => {
  test('shows category breakdown after adding expenses', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);

    await addExpense(page, '300', /Food & Dining/);
    await addExpense(page, '200', /Transport/);

    await page.getByRole('link', { name: 'Reports', exact: true }).first().click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Food & Dining').first()).toBeVisible();
    await expect(page.getByText('Transport').first()).toBeVisible();
    // The donut's middle shows the month's total spending.
    await expect(page.getByRole('img', { name: 'Spending by category' })).toBeVisible();
    await expect(page.getByText('₹500.00').first()).toBeVisible();
  });

  test('step back a month, then pick custom dates', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);
    await addExpense(page, '300', /Food & Dining/);
    await page.getByRole('link', { name: 'Reports', exact: true }).first().click();
    await waitForDB(page);
    await expect(page.getByText('₹300.00').first()).toBeVisible();

    // Last month has nothing; next month can't be picked from this month.
    await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByText(/^No spending in /)).toBeVisible();

    // A custom range that covers today brings the expense back.
    await page.getByRole('button', { name: 'Custom dates' }).click();
    const today = new Date();
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await pickDate(page.getByRole('button', { name: /^Date:/ }).last(), iso(today));
    await expect(page.getByText('₹300.00').first()).toBeVisible();
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Previous month' })).toBeVisible();
  });

  test('a quarter compared with the quarter before', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);
    await addExpense(page, '300', /Food & Dining/);
    // ₹200 on the first day of last quarter: within "the same days" of it.
    const d = new Date();
    const q = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 - 3, 1);
    const iso = `${q.getFullYear()}-${String(q.getMonth() + 1).padStart(2, '0')}-01`;
    await pickDate(page.getByRole('button', { name: /^Date:/ }), iso);
    await addExpense(page, '200', /Food & Dining/);
    await addExpense(page, '50', /Transport/);

    await page.getByRole('link', { name: 'Reports', exact: true }).first().click();
    await waitForDB(page);
    await page.getByRole('button', { name: 'Quarter', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Next quarter' })).toBeDisabled();
    await page.getByRole('button', { name: 'Compare', exact: true }).click();

    await expect(page.getByText('₹50.00 more (20%)')).toBeVisible();
    await expect(page.getByText('₹200.00 before')).toBeVisible();
    await expect(page.getByText('50% more')).toBeVisible();
    // Spent on before, nothing this quarter: still listed, at ₹0.
    await expect(page.getByText('Transport').first()).toBeVisible();
    await expect(page.getByText('₹50.00 before')).toBeVisible();

    await page.getByRole('button', { name: 'Previous quarter' }).click();
    await expect(page.getByText('₹250.00').first()).toBeVisible();
  });

  test('monthly trend tab works', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);

    await addExpense(page, '100', /Other/);

    await page.getByRole('link', { name: 'Reports', exact: true }).first().click();
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: 'Monthly trend' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('Expenses').first()).toBeVisible();
    await expect(page.getByText('Income').first()).toBeVisible();
    await expect(page.getByText('Net').first()).toBeVisible();
  });

  test('months with only scheduled entries stay folded until asked for', async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);
    await addExpense(page, '100', /Other/);
    // A second expense dated two months ahead (like a scheduled EMI).
    const d = new Date();
    const ahead = new Date(d.getFullYear(), d.getMonth() + 2, 10);
    const iso = `${ahead.getFullYear()}-${String(ahead.getMonth() + 1).padStart(2, '0')}-10`;
    await pickDate(page.getByRole('button', { name: /^Date:/ }), iso);
    await addExpense(page, '777', /Other/);

    await page.getByRole('link', { name: 'Reports', exact: true }).first().click();
    await waitForDB(page);
    await page.getByRole('button', { name: 'Monthly trend' }).click();

    const table = page.locator('table');
    await expect(table).toContainText('₹100.00');
    await expect(table).not.toContainText('₹777.00');
    await page.getByRole('button', { name: /Upcoming months/ }).click();
    await expect(table).toContainText('₹777.00');
    await expect(page.getByText(/only entries already scheduled/)).toBeVisible();
  });

  test('this month’s trend counts only up to today', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-10T09:00:00'));
    await resetAndLoad(page, '/add');
    await waitForDB(page);
    await addExpense(page, '100', /Other/);
    await pickDate(page.getByRole('button', { name: /^Date:/ }), '2026-10-25');
    await addExpense(page, '777', /Other/);

    await page.getByRole('link', { name: 'Reports', exact: true }).first().click();
    await waitForDB(page);
    await page.getByRole('button', { name: 'Monthly trend' }).click();
    const table = page.locator('table');
    await expect(table).toContainText('₹100.00');
    await expect(table).not.toContainText('₹877.00');
    await expect(table).not.toContainText('₹777.00');
  });
});

