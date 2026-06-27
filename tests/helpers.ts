import { type Page, type Locator, expect } from '@playwright/test';

export async function resetAndLoad(page: Page, path = '/dashboard') {
  await page.goto('/');
  await page.evaluate(() => {
    const dbs = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]);
    return dbs.then((dbList: IDBDatabaseInfo[]) =>
      Promise.all(
        dbList.map(
          (db: IDBDatabaseInfo) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(db.name!);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            }),
        ),
      ),
    );
  });
  // A fresh database has no accounts, so the app shows the onboarding Welcome
  // flow instead of the main shell. Complete it (creating the default "Cash"
  // account) so <nav> renders, mirroring the pre-onboarding seeded state.
  await page.goto('/');
  await completeOnboarding(page);
  await page.goto(path);
  await page.waitForSelector('nav', { timeout: 10000 });
}

// Walks the two-step Welcome screen with deterministic defaults: INR currency
// (so amount assertions stay locale-independent across machines/CI) and the
// pre-filled "Cash" account.
async function completeOnboarding(page: Page) {
  const continueBtn = page.getByRole('button', { name: 'Continue' });
  await continueBtn.waitFor({ timeout: 10000 });
  await page.getByLabel('Default currency').selectOption('INR');
  await continueBtn.click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.waitForSelector('nav', { timeout: 10000 });
}

export async function waitForDB(page: Page) {
  await page.waitForFunction(
    () => !document.body.textContent?.includes('Opening local database'),
    { timeout: 10000 },
  );
}

// Selects an option from a custom <Combobox> (a button + searchable dropdown,
// not a native <select>). Opens it, filters by typing the option label, then
// presses Enter to choose the highlighted (first) match.
export async function selectCombobox(scope: Page | Locator, label: string, optionLabel: string) {
  await scope.getByLabel(label, { exact: true }).click();
  const search = scope.getByPlaceholder(/Search/);
  await search.fill(optionLabel);
  await search.press('Enter');
}

export async function navigateTo(page: Page, label: string) {
  await page.getByRole('link', { name: label }).first().click();
  await page.waitForTimeout(300);
}

export async function expectNoConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.waitForTimeout(500);
  const critical = errors.filter(
    (e) => !e.includes('React DevTools') && !e.includes('favicon'),
  );
  expect(critical).toEqual([]);
}
