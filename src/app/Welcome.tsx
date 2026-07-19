import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
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
import {
  isPickerConfigured,
  pickSharedFolder,
  PickerBlockedError,
  type PickedFolder,
} from '@/sync/googlePicker';
import { stashJoinTarget } from '@/sync/joinFresh';
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

  const [mode, setMode] = useState<'start' | 'restore' | 'join'>(() =>
    new URLSearchParams(window.location.search).has('restore') ? 'restore' : 'start',
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

  // Join-a-partner branch: adopt a shared Drive folder and start fresh from their
  // ledger (the onboarding equivalent of Settings → "Connect a shared folder",
  // Start-fresh mode). Requires a Google sign-in to open the Picker.
  const joinConfigured = auth.googleConfigured && isPickerConfigured();
  const [joinFolder, setJoinFolder] = useState<PickedFolder | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const chooseSharedFolder = async () => {
    setJoinBusy(true);
    setJoinError(null);
    try {
      const token = await auth.getGoogleAccessToken();
      if (!token) {
        setJoinError('Reconnect to Google first, then try again.');
        return;
      }
      const folder = await pickSharedFolder(token);
      if (folder) setJoinFolder(folder);
    } catch (e) {
      if (e instanceof PickerBlockedError) {
        setJoinError(
          "The Google folder picker couldn't load. This usually means more than one Google " +
            'account is signed in to this browser. Open Copper in a browser or profile signed in ' +
            'to only this Google account, then try again.',
        );
      } else {
        setJoinError(e instanceof Error ? e.message : 'Could not open the folder picker.');
      }
    } finally {
      setJoinBusy(false);
    }
  };

  // Erase this device's seed defaults and adopt the partner's folder on the next
  // boot. applyPendingJoin (db/client) then points sync at the folder, baselines
  // the version so nothing is pushed back, and marks onboarding done — so this
  // device lands on the dashboard with the partner's data, not back here.
  const startFreshFromFolder = () => {
    if (!joinFolder) return;
    stashJoinTarget(joinFolder.id);
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
      setRestoreError("That file isn't valid JSON — pick a backup file exported from this app.");
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
          <div className="text-3xl">💰</div>
          <h1 className="mt-2 text-2xl font-semibold text-slate-50">Welcome</h1>
          <p className="mt-1 text-sm text-slate-400">
            {mode === 'restore'
              ? 'Bring your data over from a backup file.'
              : mode === 'join'
                ? 'Load the shared ledger a partner already set up.'
                : step === 1
                  ? 'Pick the currency you use day to day.'
                  : 'Add your first account to start tracking.'}
          </p>
        </div>

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
                    setMode('start');
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
                    Sign in with the Google account your partner shared the folder with. Copper only
                    ever touches the folder you pick — nothing else in your Drive.
                  </p>
                  {auth.error && (
                    <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                      {auth.error}
                    </div>
                  )}
                  <Button variant="secondary" onClick={() => auth.signInGoogle()}>
                    Sign in with Google
                  </Button>
                </>
              ) : joinFolder ? (
                <>
                  <p className="text-sm text-slate-300">
                    Start fresh from{' '}
                    <span className="font-medium text-slate-100">{joinFolder.name}</span>? This
                    device will load the shared ledger and sync with it from now on.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-300">
                    Signed in as{' '}
                    <span className="font-medium text-slate-100">{auth.google.identity.email}</span>.
                    Choose the folder your partner shared to load their ledger onto this device.
                  </p>
                  <Button variant="secondary" onClick={chooseSharedFolder} disabled={joinBusy}>
                    {joinBusy ? 'Opening picker…' : 'Choose shared folder…'}
                  </Button>
                </>
              )}

              {joinError && (
                <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {joinError}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setMode('start');
                    setJoinFolder(null);
                    setJoinError(null);
                  }}
                >
                  Back
                </Button>
                {joinFolder && (
                  <Button onClick={startFreshFromFolder}>Start fresh</Button>
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
              <div className="flex justify-end">
                <Button onClick={goStep2}>Continue</Button>
              </div>
              <div className="space-y-1 border-t border-slate-800 pt-3 text-center text-xs text-slate-500">
                <div>
                  Moving from another device?{' '}
                  <button
                    type="button"
                    onClick={() => setMode('restore')}
                    className="font-medium text-success hover:text-success"
                  >
                    Restore from a backup
                  </button>
                </div>
                {joinConfigured && (
                  <div>
                    Partner already sharing their folder?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('join')}
                      className="font-medium text-success hover:text-success"
                    >
                      Join their shared ledger
                    </button>
                  </div>
                )}
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
          Your data stays on this device unless you turn on syncing later.
        </p>
      </div>
    </div>
  );
}
