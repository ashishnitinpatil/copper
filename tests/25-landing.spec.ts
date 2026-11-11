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
  test('questions are answered on the page, and the guides open without the book', async ({ page }) => {
    await page.goto('/');
    const faq = page.getByRole('region', { name: 'Questions people ask' });
    await faq.getByText('Can my partner and I use it together?').click();
    await expect(faq.getByText(/each sign in with your own Google account/)).toBeVisible();
    // The same answers, as search engines read them.
    const data = JSON.parse((await page.locator('script[type="application/ld+json"]').last().textContent())!);
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity.length).toBeGreaterThanOrEqual(5);

    await faq.getByRole('link', { name: 'Copper for couples' }).click();
    await expect(page).toHaveURL(/\/for-couples$/);
    await expect(page).toHaveTitle('A shared expense tracker for couples · Copper');
    await page.getByRole('link', { name: 'Moving from Monefy' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Moving from Monefy');
    expect(await page.evaluate(() => indexedDB.databases().then((d) => d.length))).toBe(0);
  });
});
