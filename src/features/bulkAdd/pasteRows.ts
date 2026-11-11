import { parseCsv } from '@/features/import/parseMonefy';
import type { Account, Category } from '@/db/types';

// Rows pasted from a spreadsheet, a CSV, a bank statement or an AI's reply,
// read into what Add several needs. Names and amounts stay as text here: the
// screen matches them against the book and shows what it couldn't.

export type Kind = 'expense' | 'income';

export interface PastedRow {
  /** YYYY-MM-DD, or null when the cell wasn't a date we could read. */
  date: string | null;
  /** The amount as typed, without its sign. */
  amount: string;
  /** From a type column, a debit/credit column, or the amount's sign. */
  kind: Kind | null;
  account: string;
  category: string;
  note: string;
}

type Field = 'date' | 'amount' | 'kind' | 'account' | 'category' | 'note' | 'out' | 'in';

// Header words, as banks, spreadsheets and people write them.
const HEADERS: [Field, RegExp][] = [
  ['date', /^(date|day|when|transaction date|txn date|value date|posting date|posted|booking date)$/],
  ['amount', /^(amount|amt|value|sum|price|cost|total)( \(.*\))?$/],
  ['out', /^(debit|debits|withdrawal|withdrawals|money out|paid out|spent|dr)( amount)?$/],
  ['in', /^(credit|credits|deposit|deposits|money in|paid in|received|cr)( amount)?$/],
  ['kind', /^(type|kind|expense\/income|income\/expense|direction)$/],
  ['account', /^(account|account name|wallet|card|paid from|source)$/],
  ['category', /^(category|categories|cat|group)$/],
  ['note', /^(note|notes|description|details|narration|memo|payee|merchant|remarks|particulars|item|what|comment)$/],
];

function headerField(cell: string): Field | null {
  const c = cell.trim().toLowerCase().replace(/\s+/g, ' ');
  return HEADERS.find(([, re]) => re.test(c))?.[0] ?? null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function month(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

/** Day-first (8/11/2026 is 8 Nov) or month-first, as most of the dates show. */
export type DateOrder = 'dmy' | 'mdy';

export function parseDate(s: string, order: DateOrder = 'dmy'): string | null {
  const t = s.trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?: .*)?$/.exec(t);
  if (m) return order === 'dmy' ? iso(+m[3], +m[2], +m[1]) : iso(+m[3], +m[1], +m[2]);
  // 8 Nov 2026, 08-Nov-26, 8 November 2026
  m = /^(\d{1,2})[- ]([a-z]{3,9})\.?[- ](\d{2}|\d{4})$/i.exec(t);
  if (m && month(m[2])) return iso(+m[3], month(m[2]), +m[1]);
  // Nov 8 2026, November 8 2026
  m = /^([a-z]{3,9})\.? (\d{1,2}) (\d{4})$/i.exec(t);
  if (m && month(m[1])) return iso(+m[3], month(m[1]), +m[2]);
  return null;
}

/** Which way round a set of n/n/yyyy dates goes: a day over 12 gives it away. */
export function guessDateOrder(cells: string[], fallback: DateOrder): DateOrder {
  for (const c of cells) {
    const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(c);
    if (!m) continue;
    if (+m[1] > 12) return 'dmy';
    if (+m[2] > 12) return 'mdy';
  }
  return fallback;
}

/**
 * How to read 03/04/2026 when nothing in the paste settles it. Month-first is
 * really only the US: a browser set to US English isn't enough (it's the
 * default in many countries), so the book's currency has to be dollars too.
 */
export function localDateOrder(currency: string): DateOrder {
  if (currency !== 'USD') return 'dmy';
  try {
    const parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2026, 10, 30));
    return parts.findIndex((p) => p.type === 'month') < parts.findIndex((p) => p.type === 'day') ? 'mdy' : 'dmy';
  } catch {
    return 'dmy';
  }
}

function readKind(cell: string): Kind | null {
  const c = cell.trim().toLowerCase();
  if (/^(exp|debit|dr\b|out|spent|spend|paid|withdraw|purchase|payment)/.test(c)) return 'expense';
  if (/^(inc|credit|cr\b|in\b|deposit|received|refund|salary)/.test(c)) return 'income';
  return null;
}

/** "-1,200.50", "(1,200.50)", "1,200.50 DR" → sign and the number as typed. */
function splitSign(cell: string): { negative: boolean; amount: string; kind: Kind | null } {
  let t = cell.trim();
  let kind: Kind | null = null;
  const suffix = /\s*\b(dr|cr)\.?$/i.exec(t);
  if (suffix) {
    kind = suffix[1].toLowerCase() === 'dr' ? 'expense' : 'income';
    t = t.slice(0, suffix.index).trim();
  }
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  if (/^[^\d]*-/.test(t) || /-$/.test(t)) {
    negative = true;
    t = t.replace('-', '');
  }
  if (t.startsWith('+')) t = t.slice(1);
  return { negative, amount: t.trim(), kind };
}

const looksLikeAmount = (c: string) => /^[^\d]{0,4}\(?[-+]?[^\d]{0,4}\d[\d,.\s]*\)?(\s*(dr|cr)\.?)?$/i.test(c.trim());

/**
 * Reads pasted text into rows. Tab-separated (a spreadsheet copy) or CSV,
 * with or without a header row; an AI's ``` fences are ignored.
 * Without a header, the date and amount columns are found by their contents
 * and the first other column is the note.
 */
