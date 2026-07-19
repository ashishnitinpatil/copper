# Expense Tracker

A local-first, offline-capable PWA for personal expense tracking. All data stays in the browser via SQLite-WASM — no server stores your financial data. Optional Google Drive backup for multi-device sync.

## Features (V1)

### Core
- **Accounts** — cash, bank, credit card, wallet, loan. Each with native currency and opening balance. Credit cards track statement day, due day, and pay-from account.
- **Categories** — nested tree (expense & income), with icons and colors. 16 defaults seeded on first run.
- **Quick Entry** — Monefy-style: amount keypad + circular category grid. Tap a category to save. Desktop keyboard support.
- **Transactions** — filtered list grouped by date. Edit, delete, search. Transfers shown as read-only pairs.
- **Transfers** — between two accounts, creates paired debit/credit rows so per-account balances stay correct.

### Budgets & Recurring
- **Monthly Budgets** — per-category caps with progress bars. Over-budget warnings on dashboard.
- **Recurring Rules** — RRULE-based (daily, weekly, biweekly, monthly, quarterly, yearly). Due transactions materialize automatically on app open.

### Analytics
- **Reports** — spending by category with percentage bars, monthly expense/income/net trend table.
- **SQL Console** — read-only SQLite playground. Example queries, CSV export, Cmd+Enter to run.

### Credit Cards & Cashflow
- **Credit Card Statement Engine** — calculates statement balance per billing cycle, tracks due dates, warns when past due.
- **Cashflow Forecast** — projects bank/cash balances over 30/60/90 days combining: current balance + scheduled recurring transactions + credit card due dates. Highlights days projected to go negative.

### Review Queue
- **Duplicate Detection** — scans for transactions with same amount, account, and date (±1 day). Side-by-side comparison with keep/delete resolution.
- **Anomaly Detection** — flags future-dated entries, missing categories, and outlier amounts (>3σ from 90-day rolling mean).

### Sync, Auth & Onboarding
- **Onboarding** — first-run Welcome flow seeds a starting account and default currency before the main app is shown.
- **Google Drive Sync** — no central server. Each device exports `crsql_changes()` deltas to a shared Drive folder and pulls peers' changesets. Auto-syncs on an interval, on reconnect, and on tab focus; manual sync available.
- **Sign-in** — Google OAuth (required for Drive) and Sign in with Apple (identity only). App stays fully usable signed-out in local-only mode.
- **Monefy CSV Import** — load a Monefy export to seed or replace your book.
- **PWA install prompts** — installable, offline-capable via a Workbox service worker.

### Dashboard
- Account balances overview with links
- Over-budget alerts
- Recent transactions
- Budget progress bars

## Architecture

```
Browser (PWA)
├── React 18 + TypeScript + Tailwind CSS
├── React Router v6 (data router)
├── cr-sqlite (CRDT-enabled SQLite via WASM)
│   └── persisted in IndexedDB (IDBBatchAtomicVFS)
├── Reactive queries via db.onUpdate() subscription
└── Vite + vite-plugin-pwa (Workbox service worker)
```

