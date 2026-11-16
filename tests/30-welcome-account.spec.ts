import { test, expect } from '@playwright/test';

// Signed in with the wrong Google account on Welcome: there's a way back to
// pick another one. (A real Google sign-in can't run here, so the session is
// one Copper saved earlier, and Drive answers with a book for it.)
test('Welcome offers another account after signing in', async ({ page, context }) => {
  await context.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('expense-tracker.auth.trust-device', '1');
    localStorage.setItem(
      'expense-tracker.auth.identities',
      JSON.stringify({
        google: {
          identity: { provider: 'google', sub: '1', email: 'wrong@example.com', name: 'Wrong' },
          accessToken: 'fake',
          expiresAt: Date.now() + 3_600_000,
          scopes: ['https://www.googleapis.com/auth/drive.file'],
        },
      }),
    );
  });
  await context.route(/googleapis\.com/, (r) => r.fulfill({ status: 404, body: '{}' }));
  // Added last, so it's tried first (Playwright checks the newest route first).
  await context.route(/googleapis\.com\/drive\/v3\/files\?q=/, (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ files: [{ id: 'book-1', name: 'Copper-Expense-Tracker-book', mimeType: 'application/json' }] }),
    }),
  );

  await page.goto('/welcome');
  await expect(page.getByText('wrong@example.com')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load my book' })).toBeVisible();

  await page.getByRole('button', { name: 'Use another account' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(page.getByText('wrong@example.com')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('expense-tracker.auth.identities'))).not.toContain('wrong@');
});
