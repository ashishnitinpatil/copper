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
  // A fresh database has no accounts. The root now shows the public Landing
  // page, so go straight to the onboarding Welcome flow and complete it
  // (creating the default "Cash" account) so <nav> renders.
  await page.goto('/welcome');
  await completeOnboarding(page);
  await page.goto(path);
  await page.waitForSelector('nav', { timeout: 10000 });
}

// Walks the two-step Welcome screen with deterministic defaults: INR currency
// (so amount assertions stay locale-independent across machines/CI) and the
// pre-filled "Cash" account.
async function completeOnboarding(page: Page) {
  // With Google configured, Welcome first asks to sign in or stay local.
  const local = page.getByRole('button', { name: 'Continue without an account' });
  const continueBtn = page.getByRole('button', { name: 'Continue', exact: true });
  await local.or(continueBtn).first().waitFor({ timeout: 10000 });
  if (await local.isVisible()) await local.click();
  await continueBtn.waitFor({ timeout: 10000 });
  // "Default currency" is a searchable Combobox (not a native <select>); pick INR
  // by its code so amount assertions stay locale-independent across machines/CI.
  await selectCombobox(page, 'Default currency', 'INR');
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
  // The dropdown is portalled to <body> (to escape the modal's clipping), so its
  // search input lives outside `scope`. It auto-focuses on open, so grab it at the
  // page level via :focus rather than scoping the placeholder query to the modal.
  const root: Page = 'goto' in scope ? scope : scope.page();
  const search = root.locator('input:focus');
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
