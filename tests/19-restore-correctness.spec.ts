import { test, expect, type Page } from '@playwright/test';
import { resetAndLoad, waitForDB, selectCombobox } from './helpers';

// A controlled, hand-computed book that exercises every balance-affecting shape
// (opening balances, expenses, income, same- and cross-currency transfers,
// account + category merges, and a recurring rule) then proves a full backup →
// restore reproduces every number exactly.
//
// A cross-currency transfer records what left one account and what arrived in
// the other, each in its own currency — the two legs hold different amounts,
// and restore must keep both. All figures below are minor units.

// ---- The single source of truth for the expected end state ----------------
// Every value is derivable from the operations in `buildBook` below.
const EXPECTED = {
  n_acct: 4, // Cash, Bank, Wallet, Euro (Savings was merged into Bank)
  n_txn: 9, // 3 quick entries + 3 transfers × 2 legs
  n_rec: 1, // one future-dated recurring rule
  // Per-account balances (opening + sum of that account's legs).
  cash: 320_000, //        0 + (−50k −25k +100k)  + 300k in  − 5k out
  bank: 2_190_000, // 2,000k − 300k − 10k + 500k(merged Savings)
  wallet: 50_120, //     50k + 120 in ($1.20 received for ₹100)
  euro: 30_055, //       30k + 55 in (€0.55 received for ₹50)
  // Per-currency "global" totals (what getTotalsByCurrency reports, as-of today).
  inr: 2_510_000, // Cash + Bank
  usd: 50_120, //    Wallet
  eur: 30_055, //    Euro
};

// One query returns the whole fingerprint as a single row of integers, keyed by
// account name / currency so it survives the id-remapping a restore performs.
const perAccount = (name: string) =>
  `(SELECT opening_balance_minor + COALESCE(
     (SELECT SUM(amount_minor) FROM transactions WHERE account_id = a.id), 0)
   FROM accounts a WHERE a.name = '${name}')`;
const perCurrency = (code: string) =>
  `((SELECT COALESCE(SUM(opening_balance_minor), 0) FROM accounts WHERE currency = '${code}')
    + (SELECT COALESCE(SUM(t.amount_minor), 0) FROM transactions t
       JOIN accounts a ON a.id = t.account_id WHERE a.currency = '${code}'))`;
const SNAPSHOT_SQL = `SELECT
  (SELECT COUNT(*) FROM accounts) AS n_acct,
  (SELECT COUNT(*) FROM transactions) AS n_txn,
  (SELECT COUNT(*) FROM recurring_rules) AS n_rec,
  ${perAccount('Cash')} AS cash,
  ${perAccount('Bank')} AS bank,
  ${perAccount('Wallet')} AS wallet,
  ${perAccount('Euro')} AS euro,
  ${perCurrency('INR')} AS inr,
  ${perCurrency('USD')} AS usd,
  ${perCurrency('EUR')} AS eur`;

