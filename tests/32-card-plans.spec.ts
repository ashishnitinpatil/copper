import { test, expect, type Page } from '@playwright/test';
import { APP_DB, appSql, resetAndLoad, waitForDB, reloadAfterWrites } from './helpers';

// A card with its statement on the 3rd, due on the 18th, paid from Cash.
async function cardWithSpending(page: Page) {
  await resetAndLoad(page, '/dashboard');
  const [[cash]] = (await appSql(page, "SELECT id FROM accounts WHERE name = 'Cash'")) as string[][];
  await appSql(
    page,
    `INSERT INTO accounts (id, name, type, currency, opening_balance_minor, statement_day, due_day, pay_from_account_id, starts_on, created_at)
     VALUES ('card', 'Mashreq', 'credit_card', 'INR', 0, 3, 18, ?, '2026-01-01', '2026-01-01')`,
    [cash],
  );
  for (const [id, amount, on, note] of [
    ['laptop', -1_200_000, '2026-10-20', 'Laptop'],
    ['food', -100_000, '2026-10-25', 'Groceries run'],
  ] as const) {
    await appSql(
      page,
      "INSERT INTO transactions (id, account_id, amount_minor, kind, occurred_on, note, created_at) VALUES (?, 'card', ?, 'expense', ?, ?, ?)",
      [id, amount, on, note, on],
    );
  }
  await reloadAfterWrites(page);
  await waitForDB(page);
  return cash;
}

