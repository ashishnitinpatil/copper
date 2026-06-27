import { test, expect, type Page } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

async function addExpense(page: Page, digits: string, category: RegExp) {
  await page.goto('/add');
  await waitForDB(page);
  for (const d of digits) {
    await page.getByRole('button', { name: d, exact: true }).click();
  }
  await page.getByRole('button', { name: category }).click();
  await page.waitForTimeout(800);
}

test.describe('Settings — appearance & data', () => {
  test('switching theme persists the choice', async ({ page }) => {
    await resetAndLoad(page, '/settings');
    await waitForDB(page);

    // Appearance tiles are buttons; the active one shows an "Active" badge.
    const slate = page.getByRole('button').filter({ hasText: 'Slate' });
    await slate.click();
    await expect(slate.filter({ hasText: 'Active' })).toBeVisible();

    const stored = await page.evaluate(() => localStorage.getItem('et-theme'));
    expect(stored).toBe('slate');
  });

  test('full backup round-trip restores the snapshot and drops later edits', async ({
    page,
  }, testInfo) => {
    await resetAndLoad(page, '/dashboard');
    await waitForDB(page);

    // Data that should survive in the backup.
    await addExpense(page, '999', /Groceries/);

    // Download a full backup.
    await page.goto('/settings');
    await waitForDB(page);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Full backup' }).click();
    const download = await downloadPromise;
    const backupPath = testInfo.outputPath('backup.json');
    await download.saveAs(backupPath);

    // Add a second expense *after* the backup — it must NOT survive a restore.
    await addExpense(page, '222', /Transport/);
    await page.goto('/transactions');
    await waitForDB(page);
    await expect(page.locator('main').getByText('₹999.00')).toBeVisible();
    await expect(page.locator('main').getByText('₹222.00')).toBeVisible();

    // Restore the backup (replaces all current data, then reloads the page).
    await page.goto('/settings');
    await waitForDB(page);
    await page.locator('input[type="file"][accept*="json"]').setInputFiles(backupPath);
    await expect(page.getByRole('heading', { name: 'Restore from backup' })).toBeVisible();
    await page.getByRole('button', { name: 'Replace my data' }).click();

    // After the reload, the snapshot is back: the pre-backup expense is present,
    // the post-backup one is gone.
    await page.waitForTimeout(2000);
    await page.goto('/transactions');
    await waitForDB(page);
    // After restore ₹999.00 is the only entry, so it shows as both the row and the
    // day subtotal — first() is enough to prove it's back.
    await expect(page.locator('main').getByText('₹999.00').first()).toBeVisible();
    await expect(page.locator('main').getByText('₹222.00')).toHaveCount(0);
  });
});