/** Run the read-only fingerprint query in the SQL console and read the row back. */
async function snapshot(page: Page): Promise<Record<string, number>> {
  await page.getByRole('link', { name: 'SQL', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.locator('textarea').fill(SNAPSHOT_SQL);
  await page.getByRole('button', { name: /Run/ }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  const headers = await page.locator('thead th').allInnerTexts();
  const cells = await page.locator('tbody tr').first().locator('td').allInnerTexts();
  const row: Record<string, number> = {};
  headers.forEach((h, i) => (row[h.trim().toLowerCase()] = Number(cells[i])));
  return row;
}

async function createAccount(
  page: Page,
  opts: { name: string; opening: string; currency?: string },
) {
  await page.getByRole('button', { name: '+ New account' }).first().click();
  await expect(page.getByRole('heading', { name: 'New account' })).toBeVisible();
  const modal = page.locator('.fixed');
  await modal.getByLabel('Name', { exact: true }).fill(opts.name);
  if (opts.currency) await selectCombobox(modal, 'Currency', opts.currency);
  await modal.getByLabel('Starting balance', { exact: true }).fill(opts.opening);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(400);
}

async function quickEntry(
  page: Page,
  opts: { mode: 'Expense' | 'Income'; digits: string; category: RegExp },
) {
  await page.goto('/add');
  await waitForDB(page);
  if (opts.mode === 'Income') await page.getByRole('button', { name: 'Income', exact: true }).click();
  for (const d of opts.digits) {
    await page.getByRole('button', { name: d, exact: true }).click();
  }
  await page.getByRole('button', { name: opts.category }).click();
  await page.waitForTimeout(600);
}

async function transfer(
  page: Page,
  opts: { from: string; to: string; amount: string; received?: string },
) {
  await page.goto('/transactions');
  await waitForDB(page);
  await page.getByRole('button', { name: '↔ Transfer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New transfer' })).toBeVisible();
  const modal = page.locator('.fixed');
  await selectCombobox(modal, 'From', opts.from);
  await selectCombobox(modal, 'To', opts.to);
  if (opts.received) {
    await modal.getByLabel(/^Amount sent/).fill(opts.amount);
    await modal.getByLabel(/^Amount received/).fill(opts.received);
  } else {
    await modal.getByLabel('Amount', { exact: true }).fill(opts.amount);
  }
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  await page.waitForTimeout(500);
}

/** Builds the whole controlled book through the real UI code paths. */
async function buildBook(page: Page) {
  // 1. Accounts across three currencies. Cash (INR) is the seeded main account.
  await page.goto('/accounts');
  await waitForDB(page);
  await createAccount(page, { name: 'Bank', opening: '20000' }); // INR (default)
  await createAccount(page, { name: 'Savings', opening: '5000' }); // INR (merge source)
  await createAccount(page, { name: 'Wallet', opening: '500', currency: 'USD' });
  await createAccount(page, { name: 'Euro', opening: '300', currency: 'EUR' });

  // 2. Quick entries land on the main account (Cash).
  await quickEntry(page, { mode: 'Expense', digits: '500', category: /Food & Dining/ });
  await quickEntry(page, { mode: 'Expense', digits: '250', category: /Transport/ });
  await quickEntry(page, { mode: 'Income', digits: '1000', category: /Salary/ });

  // 3. Transfers: one same-currency, two cross-currency (amount received differs).
  await transfer(page, { from: 'Bank', to: 'Cash', amount: '3000' }); // INR → INR
  await transfer(page, { from: 'Bank', to: 'Wallet', amount: '100', received: '1.20' }); // INR → USD
  await transfer(page, { from: 'Cash', to: 'Euro', amount: '50', received: '0.55' }); // INR → EUR

  // 4. Category merge — Transport folds into Food & Dining (balance-neutral).
  await page.goto('/categories');
  await waitForDB(page);
  await page.getByRole('button', { name: 'Transport' }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit category' })).toBeVisible();
  await page.getByText('Merge into another category').click();
  await selectCombobox(page, 'Move everything into', 'Food & Dining');
  await page.getByRole('button', { name: /Merge & delete/ }).click();
  await page.getByRole('button', { name: 'Yes, merge & delete' }).click();
  await page.waitForTimeout(500);

  // 5. Account merge — Savings folds into Bank (same currency; opening recomputed
  //    so the combined balance is preserved exactly).
  await page.goto('/accounts');
  await waitForDB(page);
  await page.getByRole('button', { name: /Savings/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Edit account' })).toBeVisible();
  await page.getByText('Merge into another account').click();
  await selectCombobox(page, 'Move everything into', 'Bank');
  await page.getByRole('button', { name: /Merge & delete/ }).click();
  await page.getByRole('button', { name: 'Yes, merge & delete' }).click();
  await page.waitForTimeout(500);

  // 6. A recurring rule, future-dated so it round-trips as a row without ever
  //    materialising a transaction (which would perturb the balances).
  await page.goto('/settings');
  await waitForDB(page);
  await page.getByRole('button', { name: '+ New rule' }).click();
  await expect(page.getByRole('heading', { name: 'New recurring rule' })).toBeVisible();
  const ruleModal = page.locator('.fixed');
  await selectCombobox(ruleModal, 'Account', 'Cash');
  await selectCombobox(ruleModal, 'Category', 'Subscriptions');
  await ruleModal.getByLabel('Amount').fill('99');
  await ruleModal.getByRole('textbox', { name: 'Start date' }).fill('2099-01-01');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New recurring rule' })).not.toBeVisible();
}

test.describe('Restore — controlled correctness', () => {
  test('a full backup → restore reproduces every balance exactly', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await resetAndLoad(page, '/accounts');
    await waitForDB(page);

    await buildBook(page);

    // The book, as built, matches the hand-computed expectation.
    const before = await snapshot(page);
    expect(before).toMatchObject(EXPECTED);

    // Export a full backup.
    await page.goto('/settings');
    await waitForDB(page);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Full backup' }).click();
    const backupPath = testInfo.outputPath('controlled-backup.json');
    await (await downloadPromise).saveAs(backupPath);

    // Restore it (wipes + re-inserts with fresh ids, then reloads the page).
    await page.locator('input[type="file"][accept*="json"]').setInputFiles(backupPath);
    await expect(page.getByRole('heading', { name: 'Restore from backup' })).toBeVisible();
    await page.getByRole('button', { name: 'Replace my data' }).click();
    // Wait out the restore + closeDB/openDB durability barrier + reload.
    await page.waitForTimeout(3000);
    await waitForDB(page);

    // Every number is identical to before the round-trip — and still matches the
    // hand-computed expectation, so nothing silently drifted in a matching way.
    const after = await snapshot(page);
    expect(after).toMatchObject(EXPECTED);
    expect(after).toEqual(before);

    // And the app's own rendered balances (getAccountBalances / per-currency
    // totals) agree, in various accounts and globally.
    await page.goto('/accounts');
    await waitForDB(page);
    const main = page.locator('main');
    await expect(main.getByText('₹3,200.00').first()).toBeVisible(); // Cash
    await expect(main.getByText('₹21,900.00').first()).toBeVisible(); // Bank
    await expect(main.getByText('$501.20').first()).toBeVisible(); // Wallet
    await expect(main.getByText('€300.55').first()).toBeVisible(); // Euro
    // Savings is gone.
    await expect(page.getByRole('button', { name: /Savings/ })).toHaveCount(0);
  });
});
