import { test, expect, type Page } from '@playwright/test';
import { appSql, reloadAfterWrites, resetAndLoad, waitForDB } from './helpers';

// A device that's signed in and syncing (faked: a saved session, a book id,
// and Drive answering 404) gets two clear ways to erase.
async function syncedDevice(page: Page) {
  await page.context().route(/googleapis\.com/, (r) => r.fulfill({ status: 404, body: '{}' }));
  await resetAndLoad(page, '/settings');
  await page.evaluate(() => {
    localStorage.setItem('expense-tracker.auth.trust-device', '1');
    localStorage.setItem(
      'expense-tracker.auth.identities',
      JSON.stringify({
        google: {
          identity: { provider: 'google', sub: '1', email: 'me@example.com', name: 'Me' },
          accessToken: 'fake',
          expiresAt: Date.now() + 3_600_000,
          scopes: ['https://www.googleapis.com/auth/drive.file'],
        },
      }),
    );
  });
  await appSql(page, "INSERT INTO meta (key, value) VALUES ('sync.book_file_id', 'book-1') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  await reloadAfterWrites(page);
  await waitForDB(page);
  await page.getByRole('tab', { name: 'Your data' }).click();
  await page.getByRole('button', { name: 'Erase…' }).click();
  return page.getByRole('dialog', { name: 'Erase this device' });
}

test('erase offers to stay signed in or to sign out for a fresh start', async ({ page }) => {
  const dialog = await syncedDevice(page);
  await expect(dialog.getByRole('button', { name: /Erase and reload my book/ })).toContainText('You stay signed in as me@example.com');
  await expect(dialog.getByRole('button', { name: /Sign out and erase/ })).toContainText('Starts completely fresh');

  await dialog.getByRole('button', { name: /Sign out and erase/ }).click();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => localStorage.getItem('expense-tracker.auth.identities') ?? '')).not.toContain('me@');
});

test('cancel leaves everything as it was', async ({ page }) => {
  const dialog = await syncedDevice(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('expense-tracker.auth.identities'))).toContain('me@');
});
