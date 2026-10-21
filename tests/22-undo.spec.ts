import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resetAndLoad, waitForDB, selectCombobox } from './helpers';

const SAMPLE_CSV = fileURLToPath(new URL('./fixtures/monefy-sample.csv', import.meta.url));

async function addExpense(page: Page, amount: string, category: RegExp) {
  for (const ch of amount) await page.getByRole('button', { name: ch, exact: true }).click();
  await page.getByRole('button', { name: category }).click();
  await page.waitForTimeout(400);
}

async function undo(page: Page) {
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
}

const rows = (page: Page, text: string) => page.locator('main li', { hasText: text });

test.describe('Undo (Ctrl+Z)', () => {
  test.beforeEach(async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);
  });

  test('undoes adding, editing and deleting, newest first', async ({ page }) => {
    await addExpense(page, '500', /Food & Dining/);
    await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
    await waitForDB(page);

    // Edit 500 → 650.
    await rows(page, 'Food & Dining').first().click();
    await page.getByLabel('Amount', { exact: true }).fill('650');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('main').getByText('₹650.00').first()).toBeVisible();

    // Undo the edit…
    await undo(page);
    await expect(page.getByRole('status')).toContainText('Undone');
    await expect(page.locator('main').getByText('₹500.00').first()).toBeVisible();

    // …then delete it, and undo that.
    await rows(page, 'Food & Dining').first().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(rows(page, 'Food & Dining')).toHaveCount(0);
    await undo(page);
    await expect(rows(page, 'Food & Dining').first()).toContainText('₹500.00');

    // The original add was the last thing left: undoing it empties the list
    // (the delete-undo came first, then the edit's undo was already used).
    await undo(page);
    await expect(rows(page, 'Food & Dining')).toHaveCount(0);
    await undo(page);
    await expect(page.getByRole('status')).toContainText('Nothing to undo');
  });

  test('a transfer is undone as one change', async ({ page }) => {
    await page.goto('/accounts');
    await waitForDB(page);
    await page.getByRole('button', { name: '+ New account' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Bank');
    await page.getByLabel('Type', { exact: true }).selectOption('bank');
    await page.getByLabel('Starting balance', { exact: true }).fill('10000');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(400);
    await page.getByRole('link', { name: 'Add entry', exact: true }).first().click();
    await page.getByRole('tab', { name: 'Transfer' }).click();
    await selectCombobox(page.locator('main'), 'From account', 'Bank');
    await selectCombobox(page.locator('main'), 'To account', 'Cash');
    await page.keyboard.type('2000');
    await page.getByRole('button', { name: /^Transfer ₹/ }).click();
    await page.waitForTimeout(400);

    await page.getByRole('link', { name: 'Accounts', exact: true }).first().click();
    await expect(page.getByText('₹8,000.00').first()).toBeVisible();
    await undo(page);
    await expect(page.getByRole('status')).toContainText('Undone');
    await expect(page.getByText('₹10,000.00').first()).toBeVisible();
    await expect(page.getByText('₹8,000.00')).toHaveCount(0);
  });

  test('undoing a new recurring entry also removes what it added', async ({ page }) => {
    await page.keyboard.type('300');
    await page.getByLabel('Repeat', { exact: true }).selectOption({ label: 'Repeats monthly' });
    await page.getByRole('button', { name: /Groceries/ }).click();
    await page.waitForTimeout(400);
    await page.goto('/transactions');
    await waitForDB(page);
    await expect(rows(page, 'Groceries').first()).toBeVisible();
    // A reload starts a new session, so nothing from before is undoable.
    await undo(page);
    await expect(page.getByRole('status')).toContainText('Nothing to undo');
    await expect(rows(page, 'Groceries').first()).toBeVisible();

    await page.goto('/add');
    await waitForDB(page);
    await page.getByLabel('Repeat', { exact: true }).selectOption({ label: 'Repeats weekly' });
    await addExpense(page, '120', /Transport/);
    await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
    await expect(rows(page, 'Transport').first()).toBeVisible();
    await undo(page);
    await expect(rows(page, 'Transport')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Recurring' }).click();
    await expect(page.locator('main li', { hasText: 'Transport' })).toHaveCount(0);
    await expect(page.locator('main li', { hasText: 'Groceries' })).toHaveCount(1);
  });

  test('an import is too big to undo, and points to backups', async ({ page }) => {
    await page.goto('/settings#data');
    await waitForDB(page);
    await page.getByRole('button', { name: 'Import Monefy CSV' }).click();
    await page.locator('input[type="file"][accept*="csv"]').setInputFiles(SAMPLE_CSV);
    await page.getByLabel('Import from Monefy').getByRole('button', { name: 'Replace and import', exact: true }).click();
    await expect(page.getByText(/Imported .*transactions/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Import from Monefy')).toHaveCount(0);
    await undo(page);
    await expect(page.getByRole('status')).toContainText('restore a backup');
  });

  test('? shows the shortcuts, and letter keys move around', async ({ page }) => {
    await page.keyboard.press('?');
    await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('t');
    await expect(page).toHaveURL(/\/transactions/);
    await page.keyboard.press('a');
    await expect(page).toHaveURL(/\/add/);
    await page.keyboard.press('/');
    await expect(page.getByLabel('Search', { exact: true })).toBeFocused();
  });
});
