import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownUp, Repeat } from 'lucide-react';
import { PageShell } from './PageShell';
import { CategoryCoin } from '@/components/ui/CategoryCoin';
import { Combobox } from '@/components/ui/Combobox';
import { DateField, friendlyDate } from '@/components/ui/DateField';
import { Button } from '@/components/ui/Button';
import { AccountGlyph, accountOptions, useAccountBalances } from '@/components/accountOptions';
import { useDB } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { createTransaction, createTransfer, deleteTransaction, listPastNotes } from '@/db/queries/transactions';
import { suggestNotes, type PastNote } from '@/lib/noteSuggestions';
import { archiveRecurringRule, createRecurringRule, occurrenceId } from '@/db/queries/recurring';
import { listTags, setTransactionTags } from '@/db/queries/tags';
import { TagPicker } from '@/components/ui/TagPicker';
import type { Account, Category, CategoryKind, Tag } from '@/db/types';
import { formatMoney, fromMinor, getCurrency, parseAmount } from '@/lib/money';
import { toDateString } from '@/lib/dates';
import { FREQUENCY_OPTIONS, ruleStarting } from '@/features/recurring/frequencies';
import { useAppSettings, useConvert, useDefaultCurrency } from './AppSettingsProvider';
import { describeSource } from '@/components/ConvertedMark';
import { UNDO_EVENT } from './Shortcuts';

type Mode = CategoryKind | 'transfer';

interface Saved {
  label: string;
  txId: string | null;
  ruleId: string | null;
}

