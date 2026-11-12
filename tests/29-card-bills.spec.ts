import { test, expect } from '@playwright/test';
import { appSql, resetAndLoad, waitForDB } from './helpers';

test.describe('Card bills', () => {
  test('an unpaid statement is a reminder until a payment goes in; refunds don’t count', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-12T09:00:00'));
    await resetAndLoad(page, '/dashboard');
    const [[cash]] = (await appSql(page, "SELECT id FROM accounts WHERE name = 'Cash'")) as string[][];
    // Statement on the 3rd, due on the 18th, paid from Cash. Spent before the
    // statement; after it, a refund (lowers what's owed, isn't a payment).
    await appSql(
      page,
      `INSERT INTO accounts (id, name, type, currency, opening_balance_minor, statement_day, due_day, pay_from_account_id, starts_on, created_at)
       VALUES ('card', 'Regalia', 'credit_card', 'INR', 0, 3, 18, ?, '2026-01-01', '2026-01-01')`,
      [cash],
    );
    // A card without a statement day can't be reminded about.
    await appSql(
      page,
      `INSERT INTO accounts (id, name, type, currency, opening_balance_minor, starts_on, created_at)
       VALUES ('card2', 'Amex', 'credit_card', 'INR', -50000, '2026-01-01', '2026-01-01')`,
    );
    for (const [id, amount, kind, on] of [
      ['t1', -250000, 'expense', '2026-10-20'],
      ['t2', 30000, 'income', '2026-11-05'],
    ] as const) {
      await appSql(
        page,
        'INSERT INTO transactions (id, account_id, amount_minor, kind, occurred_on, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, 'card', amount, kind, on, on],
      );
    }
    await page.reload();
    await waitForDB(page);

    const reminder = page.locator('div', { has: page.getByRole('heading', { name: 'Card bill to pay' }) }).last();
    await expect(reminder).toContainText('Regalia');
    await expect(reminder).toContainText('Due in 6 days');
    await expect(reminder).toContainText('No payment yet for the');
    await expect(reminder).not.toContainText('Amex');

    // Pay opens a transfer from the card's pay-from account into the card.
    await reminder.getByRole('button', { name: 'Pay' }).click();
    const dialog = page.getByRole('dialog', { name: 'New transfer' });
    await expect(dialog.getByRole('button', { name: 'From' })).toContainText('Cash');
    await expect(dialog.getByRole('button', { name: 'To' })).toContainText('Regalia');
    await dialog.getByRole('textbox', { name: 'Amount' }).fill('2200');
    await dialog.getByRole('button', { name: 'Transfer', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Card bill to pay' })).toHaveCount(0);

    // Accounts says it's paid, and tells the other card how to get reminders.
    await page.goto('/accounts');
    await waitForDB(page);
    await expect(page.getByText('Payment recorded for the')).toBeVisible();
    await expect(page.getByText('Add its statement day to be reminded of unpaid bills')).toBeVisible();
  });

  test('past the due date it shows as overdue, on the Dashboard and the card', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-20T09:00:00'));
    await resetAndLoad(page, '/dashboard');
    await appSql(
      page,
      `INSERT INTO accounts (id, name, type, currency, opening_balance_minor, statement_day, due_day, starts_on, created_at)
       VALUES ('card', 'Regalia', 'credit_card', 'INR', -100000, 3, 18, '2026-01-01', '2026-01-01')`,
    );
    await page.reload();
    await waitForDB(page);
    await expect(page.getByText('2 days overdue')).toBeVisible();
    await page.goto('/accounts');
    await waitForDB(page);
    await expect(page.getByText('2 days overdue')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay bill' })).toBeVisible();
  });

  test('public pages offer a way back into the app for someone who uses it', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('link', { name: 'Open Copper →' })).toHaveCount(0);
    await resetAndLoad(page, '/dashboard');
    await page.goto('/for-couples');
    await page.getByRole('link', { name: 'Open Copper →' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('the forecast calendar shows what’s coming by day, card bills included', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-12T09:00:00'));
    await resetAndLoad(page, '/cashflow');
    const [[cash]] = (await appSql(page, "SELECT id FROM accounts WHERE name = 'Cash'")) as string[][];
    await appSql(
      page,
      `INSERT INTO accounts (id, name, type, currency, opening_balance_minor, statement_day, due_day, starts_on, created_at)
       VALUES ('card', 'Regalia', 'credit_card', 'INR', -100000, 3, 18, '2026-01-01', '2026-01-01')`,
    );
    await appSql(
      page,
      "INSERT INTO transactions (id, account_id, amount_minor, kind, occurred_on, note, created_at) VALUES ('rent', ?, -1250000, 'expense', '2026-11-20', 'Rent', '2026-11-12')",
      [cash],
    );
    await page.reload();
    await waitForDB(page);

    await page.getByRole('button', { name: 'Calendar' }).click();
    await expect(page.getByRole('region', { name: 'November 2026' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'December 2026' })).toBeVisible();
    // Opens on the first day with something on it: the card bill.
    await expect(page.getByText('Regalia bill due')).toBeVisible();
    await expect(page.getByText('Amount on your statement')).toBeVisible();

    const rentDay = page.getByRole('button', { name: /^(November 20|20 November), 1 item$/ });
    await expect(rentDay).toContainText('−');
    await rentDay.click();
    await expect(page.getByText('Scheduled expense · Rent')).toBeVisible();
    await expect(page.getByText('Balance after:')).toBeVisible();

    // Remembered on this device.
    await page.reload();
    await waitForDB(page);
    await expect(page.getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-pressed', 'true');
  });
});
