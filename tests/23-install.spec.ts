import { test, expect, type Page } from '@playwright/test';
import { resetAndLoad, waitForDB } from './helpers';

// Chrome only offers installing a real, served PWA; stand in for its offer.
async function offerInstall(page: Page, outcome: 'accepted' | 'dismissed') {
  await page.evaluate((outcome) => {
    const e = new Event('beforeinstallprompt') as Event & Record<string, unknown>;
    e.prompt = async () => {};
    e.userChoice = Promise.resolve({ outcome });
    window.dispatchEvent(e);
  }, outcome);
}

test.describe('Install', () => {
  test('dismissing the notice keeps the offer in Settings', async ({ page }) => {
    await resetAndLoad(page, '/settings#install');
    await waitForDB(page);
    // Nothing to offer on a desktop browser that can't install.
    await expect(page.getByRole('heading', { name: 'Install Copper' })).toHaveCount(0);

    await offerInstall(page, 'accepted');
    await expect(page.getByText('Install this app')).toBeVisible();
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByText('Install this app')).toHaveCount(0);

    await expect(page.getByRole('heading', { name: 'Install Copper' })).toBeVisible();
    await page.getByRole('button', { name: 'Install', exact: true }).click();
    // Installed: nothing left to offer.
    await expect(page.getByRole('heading', { name: 'Install Copper' })).toHaveCount(0);
  });
});
