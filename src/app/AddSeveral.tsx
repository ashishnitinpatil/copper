import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Sparkles, X } from 'lucide-react';
import { PageShell } from './PageShell';
import { useDefaultCurrency } from './AppSettingsProvider';
import { Button } from '@/components/ui/Button';
import { useDB } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { bulkDeleteTransactions, createTransactions, listEntriesBetween } from '@/db/queries/transactions';
import type { Account, Category } from '@/db/types';
import { formatMoney, parseAmount } from '@/lib/money';
import { addDays, formatHumanDate, parseDateString, toDateString } from '@/lib/dates';
import {
  findAlreadyAdded,
  localDateOrder,
  matchAccount,
  matchCategory,
  parsePasted,
  SAME_ENTRY_DAYS,
  type Kind,
} from '@/features/bulkAdd/pasteRows';
import { buildAiPrompt } from '@/features/bulkAdd/aiPrompt';

// Many entries at once: typed in a grid, or pasted from a spreadsheet, a bank
// statement or an AI's answer. Names that don't match the book are left for
// the person to pick; nothing is created behind their back.

interface Row {
  key: number;
  date: string;
  amount: string;
  kind: Kind;
  accountId: string;
  categoryId: string;
  note: string;
  /** A pasted name that isn't one of the book's, shown until something is picked. */
  wantAccount?: string;
  wantCategory?: string;
}

const DRAFT_KEY = 'copper-add-several-draft';
const COLUMNS = ['date', 'amount', 'kind', 'account', 'category', 'note'] as const;
let nextKey = 1;

function blankRow(from: Partial<Row> = {}): Row {
  return {
    key: nextKey++,
    date: from.date ?? toDateString(),
    amount: '',
    kind: from.kind ?? 'expense',
    accountId: from.accountId ?? '',
    categoryId: '',
    note: '',
  };
}

const isBlank = (r: Row) => !r.amount.trim() && !r.note.trim() && !r.categoryId && !r.wantCategory;

function readDraft(): Row[] | null {
  try {
    const rows = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Row[] | null;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows.map((r) => ({ ...r, key: nextKey++ }));
  } catch {
    return null;
  }
}

