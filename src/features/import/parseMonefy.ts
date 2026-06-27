import type { AccountType, CategoryKind } from '@/db/types';
import { parseAmount } from '@/lib/money';

export interface ParsedAccount {
  name: string;
  currency: string;
  type: AccountType;
  openingBalanceMinor: number;
}

export interface ParsedCategory {
  name: string;
  kind: CategoryKind;
}

export interface ParsedTransaction {
  date: string;
  account: string;
  category: string;
  amountMinor: number;
  kind: 'expense' | 'income';
  note: string | null;
  lineNo: number;
}

export interface ParsedTransfer {
  date: string;
  fromAccount: string;
  toAccount: string;
  amountMinor: number;
  note: string | null;
  lineNo: number;
}

export interface ImportPlan {
  accounts: ParsedAccount[];
  categories: ParsedCategory[];
  transactions: ParsedTransaction[];
  transfers: ParsedTransfer[];
  unpairedTransfers: Array<{ lineNo: number; row: string[]; reason: string }>;
  skippedRows: Array<{ lineNo: number; row: string[]; reason: string }>;
  currency: string;
  warnings: string[];
}

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && input[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

function parseMonefyDate(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function inferAccountType(name: string): AccountType {
  const n = name.toLowerCase();
  if (/(^|\s)cc$/.test(n) || /\bcredit\b/.test(n)) return 'credit_card';
  if (n === 'cash') return 'cash';
  if (/savings?|bank|fab|cbd|dib|mashreq|mshrq|citi|nio/.test(n)) return 'bank';
  if (/crypto|etoro|invest/.test(n)) return 'other';
  if (/splitwise|reimbursement|dad|patil|sneha|football|fines/.test(n)) return 'loan';
  return 'other';
}

const TRANSFER_TO = /^To '(.+)'$/;
const TRANSFER_FROM = /^From '(.+)'$/;
const INITIAL_BALANCE = /^Initial balance '(.+)'$/;

interface RawRow {
  lineNo: number;
  date: string;
  account: string;
  category: string;
  amountMinor: number;
  currency: string;
  note: string | null;
  raw: string[];
}

export function parseMonefyCsv(text: string): ImportPlan {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return emptyPlan('USD', ['CSV is empty']);
  }
  const header = rows[0].map((s) => s.trim().toLowerCase());
  const warnings: string[] = [];
  const expected = ['date', 'account', 'category', 'amount', 'currency'];
  for (const col of expected) {
    if (!header.includes(col)) {
      return emptyPlan('USD', [`Missing expected column: ${col}`]);
    }
  }

  const accountCurrency = new Map<string, string>();
  const accountOpening = new Map<string, number>();
  const categorySigns = new Map<string, { expense: number; income: number }>();
  const rawRows: RawRow[] = [];
  const skipped: Array<{ lineNo: number; row: string[]; reason: string }> = [];
  const currencyCounts = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const lineNo = i + 1;
    if (row.length < 5) {
      skipped.push({ lineNo, row, reason: 'too few columns' });
      continue;
    }
    const date = parseMonefyDate(row[0]);
    if (!date) {
      skipped.push({ lineNo, row, reason: `bad date ${row[0]}` });
      continue;
    }
    const account = row[1].trim();
    const category = row[2].trim();
    const currency = (row[4] || '').trim();
    const note = row[7]?.trim() || null;
    if (!account || !currency) {
      skipped.push({ lineNo, row, reason: 'missing account or currency' });
      continue;
    }
    const minor = parseAmount(row[3], currency);
    if (minor === null) {
      skipped.push({ lineNo, row, reason: `unparseable amount ${row[3]}` });
      continue;
    }

    currencyCounts.set(currency, (currencyCounts.get(currency) ?? 0) + 1);

    const existingCur = accountCurrency.get(account);
    if (existingCur && existingCur !== currency) {
      warnings.push(
        `Account "${account}" has rows in multiple currencies (${existingCur}, ${currency}); using ${existingCur}`,
      );
    } else if (!existingCur) {
      accountCurrency.set(account, currency);
    }

    const ib = INITIAL_BALANCE.exec(category);
    if (ib) {
      accountOpening.set(account, (accountOpening.get(account) ?? 0) + minor);
      continue;
    }

    rawRows.push({ lineNo, date, account, category, amountMinor: minor, currency, note, raw: row });

    if (!TRANSFER_TO.test(category) && !TRANSFER_FROM.test(category)) {
      const bucket = categorySigns.get(category) ?? { expense: 0, income: 0 };
      if (minor < 0) bucket.expense += 1;
      else bucket.income += 1;
      categorySigns.set(category, bucket);
    }
  }

  const dominantCurrency =
    [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD';

  const transfers: ParsedTransfer[] = [];
  const unpairedTransfers: Array<{ lineNo: number; row: string[]; reason: string }> = [];
  const transactions: ParsedTransaction[] = [];

  const fromPool = new Map<string, RawRow[]>();
  for (const r of rawRows) {
    const m = TRANSFER_FROM.exec(r.category);
    if (m) {
      const src = m[1];
      const key = `${r.date}|${Math.abs(r.amountMinor)}|${src}|${r.account}`;
      const list = fromPool.get(key) ?? [];
      list.push(r);
      fromPool.set(key, list);
    }
  }

  for (const r of rawRows) {
    const mFrom = TRANSFER_FROM.exec(r.category);
    if (mFrom) continue;
    const mTo = TRANSFER_TO.exec(r.category);
    if (mTo) {
      const dst = mTo[1];
      const key = `${r.date}|${Math.abs(r.amountMinor)}|${r.account}|${dst}`;
      const list = fromPool.get(key);
      if (list && list.length > 0) {
        const peer = list.shift()!;
        transfers.push({
          date: r.date,
          fromAccount: r.account,
          toAccount: dst,
          amountMinor: Math.abs(r.amountMinor),
          note: r.note ?? peer.note ?? null,
          lineNo: r.lineNo,
        });
        if (!accountCurrency.has(dst)) accountCurrency.set(dst, r.currency);
      } else {
        unpairedTransfers.push({
          lineNo: r.lineNo,
          row: r.raw,
          reason: `No matching "From '${r.account}'" on ${r.date} for ${r.amountMinor}`,
        });
      }
      continue;
    }
    transactions.push({
      date: r.date,
      account: r.account,
      category: r.category,
      amountMinor: Math.abs(r.amountMinor),
      kind: r.amountMinor < 0 ? 'expense' : 'income',
      note: r.note,
      lineNo: r.lineNo,
    });
  }

  for (const [, list] of fromPool) {
    for (const leftover of list) {
      unpairedTransfers.push({
        lineNo: leftover.lineNo,
        row: leftover.raw,
        reason: `Unmatched "${leftover.category}" row`,
      });
    }
  }

  const accounts: ParsedAccount[] = [...accountCurrency.entries()]
    .map(([name, currency]) => ({
      name,
      currency,
      type: inferAccountType(name),
      openingBalanceMinor: accountOpening.get(name) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const categories: ParsedCategory[] = [...categorySigns.entries()]
    .map(([name, { expense, income }]) => ({
      name,
      kind: (income > expense ? 'income' : 'expense') as CategoryKind,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    accounts,
    categories,
    transactions,
    transfers,
    unpairedTransfers,
    skippedRows: skipped,
    currency: dominantCurrency,
    warnings,
  };
}

function emptyPlan(currency: string, warnings: string[]): ImportPlan {
  return {
    accounts: [],
    categories: [],
    transactions: [],
    transfers: [],
    unpairedTransfers: [],
    skippedRows: [],
    currency,
    warnings,
  };
}
