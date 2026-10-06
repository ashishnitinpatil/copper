export type AccountType = 'cash' | 'bank' | 'credit_card' | 'wallet' | 'loan' | 'other';
export type CategoryKind = 'expense' | 'income';
export type TransactionKind = 'expense' | 'income' | 'transfer';
export type ReviewReason =
  | 'duplicate'
  | 'outlier'
  | 'future_dated'
  | 'stale'
  | 'empty_category'
  | 'category_spike';
export type ReviewStatus = 'open' | 'dismissed' | 'resolved';
export type BudgetPeriod = 'monthly';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  opening_balance_minor: number;
  is_main: number;
  include_in_total: number;
  credit_limit_minor: number | null;
  statement_day: number | null;
  due_day: number | null;
  pay_from_account_id: string | null;
  color: string | null;
  icon: string | null;
  starts_on: string;
  archived_at: string | null;
  created_at: string;
}

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  kind: CategoryKind;
  icon: string | null;
  color: string | null;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  account_id: string;
  category_id: string | null;
  amount_minor: number;
  kind: TransactionKind;
  transfer_peer_id: string | null;
  occurred_on: string;
  note: string | null;
  recurring_id: string | null;
  created_at: string;
}

export interface RecurringRule {
  id: string;
  template_json: string;
  rrule: string;
  next_run_on: string;
  last_run_on: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface Budget {
  id: string;
  category_id: string;
  period: BudgetPeriod;
  amount_minor: number;
  currency: string;
  starts_on: string;
  archived_at: string | null;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  /** Optional date range — a tag with a range presents as a trip/event. */
  starts_on: string | null;
  ends_on: string | null;
  /** Optional spending target, in `currency`. */
  budget_minor: number | null;
  currency: string;
  archived_at: string | null;
  created_at: string;
}

export interface ReviewFlag {
  id: string;
  transaction_id: string;
  related_transaction_id: string | null;
  reason: ReviewReason;
  score: number;
  status: ReviewStatus;
  created_at: string;
  resolved_at: string | null;
}

/** The kinds of records the audit trail tracks. */
export type ChangeEntity =
  | 'transaction'
  | 'account'
  | 'category'
  | 'tag'
  | 'budget'
  | 'recurring';
export type ChangeOp = 'insert' | 'update' | 'delete';

/** Parsed shape of `change_log.diff` (stored as JSON text). */
export type ChangeDiff =
  | { after: Record<string, unknown> }
  | { before: Record<string, unknown> }
  | { changes: Record<string, { old: unknown; new: unknown }> };

export interface ChangeLogEntry {
  id: string;
  entity: ChangeEntity;
  entity_id: string;
  op: ChangeOp;
  site_id: string;
  at: string;
  /** JSON-encoded `ChangeDiff`. */
  diff: string;
  batch_id: string | null;
  source: string | null;
}

export interface Device {
  site_id: string;
  name: string;
  last_seen: string;
  /** Set once a reset replaced this identity (see retireDevice). */
  retired_at: string;
}