function categoryLabel(c: Category, byId: Map<string, Category>): string {
  const parent = c.parent_id ? byId.get(c.parent_id) : null;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

export function AddSeveral() {
  const db = useDB();
  const defaultCurrency = useDefaultCurrency();
  const [params] = useSearchParams();
  const accountsState = useQuery<Account[]>(useCallback((d) => listAccounts(d, false), []), { deps: ['accounts'] });
  const categoriesState = useQuery<Category[]>(useCallback((d) => listCategories(d, false), []), {
    deps: ['categories'],
  });
  const accounts = useMemo(() => accountsState.data ?? [], [accountsState.data]);
  const categories = useMemo(() => categoriesState.data ?? [], [categoriesState.data]);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const options = useMemo(() => {
    const of = (kind: Kind) =>
      categories
        .filter((c) => c.kind === kind)
        .map((c) => ({ id: c.id, label: categoryLabel(c, byId) }))
        .sort((a, b) => a.label.localeCompare(b.label));
    return { expense: of('expense'), income: of('income') };
  }, [categories, byId]);

  const startAccount =
    (params.get('account') && accounts.some((a) => a.id === params.get('account')) ? params.get('account') : null) ??
    (accounts.find((a) => a.is_main) ?? accounts[0])?.id ??
    '';

  const [rows, setRows] = useState<Row[]>(() => readDraft() ?? [blankRow()]);
  const [pasteText, setPasteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ ids: string[]; accountId: string | null } | null>(null);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const grid = useRef<HTMLDivElement>(null);

  // Rows waiting on an account get the one this page was opened for (or the main one).
  useEffect(() => {
    if (!startAccount) return;
    setRows((rs) =>
      rs.some((r) => !r.accountId && !r.wantAccount)
        ? rs.map((r) => (r.accountId || r.wantAccount ? r : { ...r, accountId: startAccount }))
        : rs,
    );
  }, [startAccount]);

  // Kept on this device until saved, so leaving the page loses nothing.
  useEffect(() => {
    try {
      if (rows.every(isBlank)) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify(rows));
    } catch {
      /* private mode: the draft just isn't kept */
    }
  }, [rows]);

  const accountOf = (r: Row) => accounts.find((a) => a.id === r.accountId) ?? null;
  const problems = (r: Row): Set<(typeof COLUMNS)[number]> => {
    const p = new Set<(typeof COLUMNS)[number]>();
    if (isBlank(r)) return p;
    if (!r.date) p.add('date');
    const acc = accountOf(r);
    if (!acc) p.add('account');
    const minor = parseAmount(r.amount, acc?.currency ?? 'INR');
    if (minor === null || minor <= 0) p.add('amount');
    if (!r.categoryId) p.add('category');
    return p;
  };
  const filled = rows.filter((r) => !isBlank(r));
  const needFixing = filled.filter((r) => problems(r).size > 0).length;

  // Rows that look like entries already in the book (a pasted statement
  // usually overlaps what's been noted down): same account and amount, a few
  // days apart.
  const candidates = useMemo(
    () =>
      rows.flatMap((r) => {
        const acc = accounts.find((a) => a.id === r.accountId);
        const minor = acc && r.date ? parseAmount(r.amount, acc.currency) : null;
        if (!acc || minor === null || minor <= 0) return [];
        return [{ key: r.key, accountId: r.accountId, date: r.date, amountMinor: r.kind === 'expense' ? -minor : minor }];
      }),
    [rows, accounts],
  );
  const span = useMemo(() => {
    if (candidates.length === 0) return null;
    const dates = candidates.map((c) => c.date).sort();
    const pad = (d: string, n: number) => toDateString(addDays(parseDateString(d), n));
    return {
      accounts: [...new Set(candidates.map((c) => c.accountId))].sort().join(','),
      from: pad(dates[0], -SAME_ENTRY_DAYS),
      to: pad(dates.at(-1)!, SAME_ENTRY_DAYS),
    };
  }, [candidates]);
  const spanKey = span ? `${span.accounts}|${span.from}|${span.to}` : '';
  const nearby = useQuery(
    useCallback(
      (d) => {
        const [ids, from, to] = spanKey.split('|');
        return spanKey ? listEntriesBetween(d, ids.split(','), from, to) : Promise.resolve([]);
      },
      [spanKey],
    ),
    { deps: ['transactions'] },
  );
  const already = useMemo(() => findAlreadyAdded(candidates, nearby.data ?? []), [candidates, nearby.data]);

  // Money out and in, per currency, to check against a statement's totals.
  const totals = useMemo(() => {
    const t = new Map<string, { out: number; in: number }>();
    for (const r of rows) {
      const acc = accounts.find((a) => a.id === r.accountId);
      const minor = acc ? parseAmount(r.amount, acc.currency) : null;
      if (!acc || minor === null || minor <= 0) continue;
      const cur = t.get(acc.currency) ?? { out: 0, in: 0 };
      if (r.kind === 'expense') cur.out += minor;
      else cur.in += minor;
      t.set(acc.currency, cur);
    }
    return [...t.entries()];
  }, [rows, accounts]);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = (after?: number) => {
    setRows((rs) => {
      const i = after === undefined ? rs.length - 1 : rs.findIndex((r) => r.key === after);
      const prev = rs[i];
      const next = [...rs];
      next.splice(i + 1, 0, blankRow(prev ? { date: prev.date, accountId: prev.accountId, kind: prev.kind } : { accountId: startAccount }));
      return next;
    });
  };

  const focusCell = (rowIndex: number, col: string) => {
    requestAnimationFrame(() =>
      grid.current?.querySelector<HTMLElement>(`[data-row="${rowIndex}"][data-col="${col}"]`)?.focus(),
    );
  };

  // Enter goes down a row, adding one at the bottom: how a list gets typed in.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>, index: number, col: string) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (index === rows.length - 1) addRow();
    focusCell(index + 1, col === 'date' ? 'date' : col);
  };

  /** Rows read from pasted text, matched against the book. */
  const takePasted = (text: string, at?: number): boolean => {
    const pasted = parsePasted(text, localDateOrder(defaultCurrency));
    if (pasted.length === 0) return false;
    setRows((rs) => {
      const start = at ?? rs.length;
      const before = rs.slice(0, start);
      const after = rs.slice(start).filter((r) => !isBlank(r));
      let prev = before.filter((r) => !isBlank(r)).at(-1) ?? null;
      const made = pasted.map((p) => {
        const kind = p.kind ?? 'expense';
        const matchedAccount = matchAccount(p.account, accounts);
        const accountId = p.account ? (matchedAccount ?? '') : (prev?.accountId ?? startAccount);
        const categoryId = matchCategory(p.category, categories, kind) ?? '';
        const row: Row = {
          ...blankRow(),
          date: p.date ?? prev?.date ?? toDateString(),
          amount: p.amount,
          kind,
          accountId,
          categoryId,
          note: p.note,
          wantAccount: p.account && !matchedAccount ? p.account : undefined,
          wantCategory: p.category && !categoryId ? p.category : undefined,
        };
        prev = row;
        return row;
      });
      const next = [...before.filter((r) => !isBlank(r)), ...made, ...after];
      return next.length ? next : [blankRow({ accountId: startAccount })];
    });
    setSaved(null);
    return true;
  };

  // Several cells' worth pasted into one cell fills rows from there.
  const onGridPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\n\t]/.test(text.trim())) return;
    const at = Number((e.target as HTMLElement).dataset.row ?? rows.length);
    if (takePasted(text, at)) e.preventDefault();
  };

  const save = async () => {
    setShowErrors(true);
    if (filled.length === 0 || needFixing > 0 || saving) return;
    setSaving(true);
    try {
      const ids = await createTransactions(
        db,
        filled.map((r) => ({
          account_id: r.accountId,
          category_id: r.categoryId,
          amount_minor: parseAmount(r.amount, accountOf(r)!.currency)!,
          kind: r.kind,
          occurred_on: r.date,
          note: r.note.trim() || null,
        })),
      );
      const one = new Set(filled.map((r) => r.accountId));
      setSaved({ ids, accountId: one.size === 1 ? filled[0].accountId : null });
      const last = filled.at(-1)!;
      setRows([blankRow({ date: last.date, accountId: last.accountId, kind: last.kind })]);
      setShowErrors(false);
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    if (!saved) return;
    await bulkDeleteTransactions(db, saved.ids);
    setSaved(null);
  };

  const copyPrompt = async () => {
    const prompt = buildAiPrompt(accounts, categories, toDateString());
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };

  const cell =
    'w-full rounded-lg border bg-slate-900/60 px-2.5 py-1.5 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30';
  const tone = (r: Row, col: (typeof COLUMNS)[number]) =>
    showErrors && problems(r).has(col) ? 'border-danger' : 'border-slate-700';

  return (
    <PageShell
      title="Add several"
      subtitle="Type a list in, or paste rows from a spreadsheet, a statement or an AI chat"
      actions={
        <Link to="/add" className="text-sm text-slate-400 hover:text-slate-50">
          Add one →
        </Link>
      }
    >
      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <label htmlFor="paste-rows" className="block text-sm font-medium text-slate-200">
          Paste rows
        </label>
        <textarea
          id="paste-rows"
          rows={2}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          onPaste={(e) => {
            if (takePasted(e.clipboardData.getData('text/plain'))) {
              e.preventDefault();
              setPasteText('');
            }
          }}
          placeholder="Copy rows from Excel, Google Sheets, a CSV or an AI's answer, and paste them here"
          className={`${cell} border-slate-700`}
        />
        {pasteText.trim() && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (takePasted(pasteText)) setPasteText('');
            }}
          >
            Read these rows
          </Button>
        )}
        <p className="text-xs text-slate-500">
          Dates, amounts and notes are found by their column names (Date, Amount, Debit, Credit, Description…) or
          by what's in them. Minus amounts are money out; without any, everything is spending.
        </p>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
          <Button size="sm" variant="secondary" onClick={copyPrompt} disabled={accounts.length === 0}>
            <Sparkles size={14} aria-hidden /> Copy instructions for an AI
          </Button>
          <span className="text-xs text-slate-400" role="status">
            {copied === 'yes'
              ? 'Copied. Paste them into ChatGPT, Claude or Gemini with your statement, receipts or list, then paste its answer above.'
              : copied === 'failed'
                ? 'Couldn’t copy here. Select the text below and copy it.'
                : 'Lists your accounts and categories so an AI’s answer matches them. Nothing is sent anywhere by Copper.'}
          </span>
        </div>
        {copied === 'failed' && (
          <textarea
            readOnly
            rows={8}
            aria-label="Instructions for an AI"
            value={buildAiPrompt(accounts, categories, toDateString())}
            className={`${cell} border-slate-700 font-mono text-xs`}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
      </section>

      {already.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <span className="text-slate-200">
            {already.size === 1 ? '1 row looks' : `${already.size} rows look`} already in Copper: same account and
            amount, within {SAME_ENTRY_DAYS} days.
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setRows((rs) => {
              const left = rs.filter((r) => !already.has(r.key));
              return left.length ? left : [blankRow({ accountId: startAccount })];
            })}
          >
            Leave {already.size === 1 ? 'it' : 'them'} out
          </Button>
        </div>
      )}

      <div ref={grid} onPaste={onGridPaste} className="space-y-2" role="group" aria-label="Entries">
        <div className="hidden gap-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400 md:grid md:grid-cols-[9rem_7rem_7rem_minmax(8rem,1fr)_minmax(10rem,1.2fr)_minmax(8rem,1.5fr)_2rem]">
          <span>Date</span>
          <span>Amount</span>
          <span>Type</span>
          <span>Account</span>
          <span>Category</span>
          <span>Note</span>
          <span />
        </div>
        {rows.map((r, i) => {
          const acc = accountOf(r);
          const label = (what: string) => `${what}, row ${i + 1}`;
          return (
            <div
              key={r.key}
              className="grid grid-cols-2 items-start gap-2 rounded-xl border border-slate-800 p-2 md:grid-cols-[9rem_7rem_7rem_minmax(8rem,1fr)_minmax(10rem,1.2fr)_minmax(8rem,1.5fr)_2rem] md:rounded-none md:border-0 md:p-0 md:px-1"
            >
              <input
                type="date"
                aria-label={label('Date')}
                data-row={i}
                data-col="date"
                value={r.date}
                onChange={(e) => update(r.key, { date: e.target.value })}
                onKeyDown={(e) => onKeyDown(e, i, 'date')}
                className={`${cell} ${tone(r, 'date')}`}
              />
              <input
                inputMode="decimal"
                aria-label={label('Amount')}
                placeholder={acc ? `Amount (${acc.currency})` : 'Amount'}
                data-row={i}
                data-col="amount"
                value={r.amount}
                onChange={(e) => update(r.key, { amount: e.target.value })}
                onKeyDown={(e) => onKeyDown(e, i, 'amount')}
                className={`${cell} ${tone(r, 'amount')} font-mono`}
              />
              <select
                aria-label={label('Type')}
                data-row={i}
                data-col="kind"
                value={r.kind}
                onChange={(e) => {
                  const kind = e.target.value as Kind;
                  const keep = byId.get(r.categoryId)?.kind === kind;
                  update(r.key, {
                    kind,
                    categoryId: keep ? r.categoryId : (matchCategory(r.wantCategory ?? '', categories, kind) ?? ''),
                  });
                }}
                className={`${cell} border-slate-700`}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
              <div>
                <select
                  aria-label={label('Account')}
                  data-row={i}
                  data-col="account"
                  value={r.accountId}
                  onChange={(e) => update(r.key, { accountId: e.target.value, wantAccount: undefined })}
                  onKeyDown={(e) => onKeyDown(e, i, 'account')}
                  className={`${cell} ${r.wantAccount ? 'border-warning' : tone(r, 'account')}`}
                >
                  <option value="">Choose…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                {r.wantAccount && <p className="mt-0.5 text-xs text-warning">“{r.wantAccount}” isn’t one of your accounts</p>}
              </div>
              <div className="col-span-2 md:col-span-1">
                <select
                  aria-label={label('Category')}
                  data-row={i}
                  data-col="category"
                  value={r.categoryId}
                  onChange={(e) => update(r.key, { categoryId: e.target.value, wantCategory: undefined })}
                  onKeyDown={(e) => onKeyDown(e, i, 'category')}
                  className={`${cell} ${r.wantCategory ? 'border-warning' : tone(r, 'category')}`}
                >
                  <option value="">Choose…</option>
                  {options[r.kind].map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {r.wantCategory && (
                  <p className="mt-0.5 text-xs text-warning">“{r.wantCategory}” isn’t one of your {r.kind} categories</p>
                )}
              </div>
              <input
                aria-label={label('Note')}
                placeholder="Note"
                data-row={i}
                data-col="note"
                value={r.note}
                onChange={(e) => update(r.key, { note: e.target.value })}
                onKeyDown={(e) => onKeyDown(e, i, 'note')}
                className={`${cell} border-slate-700 col-span-2 md:col-span-1`}
              />
              {already.has(r.key) && (
                <p className="col-span-2 text-xs text-warning md:col-span-6 md:col-start-1">
                  Looks already in Copper: {formatHumanDate(already.get(r.key)!.occurred_on)}
                  {already.get(r.key)!.category_name ? ` · ${already.get(r.key)!.category_name}` : ''}
                  {already.get(r.key)!.note ? ` · ${already.get(r.key)!.note}` : ''}
                </p>
              )}
              <button
                type="button"
                aria-label={`Remove row ${i + 1}`}
                onClick={() =>
                  setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blankRow({ accountId: startAccount })]))
                }
                className="col-span-2 justify-self-end rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200 md:col-span-1"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
          );
        })}
        <Button size="sm" variant="ghost" onClick={() => addRow()}>
          <Plus size={14} aria-hidden /> Add a row
        </Button>
      </div>

      <div className="sticky bottom-20 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/95 p-3 backdrop-blur lg:bottom-4">
        <Button onClick={save} disabled={saving || filled.length === 0}>
          {filled.length === 1 ? 'Add 1 entry' : `Add ${filled.length} entries`}
        </Button>
        <span className="text-sm text-slate-400">
          {totals.map(([cur, t]) => `${formatMoney(t.out, cur)} out · ${formatMoney(t.in, cur)} in`).join(' · ')}
        </span>
        {showErrors && needFixing > 0 && (
          <span className="text-sm text-danger" role="alert">
            {needFixing === 1 ? '1 row is' : `${needFixing} rows are`} missing something: fill in the outlined cells.
          </span>
        )}
        {saved && (
          <span className="flex flex-wrap items-center gap-2 text-sm text-slate-200" role="status">
            Added {saved.ids.length === 1 ? '1 entry' : `${saved.ids.length} entries`}.
            <button type="button" onClick={undo} className="font-medium text-brand-400 hover:text-brand-300">
              Undo
            </button>
            <Link
              to={saved.accountId ? `/transactions?account=${saved.accountId}` : '/transactions'}
              className="font-medium text-brand-400 hover:text-brand-300"
            >
              See them →
            </Link>
          </span>
        )}
      </div>
    </PageShell>
  );
}
