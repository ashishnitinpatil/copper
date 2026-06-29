import { test, expect } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

async function addExpense(page: import('@playwright/test').Page, amount: string, category: RegExp) {
  for (const ch of amount) {
    await page.getByRole('button', { name: ch, exact: true }).click();
  }
  await page.getByRole('button', { name: category }).click();
  await page.waitForTimeout(500);
}

test.describe('Activity log', () => {
  test.beforeEach(async ({ page }) => {
    await resetAndLoad(page, '/add');
    await waitForDB(page);

    // Create → edit → delete a transaction so every op writes a change_log row.
    await addExpense(page, '500', /Food & Dining/);

    await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
    await page.waitForTimeout(500);
    await page.locator('main li').getByText('Food & Dining').first().click();
    await page.getByLabel('Amount', { exact: true }).fill('600');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(500);

    await page.locator('main li').getByText('Food & Dining').first().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(500);
  });

  test('writes a change_log row for each create/update/delete', async ({ page }) => {
    await page.getByRole('link', { name: 'SQL', exact: true }).first().click();
    await waitForDB(page);

    await page
      .locator('textarea')
      .fill("SELECT op FROM change_log WHERE entity = 'transaction' ORDER BY op");
    await page.getByRole('button', { name: /Run/ }).click();
    await page.waitForTimeout(500);

    for (const op of ['insert', 'update', 'delete']) {
      await expect(page.locator('td').getByText(op, { exact: true }).first()).toBeVisible();
    }
  });

  test('records the originating device on each entry', async ({ page }) => {
    await page.getByRole('link', { name: 'SQL', exact: true }).first().click();
    await waitForDB(page);

    // site_id is non-null and a device registry row exists for it.
    await page
      .locator('textarea')
      .fill(
        'SELECT COUNT(*) AS n FROM change_log cl JOIN devices d ON d.site_id = cl.site_id',
      );
    await page.getByRole('button', { name: /Run/ }).click();
    await page.waitForTimeout(500);

    // At least the create/update/delete above are attributed to a known device.
    const cell = page.locator('td').first();
    await expect(cell).toBeVisible();
    expect(Number(await cell.innerText())).toBeGreaterThanOrEqual(3);
  });

  test('Activity page renders the change feed', async ({ page }) => {
    await page.getByRole('link', { name: 'Activity', exact: true }).first().click();
    await waitForDB(page);

    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expect(page.getByText('Added').first()).toBeVisible();
    await expect(page.getByText('Edited').first()).toBeVisible();
    await expect(page.getByText('Deleted').first()).toBeVisible();
    await expect(page.getByText(/Showing \d+ of \d+ changes/)).toBeVisible();
  });
});
