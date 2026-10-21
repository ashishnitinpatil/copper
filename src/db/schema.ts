/**
 * Schema for the local-first expense tracker, declared as a single string
 * for cr-sqlite's `automigrateTo`. CRR registration via `crsql_as_crr`
 * happens after the table definitions.
 *
 * Notes:
 *  - All primary keys are TEXT UUIDs (cr-sqlite CRRs cannot use rowid PKs).
 *  - Money is stored in signed integer minor units (paise / cents).
 *  - Dates are ISO-8601 strings (YYYY-MM-DD for calendar dates, full ISO
 *    timestamps for `created_at` / `resolved_at`).
 *  - cr-sqlite requires every NOT NULL column to declare a DEFAULT so that
 *    migrations across diverging peers stay safe — application code always
 *    supplies real values, the defaults are just placeholders.
 *  - FK constraints are intentionally omitted: cr-sqlite cannot replicate
 *    them cleanly across diverging peers; integrity is enforced in app code.
 */

export const SCHEMA_NAME = 'expense_tracker_v1';

export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS accounts (
  id                    TEXT NOT NULL PRIMARY KEY DEFAULT '',
  name                  TEXT NOT NULL DEFAULT '',
  type                  TEXT NOT NULL DEFAULT 'cash',
  currency              TEXT NOT NULL DEFAULT 'INR',
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  is_main               INTEGER NOT NULL DEFAULT 0,
  include_in_total      INTEGER NOT NULL DEFAULT 1,
  credit_limit_minor    INTEGER,
  statement_day         INTEGER,
  due_day               INTEGER,
  pay_from_account_id   TEXT,
  color                 TEXT,
  icon                  TEXT,
  starts_on             TEXT NOT NULL DEFAULT '',
  archived_at           TEXT,
  created_at            TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT NOT NULL PRIMARY KEY DEFAULT '',
  parent_id   TEXT,
  name        TEXT NOT NULL DEFAULT '',
  kind        TEXT NOT NULL DEFAULT 'expense',
  icon        TEXT,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS transactions (
  id                TEXT NOT NULL PRIMARY KEY DEFAULT '',
  account_id        TEXT NOT NULL DEFAULT '',
  category_id       TEXT,
  amount_minor      INTEGER NOT NULL DEFAULT 0,
  kind              TEXT NOT NULL DEFAULT 'expense',
  transfer_peer_id  TEXT,
  occurred_on       TEXT NOT NULL DEFAULT '',
  note              TEXT,
  recurring_id      TEXT,
  created_at        TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(occurred_on);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_tx_recurring ON transactions(recurring_id);

CREATE TABLE IF NOT EXISTS recurring_rules (
  id            TEXT NOT NULL PRIMARY KEY DEFAULT '',
  template_json TEXT NOT NULL DEFAULT '',
  rrule         TEXT NOT NULL DEFAULT '',
  next_run_on   TEXT NOT NULL DEFAULT '',
  last_run_on   TEXT,
  archived_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS budgets (
  id            TEXT NOT NULL PRIMARY KEY DEFAULT '',
  category_id   TEXT NOT NULL DEFAULT '',
  period        TEXT NOT NULL DEFAULT 'monthly',
  amount_minor  INTEGER NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'INR',
  starts_on     TEXT NOT NULL DEFAULT '',
  archived_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tags (
  id           TEXT NOT NULL PRIMARY KEY DEFAULT '',
  name         TEXT NOT NULL DEFAULT '',
  color        TEXT,
  icon         TEXT,
  starts_on    TEXT,
  ends_on      TEXT,
  budget_minor INTEGER,
  currency     TEXT NOT NULL DEFAULT 'INR',
  archived_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT ''
);

-- A transaction may carry many tags and a tag many transactions. The composite
-- PK makes the same link idempotent across diverging peers (no rowid).
CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id TEXT NOT NULL DEFAULT '',
  tag_id         TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_txtags_tag ON transaction_tags(tag_id);

CREATE TABLE IF NOT EXISTS review_flags (
  id                     TEXT NOT NULL PRIMARY KEY DEFAULT '',
  transaction_id         TEXT NOT NULL DEFAULT '',
  related_transaction_id TEXT,
  reason                 TEXT NOT NULL DEFAULT 'duplicate',
  score                  REAL NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'open',
  created_at             TEXT NOT NULL DEFAULT '',
  resolved_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_flags_status ON review_flags(status);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT NOT NULL PRIMARY KEY DEFAULT '',
  value TEXT NOT NULL DEFAULT ''
);

-- Append-only audit trail: one row per local add/edit/delete, synced so every
-- device sees who changed what. \`entity\`/\`entity_id\` point (polymorphically,
-- no FK) at the changed row; \`diff\` is a JSON snapshot — the full row on
-- insert, {field:{old,new}} on update, the last-known row on delete — so a
-- history can be read or a change reconstructed. \`site_id\` is the originating
-- device (joins to \`devices\`); \`batch_id\`/\`source\` group bulk operations
-- (an import, a multi-select delete) so the UI can collapse them.
CREATE TABLE IF NOT EXISTS change_log (
  id         TEXT NOT NULL PRIMARY KEY DEFAULT '',
  entity     TEXT NOT NULL DEFAULT '',
  entity_id  TEXT NOT NULL DEFAULT '',
  op         TEXT NOT NULL DEFAULT '',
  site_id    TEXT NOT NULL DEFAULT '',
  at         TEXT NOT NULL DEFAULT '',
  diff       TEXT NOT NULL DEFAULT '',
  batch_id   TEXT,
  source     TEXT
);

CREATE INDEX IF NOT EXISTS idx_changelog_entity ON change_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_changelog_at ON change_log(at);
CREATE INDEX IF NOT EXISTS idx_changelog_batch ON change_log(batch_id);
-- The Activity page summarises a batch by counting its rows and previews its
-- first few; these keep both off the (large) diff column.
CREATE INDEX IF NOT EXISTS idx_changelog_batch_kind ON change_log(batch_id, entity, op);
CREATE INDEX IF NOT EXISTS idx_changelog_batch_at ON change_log(batch_id, at);

-- Registry of every device that has touched the book, so the audit trail can
-- show a friendly name instead of a raw site id. \`name\` is user-editable and
-- syncs; \`last_seen\` is refreshed each boot. \`retired_at\` is set when a reset
-- gave the device a new identity: the old row stays so past activity keeps its
-- name, but it no longer counts as one of the book's devices. \`person\` is the
-- first name of the Google account last signed in on it, so the log can say
-- "Ashish added…" rather than naming a device.
CREATE TABLE IF NOT EXISTS devices (
  site_id    TEXT NOT NULL PRIMARY KEY DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  last_seen  TEXT NOT NULL DEFAULT '',
  retired_at TEXT NOT NULL DEFAULT '',
  person     TEXT NOT NULL DEFAULT ''
);

-- Themes people made themselves (two colours; the rest is derived in
-- lib/customTheme). They travel with the book so every device can pick them;
-- which theme a device shows stays in that device's localStorage.
CREATE TABLE IF NOT EXISTS themes (
  id         TEXT NOT NULL PRIMARY KEY DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  background TEXT NOT NULL DEFAULT '',
  accent     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

SELECT crsql_as_crr('accounts');
SELECT crsql_as_crr('categories');
SELECT crsql_as_crr('transactions');
SELECT crsql_as_crr('recurring_rules');
SELECT crsql_as_crr('budgets');
SELECT crsql_as_crr('tags');
SELECT crsql_as_crr('transaction_tags');
SELECT crsql_as_crr('review_flags');
SELECT crsql_as_crr('change_log');
SELECT crsql_as_crr('devices');
SELECT crsql_as_crr('themes');
`;
