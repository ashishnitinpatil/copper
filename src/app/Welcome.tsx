import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { DevJoinById } from '@/sync/DevJoinById';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Combobox } from '@/components/ui/Combobox';
import { useDB } from '@/db/DBProvider';
import { createAccount } from '@/db/queries/accounts';
import type { AccountType } from '@/db/types';
import { CURRENCY_OPTIONS, parseAmount } from '@/lib/money';
import { parseBackup, restoreBackup } from '@/features/export/restoreBackup';
import { decryptBackup, isEncryptedBackup, type EncryptedBackup } from '@/features/export/crypto';
import type { BackupFile } from '@/features/export/exportData';
import { closeDB, openDB, requestLocalReset } from '@/db/client';
import { useAuth } from '@/auth/AuthProvider';
import { isPickerConfigured } from '@/sync/googlePicker';
import { stashJoinTarget } from '@/sync/joinFresh';
import { useBookPicker } from '@/sync/useBookPicker';
import { BookIdentity } from '@/sync/BookIdentity';
import { clearInvite, peekInvite } from '@/sync/invite';
import { findBook } from '@/sync/household';
import { GoogleAccessNote } from '@/auth/GoogleAccessNote';
import { TrustDeviceToggle } from '@/auth/TrustDeviceToggle';
import { SpamHint } from '@/sync/SpamHint';
import { useAppSettings } from './AppSettingsProvider';

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'wallet', label: 'Wallet' },
];

