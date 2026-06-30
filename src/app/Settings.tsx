import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageShell } from './PageShell';
import { Button } from '@/components/ui/Button';
import { InfoHint } from '@/components/ui/InfoHint';
import { Card, EmptyState } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Combobox } from '@/components/ui/Combobox';
import { Modal } from '@/components/ui/Modal';
import { useDB } from '@/db/DBProvider';
import { useSiteId } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import {
  listRecurringRules,
  createRecurringRule,
  archiveRecurringRule,
  type RecurringTemplate,
  type RecurringRuleInput,
} from '@/db/queries/recurring';
import { listAccounts } from '@/db/queries/accounts';
import { listCategories } from '@/db/queries/categories';
import { getSettingNumber, setSetting, SETTINGS_KEYS } from '@/db/queries/settings';
import { useAuth } from '@/auth/AuthProvider';
import { HOUSEHOLD_FOLDER_NAME } from '@/sync/household';
import { useSync } from '@/sync/SyncProvider';
import { useAppSettings, useDefaultCurrency } from './AppSettingsProvider';
import { SUPPORTED_CURRENCIES } from '@/lib/money';
import type { Account, AccountType, Category, RecurringRule } from '@/db/types';
import { formatMoney, parseAmount } from '@/lib/money';
import { formatHumanDate, toDateString } from '@/lib/dates';
import { parseMonefyCsv, type ImportPlan } from '@/features/import/parseMonefy';
import { runMonefyImport, type ImportOverrides } from '@/features/import/importMonefy';
import {
  buildTransactionsCsv,
  buildFullBackup,
  downloadText,
  exportFileName,
} from '@/features/export/exportData';
import { parseBackup, restoreBackup } from '@/features/export/restoreBackup';
import { decryptBackup, encryptBackup, isEncryptedBackup, type EncryptedBackup } from '@/features/export/crypto';
import {
  listDevices,
  getLocalDeviceName,
  setLocalDeviceName,
  defaultDeviceName,
} from '@/db/changeLog';
import type { Device } from '@/db/types';
import { closeDB, openDB, requestLocalReset } from '@/db/client';
import type { BackupFile } from '@/features/export/exportData';
import { useTheme, THEMES } from '@/lib/theme';

export function Settings() {
  const siteId = useSiteId();

  return (
    <PageShell title="Settings" subtitle="Sync, recurring rules and backup">
      <AuthSection />

      <SyncSection />

      <RecurringRulesSection />

      <ReviewSettingsSection />

      <AppearanceSection />

      <DefaultCurrencySection />

      <FxRatesSection />

      <ExportSection />

      <ImportSection />

      <RestoreSection />

      <ThisDeviceSection siteId={siteId} />

      <ResetDeviceSection />
    </PageShell>
  );
}