**Key design decisions:**
- All money stored as signed integer minor units (paise/cents) — no float drift
- TEXT UUID primary keys (cr-sqlite CRRs cannot use rowid PKs)
- NOT NULL columns have DEFAULT values (cr-sqlite migration safety)
- No SQL foreign keys (cr-sqlite can't replicate FKs across diverging peers)
- Per-account native currency, no cross-currency conversion
- **`meta` is intentionally _not_ a CRR — it is device-local.** It holds the
  onboarding flag, the connected Drive folder id, and per-device sync watermarks;
  replicating it would leak one device's sync cursor onto another. Corollary:
  anything that must travel between devices has to live in a CRR table, not in
  `meta`. This is why a "start fresh" folder join must set `onboarded` on the
  joining device locally — the flag cannot arrive over sync.

**Gotcha — no COOP/COEP cross-origin-isolation headers.** The Google Drive
Picker ("Connect a shared folder") embeds `docs.google.com` in an iframe that
needs the user's Google cookies to authenticate. Setting
`Cross-Origin-Embedder-Policy` (even `credentialless`) makes Chrome load that
iframe _without_ cookies, so it fails with **"docs.google.com refused to
connect"** (the picker document shows `(blocked)` in the Network panel). Nothing
here uses `SharedArrayBuffer`/`Atomics` (the DB is IndexedDB-backed, not OPFS),
so cross-origin isolation buys us nothing — **do not add COOP/COEP** to the dev
server or the hosting layer, or the Picker breaks.

## Data Model

Seven tables, all registered as cr-sqlite CRRs for multi-writer support:

| Table | Purpose |
|---|---|
| `accounts` | Cash, bank, credit card accounts with currency and balance |
| `categories` | Nested expense/income categories with icons |
| `transactions` | All entries — expenses, income, transfers (paired rows) |
| `recurring_rules` | RRULE-based auto-repeating transaction templates |
| `budgets` | Monthly per-category spending caps |
| `review_flags` | Duplicate/anomaly flags with status tracking |
| `meta` | Key-value store for schema version, device ID, etc. |

## Getting Started

```bash
npm install
npm run dev          # starts Vite dev server at localhost:5173
```

Requires Chrome/Edge (SharedArrayBuffer support for WASM). The dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` headers.

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Preview production build |
| `npm run typecheck` | TypeScript type checking |
| `npm test` | Run Vitest unit tests (lib helpers) |
| `npm run test:e2e` | Run Playwright smoke tests (requires Chromium) |
| `npm run test:e2e:ui` | Playwright UI mode |

## Testing

### Unit Tests (Vitest)

Tests pure helper and query logic (51 tests across 4 files):

- **lib/money.test.ts** — minor-unit conversion, formatting, parsing, currency lookup
- **lib/dates.test.ts** — date string formatting/parsing, relative dates, month boundaries
- **db/queries/categories.test.ts** — category tree/query helpers
- **features/import/parseMonefy.test.ts** — Monefy CSV parsing

Run: `npm test`

### E2E Smoke Tests (Playwright)

Located in `tests/`. Each test file clears IndexedDB before running to get a fresh database, then `resetAndLoad` (`tests/helpers.ts`) completes the Welcome onboarding flow (selecting INR and the default "Cash" account) so the main shell renders. Tests exercise the real cr-sqlite WASM in a headless Chromium browser.

| File | Coverage |
|---|---|
| `01-app-boots` | Dashboard loads, seeds default data, navigation works |
| `02-accounts` | Create bank/credit card accounts, edit, archive, main account promotion |
| `03-categories` | Seeded data visible, create expense/income/subcategories |
| `04-quick-entry` | Keypad input, expense/income modes, backspace, transaction saved |
| `05-transactions` | List, filter by category, edit amount, delete |
| `06-transfers` | Transfer between accounts, balance updates correctly |
| `07-budgets` | Create budget, progress display, over-budget warning |
| `08-sql-console` | Run queries, example buttons, blocks non-SELECT, shows errors |
| `09-dashboard` | Account balances, recent transactions, balance after expense |
| `10-reports` | Category breakdown, monthly trend table |

Run: `npm run test:e2e`

## Project Structure

```
src/
├── app/              # Pages: Dashboard, QuickEntry, Transactions, etc.
├── components/ui/    # Shared UI: Button, Input, Select, Modal, Card
├── db/
│   ├── client.ts     # DB singleton: open, migrate, seed, materialize recurring
│   ├── schema.ts     # SQL schema (CREATE TABLE + crsql_as_crr)
│   ├── seed.ts       # Default categories and Cash account
│   ├── DBProvider.tsx # React context with useDB() / useSiteId() hooks
│   ├── useQuery.ts   # Reactive query hook (subscribes to cr-sqlite updates)
│   ├── types.ts      # TypeScript interfaces for all tables
│   └── queries/      # Typed query helpers per table
├── features/
│   └── creditCards/   # Statement engine (cycle calc, due dates)
├── lib/
│   ├── money.ts      # Minor-unit arithmetic + formatting
│   └── dates.ts      # Date string helpers
tests/                # Playwright e2e smoke tests
```

## Not Yet Implemented

- Receipt photo attachments
- Full-text search (transactions list currently does `LIKE`-based filtering only)
- Command palette / keyboard shortcuts
- Cashflow forecast for accounts with balances but no recurring rules (currently hidden — see code)