export function QuickEntry() {
  const db = useDB();
  const navigate = useNavigate();
  const defaultCurrency = useDefaultCurrency();
  const { fxRates, rateInfo } = useAppSettings();
  const convert = useConvert();
  const balances = useAccountBalances();

  const [mode, setMode] = useState<Mode>('expense');
  const [raw, setRaw] = useState('0');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [receivedInput, setReceivedInput] = useState('');
  // Once the person types what actually arrived, stop overwriting it with the estimate.
  const [receivedTouched, setReceivedTouched] = useState(false);
  const [note, setNote] = useState('');
  const [repeat, setRepeat] = useState('');
  // Selected tags persist across saves — tagging many entries on the same trip
  // shouldn't mean re-picking the tag every time.
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [occurredOn, setOccurredOn] = useState<string>(toDateString());
  const [committing, setCommitting] = useState(false);
  const [flash, setFlash] = useState<Saved | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const savedTimer = useRef<number | null>(null);

  // Clear pending dismiss timers on unmount so they can't fire into a gone component.
  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
  }, []);

  const accountsState = useQuery<Account[]>(
    useCallback((d) => listAccounts(d), []),
    { deps: ['accounts'] },
  );
  const categoriesState = useQuery<Category[]>(
    useCallback((d) => listCategories(d), []),
    { deps: ['categories'] },
  );
  const tagsState = useQuery<Tag[]>(
    useCallback((d) => listTags(d), []),
    { deps: ['tags'] },
  );
  const pastNotes = useQuery<PastNote[]>(
    useCallback((d) => listPastNotes(d, mode), [mode]),
    { deps: ['transactions'] },
  );
  const noteSuggestions = useMemo(() => suggestNotes(pastNotes.data ?? [], note), [pastNotes.data, note]);

  const accounts = accountsState.data ?? [];
  const allCategories = categoriesState.data ?? [];
  const tags = tagsState.data ?? [];

  const toggleTag = (id: string) =>
    setSelectedTags((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    if (accountId) return;
    const main = accounts.find((a) => a.is_main) ?? accounts[0];
    if (main) setAccountId(main.id);
  }, [accounts, accountId]);

  // A transfer needs somewhere to go: default to the first other account.
  useEffect(() => {
    if (toId && toId !== accountId) return;
    setToId(accounts.find((a) => a.id !== accountId)?.id ?? null);
  }, [accounts, accountId, toId]);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const toAccount = accounts.find((a) => a.id === toId) ?? null;
  const currency = account?.currency ?? defaultCurrency;
  const meta = getCurrency(currency);
  const options = useMemo(() => accountOptions(accounts, balances, 'md'), [accounts, balances]);

  const topLevel = useMemo(() => allCategories.filter((c) => !c.parent_id), [allCategories]);
  const filteredCategories = useMemo(
    () => topLevel.filter((c) => c.kind === mode),
    [topLevel, mode],
  );
  // Reserve grid space for whichever mode has more categories so switching
  // expense/income never grows or shrinks the panel — no layout shift.
  const reserveCount = useMemo(() => {
    const expense = topLevel.filter((c) => c.kind === 'expense').length;
    const income = topLevel.filter((c) => c.kind === 'income').length;
    return Math.max(expense, income);
  }, [topLevel]);

  const minor = parseAmount(raw, currency);
  const canCommit = minor !== null && minor > 0 && !!account && !committing;

  // --- Transfers between currencies: what arrives, estimated until typed ----
  const toCurrency = toAccount?.currency ?? currency;
  const crossCurrency = mode === 'transfer' && !!toAccount && toCurrency !== currency;
  const hasRate = (c: string) => c === defaultCurrency || !!fxRates[c];
  useEffect(() => {
    if (!crossCurrency || receivedTouched) return;
    if (!minor || minor <= 0 || !hasRate(currency) || !hasRate(toCurrency)) {
      setReceivedInput('');
      return;
    }
    setReceivedInput(String(fromMinor(convert(minor, currency, toCurrency), toCurrency)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossCurrency, receivedTouched, minor, currency, toCurrency, convert, fxRates]);
  const received = crossCurrency ? parseAmount(receivedInput, toCurrency) : minor;
  const estimateSource = [currency, toCurrency].map((c) => rateInfo[c]).find(Boolean)?.source;
  const canTransfer =
    canCommit && !!toAccount && toAccount.id !== account?.id && !!received && received > 0;

  const press = (ch: string) => {
    setRaw((cur) => {
      if (ch === 'C') return '0';
      if (ch === '⌫') return cur.length <= 1 ? '0' : cur.slice(0, -1);
      if (ch === '.') {
        if (meta.decimals === 0) return cur;
        return cur.includes('.') ? cur : cur + '.';
      }
      if (cur === '0') return ch;
      const decIdx = cur.indexOf('.');
      if (decIdx >= 0 && cur.length - decIdx - 1 >= meta.decimals) return cur;
      if (cur.replace('.', '').length >= 12) return cur;
      return cur + ch;
    });
  };

  const showSaved = (saved: Saved, tileId: string) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    setFlash(saved);
    setSavedId(tileId);
    setRaw('0');
    setNote('');
    setReceivedInput('');
    setReceivedTouched(false);
    // Long enough to notice and reach for Undo on a phone.
    flashTimer.current = window.setTimeout(() => setFlash(null), 8000);
    savedTimer.current = window.setTimeout(() => setSavedId(null), 900);
  };

  const commitTransfer = async () => {
    if (!canTransfer || !account || !toAccount) return;
    setCommitting(true);
    try {
      const [fromLegId] = await createTransfer(db, {
        from_account_id: account.id,
        to_account_id: toAccount.id,
        amount_minor: minor!,
        to_amount_minor: received!,
        occurred_on: occurredOn,
        note: note.trim() || null,
      });
      // Deleting either leg removes both, so Undo works on the from leg.
      showSaved(
        { label: `${formatMoney(minor!, currency)} to ${toAccount.name}`, txId: fromLegId, ruleId: null },
        'transfer',
      );
    } finally {
      setCommitting(false);
    }
  };

  const commit = async (categoryId: string) => {
    if (!canCommit || !account || mode === 'transfer') return;
    setCommitting(true);
    try {
      const cat = filteredCategories.find((c) => c.id === categoryId);
      const amountLabel = `${cat?.name ?? 'Saved'}  ${formatMoney(minor!, currency)}`;
      if (repeat) {
        // A repeating entry is a recurring rule starting on the chosen date;
        // creating it adds that first occurrence too when it's already due.
        const ruleId = await createRecurringRule(db, {
          template: {
            account_id: account.id,
            category_id: categoryId,
            amount_minor: minor!,
            kind: mode,
            note: note.trim() || null,
          },
          rrule: ruleStarting(occurredOn, repeat),
          next_run_on: occurredOn,
        });
        const due = occurredOn <= toDateString();
        const txId = due ? occurrenceId(ruleId, occurredOn) : null;
        if (txId && selectedTags.size > 0) await setTransactionTags(db, txId, [...selectedTags]);
        const freq = FREQUENCY_OPTIONS.find((f) => f.rrule === repeat)?.label.toLowerCase() ?? 'repeating';
        showSaved(
          { label: `${amountLabel}, ${freq}${due ? '' : ` from ${friendlyDate(occurredOn)}`}`, txId, ruleId },
          categoryId,
        );
        return;
      }
      const txId = await createTransaction(db, {
        account_id: account.id,
        category_id: categoryId,
        amount_minor: minor!,
        kind: mode,
        occurred_on: occurredOn,
        note: note.trim() || null,
      });
      if (selectedTags.size > 0) {
        await setTransactionTags(db, txId, [...selectedTags]);
      }
      showSaved({ label: amountLabel, txId, ruleId: null }, categoryId);
    } finally {
      setCommitting(false);
    }
  };

  const undoLast = async () => {
    if (!flash) return;
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    if (flash.ruleId) await archiveRecurringRule(db, flash.ruleId);
    if (flash.txId) await deleteTransaction(db, flash.txId);
    setFlash(null);
  };

  // After Ctrl+Z, the "saved" notice may describe something already undone.
  useEffect(() => {
    const clear = () => setFlash(null);
    window.addEventListener(UNDO_EVENT, clear);
    return () => window.removeEventListener(UNDO_EVENT, clear);
  }, []);

  // Typing works without the keypad on a computer: digits, Backspace, Escape to
  // clear, and Enter to finish a transfer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === '.' || e.key === ',') press('.');
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Escape') press('C');
      else if (e.key === 'Enter' && mode === 'transfer' && t?.tagName !== 'BUTTON') void commitTransfer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const tone =
    mode === 'expense'
      ? { border: 'border-clay-500/30', text: 'text-clay-400', tab: 'bg-clay-500' }
      : mode === 'income'
        ? { border: 'border-mint-500/30', text: 'text-mint-400', tab: 'bg-mint-500' }
        : { border: 'border-brand-500/30', text: 'text-brand-400', tab: 'bg-brand-500' };

  return (
    <PageShell
      title="Add transaction"
      subtitle={
        mode === 'transfer'
          ? 'Move money between your accounts'
          : 'Note what you spent or earned'
      }
      actions={
        <button
          type="button"
          onClick={() => navigate('/transactions')}
          className="text-sm text-slate-400 hover:text-slate-50"
        >
          View all →
        </button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="space-y-4">
          <div className="flex gap-1 rounded-lg bg-slate-900 p-1" role="tablist" aria-label="Type">
            {(['expense', 'income', 'transfer'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition ${
                  mode === m ? `${tone.tab} text-slate-950 shadow-sm` : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'expense' ? 'Expense' : m === 'income' ? 'Income' : 'Transfer'}
              </button>
            ))}
          </div>

          {mode === 'transfer' ? (
            <div className="relative space-y-2">
              <Combobox
                size="lg"
                caption="From"
                ariaLabel="From account"
                value={accountId ?? ''}
                onChange={(v) => {
                  if (v === toId) setToId(accountId);
                  setAccountId(v);
                }}
                options={options}
              />
              <button
                type="button"
                aria-label="Swap accounts"
                title="Swap"
                onClick={() => {
                  setAccountId(toId);
                  setToId(accountId);
                }}
                className="absolute right-12 top-1/2 z-10 -translate-y-1/2 rounded-full border border-slate-700 bg-slate-900 p-1.5 text-brand-300 shadow hover:border-brand-400"
              >
                <ArrowDownUp className="h-4 w-4" />
              </button>
              <Combobox
                size="lg"
                caption="To"
                ariaLabel="To account"
                value={toId ?? ''}
                onChange={setToId}
                placeholder="Choose an account"
                options={options.filter((o) => o.value !== accountId)}
              />
            </div>
          ) : (
            <Combobox
              size="lg"
              caption={mode === 'expense' ? 'Paid from' : 'Received into'}
              ariaLabel={mode === 'expense' ? 'Paid from account' : 'Received into account'}
              value={accountId ?? ''}
              onChange={setAccountId}
              placeholder={accountsState.data ? undefined : 'Loading…'}
              options={options}
            />
          )}

          <div className={`rounded-2xl border bg-slate-900/70 p-5 text-right shadow-inner ${tone.border}`}>
            <div className="flex items-center justify-end gap-1.5 text-xs uppercase tracking-wider text-slate-500">
              {account && <AccountGlyph account={account} />}
              <span className="truncate">
                {mode === 'transfer' ? 'From ' : ''}
                {account?.name ?? '—'} · {currency}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-end font-display text-5xl font-semibold tabular-nums sm:text-6xl">
              <span className="mr-1 text-[0.4em] text-slate-500">{meta.symbol}</span>
              <span
                key={raw}
                className={`motion-safe:animate-amount-pop ${raw === '0' ? 'text-slate-600' : tone.text}`}
              >
                {raw}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => press(k)}
                className={`select-none rounded-xl bg-slate-800 py-4 text-xl font-medium transition-[transform,background-color] duration-100 hover:bg-slate-700 active:scale-90 active:bg-slate-700 ${
                  k === '.' || k === '⌫' ? 'text-slate-400' : 'text-slate-50'
                }`}
              >
                {k}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <DateField value={occurredOn} onChange={setOccurredOn} />
            {mode !== 'transfer' && (
              <label className="relative flex items-center">
                <Repeat
                  aria-hidden
                  className={`pointer-events-none absolute left-3 h-4 w-4 ${repeat ? 'text-brand-400' : 'text-slate-500'}`}
                />
                <select
                  aria-label="Repeat"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  className={`w-full appearance-none rounded-lg border bg-slate-900/60 py-2 pl-9 pr-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30 ${
                    repeat ? 'border-brand-500/50 text-slate-50' : 'border-slate-700 text-slate-400'
                  }`}
                >
                  <option value="">Doesn&rsquo;t repeat</option>
                  {FREQUENCY_OPTIONS.map((f) => (
                    <option key={f.rrule} value={f.rrule}>
                      Repeats {f.label.toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            aria-label="Note"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
          />
          {noteSuggestions.length > 0 && (
            <div className="-mt-1 flex flex-wrap gap-1.5" aria-label="Notes you've used before">
              {noteSuggestions.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNote(n)}
                  className="max-w-full truncate rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-50"
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {tags.length > 0 && mode !== 'transfer' && (
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wider text-slate-500">Tags (optional)</div>
              <TagPicker tags={tags} selected={selectedTags} onToggle={toggleTag} />
            </div>
          )}
        </section>

        {mode === 'transfer' ? (
          <section className="space-y-3">
            {accounts.length < 2 ? (
              <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
                You need two accounts to move money between them.{' '}
                <button type="button" onClick={() => navigate('/accounts')} className="text-brand-300 underline">
                  Add an account
                </button>
              </div>
            ) : (
              <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
                <div className="flex items-center gap-3">
                  {account && <AccountGlyph account={account} size="md" />}
                  <div className="h-px flex-1 border-t border-dashed border-brand-500/50" />
                  <span className="text-sm font-semibold tabular-nums text-brand-300">
                    {minor ? formatMoney(minor, currency) : '—'}
                  </span>
                  <div className="h-px flex-1 border-t border-dashed border-brand-500/50" />
                  {toAccount && <AccountGlyph account={toAccount} size="md" />}
                </div>
                <p className="text-center text-sm text-slate-300">
                  {account?.name ?? '—'} <span className="text-slate-500">→</span> {toAccount?.name ?? '—'}
                </p>

                {crossCurrency && (
                  <div className="space-y-1">
                    <label htmlFor="received" className="block text-xs font-medium uppercase tracking-wide text-slate-400">
                      Amount received in {toAccount?.name} ({toCurrency})
                    </label>
                    <input
                      id="received"
                      inputMode="decimal"
                      value={receivedInput}
                      onChange={(e) => {
                        setReceivedInput(e.target.value);
                        setReceivedTouched(true);
                      }}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm tabular-nums text-slate-50 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
                    />
                    <p className="text-xs text-slate-500">
                      {receivedTouched
                        ? 'As you entered it.'
                        : estimateSource
                          ? `Estimated using ${describeSource(estimateSource)}. Enter what actually arrived if it differs.`
                          : 'Enter what arrived.'}
                    </p>
                  </div>
                )}

                <Button className="w-full py-3 text-base" onClick={commitTransfer} disabled={!canTransfer}>
                  {minor ? `Transfer ${formatMoney(minor, currency)}` : 'Type an amount to transfer'}
                </Button>
              </div>
            )}
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-300">
                {canCommit ? `Tap a category to save` : `Type an amount, then tap a category`}
              </div>
              {repeat && (
                <span className="flex items-center gap-1 text-xs text-brand-300">
                  <Repeat className="h-3.5 w-3.5" />
                  {FREQUENCY_OPTIONS.find((f) => f.rrule === repeat)?.label}
                </span>
              )}
            </div>

            {categoriesState.data === null && !categoriesState.error ? (
              // Still opening the book: placeholders, not "no categories yet".
              <div role="status" className="grid grid-cols-3 gap-3 motion-safe:animate-pulse sm:grid-cols-4">
                <span className="sr-only">Loading categories…</span>
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="h-28 rounded-2xl bg-slate-800/60" />
                ))}
              </div>
            ) : filteredCategories.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
                No {mode} categories yet. Add some on the Categories page.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {filteredCategories.map((c) => {
                  const saved = savedId === c.id;
                  // Keep the just-saved tile bright through its confirmation flash,
                  // even though the amount has reset to 0 (which dims the rest).
                  const dim = !canCommit && !saved;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={!canCommit}
                      onClick={() => commit(c.id)}
                      className={`group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border p-2 text-center transition active:scale-[0.97] enabled:hover:-translate-y-0.5 enabled:hover:bg-slate-800 disabled:cursor-not-allowed ${
                        saved
                          ? 'border-mint-400 bg-mint-500/10 ring-2 ring-mint-400/50'
                          : 'border-slate-800 bg-slate-900/60 enabled:hover:border-slate-700'
                      } ${dim ? 'opacity-40' : 'opacity-100'}`}
                    >
                      {saved && (
                        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-mint-500 text-xs font-bold text-slate-950">
                          ✓
                        </span>
                      )}
                      <CategoryCoin
                        name={c.name}
                        color={c.color}
                        icon={c.icon}
                        size="lg"
                        className={`transition group-hover:scale-105 ${saved ? 'motion-safe:animate-coin-pop' : ''}`}
                      />
                      <div className="line-clamp-2 text-xs font-medium text-slate-200">{c.name}</div>
                    </button>
                  );
                })}
                {Array.from({ length: Math.max(0, reserveCount - filteredCategories.length) }).map(
                  (_, i) => (
                    <div key={`reserve-${i}`} aria-hidden className="aspect-square" />
                  ),
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {flash && (
        <div
          aria-live="polite"
          className="fixed bottom-24 left-1/2 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-mint-500/40 bg-mint-500/15 px-5 py-2 text-sm font-medium text-mint-300 shadow-xl backdrop-blur motion-safe:animate-snack-in lg:bottom-8"
        >
          <span className="truncate">✓ {flash.label}</span>
          <button
            type="button"
            onClick={undoLast}
            className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-mint-100 underline underline-offset-2 hover:text-white"
          >
            Undo
          </button>
        </div>
      )}
    </PageShell>
  );
}

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];
