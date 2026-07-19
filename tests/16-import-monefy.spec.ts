import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resetAndLoad, waitForDB } from './helpers';

const SAMPLE_CSV = fileURLToPath(new URL('./fixtures/monefy-sample.csv', import.meta.url));

test.describe('Monefy CSV import', () => {
  test('imports accounts, categories and transactions from a Monefy export', async ({ page }) => {
    await resetAndLoad(page, '/settings');
    await waitForDB(page);

    await page.getByRole('button', { name: 'Import Monefy CSV' }).click();
    await expect(page.getByRole('heading', { name: 'Import from Monefy' })).toBeVisible();

    // The file input is hidden behind the drop-zone label; set it directly.
    await page.locator('input[type="file"][accept*="csv"]').setInputFiles(SAMPLE_CSV);

    // Step 2 shows a summary + account mapping; "Delete all current data first" is
    // checked by default. Wait for it, then import.
    await expect(page.getByText('Delete all current data first')).toBeVisible();
    // Scope to the modal — a top-level "Import" nav tab also matches by name.
    await page
      .getByLabel('Import from Monefy')
      .getByRole('button', { name: 'Import', exact: true })
      .click();

    // Success summary confirms the import landed.
    await expect(page.getByText(/Imported .*transactions/)).toBeVisible();

    // The imported data is queryable in the app.
    await page.goto('/transactions');
    await waitForDB(page);
    await expect(page.locator('main li', { hasText: 'Groceries' }).first()).toBeVisible();
    await expect(page.locator('main').getByText('₹250.00').first()).toBeVisible();
    await expect(page.locator('main li', { hasText: 'Salary' }).first()).toBeVisible();
  });
});
