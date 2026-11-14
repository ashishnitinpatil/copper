// The app's pages, each in its own file so starting the app reads less code.
// The router loads one when it's opened; preloadPages fetches the rest just
// after the app appears, so moving between pages is as quick as before.

import type { DB } from '@/db/wasm';

export const pages = {
  Dashboard: () => import('./Dashboard').then((m) => ({ Component: m.Dashboard })),
  QuickEntry: () => import('./QuickEntry').then((m) => ({ Component: m.QuickEntry })),
  AddSeveral: () => import('./AddSeveral').then((m) => ({ Component: m.AddSeveral })),
  Transactions: () => import('./Transactions').then((m) => ({ Component: m.Transactions })),
  Reports: () => import('./Reports').then((m) => ({ Component: m.Reports })),
  Cashflow: () => import('./Cashflow').then((m) => ({ Component: m.Cashflow })),
  SqlConsole: () => import('./SqlConsole').then((m) => ({ Component: m.SqlConsole })),
  Accounts: () => import('./Accounts').then((m) => ({ Component: m.Accounts })),
  Categories: () => import('./Categories').then((m) => ({ Component: m.Categories })),
  Budgets: () => import('./Budgets').then((m) => ({ Component: m.Budgets })),
  Tags: () => import('./Tags').then((m) => ({ Component: m.Tags })),
  Review: () => import('./Review').then((m) => ({ Component: m.Review })),
  Activity: () => import('./Activity').then((m) => ({ Component: m.Activity })),
  Settings: () => import('./Settings').then((m) => ({ Component: m.Settings })),
};

let preloaded = false;
/** Also reads the Add page's lists, the page opened most, so it opens ready. */
export function preloadPages(db: DB) {
  if (preloaded) return;
  preloaded = true;
  const run = () => {
    Object.values(pages).forEach((load) => void load().catch(() => {}));
    void import('./QuickEntry').then((m) => m.warmAddPage(db)).catch(() => {});
  };
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 1500 });
  else setTimeout(run, 300);
}