function ThisDeviceSection({ siteId }: { siteId: string }) {
  const db = useDB();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  const devicesState = useQuery<Device[]>(
    useCallback((d) => listDevices(d), []),
    { deps: ['devices'] },
  );

  useEffect(() => {
    getLocalDeviceName(db).then(setName);
  }, [db]);

  const others = (devicesState.data ?? []).filter((d) => d.site_id !== siteId);
  const placeholder = defaultDeviceName(siteId);

  const save = async () => {
    await setLocalDeviceName(db, name);
    setName(await getLocalDeviceName(db));
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-slate-300">This device</h3>
      <p className="mb-3 text-xs text-slate-500">
        The name shown next to changes this device makes in the{' '}
        <span className="text-slate-400">Activity</span> log. Pick something you'll recognise across
        your phone and laptop.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 text-xs text-slate-400">
          Device name
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            maxLength={40}
            className="mt-1"
          />
        </label>
        <Button variant="secondary" onClick={save} disabled={name.trim() === ''}>
          {saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      <div className="mt-3 text-xs text-slate-500">
        Device ID: <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{siteId}</code>
      </div>

      {others.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <div className="mb-2 text-xs font-medium text-slate-400">Other devices in this book</div>
          <ul className="space-y-1">
            {others.map((d) => (
              <li key={d.site_id} className="flex items-center justify-between text-xs text-slate-500">
                <span className="text-slate-300">{d.name}</span>
                <span>last seen {formatHumanDate(d.last_seen.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function ResetDeviceSection() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-300">Reset this device</h3>
          <div className="text-xs text-slate-500">
            Erase everything stored on this device and start fresh. If you're signed in to sync, your
            data re-downloads from Google Drive afterwards.
          </div>
        </div>
        <Button variant="danger" className="shrink-0" onClick={() => setOpen(true)}>
          Reset…
        </Button>
      </div>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Reset this device">
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            This deletes everything stored on this device — accounts, transactions and settings —
            and reloads.{' '}
            <span className="font-medium text-slate-100">It can't be undone.</span>
          </p>
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            If you haven't turned on sync or saved a backup, this data is gone for good. Export a
            backup first if you're not sure.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setBusy(true);
                requestLocalReset();
              }}
              disabled={busy}
            >
              {busy ? 'Resetting…' : 'Erase and reset'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useTheme();
  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-slate-300">Appearance</h3>
      <p className="mb-3 text-xs text-slate-500">Pick the look. Saved on this device.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {THEMES.map((t) => {
          const active = theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={`rounded-xl border p-3 text-left transition ${
                active
                  ? 'border-brand-400 bg-slate-800/60'
                  : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-100">{t.label}</span>
                {active ? (
                  <span className="text-xs font-medium text-brand-500">Active</span>
                ) : (
                  <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    {t.mode}
                  </span>
                )}
              </div>
              <div className="mt-2 flex gap-1.5">
                {t.swatch.map((c) => (
                  <span
                    key={c}
                    className="h-5 w-5 rounded-full ring-1 ring-inset ring-black/10"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="mt-2 text-xs text-slate-500">{t.desc}</div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function SyncSection() {
  const auth = useAuth();
  const sync = useSync();
  const [copied, setCopied] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const signedIn = !!auth.google;
  const folderUrl = sync.folderId
    ? `https://drive.google.com/drive/folders/${sync.folderId}`
    : null;
  const busy = sync.status === 'syncing';

  const needsReconnect = signedIn && sync.status === 'signed-out';
  const statusLabel = (() => {
    switch (sync.status) {
      case 'syncing':
        return 'Syncing…';
      case 'error':
        return 'Error';
      case 'offline':
        return 'Offline';
      case 'signed-out':
        return needsReconnect ? 'Reconnect needed' : 'Signed out';
      default:
        return 'Idle';
    }
  })();

  const statusTone = (() => {
    switch (sync.status) {
      case 'syncing':
        return 'text-info';
      case 'error':
        return 'text-danger';
      case 'offline':
      case 'signed-out':
        return 'text-warning';
      default:
        return 'text-success';
    }
  })();

  // When silent refresh can't reconnect (it's intermittent), force the visible
  // consent flow. A fresh session then triggers the auto-sync effect.
  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      await auth.signInGoogle();
    } finally {
      setReconnecting(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!folderUrl) return;
    try {
      await navigator.clipboard.writeText(folderUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; ignore
    }
  };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Google Drive sync</h3>
        <span className={`text-xs font-medium ${statusTone}`}>{statusLabel}</span>
      </div>

      {!signedIn && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Sync is off, so your data lives only on this device. If you clear your browser data or
          lose this device, it's gone. Sign in with Google above to keep a copy in Drive — or
          export a backup regularly from the section above.
        </div>
      )}

      {signedIn && needsReconnect && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <span className="min-w-0">
            Will reconnect to Google on the next sync — usually instant and silent. If it doesn't,
            use Reconnect to sign in again.
          </span>
          <button
            type="button"
            className="shrink-0 rounded border border-warning/50 px-2 py-1 font-medium text-warning hover:bg-warning/20 disabled:opacity-50"
            onClick={handleReconnect}
            disabled={reconnecting}
          >
            {reconnecting ? 'Reconnecting…' : 'Reconnect'}
          </button>
        </div>
      )}

      {signedIn && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-slate-200">Household folder</div>
              <div className="truncate text-xs text-slate-500">
                {folderUrl ? (
                  <a
                    href={folderUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted hover:text-slate-300"
                  >
                    Open "{HOUSEHOLD_FOLDER_NAME}" in Drive
                  </a>
                ) : (
                  <>Will be created on first sync as "{HOUSEHOLD_FOLDER_NAME}"</>
                )}
              </div>
            </div>
            <Button size="sm" onClick={() => sync.triggerSync('manual')} disabled={busy}>
              {busy ? 'Syncing…' : 'Sync now'}
            </Button>
          </div>

          <div className="text-xs text-slate-500">
            Last sync:{' '}
            <span className="text-slate-400">
              {sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : 'never'}
            </span>
            <span className="ml-2 text-slate-500">· automatically every 5 minutes</span>
          </div>

          {sync.lastResult && (
            <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              Sent {sync.lastResult.pushed} change(s) · received {sync.lastResult.pulled} from{' '}
              {sync.lastResult.peers} other device(s)
            </div>
          )}

          {sync.error && (
            <div className="flex items-start justify-between gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              <span className="min-w-0 break-words">{sync.error}</span>
              <button
                type="button"
                className="shrink-0 underline hover:text-danger"
                onClick={sync.dismissError}
              >
                dismiss
              </button>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">
              Other devices ({sync.peers.length})
            </div>
            {sync.peers.length === 0 ? (
              <div className="text-xs text-slate-500">
                No other devices have synced yet. Share the Drive folder with someone to combine your data.
              </div>
            ) : (
              <ul className="divide-y divide-slate-800 text-xs">
                {sync.peers.map((p) => (
                  <li
                    key={p.siteIdHex}
                    className="flex items-center justify-between gap-2 py-1.5"
                  >
                    <code className="truncate rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                      {p.siteIdHex.slice(0, 12)}…{p.siteIdHex.slice(-4)}
                    </code>
                    <span className="text-slate-500" title="How far this device has synced">
                      synced #{p.watermarkSeq}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {folderUrl && (
            <div className="rounded-md border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
              <div className="mb-1 font-medium text-slate-300">Invite your partner</div>
              <p>
                Open the folder in Drive and use <span className="text-slate-300">Share</span> to
                add your partner's Google account as an Editor. They sign in on their device, open
                this app, and their changes merge automatically.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleCopyUrl}>
                  {copied ? 'Copied!' : 'Copy folder URL'}
                </Button>
                <a
                  href={folderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-slate-500 underline decoration-dotted hover:text-slate-300"
                >
                  Open in Drive
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function AuthSection() {
  const auth = useAuth();
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);

  const doGoogle = async () => {
    setBusy('google');
    try {
      await auth.signInGoogle();
    } finally {
      setBusy(null);
    }
  };

  const doApple = async () => {
    setBusy('apple');
    try {
      await auth.signInApple();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-slate-300">Sign in</h3>
      {auth.error && (
        <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {auth.error}{' '}
          <button type="button" className="underline" onClick={auth.clearError}>
            dismiss
          </button>
        </div>
      )}

      <div className="space-y-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium text-slate-200">Google</div>
            <div className="text-xs text-slate-500">
              {auth.google
                ? auth.google.identity.email ?? auth.google.identity.name ?? 'Signed in'
                : 'Needed to sync across devices'}
            </div>
          </div>
          {auth.google ? (
            <Button variant="ghost" size="sm" onClick={auth.signOutGoogle}>
              Sign out
            </Button>
          ) : auth.googleConfigured ? (
            <Button size="sm" onClick={doGoogle} disabled={busy !== null}>
              {busy === 'google' ? 'Connecting…' : 'Connect'}
            </Button>
          ) : (
            <span className="text-xs text-slate-500">Not configured</span>
          )}
        </div>

        {auth.googleConfigured && (
          <label className="flex items-start gap-3 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-sky-500"
              checked={auth.trustDevice}
              onChange={(e) => auth.setTrustDevice(e.target.checked)}
            />
            <span className="text-xs text-slate-400">
              <span className="font-medium text-slate-300">Trust this device (stay signed in)</span>
              <br />
              Keeps you connected across browser restarts. On a shared or public computer, leave
              this off — your sign-in is then forgotten when you close the tab.
            </span>
          </label>
        )}

        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium text-slate-200">Apple</div>
            <div className="text-xs text-slate-500">
              {auth.apple
                ? auth.apple.email ?? auth.apple.name ?? 'Signed in'
                : 'Sign-in only — no sync'}
            </div>
          </div>
          {auth.apple ? (
            <Button variant="ghost" size="sm" onClick={auth.signOutApple}>
              Sign out
            </Button>
          ) : auth.appleConfigured ? (
            <Button size="sm" onClick={doApple} disabled={busy !== null}>
              {busy === 'apple' ? 'Connecting…' : 'Connect'}
            </Button>
          ) : (
            <span className="text-xs text-slate-500">Not configured</span>
          )}
        </div>

        {!auth.googleConfigured && !auth.appleConfigured && (
          <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-500">
            Set <code className="text-slate-400">VITE_GOOGLE_CLIENT_ID</code> and/or{' '}
            <code className="text-slate-400">VITE_APPLE_CLIENT_ID</code> in{' '}
            <code className="text-slate-400">.env.local</code> to enable sign-in. See{' '}
            <code className="text-slate-400">.env.example</code>.
          </div>
        )}
      </div>
    </Card>
  );
}

function ReviewSettingsSection() {
  const db = useDB();
  const [windowDays, setWindowDays] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettingNumber(db, SETTINGS_KEYS.DUP_SCAN_WINDOW_DAYS, 30).then(setWindowDays);
  }, [db]);

  const save = async (n: number) => {
    setSaving(true);
    try {
      await setSetting(db, SETTINGS_KEYS.DUP_SCAN_WINDOW_DAYS, String(n));
      setWindowDays(n);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold text-slate-300">Review queue</h3>
      <label className="block text-xs text-slate-400">
        Check for duplicates within (days)
        <Input
          type="number"
          min={1}
          max={365}
          value={windowDays ?? ''}
          disabled={saving || windowDays == null}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 1 && n <= 365) save(n);
          }}
        />
      </label>
      <div className="mt-1 text-xs text-slate-500">
        How many days back the app checks for possible duplicates. Default 30.
      </div>
    </Card>
  );
}

function DefaultCurrencySection() {
  const settings = useAppSettings();
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold text-slate-300">Default currency</h3>
      <Select
        value={settings.defaultCurrency}
        onChange={(e) => settings.setDefaultCurrency(e.target.value)}
      >
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.symbol} {c.code}
          </option>
        ))}
      </Select>
      <div className="mt-1 text-xs text-slate-500">
        Used for new accounts and budgets. Each account can still use a different currency.
      </div>
    </Card>
  );
}

function FxRatesSection() {
  const { defaultCurrency, fxRates, setFxRate } = useAppSettings();
  const accountsState = useQuery<Account[]>(
    useCallback((d) => listAccounts(d, true), []),
    { deps: ['accounts'] },
  );

  const foreignCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const a of accountsState.data ?? []) {
      if (a.currency !== defaultCurrency) set.add(a.currency);
    }
    return [...set].sort();
  }, [accountsState.data, defaultCurrency]);

  // Nothing to convert when every account is already in the default currency.
  if (foreignCurrencies.length === 0) return null;

  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-slate-300">Exchange rates</h3>
      <p className="mb-3 text-xs text-slate-500">
        Lets totals in Reports, Budgets and Cashflow mix currencies. Enter what 1 unit is worth in{' '}
        {defaultCurrency}. You enter these yourself, and they stay on this device.
      </p>
      <div className="space-y-2">
        {foreignCurrencies.map((code) => (
          <FxRateRow
            key={code}
            code={code}
            defaultCurrency={defaultCurrency}
            value={fxRates[code]}
            onSave={(v) => setFxRate(code, v)}
          />
        ))}
      </div>
    </Card>
  );
}

function FxRateRow({
  code,
  defaultCurrency,
  value,
  onSave,
}: {
  code: string;
  defaultCurrency: string;
  value: number | undefined;
  onSave: (v: number) => void;
}) {
  const [text, setText] = useState(value != null ? String(value) : '');
  useEffect(() => {
    setText(value != null ? String(value) : '');
  }, [value]);

  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0 && n !== value) onSave(n);
  };

  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-sm text-slate-300">1 {code} =</span>
      <Input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        placeholder="0.00"
        className="max-w-[8rem]"
      />
      <span className="text-sm text-slate-400">{defaultCurrency}</span>
      {value == null && <span className="text-xs text-warning">not set</span>}
    </div>
  );
}

const ACCOUNT_TYPES: AccountType[] = ['cash', 'bank', 'credit_card', 'wallet', 'loan', 'other'];

function ExportSection() {
  const db = useDB();
  const [busy, setBusy] = useState<null | 'csv' | 'backup' | 'encrypted'>(null);
  const [note, setNote] = useState<string | null>(null);

  // Encrypted-backup modal state.
  const [encryptOpen, setEncryptOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [encryptError, setEncryptError] = useState<string | null>(null);

  const run = async (kind: 'csv' | 'backup') => {
    setBusy(kind);
    setNote(null);
    try {
      if (kind === 'csv') {
        const csv = await buildTransactionsCsv(db);
        downloadText(exportFileName('transactions', 'csv'), csv, 'text/csv');
        setNote('Transactions spreadsheet downloaded.');
      } else {
        const backup = await buildFullBackup(db);
        const total = Object.values(backup.tables).reduce((n, rows) => n + rows.length, 0);
        downloadText(
          exportFileName('backup', 'json'),
          JSON.stringify(backup),
          'application/json',
        );
        setNote(`Backup downloaded — ${total} items saved.`);
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const closeEncrypt = () => {
    setEncryptOpen(false);
    setPassword('');
    setConfirmPw('');
    setEncryptError(null);
  };

  const runEncrypted = async () => {
    if (password.length < 8) {
      setEncryptError('Use a password of at least 8 characters.');
      return;
    }
    if (password !== confirmPw) {
      setEncryptError('The two passwords don’t match.');
      return;
    }
    setBusy('encrypted');
    setEncryptError(null);
    try {
      const backup = await buildFullBackup(db);
      const total = Object.values(backup.tables).reduce((n, rows) => n + rows.length, 0);
      const envelope = await encryptBackup(JSON.stringify(backup), password);
      downloadText(exportFileName('backup', 'encrypted.json'), envelope, 'application/json');
      setNote(`Encrypted backup downloaded — ${total} items saved.`);
      closeEncrypt();
    } catch (e) {
      setEncryptError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-300">Export</h3>
          <div className="text-xs text-slate-500">
            Download your data. The spreadsheet lists every transaction; the backup is a complete
            copy of everything, for safekeeping. An encrypted backup locks that copy with a password.
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={busy !== null} onClick={() => run('csv')}>
            {busy === 'csv' ? 'Exporting…' : 'Spreadsheet (CSV)'}
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => run('backup')}>
            {busy === 'backup' ? 'Exporting…' : 'Full backup'}
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => setEncryptOpen(true)}>
            Encrypted backup
          </Button>
        </div>
      </div>
      {note && <div className="mt-3 text-xs text-slate-400">{note}</div>}

      <Modal open={encryptOpen} onClose={() => busy !== 'encrypted' && closeEncrypt()} title="Encrypted backup">
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Choose a password. You’ll need it to restore this file — there’s no way to recover it if
            it’s lost, so store it somewhere safe.
          </p>
          <Input
            label="Password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
          <Input
            label="Confirm password"
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runEncrypted();
            }}
          />
          {encryptError && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {encryptError}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeEncrypt} disabled={busy === 'encrypted'}>
              Cancel
            </Button>
            <Button onClick={runEncrypted} disabled={busy === 'encrypted'}>
              {busy === 'encrypted' ? 'Encrypting…' : 'Download encrypted'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function RestoreSection() {
  const db = useDB();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ backup: BackupFile; rows: number; tables: number; name: string } | null>(null);
  const [encrypted, setEncrypted] = useState<{ env: EncryptedBackup; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = (backup: BackupFile, name: string) => {
    const rows = Object.values(backup.tables).reduce(
      (n, r) => n + (Array.isArray(r) ? r.length : 0),
      0,
    );
    const tables = Object.values(backup.tables).filter((r) => Array.isArray(r) && r.length > 0).length;
    setPending({ backup, rows, tables, name });
  };

  const onFile = async (file: File) => {
    setError(null);
    setNote(null);
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError("That file isn't valid JSON — pick a backup file exported from this app.");
      return;
    }
    if (isEncryptedBackup(parsed)) {
      setPassword('');
      setEncrypted({ env: parsed, name: file.name });
      return;
    }
    try {
      preview(parseBackup(text), file.name);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const unlock = async () => {
    if (!encrypted) return;
    setUnlocking(true);
    setError(null);
    try {
      const plaintext = await decryptBackup(encrypted.env, password);
      preview(parseBackup(plaintext), encrypted.name);
      setEncrypted(null);
      setPassword('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUnlocking(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await restoreBackup(db, pending.backup);
      // The VFS persists with "relaxed" durability, so the write isn't
      // guaranteed flushed to IndexedDB when restoreBackup resolves — reloading
      // here can tear the page down mid-flush and leave a malformed file.
      // close() then a fresh open() is a durability barrier: IndexedDB orders
      // the reopen's reads after all pending writes, so once open() resolves
      // the file is fully written. Only then is it safe to reload.
      setNote('Restored — reloading…');
      await closeDB();
      await openDB();
      // Reload so every reactive query re-reads the freshly rebuilt tables.
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-300">Restore</h3>
          <div className="text-xs text-slate-500">
            Load a backup file to bring your data back. This replaces everything currently on this device.
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
        <Button variant="secondary" className="shrink-0" onClick={() => inputRef.current?.click()}>
          Choose backup file…
        </Button>
      </div>
      {error && (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}
      {note && <div className="mt-3 text-xs text-success">{note}</div>}

      <Modal open={!!pending} onClose={() => !busy && setPending(null)} title="Restore from backup">
        {pending && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Restore <span className="font-medium text-slate-100">{pending.name}</span>? This deletes
              all current data and replaces it with{' '}
              <span className="font-medium text-slate-100">
                {pending.rows} items across {pending.tables} tables
              </span>{' '}
              from the backup. This can't be undone.
            </p>
            {busy && (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                Restoring your data — a large backup can take up to a minute. Keep this tab open.
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirm} disabled={busy}>
                {busy ? 'Restoring…' : 'Replace my data'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!encrypted}
        onClose={() => {
          if (!unlocking) {
            setEncrypted(null);
            setPassword('');
            setError(null);
          }
        }}
        title="Encrypted backup"
      >
        {encrypted && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              <span className="font-medium text-slate-100">{encrypted.name}</span> is encrypted.
              Enter its password to continue.
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
            {error && (
              <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setEncrypted(null);
                  setPassword('');
                  setError(null);
                }}
                disabled={unlocking}
              >
                Cancel
              </Button>
              <Button onClick={unlock} disabled={unlocking || !password}>
                {unlocking ? 'Unlocking…' : 'Unlock'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function ImportSection() {
  const db = useDB();
  const settings = useAppSettings();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [typeOverrides, setTypeOverrides] = useState<Record<string, AccountType>>({});
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [includeOverrides, setIncludeOverrides] = useState<Record<string, boolean>>({});
  const [stripText, setStripText] = useState('Z');
  const [wipeFirst, setWipeFirst] = useState(true);
  const [mainAccount, setMainAccount] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const reset = () => {
    setPlan(null);
    setFileName(null);
    setTypeOverrides({});
    setNameOverrides({});
    setIncludeOverrides({});
    setParseError(null);
    setResult(null);
    setMainAccount('');
  };

  const applyStrip = (prefix: string, name: string) =>
    prefix && name.startsWith(prefix) ? name.slice(prefix.length).trimStart() : name;

  // Re-derive every suggested name from the original CSV names using the prefix.
  const applyStripToAll = () => {
    if (!plan) return;
    const next: Record<string, string> = {};
    for (const a of plan.accounts) next[a.name] = applyStrip(stripText, a.name);
    setNameOverrides(next);
  };

  const onFile = async (file: File) => {
    setParseError(null);
    setResult(null);
    try {
      const text = await file.text();
      const parsed = parseMonefyCsv(text);
      if (parsed.warnings.length > 0 && parsed.accounts.length === 0) {
        setParseError(parsed.warnings.join('; '));
        setPlan(null);
        return;
      }
      setPlan(parsed);
      setFileName(file.name);
      const initialTypes: Record<string, AccountType> = {};
      const initialNames: Record<string, string> = {};
      const initialInclude: Record<string, boolean> = {};
      for (const a of parsed.accounts) {
        initialTypes[a.name] = a.type;
        initialNames[a.name] = applyStrip(stripText, a.name);
        initialInclude[a.name] = a.type !== 'loan';
      }
      setTypeOverrides(initialTypes);
      setNameOverrides(initialNames);
      setIncludeOverrides(initialInclude);
      setMainAccount(parsed.accounts[0]?.name ?? '');
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const runImport = async () => {
    if (!plan) return;
    setImporting(true);
    try {
      const overrides: ImportOverrides = {
        accountTypes: typeOverrides,
        names: nameOverrides,
        includeInTotal: includeOverrides,
        mainAccount: mainAccount || null,
        wipeFirst,
      };
      const res = await runMonefyImport(db, plan, overrides);
      await settings.refresh();
      setResult(
        `Imported ${res.accountsCreated} accounts, ${res.categoriesCreated} categories, ${res.transactionsCreated} transactions, ${res.transfersCreated} transfers.`,
      );
      setPlan(null);
      setFileName(null);
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-300">Import</h3>
          <div className="text-xs text-slate-500">
            Load a Monefy CSV export to replace or fill in your data.
          </div>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Import Monefy CSV
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => {
          if (importing) return;
          setOpen(false);
          reset();
        }}
        title="Import from Monefy"
        size="xl"
      >
        {!plan ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/50 p-6 text-center">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                  }}
                />
                <span className="text-sm text-slate-300">
                  Click to choose a Monefy CSV export
                </span>
              </label>
            </div>
            {parseError && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                {parseError}
              </div>
            )}
            {result && (
              <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
                {result}
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-slate-500">{fileName}</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Accounts" value={plan.accounts.length} />
              <Stat label="Categories" value={plan.categories.length} />
              <Stat label="Transactions" value={plan.transactions.length} />
              <Stat label="Transfers" value={plan.transfers.length} />
            </div>

            {(plan.unpairedTransfers.length > 0 || plan.skippedRows.length > 0) && (
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                {plan.unpairedTransfers.length > 0 && (
                  <div>{plan.unpairedTransfers.length} transfers couldn't be matched and will be skipped.</div>
                )}
                {plan.skippedRows.length > 0 && (
                  <div>{plan.skippedRows.length} entries with errors will be skipped.</div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-300">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Strip from start of names</span>
                <input
                  type="text"
                  value={stripText}
                  onChange={(e) => setStripText(e.target.value)}
                  placeholder="e.g. Z"
                  className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-50"
                />
                <Button variant="secondary" onClick={applyStripToAll}>
                  Apply to all
                </Button>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={wipeFirst}
                  onChange={(e) => setWipeFirst(e.target.checked)}
                  className="h-4 w-4 accent-brand-500"
                />
                Delete all current data first
                <InfoHint label="What this does" title="Replace or add">
                  On (recommended for a re-import) wipes everything first. Off adds the
                  imported accounts and categories as new — it won’t merge into ones you
                  already have, so same-named entries become duplicates.
                </InfoHint>
              </label>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-slate-400">
                Accounts — edit name, type, what counts toward your total, and your main one
              </div>
              <div className="max-h-72 overflow-auto rounded-lg border border-slate-800">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-900 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Main</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2 text-center">In total</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.accounts.map((a) => (
                      <tr key={a.name} className="border-t border-slate-800">
                        <td className="px-3 py-1.5">
                          <input
                            type="radio"
                            name="main-account"
                            checked={mainAccount === a.name}
                            onChange={() => setMainAccount(a.name)}
                            className="h-4 w-4 accent-brand-500"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            value={nameOverrides[a.name] ?? a.name}
                            onChange={(e) =>
                              setNameOverrides((prev) => ({ ...prev, [a.name]: e.target.value }))
                            }
                            className="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-50"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            value={typeOverrides[a.name] ?? a.type}
                            onChange={(e) =>
                              setTypeOverrides((prev) => ({
                                ...prev,
                                [a.name]: e.target.value as AccountType,
                              }))
                            }
                            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-50"
                          >
                            {ACCOUNT_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={includeOverrides[a.name] ?? (typeOverrides[a.name] ?? a.type) !== 'loan'}
                            onChange={(e) =>
                              setIncludeOverrides((prev) => ({ ...prev, [a.name]: e.target.checked }))
                            }
                            className="h-4 w-4 accent-brand-500"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">
                          {a.openingBalanceMinor !== 0
                            ? formatMoney(a.openingBalanceMinor, a.currency, { signed: true })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {parseError && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                {parseError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={reset} disabled={importing}>
                Choose different file
              </Button>
              <Button onClick={runImport} disabled={importing}>
                {importing ? 'Importing…' : 'Import'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-50 tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}

function RecurringRulesSection() {
  const db = useDB();
  const defaultSettingsCurrency = useDefaultCurrency();
  const [creating, setCreating] = useState(false);

  const rulesState = useQuery<RecurringRule[]>(
    useCallback((d) => listRecurringRules(d, true), []),
    { deps: ['recurring_rules'] },
  );
  const accountsState = useQuery<Account[]>(
    useCallback((d) => listAccounts(d), []),
    { deps: ['accounts'] },
  );
  const categoriesState = useQuery<Category[]>(
    useCallback((d) => listCategories(d), []),
    { deps: ['categories'] },
  );

  const rules = rulesState.data ?? [];
  const accounts = accountsState.data ?? [];
  const categories = categoriesState.data ?? [];
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const active = rules.filter((r) => !r.archived_at);
  const archived = rules.filter((r) => r.archived_at);

  const handleArchive = async (id: string) => {
    await archiveRecurringRule(db, id);
  };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Recurring rules</h3>
        <Button size="sm" onClick={() => setCreating(true)}>
          + New rule
        </Button>
      </div>

      {active.length === 0 && (
        <EmptyState
          title="No recurring rules"
          description="Set up auto-repeating transactions like rent or subscriptions."
        />
      )}

      {active.length > 0 && (
        <div className="divide-y divide-slate-800">
          {active.map((rule) => {
            const tpl: RecurringTemplate = JSON.parse(rule.template_json);
            const acct = accountMap.get(tpl.account_id);
            const cat = catMap.get(tpl.category_id ?? '');
            return (
              <div key={rule.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="flex items-center gap-2 text-sm text-slate-50">
                    <span>{cat?.icon ?? '•'}</span>
                    <span>{cat?.name ?? 'Uncategorized'}</span>
                    <span className="text-slate-500">·</span>
                    <span className="tabular-nums">
                      {formatMoney(tpl.amount_minor, acct?.currency ?? defaultSettingsCurrency)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {tpl.kind === 'income' ? 'Income' : 'Expense'} · {acct?.name ?? '?'} · next:{' '}
                    {formatHumanDate(rule.next_run_on)}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleArchive(rule.id)}>
                  Archive
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {archived.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
            {archived.length} archived
          </summary>
          <div className="mt-2 space-y-1 text-xs text-slate-500">
            {archived.map((r) => {
              const tpl: RecurringTemplate = JSON.parse(r.template_json);
              const cat = catMap.get(tpl.category_id ?? '');
              return (
                <div key={r.id}>
                  {cat?.icon} {cat?.name} — {tpl.kind}
                </div>
              );
            })}
          </div>
        </details>
      )}

      <RecurringFormModal
        open={creating}
        onClose={() => setCreating(false)}
        accounts={accounts}
        categories={categories}
      />
    </Card>
  );
}

const FREQUENCY_OPTIONS = [
  { label: 'Daily', rrule: 'FREQ=DAILY;INTERVAL=1' },
  { label: 'Weekly', rrule: 'FREQ=WEEKLY;INTERVAL=1' },
  { label: 'Biweekly', rrule: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Monthly', rrule: 'FREQ=MONTHLY;INTERVAL=1' },
  { label: 'Quarterly', rrule: 'FREQ=MONTHLY;INTERVAL=3' },
  { label: 'Yearly', rrule: 'FREQ=YEARLY;INTERVAL=1' },
];

interface RecurringFormModalProps {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  categories: Category[];
}

function RecurringFormModal({ open, onClose, accounts, categories }: RecurringFormModalProps) {
  const db = useDB();
  const defaultCurrency = useDefaultCurrency();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [note, setNote] = useState('');
  const [freq, setFreq] = useState(FREQUENCY_OPTIONS[3].rrule);
  const [startDate, setStartDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filteredCats = useMemo(() => categories.filter((c) => c.kind === kind), [categories, kind]);

  useEffect(() => {
    if (!open) return;
    setKind('expense');
    setAccountId(accounts.find((a) => a.is_main)?.id ?? accounts[0]?.id ?? '');
    setCategoryId('');
    setAmountInput('');
    setNote('');
    setFreq(FREQUENCY_OPTIONS[3].rrule);
    setStartDate(toDateString());
  }, [open, accounts]);

  const currency = accounts.find((a) => a.id === accountId)?.currency ?? defaultCurrency;

  const handleSubmit = async () => {
    const minor = parseAmount(amountInput, currency);
    if (!accountId || !categoryId || !minor || minor <= 0 || !startDate) return;
    setSubmitting(true);
    try {
      const input: RecurringRuleInput = {
        template: {
          account_id: accountId,
          category_id: categoryId,
          amount_minor: minor,
          kind,
          note: note.trim() || null,
        },
        rrule: `DTSTART:${startDate.replace(/-/g, '')}T000000Z\n${freq}`,
        next_run_on: startDate,
      };
      await createRecurringRule(db, input);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New recurring rule">
      <div className="space-y-3">
        <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
          {(['expense', 'income'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setKind(m); setCategoryId(''); }}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition ${
                kind === m
                  ? m === 'expense'
                    ? 'bg-clay-500/20 text-clay-300'
                    : 'bg-mint-500/20 text-mint-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m === 'expense' ? 'Expense' : 'Income'}
            </button>
          ))}
        </div>
        <Combobox
          label="Account"
          value={accountId}
          onChange={setAccountId}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        />
        <Combobox
          label="Category"
          value={categoryId}
          onChange={setCategoryId}
          emptyOption={{ value: '', label: 'Select…' }}
          options={filteredCats.map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim() }))}
        />
        <Input
          label="Amount"
          inputMode="decimal"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          placeholder="0.00"
          autoFocus
        />
        <Select label="Frequency" value={freq} onChange={(e) => setFreq(e.target.value)}>
          {FREQUENCY_OPTIONS.map((f) => (
            <option key={f.rrule} value={f.rrule}>{f.label}</option>
          ))}
        </Select>
        <Input
          label="Start date"
          labelHint={
            <InfoHint label="About the start date" title="Past dates backfill">
              The first date this rule runs. Pick a date in the past and we’ll fill in
              every occurrence from then up to today in one go.
            </InfoHint>
          }
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || !accountId || !categoryId || !amountInput}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}