test.describe('Card instalment plans', () => {
  test('a purchase paid in instalments: the bill asks only for this month’s share', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-12T09:00:00'));
    await cardWithSpending(page);
    await reloadAfterWrites(page);
    await waitForDB(page);
    const reminder = page.locator('div', { has: page.getByRole('heading', { name: 'Card bill to pay' }) }).last();
    await expect(reminder).toContainText('13,000.00 on the');

    await page.goto('/transactions');
    await waitForDB(page);
    await page.locator('main li', { hasText: 'Laptop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit transaction' });
    await dialog.getByRole('button', { name: 'Pay in instalments…' }).click();
    await expect(dialog.getByLabel('Amount converted')).toHaveValue('12000');
    await dialog.getByLabel('Months').fill('12');
    await expect(dialog.getByText('₹1,000.00 a month · no interest')).toBeVisible();
    await dialog.getByRole('button', { name: 'Start plan' }).click();
    await expect(dialog.getByText('Instalments · 1 of 12 billed')).toBeVisible();
    await expect(dialog.getByText('₹11,000.00')).toBeVisible();

    // 1,000 of other spending + the first 1,000 instalment.
    await page.goto('/dashboard');
    await waitForDB(page);
    await expect(reminder).toContainText('2,000.00 on the');
    await page.goto('/accounts');
    await waitForDB(page);
    await page.getByRole('button', { name: '1 instalment plan · ₹11,000.00 still to be billed' }).click();
    const list = page.getByRole('dialog', { name: 'Instalment plans · Mashreq' });
    await expect(list).toContainText('Laptop');
    await expect(list).toContainText('Instalments · 1 of 12');
    await expect(list).toContainText('₹11,000.00 still to be billed · next on the');
    await expect(list).toContainText('₹1,000.00');

    // Tapping it shows the entry, tagged with how far along it is.
    await list.getByRole('button', { name: /Laptop/ }).click();
    await expect(page).toHaveURL(/\/transactions\?account=card&from=2026-10-20&to=2026-10-20/);
    await expect(page.locator('main li', { hasText: 'Laptop' })).toContainText('Instalments · 1 of 12');
    await expect(page.locator('main li', { hasText: 'Groceries run' })).toHaveCount(0);
  });

  test('a loan on the card: monthly interest goes on the card each statement, the fee once; settling ends it', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-11-12T09:00:00'));
    const cash = await cardWithSpending(page);
    // 4,800 out of the card into Cash on 5 Nov.
    await appSql(
      page,
      `INSERT INTO transactions (id, account_id, amount_minor, kind, transfer_peer_id, occurred_on, note, created_at) VALUES
       ('loanOut', 'card', -480000, 'transfer', 'loanIn', '2026-11-05', 'Loan on card', '2026-11-05'),
       ('loanIn', ?, 480000, 'transfer', 'loanOut', '2026-11-05', 'Loan on card', '2026-11-05')`,
      [cash],
    );
    await reloadAfterWrites(page, '/transactions');
    await waitForDB(page);
    await page.locator('main li', { hasText: 'Loan on card' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit transfer' });
    await dialog.getByRole('button', { name: 'Pay in instalments…' }).click();
    await dialog.getByLabel('Months').fill('48');
    await dialog.getByLabel('Interest rate (%)').fill('0.89');
    await dialog.getByLabel('Processing fee').fill('105');
    // 0.89% a month on what's left, over 48 months.
    await expect(dialog.getByText(/₹123\.31 a month/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Start plan' }).click();
    await expect(dialog.getByText('Instalments · 0 of 48 billed')).toBeVisible();

    // After the 3 Dec statement: its interest (0.89% of 4,800) and the fee are on the card.
    await page.clock.setFixedTime(new Date('2026-12-10T09:00:00'));
    await reloadAfterWrites(page);
    await waitForDB(page);
    await page.waitForFunction(() => !!(window as { __copperDb?: unknown }).__copperDb);
    const added = (await appSql(
      page,
      "SELECT amount_minor, occurred_on FROM transactions WHERE account_id = 'card' AND id LIKE 'plan:%' ORDER BY amount_minor",
    )) as [number, string][];
    expect(added).toEqual([
      [-10500, '2026-12-03'],
      [-4272, '2026-12-03'],
    ]);
    // Opening again adds nothing more.
    await reloadAfterWrites(page);
    await waitForDB(page);
    await page.waitForFunction(() => !!(window as { __copperDb?: unknown }).__copperDb);
    expect(await appSql(page, "SELECT count(*) FROM transactions WHERE id LIKE 'plan:%'")).toEqual([[2]]);

    await page.locator('main li', { hasText: 'Mashreq → Cash' }).click();
    await dialog.getByRole('button', { name: 'Settle the rest…' }).click();
    await dialog.getByLabel('Settlement charge').fill('50');
    await dialog.getByRole('button', { name: 'Settle', exact: true }).click();
    await expect(dialog.getByText('Instalments · settled')).toBeVisible();
    expect(await appSql(page, "SELECT amount_minor FROM transactions WHERE id LIKE 'plan:%:settle'")).toEqual([[-5000]]);
  });

  test('a flat plan: all the interest goes on the card at the start, as the bank books it', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-12T09:00:00'));
    await cardWithSpending(page);
    await page.goto('/transactions');
    await waitForDB(page);
    await page.locator('main li', { hasText: 'Laptop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit transaction' });
    await dialog.getByRole('button', { name: 'Pay in instalments…' }).click();
    await dialog.getByLabel('Months').fill('12');
    await dialog.getByLabel('Interest rate (%)').fill('1');
    await dialog.getByLabel('Charged', { exact: true }).selectOption('flat');
    await expect(dialog.getByRole('checkbox', { name: /The bank adds all the interest at the start/ })).toBeChecked();
    // 12,000 + 1% a month × 12 on the full amount = 13,440, in 12 instalments.
    await expect(dialog.getByText(/₹1,120\.00 a month · ₹1,440\.00 interest in all/)).toBeVisible();
    // The purchase was before the 3 Nov statement: the bank has charged it already.
    await dialog.getByRole('checkbox', { name: /Also add the interest/ }).check();
    await dialog.getByRole('button', { name: 'Start plan' }).click();
    await expect(dialog.getByText('Instalments · 1 of 12 billed')).toBeVisible();
    expect(
      await appSql(page, "SELECT amount_minor, occurred_on FROM transactions WHERE id LIKE 'plan:%'"),
    ).toEqual([[-144000, '2026-10-20']]);

    // 1,000 of other spending + the first instalment of 1,120.
    await page.goto('/dashboard');
    await waitForDB(page);
    const reminder = page.locator('div', { has: page.getByRole('heading', { name: 'Card bill to pay' }) }).last();
    await expect(reminder).toContainText('2,120.00 on the');
  });

  test('the plan follows its entry: a new amount, a new date, and undo', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-12T09:00:00'));
    await cardWithSpending(page);
    await page.goto('/transactions');
    await waitForDB(page);
    await page.locator('main li', { hasText: 'Laptop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit transaction' });
    await dialog.getByRole('button', { name: 'Pay in instalments…' }).click();
    await expect(dialog.getByText('no entries are added for the instalments')).toBeVisible();
    await dialog.getByLabel('Months').fill('12');
    await dialog.getByRole('button', { name: 'Start plan' }).click();
    await expect(dialog.getByText('Instalments · 1 of 12 billed')).toBeVisible();
    const plan = () => appSql(page, 'SELECT principal_minor, first_statement FROM card_plans');
    expect(await plan()).toEqual([[1_200_000, '2026-11-03']]);

    // The bank's figure was 9,000: the plan of the whole amount takes it.
    await dialog.getByLabel('Amount', { exact: true }).fill('9000');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(plan).toEqual([[900_000, '2026-11-03']]);

    // A month later: the first instalment moves a statement on with it.
    await page.evaluate(async (appDb) => {
      const db = await eval(appDb)();
      const { updateTransaction } = await import('/src/db/queries/transactions.ts');
      await updateTransaction(db, 'laptop', {
        account_id: 'card',
        category_id: null,
        amount_minor: 900_000,
        kind: 'expense',
        occurred_on: '2026-11-20',
        note: 'Laptop',
      });
    }, APP_DB);
    expect(await plan()).toEqual([[900_000, '2026-12-03']]);

    // Undo puts the date, and the plan, back.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('status')).toContainText('Undone');
    await expect.poll(plan).toEqual([[900_000, '2026-11-03']]);

    // A plan of part of an entry keeps its amount, unless the entry drops below it.
    await appSql(page, 'UPDATE card_plans SET principal_minor = 500000');
    // The list catches up with the undo (the entry leaves Upcoming).
    await expect(page.locator('main li', { hasText: 'Laptop' })).toHaveCount(1);
    await page.locator('main li', { hasText: 'Laptop' }).click();
    await dialog.getByLabel('Amount', { exact: true }).fill('8000');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(plan).toEqual([[500_000, '2026-11-03']]);
    await page.locator('main li', { hasText: 'Laptop' }).click();
    await dialog.getByLabel('Amount', { exact: true }).fill('4000');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(plan).toEqual([[400_000, '2026-11-03']]);
  });
});
