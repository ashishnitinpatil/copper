import { test, expect } from '@playwright/test';
import { resetAndLoad } from './helpers';

test.describe('Landing', () => {
  test('a first-time visitor sees it at once, without the book opening', async ({ page }) => {
    // Note whether the loading screen ever shows, however briefly.
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.body?.innerText.includes('Getting your data ready')) {
          sessionStorage.setItem('saw-loading', '1');
        }
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => sessionStorage.getItem('saw-loading'))).toBeNull();
    // Nothing was created on the device just by looking.
    expect(await page.evaluate(() => indexedDB.databases().then((d) => d.length))).toBe(0);

    // Privacy and back, still without the book.
    await page.getByRole('link', { name: 'Privacy' }).first().click();
    await expect(page).toHaveURL(/\/privacy$/);
    await page.getByRole('link', { name: 'Home' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('saw-loading'))).toBeNull();
  });

  test('someone who uses Copper here goes straight to their dashboard', async ({ page }) => {
    await resetAndLoad(page, '/dashboard');
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('nav').first()).toBeVisible();

    // From the app to Privacy (Settings links there) and back: the book stays open.
    await page.goto('/settings');
    await page.getByRole('link', { name: 'Privacy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });
});
