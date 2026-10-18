<p align="center">
  <img src="public/icon.svg" alt="Copper" width="96" height="96">
</p>

<h1 align="center">Copper</h1>

<p align="center">
  A local-first personal finance tracker — on your own, or shared with a partner.<br>
  Your book lives in your browser and syncs privately through your own Google Drive.
</p>

<p align="center">
  <a href="https://copper.ashishnitinpatil.com"><strong>Open Copper →</strong></a>
</p>

---

Copper has no backend. Everything you enter is stored in the browser (SQLite
compiled to WebAssembly). Turn on sync and Copper keeps one shared file in your
Google Drive; partners each sign in with their own Google account and their
changes merge automatically. No account to create, no server holding your
money data, no analytics.

## What it does

- **Quick entry** — type an amount, tap a category. Expenses, income and
  transfers (including between currencies), with a "repeats" option right on
  the Add screen.
- **Accounts** — cash, bank, credit cards, wallets and loans, each in its own
  currency; balances are as of today, so scheduled entries don't count early.
- **Recurring entries** — rent, salary, EMIs; added automatically on their dates.
- **Budgets, tags and categories** — monthly caps per category, free-form tags,
  merge categories or accounts.
- **Reports** — spending by category (donut, any month or custom dates) and a
  monthly income/expense/net trend.
- **Cashflow** — a forecast of where your balances are heading, plus a trend view.
- **Search** — by amount or text, tolerant of typos.
- **Review** — flags likely duplicates and unusual entries.
- **Activity** — a plain-language history of who changed what, on every device.
- **Undo** — Ctrl/⌘+Z reverses your last change; press `?` for shortcuts.
- **Backups** — automatic copies in Drive, plus downloadable backup files
  (optionally password-protected).
- **Import from Monefy** — bring your existing history over from a CSV export.
- **Installable** — a PWA that works offline.

## Privacy in one paragraph

Your data stays on your device unless you turn on sync. Signing in with Google
is optional and asks only for your basic profile and access to the Drive files
Copper itself creates (`drive.file`) — Copper can't see anything else in your
Drive. See the full [privacy policy](https://copper.ashishnitinpatil.com/privacy)
and [terms](https://copper.ashishnitinpatil.com/terms).

## Running it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Copper works without any configuration in local-only mode. To enable Google
sign-in and Drive sync, copy `.env.example` to `.env.local` and fill in:

| Variable | What it is |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | OAuth 2.0 Web client ID. Add `http://localhost:5173` (and your production origin) to its authorized JavaScript origins. |
| `VITE_GOOGLE_API_KEY` | API key restricted to the Google Picker API — used to connect a book a partner shared with you. |
| `VITE_GOOGLE_APP_ID` | The Google Cloud project number. |

These are public client-side values; they're compiled into the build.

## Scripts

| Script | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run deploy` | Build and upload to Cloudflare (see `wrangler.jsonc`) |
| `npm run typecheck` | TypeScript only |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright, real WASM database in Chromium) |

## How it works

```
Browser (PWA)
├── React 18 · TypeScript · Tailwind CSS · React Router
├── cr-sqlite — SQLite + CRDTs, compiled to WASM
│   └── persisted in IndexedDB
├── reactive queries (re-run on db.onUpdate)
└── Workbox service worker for offline use

Google Drive (yours)
└── Copper Expense Tracker/
    ├── Copper-Expense-Tracker-shared-book.json.gz   ← the shared book
    └── Backups/
```

**Sync.** The shared book is the full cr-sqlite change set, gzipped. A sync
checks the file's version with one metadata call, downloads and merges only when
someone else changed it, and uploads only when this device has something new.
Because every table is a CRDT ("CRR"), two people editing offline merge cleanly.
Syncs run on open, when leaving the app, periodically, on reconnect and on demand.

**Design rules worth knowing before you change the schema**

- Money is stored as signed integer minor units (cents/paise) — never floats.
- Primary keys are TEXT UUIDs; cr-sqlite CRRs can't use rowid keys.
- `NOT NULL` columns must have defaults, and there are no SQL foreign keys —
  both are cr-sqlite constraints for merging diverged copies.
- Every local create/edit/delete is written to `change_log`, which powers
  Activity and Undo.
- **`meta` is deliberately device-local (not a CRR).** It holds onboarding state,
  the shared book's file id and this device's sync cursor. Anything that must
  reach other devices belongs in a CRR table instead.
- **Never add COOP/COEP headers** (dev server or hosting). They make Chrome load
  the Google Picker iframe without cookies ("docs.google.com refused to
  connect"). Copper doesn't use `SharedArrayBuffer`, so cross-origin isolation
  buys nothing.

**Tables:** `accounts`, `categories`, `transactions` (transfers are paired rows),
`recurring_rules`, `budgets`, `tags`, `transaction_tags`, `review_flags`,
`change_log`, `devices` — all CRRs — plus the device-local `meta`.

## Project layout

```
src/
├── app/          pages and app shell
├── components/   shared UI and charts
├── db/           schema, client, reactive query hook, typed queries, change log
├── features/     activity, import, recurring, undo, credit cards …
├── sync/         Google Drive sync, backups, sharing
├── auth/         Google sign-in
└── lib/          money, dates, currency conversion helpers
tests/            Playwright browser tests
```

## License

[MIT](LICENSE) © 2026 Ashish Patil. Use it, change it, share it or sell it —
just keep the copyright notice and licence with any copy you pass on.
