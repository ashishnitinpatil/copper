import type { ChangeDiff, ChangeEntity, ChangeOp } from '@/db/types';
import { formatHumanDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';

/**
 * Turns audit-log rows into plain sentences — "added an expense of ₹500.00 in
 * Groceries", "moved ₹1,000.00 from HDFC to Cash" — so the Activity page reads
 * like a story of what people did, not a dump of changed columns. The actor
 * ("You", "Ashish") is prefixed by the page; these return the rest.
 */

type Row = Record<string, unknown>;

export interface Lookups {
  /** Every account, archived included, so old entries still resolve. */
  accounts: Map<string, { name: string; currency: string }>;
  categories: Map<string, string>;
  tags: Map<string, string>;
  defaultCurrency: string;
}

export interface FieldChange {
  label: string;
  from: string;
  to: string;
}

export interface Description {
  text: string;
  /** Secondary context: account · date · note. */
  detail: string | null;
  changes: FieldChange[];
}

/** The subset of an audit row the descriptions need. */
export interface DescribableEntry {
  entity: ChangeEntity;
  op: ChangeOp;
  diff: string;
  source: string | null;
  current: Row | null;
}

export interface DescribableGroup {
  source: string | null;
  total: number;
  counts: { entity: ChangeEntity; op: ChangeOp; n: number }[];
  entries: DescribableEntry[];
}

// Columns that never mean anything to a person reading the log.
const IGNORED = new Set(['id', 'created_at', 'sort_order', 'last_run_on', 'transfer_peer_id', 'recurring_id']);

const ACCOUNT_TYPE: Record<string, string> = {
  cash: 'Cash',
  bank: 'Bank',
  credit_card: 'Credit card',
  wallet: 'Wallet',
  loan: 'Loan',
  other: 'Other',
};

export function parseDiff(raw: string): ChangeDiff | null {
  try {
    return JSON.parse(raw) as ChangeDiff;
  } catch {
    return null;
  }
}

function changesOf(diff: ChangeDiff | null): Record<string, { old: unknown; new: unknown }> {
  return diff && 'changes' in diff ? diff.changes : {};
}

/** The record as this entry left it: the snapshot for adds/deletes, the live row plus the new values for edits. */
function subjectOf(entry: DescribableEntry): Row {
  const diff = parseDiff(entry.diff);
  if (diff && 'after' in diff) return diff.after;
  if (diff && 'before' in diff) return diff.before;
  const row: Row = { ...(entry.current ?? {}) };
  for (const [k, v] of Object.entries(changesOf(diff))) row[k] = v.new;
  return row;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);
const quoted = (s: string) => `“${s}”`;

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : many}`;
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function accountName(L: Lookups, id: unknown): string {
  return (typeof id === 'string' && L.accounts.get(id)?.name) || 'a deleted account';
}

function categoryName(L: Lookups, id: unknown): string | null {
  return typeof id === 'string' ? (L.categories.get(id) ?? null) : null;
}

function currencyOf(L: Lookups, accountId: unknown): string {
  return (typeof accountId === 'string' && L.accounts.get(accountId)?.currency) || L.defaultCurrency;
}

function money(minor: unknown, currency: string): string {
  return formatMoney(Math.abs(num(minor)), currency);
}

function date(v: unknown): string {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? formatHumanDate(s.slice(0, 10)) : s;
}

const yesNo = (v: unknown) => (num(v) ? 'Yes' : 'No');
const orNone = (s: string | null) => s || 'None';

// --- Transactions -----------------------------------------------------------

function txPhrase(L: Lookups, row: Row): string {
  if (row.amount_minor === undefined) return 'a transaction';
  const amount = money(row.amount_minor, currencyOf(L, row.account_id));
  const cat = categoryName(L, row.category_id);
  const inCat = cat ? ` in ${cat}` : '';
  if (row.kind === 'income') return `income of ${amount}${inCat}`;
  if (row.kind === 'transfer') {
    return num(row.amount_minor) < 0
      ? `a transfer of ${amount} out of ${accountName(L, row.account_id)}`
      : `a transfer of ${amount} into ${accountName(L, row.account_id)}`;
  }
  return `an expense of ${amount}${inCat}`;
}

function txDetail(L: Lookups, row: Row): string | null {
  const parts = [
    row.kind !== 'transfer' && row.account_id ? accountName(L, row.account_id) : '',
    date(row.occurred_on),
    str(row.note) ? quoted(str(row.note)) : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function txChanges(L: Lookups, row: Row, changes: Record<string, { old: unknown; new: unknown }>): FieldChange[] {
  const out: FieldChange[] = [];
  const oldCurrency = currencyOf(L, changes.account_id?.old ?? row.account_id);
  const newCurrency = currencyOf(L, row.account_id);
  for (const [field, { old, new: next }] of Object.entries(changes)) {
    switch (field) {
      case 'amount_minor':
        out.push({ label: 'Amount', from: money(old, oldCurrency), to: money(next, newCurrency) });
        break;
      case 'category_id':
        out.push({ label: 'Category', from: orNone(categoryName(L, old)), to: orNone(categoryName(L, next)) });
        break;
      case 'account_id':
        out.push({ label: 'Account', from: accountName(L, old), to: accountName(L, next) });
        break;
      case 'occurred_on':
        out.push({ label: 'Date', from: date(old), to: date(next) });
        break;
      case 'note':
        out.push({ label: 'Note', from: orNone(str(old)), to: orNone(str(next)) });
        break;
      case 'kind':
        out.push({ label: 'Type', from: capital(str(old)), to: capital(str(next)) });
        break;
    }
  }
  return out;
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function tagNames(L: Lookups, v: unknown): string[] {
  return Array.isArray(v) ? v.map((id) => L.tags.get(String(id)) ?? 'a deleted tag') : [];
}

function describeTransaction(L: Lookups, entry: DescribableEntry): Description {
  const row = subjectOf(entry);
  const phrase = txPhrase(L, row);
  const detail = txDetail(L, row);
  if (entry.op === 'insert') return { text: `added ${phrase}`, detail, changes: [] };
  if (entry.op === 'delete') return { text: `deleted ${phrase}`, detail, changes: [] };

  const changes = changesOf(parseDiff(entry.diff));
  if (changes.tag_added) {
    const tag = L.tags.get(String(changes.tag_added.new)) ?? 'a tag';
    return { text: `tagged ${phrase} with ${tag}`, detail, changes: [] };
  }
  if (changes.tags) {
    const before = tagNames(L, changes.tags.old);
    const after = tagNames(L, changes.tags.new);
    const added = after.filter((t) => !before.includes(t));
    const removed = before.filter((t) => !after.includes(t));
    const text =
      removed.length === 0
        ? `tagged ${phrase} with ${joinList(added)}`
        : added.length === 0
          ? `removed ${joinList(removed)} from ${phrase}`
          : `changed the tags on ${phrase}`;
    const fieldChanges =
      added.length && removed.length ? [{ label: 'Tags', from: joinList(before), to: joinList(after) }] : [];
    return { text, detail, changes: fieldChanges };
  }
  return { text: `edited ${phrase}`, detail, changes: txChanges(L, row, changes) };
}

// --- Accounts, categories, tags, budgets, repeating entries ----------------

type Labeler = (L: Lookups, row: Row, field: string, old: unknown, next: unknown) => FieldChange | null;

function fieldChanges(
  L: Lookups,
  row: Row,
  changes: Record<string, { old: unknown; new: unknown }>,
  label: Labeler,
): FieldChange[] {
  const out: FieldChange[] = [];
  let look = false;
  for (const [field, { old, new: next }] of Object.entries(changes)) {
    if (IGNORED.has(field) || field === 'archived_at') continue;
    if (field === 'color' || field === 'icon') {
      look = true;
      continue;
    }
    const c = label(L, row, field, old, next);
    if (c) out.push(c);
  }
  if (look) out.push({ label: 'Colour or icon', from: '', to: 'changed' });
  return out;
}

const accountLabel: Labeler = (L, row, field, old, next) => {
  const cur = str(row.currency) || L.defaultCurrency;
  const optMoney = (v: unknown) => (v === null || v === undefined ? 'None' : money(v, cur));
  const optDay = (v: unknown) => (v === null || v === undefined || v === '' ? 'None' : String(v));
  switch (field) {
    case 'name':
      return { label: 'Name', from: str(old), to: str(next) };
    case 'type':
      return { label: 'Type', from: ACCOUNT_TYPE[str(old)] ?? str(old), to: ACCOUNT_TYPE[str(next)] ?? str(next) };
    case 'currency':
      return { label: 'Currency', from: str(old), to: str(next) };
    case 'opening_balance_minor':
      return { label: 'Starting balance', from: formatMoney(num(old), cur), to: formatMoney(num(next), cur) };
    case 'include_in_total':
      return { label: 'Counted in total', from: yesNo(old), to: yesNo(next) };
    case 'is_main':
      return { label: 'Main account', from: yesNo(old), to: yesNo(next) };
    case 'credit_limit_minor':
      return { label: 'Credit limit', from: optMoney(old), to: optMoney(next) };
    case 'statement_day':
      return { label: 'Statement day', from: optDay(old), to: optDay(next) };
    case 'due_day':
      return { label: 'Due day', from: optDay(old), to: optDay(next) };
    case 'pay_from_account_id':
      return {
        label: 'Paid from',
        from: old ? accountName(L, old) : 'None',
        to: next ? accountName(L, next) : 'None',
      };
    case 'starts_on':
      return { label: 'Balance as of', from: orNone(date(old)), to: orNone(date(next)) };
    default:
      return null;
  }
};

const categoryLabel: Labeler = (L, _row, field, old, next) => {
  switch (field) {
    case 'name':
      return { label: 'Name', from: str(old), to: str(next) };
    case 'parent_id':
      return {
        label: 'Inside',
        from: categoryName(L, old) ?? 'Top level',
        to: categoryName(L, next) ?? 'Top level',
      };
    case 'kind':
      return { label: 'Type', from: capital(str(old)), to: capital(str(next)) };
    default:
      return null;
  }
};

const tagLabel: Labeler = (L, row, field, old, next) => {
  const cur = str(row.currency) || L.defaultCurrency;
  switch (field) {
    case 'name':
      return { label: 'Name', from: str(old), to: str(next) };
    case 'starts_on':
      return { label: 'From', from: orNone(date(old)), to: orNone(date(next)) };
    case 'ends_on':
      return { label: 'Until', from: orNone(date(old)), to: orNone(date(next)) };
    case 'budget_minor':
      return {
        label: 'Budget',
        from: old === null || old === undefined ? 'None' : money(old, cur),
        to: next === null || next === undefined ? 'None' : money(next, cur),
      };
    case 'currency':
      return { label: 'Currency', from: str(old), to: str(next) };
    default:
      return null;
  }
};

const budgetLabel: Labeler = (L, row, field, old, next) => {
  const cur = str(row.currency) || L.defaultCurrency;
  switch (field) {
    case 'amount_minor':
      return { label: 'Amount', from: money(old, cur), to: money(next, cur) };
    case 'category_id':
      return { label: 'Category', from: orNone(categoryName(L, old)), to: orNone(categoryName(L, next)) };
    case 'currency':
      return { label: 'Currency', from: str(old), to: str(next) };
    case 'starts_on':
      return { label: 'From', from: orNone(date(old)), to: orNone(date(next)) };
    default:
      return null;
  }
};

/** "monthly", "every 2 weeks" — from the simple RRULEs the app writes. */
export function repeatLabel(rrule: unknown): string {
  const s = str(rrule);
  const freq = /FREQ=(\w+)/.exec(s)?.[1];
  const interval = Number(/INTERVAL=(\d+)/.exec(s)?.[1] ?? 1);
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[freq ?? ''];
  if (!unit) return 'on a schedule';
  if (interval === 1) return unit === 'day' ? 'daily' : `${unit}ly`;
  return `every ${interval} ${unit}s`;
}

function template(v: unknown): Row {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as Row) : {};
  } catch {
    return {};
  }
}

function describeRecurring(L: Lookups, entry: DescribableEntry): Description {
  const row = subjectOf(entry);
  const tpl = template(row.template_json);
  const kind = tpl.kind === 'income' ? 'income' : 'expense';
  const cat = categoryName(L, tpl.category_id);
  const amount = tpl.amount_minor === undefined ? '' : ` of ${money(tpl.amount_minor, currencyOf(L, tpl.account_id))}`;
  const phrase = `the recurring ${kind}${amount}${cat ? ` in ${cat}` : ''} (${repeatLabel(row.rrule)})`;
  if (entry.op === 'insert') return { text: `set up ${phrase.replace(/^the /, 'a ')}`, detail: null, changes: [] };
  if (entry.op === 'delete') return { text: `removed ${phrase}`, detail: null, changes: [] };
  const changes = changesOf(parseDiff(entry.diff));
  if (changes.archived_at && !changes.archived_at.old) return { text: `stopped ${phrase}`, detail: null, changes: [] };

  const out: FieldChange[] = [];
  if (changes.template_json) {
    const before = template(changes.template_json.old);
    const after = template(changes.template_json.new);
    const diff: Record<string, { old: unknown; new: unknown }> = {};
    for (const k of ['amount_minor', 'category_id', 'account_id', 'note', 'kind']) {
      if (before[k] !== after[k]) diff[k] = { old: before[k], new: after[k] };
    }
    out.push(...txChanges(L, after, diff));
  }
  if (changes.rrule) {
    out.push({ label: 'Repeats', from: capital(repeatLabel(changes.rrule.old)), to: capital(repeatLabel(changes.rrule.new)) });
  }
  if (changes.next_run_on) {
    out.push({ label: 'Next on', from: date(changes.next_run_on.old), to: date(changes.next_run_on.new) });
  }
  return { text: `edited ${phrase}`, detail: null, changes: out };
}

/** Shared shape for named records: add / archive / restore / rename / edit. */
function describeNamed(
  L: Lookups,
  entry: DescribableEntry,
  noun: string,
  name: string,
  label: Labeler,
  extra?: (changes: Record<string, { old: unknown; new: unknown }>) => string | null,
): Description {
  const row = subjectOf(entry);
  const the = `the ${noun} ${name}`;
  if (entry.op === 'insert') return { text: `added ${the}`, detail: null, changes: [] };
  if (entry.op === 'delete') {
    const diff = parseDiff(entry.diff);
    const into = diff && 'before' in diff && diff.merged_into;
    return { text: `removed ${the}`, detail: into ? `Merged into another ${noun}` : null, changes: [] };
  }
  const changes = changesOf(parseDiff(entry.diff));
  const list = fieldChanges(L, row, changes, label);
  if (changes.archived_at) {
    const verb = changes.archived_at.old ? 'restored' : 'archived';
    return { text: `${verb} ${the}`, detail: null, changes: list };
  }
  const keys = Object.keys(changes).filter((k) => !IGNORED.has(k));
  if (keys.length === 1 && keys[0] === 'name') {
    return { text: `renamed the ${noun} ${quoted(str(changes.name.old))} to ${quoted(str(changes.name.new))}`, detail: null, changes: [] };
  }
  const special = extra?.(changes);
  if (special && keys.length === 1) return { text: special, detail: null, changes: [] };
  return { text: `edited ${the}`, detail: null, changes: list };
}

export function describeEntry(L: Lookups, entry: DescribableEntry): Description {
  const row = subjectOf(entry);
  switch (entry.entity) {
    case 'transaction':
      return describeTransaction(L, entry);
    case 'account': {
      const name = str(row.name) || 'an account';
      return describeNamed(L, entry, 'account', name, accountLabel, (c) => {
        if (c.include_in_total) {
          return num(c.include_in_total.new)
            ? `started counting ${name} in the total balance`
            : `stopped counting ${name} in the total balance`;
        }
        if (c.is_main && num(c.is_main.new)) return `made ${name} the main account`;
        return null;
      });
    }
    case 'category':
      return describeNamed(L, entry, 'category', str(row.name) || 'a category', categoryLabel);
    case 'tag':
      return describeNamed(L, entry, 'tag', str(row.name) || 'a tag', tagLabel);
    case 'budget': {
      const cat = categoryName(L, row.category_id) ?? 'a category';
      const amount = money(row.amount_minor, str(row.currency) || L.defaultCurrency);
      if (entry.op === 'insert') return { text: `set a monthly budget of ${amount} for ${cat}`, detail: null, changes: [] };
      if (entry.op === 'delete') return { text: `removed the budget for ${cat}`, detail: null, changes: [] };
      const changes = changesOf(parseDiff(entry.diff));
      if (changes.archived_at && !changes.archived_at.old) {
        return { text: `removed the budget for ${cat}`, detail: null, changes: [] };
      }
      const list = fieldChanges(L, row, changes, budgetLabel);
      if (list.length === 1 && list[0].label === 'Amount') {
        return { text: `changed the ${cat} budget from ${list[0].from} to ${list[0].to}`, detail: null, changes: [] };
      }
      return { text: `edited the budget for ${cat}`, detail: null, changes: list };
    }
    case 'recurring':
      return describeRecurring(L, entry);
  }
}

// --- Bulk operations ----------------------------------------------------------

function count(group: DescribableGroup, entity: ChangeEntity, op?: ChangeOp): number {
  return group.counts
    .filter((c) => c.entity === entity && (!op || c.op === op))
    .reduce((s, c) => s + c.n, 0);
}

function describeTransfer(L: Lookups, legs: DescribableEntry[]): Description | null {
  const rows = legs.map((l) => ({ leg: l, row: subjectOf(l) }));
  const from = rows.find((r) => num(r.row.amount_minor) < 0);
  const to = rows.find((r) => num(r.row.amount_minor) > 0);
  if (!from || !to) return null;
  const fromCur = currencyOf(L, from.row.account_id);
  const toCur = currencyOf(L, to.row.account_id);
  const sent = money(from.row.amount_minor, fromCur);
  const route = `from ${accountName(L, from.row.account_id)} to ${accountName(L, to.row.account_id)}`;
  const arrived = fromCur !== toCur ? ` (${money(to.row.amount_minor, toCur)} arrived)` : '';
  const detail = [date(from.row.occurred_on), str(from.row.note) ? quoted(str(from.row.note)) : '']
    .filter(Boolean)
    .join(' · ');
  const op = from.leg.op;
  if (op === 'insert') return { text: `moved ${sent} ${route}${arrived}`, detail, changes: [] };
  if (op === 'delete') return { text: `deleted the transfer of ${sent} ${route}`, detail, changes: [] };

  const fc = changesOf(parseDiff(from.leg.diff));
  const tc = changesOf(parseDiff(to.leg.diff));
  const out: FieldChange[] = [];
  if (fc.amount_minor) {
    out.push({
      label: fromCur === toCur ? 'Amount' : 'Amount sent',
      from: money(fc.amount_minor.old, fromCur),
      to: money(fc.amount_minor.new, fromCur),
    });
  }
  if (tc.amount_minor && fromCur !== toCur) {
    out.push({ label: 'Amount received', from: money(tc.amount_minor.old, toCur), to: money(tc.amount_minor.new, toCur) });
  }
  if (fc.account_id) out.push({ label: 'From', from: accountName(L, fc.account_id.old), to: accountName(L, fc.account_id.new) });
  if (tc.account_id) out.push({ label: 'To', from: accountName(L, tc.account_id.old), to: accountName(L, tc.account_id.new) });
  if (fc.occurred_on) out.push({ label: 'Date', from: date(fc.occurred_on.old), to: date(fc.occurred_on.new) });
  if (fc.note) out.push({ label: 'Note', from: orNone(str(fc.note.old)), to: orNone(str(fc.note.new)) });
  return { text: `edited the transfer of ${sent} ${route}`, detail, changes: out };
}

function mergeTarget(L: Lookups, group: DescribableGroup, entity: 'account' | 'category') {
  const removed = group.entries.find((e) => e.entity === entity && e.op === 'delete');
  const diff = removed ? parseDiff(removed.diff) : null;
  if (!diff || !('before' in diff)) return null;
  const into = diff.merged_into;
  const target =
    entity === 'account' ? (into ? accountName(L, into) : null) : into ? categoryName(L, into) : null;
  return { source: str(diff.before.name), target: target ?? `another ${entity}` };
}

export function describeGroup(L: Lookups, group: DescribableGroup): Description {
  const { entries } = group;
  const txs = count(group, 'transaction');

  const isTransfer =
    entries.length === 2 &&
    entries.every((e) => e.entity === 'transaction' && subjectOf(e).kind === 'transfer');
  if (group.source === 'transfer' || isTransfer) {
    const d = describeTransfer(L, entries);
    if (d) return d;
  }

  switch (group.source) {
    case 'undo': {
      const inner =
        entries.length === 1 && group.total === 1
          ? describeEntry(L, entries[0])
          : { text: `made ${plural(group.total, 'change')}`, detail: null, changes: [] };
      return { ...inner, text: `${inner.text} (undo)` };
    }
    case 'monefy-import': {
      const parts = [
        txs ? plural(txs, 'transaction') : '',
        count(group, 'account') ? plural(count(group, 'account'), 'account') : '',
        count(group, 'category') ? plural(count(group, 'category'), 'category', 'categories') : '',
      ].filter(Boolean);
      return { text: `imported ${joinList(parts) || 'data'} from Monefy`, detail: null, changes: [] };
    }
    case 'bulk-delete':
      return { text: `deleted ${plural(txs, 'transaction')}`, detail: null, changes: [] };
    case 'bulk-category': {
      const first = changesOf(parseDiff(entries[0]?.diff ?? '')).category_id;
      const cat = first ? categoryName(L, first.new) : null;
      return {
        text: cat ? `moved ${plural(txs, 'transaction')} to ${cat}` : `cleared the category on ${plural(txs, 'transaction')}`,
        detail: null,
        changes: [],
      };
    }
    case 'tags': {
      const first = changesOf(parseDiff(entries[0]?.diff ?? '')).tag_added;
      const tag = first ? (L.tags.get(String(first.new)) ?? 'a tag') : 'a tag';
      return { text: `tagged ${plural(txs, 'transaction')} with ${tag}`, detail: null, changes: [] };
    }
    case 'category-merge':
    case 'account-merge': {
      const entity = group.source === 'account-merge' ? 'account' : 'category';
      const m = mergeTarget(L, group, entity);
      if (m) {
        return {
          text: `merged the ${entity} ${m.source} into ${m.target}`,
          detail: txs ? `${plural(txs, 'transaction')} moved across` : null,
          changes: [],
        };
      }
      break;
    }
  }
  if (entries.length === 1 && group.total === 1) return describeEntry(L, entries[0]);
  return { text: `made ${plural(group.total, 'change')}`, detail: null, changes: [] };
}