export function Welcome() {
  const db = useDB();
  const navigate = useNavigate();
  const settings = useAppSettings();
  const auth = useAuth();

  // An invite link (/join/<bookId>) lands here with the book remembered.
  const [inviteBookId] = useState(() => peekInvite());
  // choose: sign in or go local · cloud: signed in, looking for this account's
  // book · start: currency + first account · restore: from a file · join: pick
  // a partner's book.
  const [mode, setMode] = useState<'choose' | 'cloud' | 'start' | 'restore' | 'join'>(() =>
    inviteBookId
      ? 'join'
      : new URLSearchParams(window.location.search).has('restore')
        ? 'restore'
        : !auth.googleConfigured
          ? 'start'
          : auth.google
            ? 'cloud'
            : 'choose',
  );
  const [step, setStep] = useState<1 | 2>(1);
  const [currency, setCurrency] = useState<string>(settings.defaultCurrency);
  const [name, setName] = useState('Cash');
  const [type, setType] = useState<AccountType>('cash');
  const [openingInput, setOpeningInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore-from-backup branch (e.g. moving to a new device).
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [restorePending, setRestorePending] = useState<{ backup: BackupFile; rows: number; name: string } | null>(null);
  const [encrypted, setEncrypted] = useState<{ env: EncryptedBackup; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Join-a-partner branch: adopt a partner's shared book and start fresh from
  // it (the onboarding equivalent of Settings → "Join a shared book", Start-fresh
  // mode). Requires a Google sign-in to open the Picker.
  const joinConfigured = auth.googleConfigured && isPickerConfigured();
  const book = useBookPicker();

  // Signed in on Welcome: look for a book this account already has (its own,
  // or one it joined), so a returning person just loads it. A partner's book
  // can't be found until it's picked once (drive.file), so "none" still offers
  // Join.
  const [lookup, setLookup] = useState<'idle' | 'looking' | 'found' | 'none' | 'error'>('idle');
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => {
    if (mode !== 'cloud' || !auth.google || lookup !== 'idle') return;
    setLookup('looking');
    (async () => {
      try {
        const token = await auth.getGoogleAccessToken();
        if (!token) throw new Error('Your Google sign-in has expired. Sign in again and retry.');
        const found = await findBook(token);
        if (!found) return setLookup('none');
        await book.choose(undefined, { id: found.id, name: found.name });
        setLookup('found');
      } catch (e) {
        console.warn('Could not look for a book:', e);
        setLookup('error');
      }
    })();
  }, [mode, auth, lookup, book]);

  const signIn = async () => {
    setSigningIn(true);
    try {
      await auth.signInGoogle();
    } finally {
      setSigningIn(false);
    }
  };
  // Signing in from the first screen moves on to looking for the book.
  useEffect(() => {
    if (mode === 'choose' && auth.google) setMode('cloud');
  }, [mode, auth.google]);

  // Adopt the partner's book on the next boot. applyPendingJoin (db/client) then
  // points sync at it and marks onboarding done — so this device lands on the
  // dashboard with the partner's data, not back here.
  const startFreshFromBook = () => {
    if (!book.picked) return;
    stashJoinTarget(book.picked.id);
    clearInvite();
    requestLocalReset();
  };

  const previewRestore = (backup: BackupFile, name: string) => {
    const rows = Object.values(backup.tables).reduce(
      (n, r) => n + (Array.isArray(r) ? r.length : 0),
      0,
    );
    setRestorePending({ backup, rows, name });
  };

  const onRestoreFile = async (file: File) => {
    setRestoreError(null);
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setRestoreError("That doesn't look like a Copper backup. Choose a file saved with Download backup in Settings.");
      return;
    }
    if (isEncryptedBackup(parsed)) {
      setPassword('');
      setEncrypted({ env: parsed, name: file.name });
      return;
    }
    try {
      previewRestore(parseBackup(text), file.name);
    } catch (e) {
      setRestoreError((e as Error).message);
    }
  };

  const unlock = async () => {
    if (!encrypted) return;
    setUnlocking(true);
    setRestoreError(null);
    try {
      const plaintext = await decryptBackup(encrypted.env, password);
      previewRestore(parseBackup(plaintext), encrypted.name);
      setEncrypted(null);
      setPassword('');
    } catch (e) {
      setRestoreError((e as Error).message);
    } finally {
      setUnlocking(false);
    }
  };

  const doRestore = async () => {
    if (!restorePending) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      await restoreBackup(db, restorePending.backup);
      // close() + a fresh open() is a durability barrier: the VFS persists with
      // "relaxed" durability, so reloading before the write is flushed to
      // IndexedDB can corrupt the file. IndexedDB orders the reopen's reads
      // after all pending writes, so once open() resolves the flush is done.
      await closeDB();
      await openDB();
      window.location.reload();
    } catch (e) {
      setRestoreError((e as Error).message);
      setRestoring(false);
    }
  };

  const goStep2 = async () => {
    await settings.setDefaultCurrency(currency);
    setStep(2);
  };

  const finish = async () => {
    if (!name.trim()) {
      setError('Give your account a name.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const opening = openingInput.trim() ? parseAmount(openingInput, currency) : 0;
      await createAccount(db, {
        name: name.trim(),
        type,
        currency,
        opening_balance_minor: opening ?? 0,
        is_main: true,
      });
      await settings.setOnboarded(true);
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create account');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <img src="/icon.svg" alt="" aria-hidden className="mx-auto h-10 w-10" />
          <h1 className="mt-2 text-2xl font-semibold text-slate-50">Welcome</h1>
          <p className="mt-1 text-sm text-slate-400">
            {mode === 'choose'
              ? 'Track what you spend — on its own, or shared with a partner.'
              : mode === 'cloud'
                ? lookup === 'found'
                  ? 'Found your book.'
                  : lookup === 'idle' || lookup === 'looking'
                    ? 'Signed in. Looking for your book…'
                    : 'Signed in. Set up your book.'
                : mode === 'restore'
              ? 'Bring your data over from a backup file.'
              : mode === 'join'
                ? 'Load the shared book a partner already set up.'
                : step === 1
                  ? 'Pick the currency you use day to day.'
                  : 'Add your first account to start tracking.'}
          </p>
        </div>

        {mode === 'choose' && (
          <Card>
            <div className="space-y-4">
              <div className="space-y-2">
                <Button className="w-full" onClick={signIn} disabled={signingIn}>
                  {signingIn ? 'Signing in…' : 'Sign in with Google'}
                </Button>
                <p className="text-xs text-slate-400">
                  Use Copper on more than one device, or with a partner. Your book is kept in your own
                  Google Drive — Copper only sees the files it creates or you pick.
                </p>
                <GoogleAccessNote />
                <TrustDeviceToggle />
              </div>
              {auth.error && (
                <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {auth.error}
                </div>
              )}
              <div className="space-y-2 border-t border-slate-800 pt-4">
                <Button variant="secondary" className="w-full" onClick={() => setMode('start')}>
                  Continue without an account
                </Button>
                <p className="text-xs text-slate-400">
                  Everything stays on this device. You can connect Google later in Settings.
                </p>
              </div>
              <div className="border-t border-slate-800 pt-3 text-center text-xs text-slate-500">
                Have a backup file?{' '}
                <button
                  type="button"
                  className="text-slate-300 underline hover:text-slate-100"
                  onClick={() => setMode('restore')}
                >
                  Restore it
                </button>
              </div>
            </div>
          </Card>
        )}

        {mode === 'cloud' && (
          <Card>
            <div className="space-y-4">
              {lookup === 'found' && book.picked ? (
                <>
                  <p className="text-sm text-slate-300">
                    Welcome back. This Google account already has a book — load it onto this device
                    and keep it in sync.
                  </p>
                  <BookIdentity
                    name={book.picked.name}
                    peek={book.peek}
                    peekError={book.peekError}
                  />
                </>
              ) : lookup === 'none' || lookup === 'error' ? (
                <>
                  <p className="text-sm text-slate-300">
                    {lookup === 'none'
                      ? 'No Copper book in this Google account yet.'
                      : "Copper couldn't check this Google account for a book."}{' '}
                    Start a new one, or join the book your partner shared with you.
                  </p>
                  <div className="flex flex-col gap-2">
                    <Button onClick={() => setMode('start')}>Start a new book</Button>
                    {joinConfigured && (
                      <Button variant="secondary" onClick={() => setMode('join')}>
                        Join a partner's book
                      </Button>
                    )}
                    {lookup === 'error' && (
                      <Button variant="ghost" onClick={() => setLookup('idle')}>
                        Try again
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-400">Looking for your book in Google Drive…</p>
              )}
              <div className="flex items-center justify-between pt-2">
                <span className="truncate text-xs text-slate-500">
                  {auth.google?.identity.email}
                </span>
                {lookup === 'found' && book.picked && (
                  <Button onClick={startFreshFromBook} disabled={book.peekError}>
                    Load my book
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        {mode === 'restore' && (
          <Card>
            <div className="space-y-4">
              <input
                ref={restoreInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onRestoreFile(f);
                  e.target.value = '';
                }}
              />
              {restorePending ? (
                <>
                  <p className="text-sm text-slate-300">
                    Restore{' '}
                    <span className="font-medium text-slate-100">{restorePending.name}</span>?
                    This loads{' '}
                    <span className="font-medium text-slate-100">{restorePending.rows} items</span>{' '}
                    onto this device.
                  </p>
                  {restoring && (
                    <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                      Restoring your data — a large backup can take up to a minute. Keep this tab open.
                    </div>
                  )}
                </>
              ) : encrypted ? (
                <>
                  <p className="text-sm text-slate-300">
                    <span className="font-medium text-slate-100">{encrypted.name}</span> is
                    encrypted. Enter its password to continue.
                  </p>
                  <Input
                    label="Password"
                    type="password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') unlock();
                    }}
                  />
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-300">
                    Choose a backup file you exported from Copper. Its accounts,
                    categories and transactions will be loaded onto this device.
                  </p>
                  <Button variant="secondary" onClick={() => restoreInputRef.current?.click()}>
                    Choose backup file…
                  </Button>
                </>
              )}

              {restoreError && (
                <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {restoreError}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setMode(auth.googleConfigured ? 'choose' : 'start');
                    setRestorePending(null);
                    setEncrypted(null);
                    setPassword('');
                    setRestoreError(null);
                  }}
                  disabled={restoring || unlocking}
                >
                  Back
                </Button>
                {restorePending ? (
                  <Button onClick={doRestore} disabled={restoring}>
                    {restoring ? 'Restoring…' : 'Restore'}
                  </Button>
                ) : encrypted ? (
                  <Button onClick={unlock} disabled={unlocking || !password}>
                    {unlocking ? 'Unlocking…' : 'Unlock'}
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>
        )}

        {mode === 'join' && (
          <Card>
            <div className="space-y-4">
              {!auth.google ? (
                <>
                  <p className="text-sm text-slate-300">
                    Sign in with the Google account your partner shared their book with. Copper only
                    ever opens the file you pick — nothing else in your Drive.
                  </p>
                  {auth.error && (
                    <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                      {auth.error}
                    </div>
                  )}
                  <Button variant="secondary" onClick={() => auth.signInGoogle()}>
                    Sign in with Google
                  </Button>
                  <GoogleAccessNote />
                  <TrustDeviceToggle />
                </>
              ) : book.picked ? (
                <>
                  <p className="text-sm text-slate-300">
                    Start fresh from this book? This device will load the shared book and sync
                    with it from now on.
                  </p>
                  <BookIdentity
                    name={book.picked.name}
                    peek={book.peek}
                    peekError={book.peekError}
                    onRetry={() => book.choose(book.picked!.id)}
                    retrying={book.busy}
                  />
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-300">
                    Signed in as{' '}
                    <span className="font-medium text-slate-100">{auth.google.identity.email}</span>.
                    {inviteBookId
                      ? ' Open the book your partner invited you to, then confirm it in the Google window.'
                      : ' Choose the book your partner shared (“Copper-Expense-Tracker-shared-book”) to load it onto this device.'}
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => book.choose(inviteBookId ?? undefined)}
                    disabled={book.busy}
                  >
                    {book.busy ? 'Opening…' : inviteBookId ? 'Open shared book' : 'Choose shared book…'}
                  </Button>
                  <DevJoinById onPick={(f) => book.choose(undefined, f)} disabled={book.busy} />
                  <SpamHint />
                </>
              )}

              {book.error && (
                <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {book.error}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setMode(auth.google ? 'cloud' : auth.googleConfigured ? 'choose' : 'start');
                    setLookup('idle');
                    book.clear();
                  }}
                >
                  Back
                </Button>
                {book.picked && (
                  <Button onClick={startFreshFromBook} disabled={book.peekError}>
                    Start fresh
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        {mode === 'start' && (
        <Card>
          {step === 1 && (
            <div className="space-y-4">
              <Combobox
                label="Default currency"
                value={currency}
                onChange={setCurrency}
                options={CURRENCY_OPTIONS}
              />
              <p className="text-xs text-slate-500">
                We guessed this from your device. You can change it later in Settings, and each
                account can still use a different currency.
              </p>
              <div className="flex items-center justify-between">
                {auth.googleConfigured ? (
                  <Button variant="ghost" onClick={() => setMode(auth.google ? 'cloud' : 'choose')}>
                    Back
                  </Button>
                ) : (
                  <button
                    type="button"
                    className="text-xs text-slate-400 underline hover:text-slate-200"
                    onClick={() => setMode('restore')}
                  >
                    Restore from a backup
                  </button>
                )}
                <Button onClick={goStep2}>Continue</Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <Input
                label="Account name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cash, HDFC, Amex"
                autoFocus
              />
              <Select
                label="Type"
                value={type}
                onChange={(e) => setType(e.target.value as AccountType)}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <Input
                label={`Starting balance (${currency})`}
                inputMode="decimal"
                value={openingInput}
                onChange={(e) => setOpeningInput(e.target.value)}
                placeholder="0.00"
              />

              {error && (
                <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={() => setStep(1)} disabled={submitting}>
                  Back
                </Button>
                <Button onClick={finish} disabled={submitting || !name.trim()}>
                  {submitting ? 'Creating…' : 'Get started'}
                </Button>
              </div>
            </div>
          )}
        </Card>
        )}

        <p className="text-center text-xs text-slate-600">
          {mode === 'start' && `Step ${step} of 2 · `}
          {auth.google
            ? 'Your book syncs through your Google Drive.'
            : 'Your data stays on this device unless you turn on syncing later.'}
        </p>
      </div>
    </div>
  );
}
