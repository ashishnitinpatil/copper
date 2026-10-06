import { test, expect } from '@playwright/test';
import { resetAndLoad } from './helpers';

// Nothing on a phone-width screen may scroll sideways. Catches content that
// won't shrink (non-wrapping button rows) and hidden-but-laid-out popovers.
const ROUTES = ['/', '/welcome', '/dashboard', '/add', '/transactions', '/reports', '/cashflow',
  '/accounts', '/categories', '/budgets', '/tags', '/review', '/activity', '/settings', '/sql'];

test('no horizontal scroll at 360px', async ({ page }) => {
  test.setTimeout(90000);
  await resetAndLoad(page);
  await page.setViewportSize({ width: 360, height: 740 });
  for (const route of ROUTES) {
    await page.goto(route);
    await page.waitForTimeout(800);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, route).toBeLessThanOrEqual(360);
  }
});
