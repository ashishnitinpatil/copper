import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageShell } from './PageShell';
import { CategoryCoin } from '@/components/ui/CategoryCoin';
import { Combobox } from '@/components/ui/Combobox';
import { useDB } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { createTransaction, createTransfer, deleteTransaction } from '@/db/queries/transactions';
import { listTags, setTransactionTags } from '@/db/queries/tags';
import { TagPicker } from '@/components/ui/TagPicker';
import type { Account, Category, CategoryKind, Tag } from '@/db/types';
import { formatMoney, getCurrency, parseAmount } from '@/lib/money';
import { toDateString } from '@/lib/dates';
import { useDefaultCurrency } from './AppSettingsProvider';
import { TransferModal, type TransferDraft } from './TransferModal';

type Mode = CategoryKind | 'transfer';

export function QuickEntry() {
  const db = useDB();
  const navigate = useNavigate();
  const defaultCurrency = useDefaultCurrency();

  const [mode, setMode] = useState<Mode>('expense');
  const [raw, setRaw] = useState('0');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // Selected tags persist across saves — tagging many entries on the same trip
  // shouldn't mean re-picking the tag every time.
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [occurredOn, setOccurredOn] = useState<string>(toDateString());
  const [committing, setCommitting] = useState(false);
  const [flash, setFlash] = useState<{ label: string; txId: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const savedTimer = useRef<number | null>(null);
  // A transfer into an account in another currency needs the amount received,
  // so it goes through the full transfer form instead of saving on tap.
  const [transferDraft, setTransferDraft] = useState<TransferDraft | null>(null);

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

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const currency = account?.currency ?? defaultCurrency;
  const meta = getCurrency(currency);

  const topLevel = useMemo(() => allCategories.filter((c) => !c.parent_id), [allCategories]);
  const filteredCategories = useMemo(
    () => topLevel.filter((c) => c.kind === mode),
    [topLevel, mode],
  );
  const transferTargets = useMemo(
    () => accounts.filter((a) => a.id !== accountId && !a.archived_at),
    [accounts, accountId],
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === '.') press('.');
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Escape') press('C');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [meta.decimals]);

  const showSaved = (label: string, txId: string, tileId: string) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    setFlash({ label, txId });
    setSavedId(tileId);
    setRaw('0');
    setNote('');
    flashTimer.current = window.setTimeout(() => setFlash(null), 4500);
    savedTimer.current = window.setTimeout(() => setSavedId(null), 900);
  };

  const commitTransfer = async (to: Account) => {
    if (!canCommit || !account) return;
    if (to.currency !== account.currency) {
      setTransferDraft({ fromId: account.id, toId: to.id, amountMinor: minor!, date: occurredOn, note });
      return;
    }
    setCommitting(true);
    try {
      const [fromLegId] = await createTransfer(db, {
        from_account_id: account.id,
        to_account_id: to.id,
        amount_minor: minor!,
        occurred_on: occurredOn,
        note: note.trim() || null,
      });
      // Deleting either leg removes both, so Undo works on the from leg.
      showSaved(`↔ ${to.name}  ${formatMoney(minor!, currency)}`, fromLegId, to.id);
    } finally {
      setCommitting(false);
    }
  };

  const commit = async (categoryId: string) => {
    if (!canCommit || !account) return;
    setCommitting(true);
    try {
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
      const cat = filteredCategories.find((c) => c.id === categoryId);
      showSaved(`${cat?.icon ?? ''} ${cat?.name ?? 'Saved'}  ${formatMoney(minor!, currency)}`, txId, categoryId);
    } finally {
      setCommitting(false);
    }
  };

  const undoLast = async () => {
    if (!flash) return;
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    await deleteTransaction(db, flash.txId);
    setFlash(null);
  };

  return (
    <PageShell
      title="Add transaction"
      subtitle={`Tap ${mode === 'transfer' ? 'an account' : 'a category'} to save · keyboard works on desktop`}
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
          <div className="flex gap-1 rounded-lg bg-slate-900 p-1">
            {(['expense', 'income', 'transfer'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md py-1.5 text-sm font-medium transition ${
                  mode === m
                    ? m === 'expense'
                      ? 'bg-clay-500 text-slate-950 shadow-sm'
                      : m === 'income'
                        ? 'bg-mint-500 text-slate-950 shadow-sm'
                        : 'bg-brand-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'expense' ? 'Expense' : m === 'income' ? 'Income' : 'Transfer'}
              </button>
            ))}
          </div>

          <div
            className={`rounded-2xl border bg-slate-900/70 p-5 text-right shadow-inner ${
              mode === 'expense'
                ? 'border-clay-500/30'
                : mode === 'income'
                  ? 'border-mint-500/30'
                  : 'border-brand-500/30'
            }`}
          >
            <div className="text-xs uppercase tracking-wider text-slate-500">
              {mode === 'transfer' ? 'From ' : ''}
              {account?.name ?? '—'} · {currency}
            </div>
            <div className="mt-1 flex items-baseline justify-end font-display text-5xl font-semibold tabular-nums sm:text-6xl">
              <span className="mr-1 text-[0.4em] text-slate-500">{meta.symbol}</span>
              <span
                key={raw}
                className={`motion-safe:animate-amount-pop ${
                  raw === '0'
                    ? 'text-slate-600'
                    : mode === 'expense'
                      ? 'text-clay-400'
                      : mode === 'income'
                        ? 'text-mint-400'
                        : 'text-brand-400'
                }`}
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
            <Combobox
              value={accountId ?? ''}
              onChange={setAccountId}
              placeholder="Account"
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            />
            <input
              type="date"
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-50 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
          />
          {tags.length > 0 && mode !== 'transfer' && (
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wider text-slate-500">Tags (optional)</div>
              <TagPicker tags={tags} selected={selectedTags} onToggle={toggleTag} />
            </div>
          )}
        </section>

        {mode === 'transfer' ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-300">Tap the account to transfer to</div>
            </div>
            {transferTargets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
                Add another account on the Accounts page to move money between them.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {transferTargets.map((a) => {
                  const saved = savedId === a.id;
                  const dim = !canCommit && !saved;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      disabled={!canCommit}
                      onClick={() => commitTransfer(a)}
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
                      <CategoryCoin name={a.name} color={a.color} icon={a.icon} size="lg" />
                      <div className="line-clamp-2 text-xs font-medium text-slate-200">{a.name}</div>
                      {a.currency !== currency && (
                        <div className="text-[10px] uppercase tracking-wider text-slate-500">{a.currency}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-300">
                Tap an {mode} category to save
              </div>
            </div>

            {filteredCategories.length === 0 ? (
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

      <TransferModal
        open={transferDraft !== null}
        draft={transferDraft}
        accounts={accounts}
        onClose={() => setTransferDraft(null)}
        onCreated={() => {
          setRaw('0');
          setNote('');
        }}
      />

      {flash && (
        <div
          aria-live="polite"
          className="fixed bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-mint-500/40 bg-mint-500/15 px-5 py-2 text-sm font-medium text-mint-300 shadow-xl backdrop-blur motion-safe:animate-snack-in lg:bottom-8"
        >
          <span>✓ {flash.label}</span>
          <button
            type="button"
            onClick={undoLast}
            className="rounded-full px-2 py-0.5 text-xs font-semibold text-mint-100 underline underline-offset-2 hover:text-white"
          >
            Undo
          </button>
        </div>
      )}
    </PageShell>
  );
}

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];