export function parsePasted(text: string, fallbackOrder: DateOrder = 'dmy'): PastedRow[] {
  const body = text
    .split(/\r?\n/)
    .filter((l) => !/^\s*```/.test(l))
    .join('\n')
    .trim();
  if (!body) return [];
  const first = body.split('\n')[0];
  const delimiter = first.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
  let rows = parseCsv(body, delimiter).map((r) => r.map((c) => c.trim()));
  rows = rows.filter((r) => r.some((c) => c !== ''));
  if (rows.length === 0) return [];

  const width = Math.max(...rows.map((r) => r.length));
  let fields: (Field | null)[] = rows[0].map(headerField);
  if (fields.filter(Boolean).length >= 2 || (fields.includes('amount') && rows.length > 1)) {
    rows = rows.slice(1);
  } else {
    // No header: find the columns by what's in them.
    fields = Array.from({ length: width }, () => null);
    const column = (i: number) => rows.map((r) => r[i] ?? '').filter((c) => c !== '');
    const order0 = guessDateOrder(rows.flat(), fallbackOrder);
    const dateCol = fields.findIndex((_, i) => column(i).length > 0 && column(i).every((c) => parseDate(c, order0)));
    if (dateCol >= 0) fields[dateCol] = 'date';
    const amountCol = fields.findIndex(
      (f, i) => !f && column(i).length > 0 && column(i).every(looksLikeAmount),
    );
    if (amountCol >= 0) fields[amountCol] = 'amount';
    const noteCol = fields.findIndex((f, i) => !f && column(i).length > 0);
    if (noteCol >= 0) fields[noteCol] = 'note';
  }

  const col = (f: Field) => fields.indexOf(f);
  const order = guessDateOrder(
    rows.map((r) => r[col('date')] ?? ''),
    fallbackOrder,
  );
  const cell = (r: string[], f: Field) => (col(f) >= 0 ? (r[col(f)] ?? '') : '');

  const parsed = rows.map((r) => {
    let amount = '';
    let negative = false;
    let kind: Kind | null = cell(r, 'kind') ? readKind(cell(r, 'kind')) : null;
    if (cell(r, 'amount')) {
      const s = splitSign(cell(r, 'amount'));
      amount = s.amount;
      negative = s.negative;
      kind ??= s.kind;
    } else if (cell(r, 'out')) {
      amount = splitSign(cell(r, 'out')).amount;
      kind ??= 'expense';
    } else if (cell(r, 'in')) {
      amount = splitSign(cell(r, 'in')).amount;
      kind ??= 'income';
    }
    return {
      row: {
        date: cell(r, 'date') ? parseDate(cell(r, 'date'), order) : null,
        amount,
        kind,
        account: cell(r, 'account'),
        category: cell(r, 'category'),
        note: cell(r, 'note'),
      },
      negative,
    };
  });
  // Signed amounts, as on a statement: minus is money out, the rest money in.
  // Without any minus they're all spending, as people list what they spent.
  const signed = parsed.some((p) => p.negative);
  return parsed.map(({ row, negative }) => ({
    ...row,
    kind: row.kind ?? (signed && !negative ? 'income' : row.amount ? 'expense' : null),
  }));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The account with this name, if exactly one has it. */
export function matchAccount(name: string, accounts: Account[]): string | null {
  if (!name.trim()) return null;
  const hits = accounts.filter((a) => norm(a.name) === norm(name));
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * The category with this name ("Groceries") or path ("Food › Groceries",
 * "Food > Groceries", "Food / Groceries"), of the entry's kind when known.
 */
export function matchCategory(name: string, categories: Category[], kind: Kind | null): string | null {
  if (!name.trim()) return null;
  const pool = kind ? categories.filter((c) => c.kind === kind) : categories;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path = (c: Category): string => {
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    return parent ? `${norm(parent.name)} › ${norm(c.name)}` : norm(c.name);
  };
  const wanted = norm(name).replace(/\s*(>|\/|›|»|:)\s*/g, ' › ');
  // Two categories with the very same name and parent can't be told apart
  // anywhere in Copper, so either will do; the first is taken.
  const exact = pool.filter((c) => path(c) === wanted);
  if (exact.length > 0) return exact[0].id;
  const leaf = pool.filter((c) => norm(c.name) === wanted);
  return leaf.length > 0 && leaf.every((c) => path(c) === path(leaf[0])) ? leaf[0].id : null;
}

export interface Candidate {
  key: number;
  accountId: string;
  date: string;
  /** Signed: money out is negative. */
  amountMinor: number;
}

export interface Existing {
  id: string;
  account_id: string;
  occurred_on: string;
  amount_minor: number;
}

/** Days a statement's date and the day it was noted down can differ by (card postings lag). */
export const SAME_ENTRY_DAYS = 3;

const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

/**
 * Rows that look like entries already in the book: same account and amount,
 * dated within a few days. Each existing entry vouches for one row only, the
 * closest in date, so two coffees on a statement aren't both waved through by
 * one coffee in the book.
 */
export function findAlreadyAdded<E extends Existing>(rows: Candidate[], existing: E[]): Map<number, E> {
  const pairs: { row: Candidate; tx: E; gap: number }[] = [];
  for (const row of rows) {
    for (const tx of existing) {
      if (tx.account_id !== row.accountId || tx.amount_minor !== row.amountMinor) continue;
      const gap = Math.abs(dayNumber(tx.occurred_on) - dayNumber(row.date));
      if (gap <= SAME_ENTRY_DAYS) pairs.push({ row, tx, gap });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap);
  const found = new Map<number, E>();
  const used = new Set<string>();
  for (const { row, tx } of pairs) {
    if (found.has(row.key) || used.has(tx.id)) continue;
    found.set(row.key, tx);
    used.add(tx.id);
  }
  return found;
}
