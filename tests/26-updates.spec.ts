import { test, expect, type Page } from '@playwright/test';
import { APP_DB, resetAndLoad, waitForDB } from './helpers';

// Every change a device makes is something each other device merges at its
// next sync, and a few thousand of them put up the "catching up" screen. An
// update or a plain reload makes no change of its own, so neither may write
// anything to sync.

/** The database's version: every change made here raises it. */
async function dbVersion(page: Page): Promise<number> {
  return page.evaluate(async (appDb) => {
    const db = await eval(appDb)();
    return (await db.execA('SELECT crsql_db_version()'))[0][0];
  }, APP_DB);
}

/** Changes made since `version`, by table. */
async function changesSince(page: Page, version: number): Promise<Record<string, number>> {
  return page.evaluate(
    async ([appDb, v]) => {
      const db = await eval(appDb as string)();
      return Object.fromEntries(
        await db.execA('SELECT "table", count(*) FROM crsql_changes WHERE db_version > ? GROUP BY 1', [v]),
      );
    },
    [APP_DB, version] as const,
  );
}

test.describe('Updates and reloads', () => {
  test('a database update adds no changes to sync', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const { getSQLite } = await import('/src/db/wasm.ts');
      const { SCHEMA_NAME, SCHEMA_SQL } = await import('/src/db/schema.ts');
      // The previous release, as if each table's newest column were just
      // added: each table without its last plain nullable column.
      const previous = SCHEMA_SQL.replace(/CREATE TABLE IF NOT EXISTS[^;]+;/g, (table) => {
        const lines = table.split('\n');
        const i = lines.findLastIndex((l) => /^\s+\w+\s+(TEXT|INTEGER|REAL),?$/.test(l));
        if (i >= 0) lines.splice(i, 1);
        return lines.join('\n').replace(/,(\s*\);)$/, '$1');
      });
      const sqlite = await getSQLite();
      const db = await sqlite.open(`update-test-${Date.now()}.db`);
      await db.automigrateTo(SCHEMA_NAME, previous);
      // Rows in every synced table, filled in from the column defaults.
      const tables = (await db.execA<[string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%__crsql_clock'"))
        .map(([n]) => n.replace(/__crsql_clock$/, ''));
      for (const table of tables) {
        const keys = (await db.execO<{ name: string; pk: number }>(`PRAGMA table_info("${table}")`)).filter((c) => c.pk > 0);
        for (let n = 0; n < 50; n++) {
          await db.exec(
            `INSERT INTO "${table}" (${keys.map((k) => `"${k.name}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
            keys.map((k) => `${table}-${k.name}-${n}`),
          );
        }
      }
      const count = async () => (await db.execA<[number, number]>('SELECT count(*), crsql_db_version() FROM crsql_changes'))[0];
      const before = await count();
      await db.automigrateTo(SCHEMA_NAME, SCHEMA_SQL);
      const after = await count();
      await db.close();
      return { tables: tables.length, removed: SCHEMA_SQL.length - previous.length, before, after };
    });
    // It really was an update, over real rows.
    expect(result.tables).toBeGreaterThan(5);
    expect(result.removed).toBeGreaterThan(0);
    expect(result.before[0]).toBeGreaterThan(0);
    expect(result.after).toEqual(result.before);
  });

  test('reloading the app adds no changes to sync', async ({ page }) => {
    await resetAndLoad(page, '/accounts');
    // A book with a loan paid automatically and a recurring entry: the kinds
    // of entry the app adds by itself on opening.
    await page.evaluate(async (appDb) => {
      const db = await eval(appDb)();
      const [[cash]] = await db.execA<[string]>("SELECT id FROM accounts WHERE name = 'Cash'");
      const today = new Date().toISOString().slice(0, 10);
      await db.exec(
        `INSERT INTO accounts (id, name, type, currency, opening_balance_minor, due_day, pay_from_account_id,
           loan_principal_minor, loan_rate_bp, loan_interest_method, loan_term_months, loan_payment_minor, loan_autopay_from, starts_on, created_at)
         VALUES ('loan-1', 'Car loan', 'loan', 'INR', -10000000, 1, ?, 10000000, 1200, 'reducing', 12, 888488, '2026-01-01', '2026-01-01', ?)`,
        [cash, today],
      );
      for (let n = 0; n < 30; n++) {
        await db.exec(
          "INSERT INTO transactions (id, account_id, amount_minor, kind, occurred_on, created_at) VALUES (?, ?, -1000, 'expense', ?, ?)",
          [`t-${n}`, cash, today, today],
        );
      }
    }, APP_DB);
    // Opening once adds the loan's payments that are due; after that a reload has nothing to do.
    await page.reload();
    await waitForDB(page);
    await page.waitForSelector('nav');
    const before = await dbVersion(page);
    expect(await changesSince(page, 0)).toMatchObject({ accounts: expect.any(Number), transactions: expect.any(Number) });

    for (let i = 0; i < 2; i++) {
      await page.reload();
      await waitForDB(page);
      await page.waitForSelector('nav');
    }
    expect(await changesSince(page, before)).toEqual({});
  });
});
