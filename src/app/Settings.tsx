import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw, Palette, Download, Pencil, Plus, type LucideIcon } from 'lucide-react';
import { PageShell } from './PageShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Combobox } from '@/components/ui/Combobox';
import { Modal } from '@/components/ui/Modal';
import { useDB } from '@/db/DBProvider';
import { useSiteId } from '@/db/DBProvider';
import { useQuery } from '@/db/useQuery';
import { listAccounts } from '@/db/queries/accounts';
import { getSettingNumber, setSetting, SETTINGS_KEYS } from '@/db/queries/settings';
import { useAuth } from '@/auth/AuthProvider';
import { useSync } from '@/sync/SyncProvider';
import { isPickerConfigured, type PickedFile } from '@/sync/googlePicker';
import { BOOK_FILE_NAME } from '@/sync/bookFile';
import { GoogleAccessNote } from '@/auth/GoogleAccessNote';
import { useFreshToken } from '@/auth/useFreshToken';
import { CAN_RENEW_SILENTLY } from '@/auth/google';
import { describeSource } from '@/components/ConvertedMark';
import type { FxRate } from '@/lib/fx';
import { TrustDeviceToggle } from '@/auth/TrustDeviceToggle';
import { SpamHint } from '@/sync/SpamHint';
import { rememberRetiringIdentity, stashJoinTarget } from '@/sync/joinFresh';
import { DevJoinById } from '@/sync/DevJoinById';
import { markSafetyBackup, peekBook, type BookPeek, type SyncResult } from '@/sync/household';
import { APP_FOLDER_NAME } from '@/sync/driveFolders';
import { shareFileWithEmail } from '@/sync/googleDrive';
import { useBookPicker } from '@/sync/useBookPicker';
import { BookIdentity } from '@/sync/BookIdentity';
import { clearInvite, inviteLink, peekInvite } from '@/sync/invite';
import type { DriveSnapshot } from '@/sync/driveBackup';
import { reloadToUpdate } from '@/pwa/update';
import { isIOS, isPhone, promptInstall, useInstall } from '@/pwa/install';
import { useAppSettings } from './AppSettingsProvider';
import { CURRENCY_OPTIONS } from '@/lib/money';
import type { Account, AccountType } from '@/db/types';
import { formatMoney } from '@/lib/money';
import { formatHumanDate } from '@/lib/dates';
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
import { useTheme, applyTheme, applyCustomTheme, getCustomColors, THEMES } from '@/lib/theme';
import { buildTheme } from '@/lib/customTheme';
import { listThemes, type CustomTheme } from '@/db/queries/themes';
import { ThemeEditor } from './ThemeEditor';


type TabId = 'sharing' | 'preferences' | 'data';

// Three groups a person can tell apart at a glance, instead of one long page.
// Each section keeps its own id so deep links (/settings#sync) still land on it.
const TABS: { id: TabId; label: string; Icon: LucideIcon; sections: string[] }[] = [
  { id: 'sharing', label: 'Sync & sharing', Icon: RefreshCw, sections: ['signin', 'sync', 'device'] },
  { id: 'preferences', label: 'Preferences', Icon: Palette, sections: ['install', 'appearance', 'currency', 'rates', 'review'] },
  { id: 'data', label: 'Your data', Icon: Download, sections: ['export', 'import', 'restore', 'reset'] },
];

function tabFor(hash: string): TabId {
  const id = hash.replace(/^#/, '');
  return TABS.find((t) => t.id === id || t.sections.includes(id))?.id ?? 'sharing';
}

export function Settings() {
  const siteId = useSiteId();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const tab = tabFor(hash);

  // A deep link to a section (/settings#sync, from the sync-paused banner)
  // opens its tab and scrolls to it.
  useEffect(() => {
    const id = hash.slice(1);
    if (id && !TABS.some((t) => t.id === id)) {
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    }
  }, [hash]);

  return (
    <PageShell title="Settings">
      <div
        role="tablist"
        aria-label="Settings sections"
        className="sticky top-0 z-20 -mx-1 flex gap-1 overflow-x-auto bg-slate-950/85 px-1 py-2 backdrop-blur [scrollbar-width:none]"
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => navigate({ hash: id }, { replace: true })}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm sm:flex-none sm:px-3 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
              tab === id
                ? 'bg-brand-500/15 text-brand-300 ring-1 ring-inset ring-brand-500/40'
                : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
            }`}
          >
            <Icon className="hidden h-4 w-4 sm:block" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'sharing' && (
        <>
          <Section id="signin"><AuthSection /></Section>
          <Section id="sync"><SyncSection /></Section>
          <Section id="device"><ThisDeviceSection siteId={siteId} /></Section>
        </>
      )}
      {tab === 'preferences' && (
        <>
          {/* Renders its own #install anchor, or nothing once Copper runs installed. */}
          <InstallSection />
          <Section id="appearance"><AppearanceSection /></Section>
          <Section id="currency"><DefaultCurrencySection /></Section>
          {/* Renders its own #rates anchor, or nothing when all accounts share a currency. */}
          <FxRatesSection />
          <Section id="review"><ReviewSettingsSection /></Section>
        </>
      )}
      {tab === 'data' && (
        <>
          <Section id="export"><ExportSection /></Section>
          <Section id="import"><ImportSection /></Section>
          <Section id="restore"><RestoreSection /></Section>
          <Section id="reset"><ResetDeviceSection /></Section>
          <p className="text-center text-xs text-slate-600">
            For power users:{' '}
            <Link to="/sql" className="underline hover:text-slate-400">
              SQL console
            </Link>
          </p>
        </>
      )}
      <p className="pt-2 text-center text-xs text-slate-600">
        <Link to="/privacy" className="hover:text-slate-400">Privacy</Link>
        {' · '}
        <Link to="/terms" className="hover:text-slate-400">Terms</Link>
      </p>
    </PageShell>
  );
}

// Anchor wrapper for a settings section. scroll-mt clears the sticky tab bar so
// a jumped-to heading isn't hidden behind it.
function Section({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      {children}
    </section>
  );
}

// On a phone Copper works best installed: its own icon, full screen, offline.
// The bottom notice can be dismissed, so the offer lives here too.
function InstallSection() {
  const { canPrompt, installed } = useInstall();
  const [asking, setAsking] = useState(false);
  if (installed || (!canPrompt && !isPhone)) return null;
  return (
    <Section id="install">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="mb-1 text-sm font-semibold text-slate-300">Install Copper</h3>
            <p className="text-xs text-slate-500">
              {canPrompt
                ? 'Add Copper to your home screen. It opens full screen like any other app, and works offline.'
                : isIOS
                  ? 'In Safari, tap Share, then Add to Home Screen. Copper then opens full screen like any other app, and works offline.'
                  : 'Open your browser’s menu (⋮) and choose Install app or Add to Home screen. Copper then opens full screen like any other app, and works offline.'}
            </p>
          </div>
          {canPrompt && (
            <Button
              className="shrink-0"
              disabled={asking}
              onClick={async () => {
                setAsking(true);
                try {
                  await promptInstall();
                } finally {
                  setAsking(false);
                }
              }}
            >
              Install
            </Button>
          )}
        </div>
      </Card>
    </Section>
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

  const others = (devicesState.data ?? []).filter((d) => d.site_id !== siteId && !d.retired_at);
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

      {others.length > 0 && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <div className="mb-2 text-xs font-medium text-slate-400">Other devices in this book</div>
          <ul className="space-y-1">
            {others.map((d) => (
              <li key={d.site_id} className="flex items-center justify-between text-xs text-slate-500">
                <span className="text-slate-300">
                  {d.name}
                  {d.person && <span className="text-slate-500"> · {d.person}</span>}
                </span>
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
  const db = useDB();
  const auth = useAuth();
  const sync = useSync();
  const synced = !!(sync.bookId && auth.google);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-300">Erase this device</h3>
          <div className="text-xs text-slate-500">
            {synced
              ? 'Removes Copper’s data from this device only, then loads your book again from Google Drive. Other devices aren’t affected.'
              : 'Removes all of Copper’s data from this device and starts over.'}
          </div>
        </div>
        <Button variant="danger" className="shrink-0" onClick={() => setOpen(true)}>
          Erase…
        </Button>
      </div>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Erase this device">
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            This removes your accounts, transactions and settings from this device and reloads the app.
            {synced && ' Your book then loads again from Google Drive; other devices aren’t affected.'}
          </p>
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            {synced
              ? sync.unsynced
                ? 'Some changes on this device haven’t reached Google Drive yet and will be lost. Sync first if you want to keep them.'
                : 'Everything here is already in Google Drive, so nothing is lost.'
              : 'Sync is off, so this is your only copy. Download a backup first if you might want it back. This can’t be undone.'}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setBusy(true);
                // Connected: come back as a fresh copy of the shared book — no
                // seeded defaults merged into it, and no Welcome screen.
                rememberRetiringIdentity(db.siteid);
                if (sync.bookId && auth.google) stashJoinTarget(sync.bookId);
                requestLocalReset();
              }}
              disabled={busy}
            >
              {busy ? 'Erasing…' : 'Erase this device'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function AppearanceSection() {
  const theme = useTheme();
  const custom = useQuery<CustomTheme[]>(useCallback((db) => listThemes(db), []), { deps: ['themes'] });
  const [editing, setEditing] = useState<CustomTheme | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-slate-300">Appearance</h3>
      <p className="mb-3 text-xs text-slate-500">
        Pick the look for this device. Themes you make are shared with every device in your book.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {THEMES.map((t) => {
          const active = theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => applyTheme(t.id)}
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
        {(custom.data ?? []).map((t) => {
          const active = theme === `custom:${t.id}`;
          const { mode, vars } = buildTheme(t);
          const swatch = [t.background, t.accent, vars['--mint-400'], vars['--clay-400']].map((c) =>
            c.startsWith('#') ? c : `rgb(${c.split(' ').join(',')})`,
          );
          return (
            <div
              key={t.id}
              className={`relative rounded-xl border transition ${
                active ? 'border-brand-400 bg-slate-800/60' : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
              }`}
            >
              <button type="button" onClick={() => applyCustomTheme(t)} className="block w-full p-3 text-left">
                <div className="flex items-center gap-2 pr-8">
                  <span className="truncate text-sm font-medium text-slate-100">{t.name}</span>
                  {active ? (
                    <span className="ml-auto text-xs font-medium text-brand-500">Active</span>
                  ) : (
                    <span className="ml-auto rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                      {mode === 'light' ? 'Light' : 'Dark'}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex gap-1.5">
                  {swatch.map((c, i) => (
                    <span key={i} className="h-5 w-5 rounded-full ring-1 ring-inset ring-black/10" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <div className="mt-2 text-xs text-slate-500">Made by you</div>
              </button>
              <button
                type="button"
                aria-label={`Edit ${t.name}`}
                onClick={() => setEditing(t)}
                className="absolute right-2 top-2 rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        {theme.startsWith('custom:') && custom.data && !custom.data.some((t) => theme === `custom:${t.id}`) && (
          // Deleted on another device: still on screen here until another is picked.
          <div className="rounded-xl border border-brand-400 bg-slate-800/60 p-3">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-slate-100">{getCustomColors()?.name ?? 'Your theme'}</span>
              <span className="ml-auto text-xs font-medium text-brand-500">Active</span>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Removed on another device. It stays here until you pick another theme.
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex min-h-[6.5rem] items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 p-3 text-sm font-medium text-slate-400 transition hover:border-slate-500 hover:text-slate-100"
        >
          <Plus className="h-4 w-4" />
          Make your own
        </button>
      </div>
      <ThemeEditor
        open={creating || editing !== null}
        existing={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </Card>
  );
}

// Plain words, no counts: the counts are CRDT cells (one transaction is ~10),
// which mean nothing to the person reading this.
function syncResultText(r: SyncResult): string {
  if (r.wrote === 'created') return 'Created the shared book';
  if (r.wrote === 'replaced') return "Replaced the shared book with this device's copy";
  const sent = !!r.uploadedFile;
  const got = r.pulled > 0;
  if (sent && got) return 'Sent your changes and got the latest';
  if (sent) return 'Sent your changes';
  if (got) return 'Got the latest changes';
  return 'Up to date';
}

function SyncSection() {
  const db = useDB();
  const auth = useAuth();
  const sync = useSync();
  // Friendly device names live in the CRR `devices` table and sync between
  // devices, so a peer we know only by site id here often already has a name a
  // partner typed. Join by site id to show "Ashish's phone" instead of raw hex.
  // `devices.site_id` (db.siteid) is upper-case hex while a peer's siteIdHex is
  // lower-case, so key the map lower-cased and look up the same way.
  const devicesState = useQuery<Device[]>(
    useCallback((d) => listDevices(d), []),
    { deps: ['devices'] },
  );
  const deviceNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of devicesState.data ?? []) {
      if (d.name) m.set(d.site_id.toLowerCase(), d.person ? `${d.name} · ${d.person}` : d.name);
    }
    return m;
  }, [devicesState.data]);
  const [reconnecting, setReconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const book = useBookPicker();
  // An invite link (/join/<bookId>) routes an onboarded device here.
  const [inviteBookId, setInviteBookId] = useState(() => peekInvite());
  const [joinMode, setJoinMode] = useState<'fresh' | 'merge' | 'replace'>('fresh');
  // "Overwrite the shared book" is a sharp, rarely-right tool (other devices
  // lose unsynced changes), so it stays tucked behind an Advanced disclosure
  // rather than sitting as a co-equal choice next to Start fresh / Merge.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmFresh, setConfirmFresh] = useState(false);
  // Whose book this is: the owner shares it; someone who joined sees whose it
  // is, and may only re-share if Drive allows (an owner can restrict editors).
  // Keyed by book id so a token refresh (which re-runs the lookup) doesn't blank it.
  const [ownership, setOwnership] = useState<(BookPeek & { bookId: string }) | null>(null);

  const signedIn = !!auth.google;
  const pickerReady = isPickerConfigured();
  // Only with a token that's still fresh. Refreshing one means a Google popup,
  // which the browser blocks without a click — and the half-open request then
  // swallows the next "Sync now". A sync refreshes the token, and this re-runs.
  const freshToken = useFreshToken();
  useEffect(() => {
    const bookId = sync.bookId;
    if (!freshToken || !bookId) return;
    let cancelled = false;
    peekBook(freshToken, bookId)
      .then((peek) => {
        if (!cancelled) setOwnership({ ...peek, bookId });
      })
      .catch(() => {
        // Unknown ownership: the generic copy below still holds.
      });
    return () => {
      cancelled = true;
    };
  }, [freshToken, sync.bookId]);
  const joined = ownership?.bookId === sync.bookId && !ownership.ownedByMe;
  const ownerName = ownership?.owner ?? 'its owner';
  const folderUrl = sync.appFolderId
    ? `https://drive.google.com/drive/folders/${sync.appFolderId}`
    : null;
  const busy = sync.status === 'syncing';
  const link = sync.bookId ? inviteLink(sync.bookId) : null;

  // Background syncs never reopen an expired sign-in (that takes a click), so
  // an expired one means changes wait here until the person taps.
  // With the sign-in helper an expired token renews by itself, so it isn't a reason to ask.
  const needsReconnect =
    signedIn &&
    (sync.status === 'signed-out' || (sync.status === 'idle' && !freshToken && !CAN_RENEW_SILENTLY));
  // Sync stopped on purpose to let the person decide (a book found, the book
  // replaced, or a newer app version wrote it) — not a failure.
  const needsChoice = sync.status === 'error' && (!!sync.foundBookId || sync.bookReplaced || sync.newerBook);
  const statusLabel = (() => {
    if (needsReconnect) return 'Reconnect needed';
    if (needsChoice) return sync.newerBook ? 'Update Copper to continue' : 'Needs your choice';
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
    if (needsReconnect || needsChoice) return 'text-warning';
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

  // Partner-across-accounts sharing: because Copper uses the narrow `drive.file`
  // scope, a book shared with you is invisible until you pick it in the Google
  // Picker — the pick is what grants access. See googlePicker.ts.
  const openBookPicker = async (fileId?: string, devFile?: PickedFile) => {
    setJoinMode('fresh');
    setShowAdvanced(false);
    setConnectError(null);
    await book.choose(fileId, devFile);
  };

  // Give the partner's Google account edit access to the book, then hand over a
  // link to send them. No Google notification email is sent: those tend to land
  // in spam, and the partner needs the link to open the book in Copper anyway.
  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!sync.bookId || !email) return;
    setInviting(true);
    setInviteError(null);
    try {
      const token = await auth.getGoogleAccessToken();
      if (!token) throw new Error('Your Google sign-in has expired. Tap Reconnect, then try again.');
      await shareFileWithEmail(token, sync.bookId, email, false);
      setInvitedEmail(email);
      setInviteEmail('');
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : 'Couldn’t share the book. Check the email is a Google account and try again.');
    } finally {
      setInviting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; the link is on screen to copy by hand
    }
  };

  const closeJoin = () => {
    book.clear();
    clearInvite();
    setInviteBookId(null);
  };

  // "Start fresh": erase this device, then adopt the partner's book at the next
  // boot (see joinFresh + db/client). "Merge" / "Overwrite": switch now; the
  // next sync backs the book up first, then merges into or replaces it.
  const handleConfirmJoin = async () => {
    if (!book.picked) return;
    if (joinMode === 'fresh') {
      stashJoinTarget(book.picked.id, db.siteid);
      clearInvite();
      requestLocalReset();
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      await sync.joinBook(book.picked.id, joinMode);
      closeJoin();
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Could not join the book.');
    } finally {
      setConnecting(false);
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
          lose this device, it's gone. Sign in with Google above to keep a copy in Drive, or
          download a backup now and then (under Export, further down).
        </div>
      )}

      {signedIn && needsReconnect && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <span className="min-w-0">
            Your Google sign-in has expired (they last about an hour), so changes are waiting on
            this device. Tap Reconnect — usually you just pick your account.
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

      {signedIn && inviteBookId && pickerReady && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-info/40 bg-info/10 px-3 py-2 text-xs text-info">
          <span className="min-w-0">
            You opened an invite to a shared book. Open it to choose how to join.
          </span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded border border-info/50 px-2 py-1 font-medium hover:bg-info/20 disabled:opacity-50"
              onClick={() => openBookPicker(inviteBookId)}
              disabled={book.busy || busy}
            >
              {book.busy ? 'Opening…' : 'Open shared book'}
            </button>
            <button type="button" className="underline" onClick={closeJoin}>
              dismiss
            </button>
          </div>
        </div>
      )}

      {signedIn && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-slate-200">Shared book</div>
              <div className="truncate text-xs text-slate-500">
                {joined ? (
                  <>Shared by {ownerName}</>
                ) : folderUrl ? (
                  <a
                    href={folderUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted hover:text-slate-300"
                  >
                    Open "{APP_FOLDER_NAME}" in Drive
                  </a>
                ) : sync.bookId ? (
                  <>Connected — loads on the next sync</>
                ) : (
                  <>Created on first sync in "{APP_FOLDER_NAME}"</>
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
              {sync.lastSyncAt
                ? new Date(sync.lastSyncAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                : 'never'}
            </span>
            <span className="ml-2 text-slate-500">· when you open or leave the app, and every few minutes while it's open</span>
          </div>

          {sync.lastResult && (
            <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              {syncResultText(sync.lastResult)}
            </div>
          )}

          {sync.error && (
            <div
              className={`flex flex-col gap-2 rounded-md border px-3 py-2 text-xs ${
                needsChoice ? 'border-warning/40 bg-warning/10 text-warning' : 'border-danger/40 bg-danger/10 text-danger'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words">{sync.error}</span>
                <button
                  type="button"
                  className="shrink-0 underline hover:text-danger"
                  onClick={sync.dismissError}
                >
                  dismiss
                </button>
              </div>
              {sync.needsReauth && (
                <button
                  type="button"
                  className="self-start rounded border border-danger/50 px-2 py-1 font-medium text-danger hover:bg-danger/20 disabled:opacity-50"
                  onClick={handleReconnect}
                  disabled={reconnecting}
                >
                  {reconnecting ? 'Reconnecting…' : 'Reconnect to Google'}
                </button>
              )}
              {sync.newerBook && (
                <button
                  type="button"
                  className="self-start rounded border border-warning/50 px-2 py-1 font-medium text-warning hover:bg-warning/20"
                  onClick={() => void reloadToUpdate()}
                >
                  Update Copper
                </button>
              )}
              {sync.foundBookId && !book.picked && (
                <button
                  type="button"
                  className="self-start rounded border border-warning/50 px-2 py-1 font-medium text-warning hover:bg-warning/20 disabled:opacity-50"
                  onClick={() => book.choose(undefined, { id: sync.foundBookId!, name: BOOK_FILE_NAME })}
                  disabled={book.busy}
                >
                  Choose what to do…
                </button>
              )}
              {sync.bookReplaced && sync.bookId && (
                <button
                  type="button"
                  className="self-start rounded border border-warning/50 px-2 py-1 font-medium text-warning hover:bg-warning/20"
                  onClick={() => setConfirmFresh(true)}
                >
                  Load the shared book again…
                </button>
              )}
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-medium text-slate-400">
              Other devices ({sync.peers.length})
            </div>
            {sync.peers.length === 0 ? (
              <div className="text-xs text-slate-500">
                No other devices have synced yet. Invite your partner below to share one book.
              </div>
            ) : (
              <ul className="divide-y divide-slate-800 text-xs">
                {sync.peers.map((p) => {
                  const name = deviceNames.get(p.siteIdHex.toLowerCase());
                  return (
                    <li key={p.siteIdHex} className="flex items-center gap-2 py-1.5">
                      <span className="truncate text-slate-300">{name ?? 'Unnamed device'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {pickerReady && (
            <div className="space-y-3 rounded-md border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
              <div>
                <div className="mb-1 font-medium text-slate-300">
                  {joined ? 'Invite someone else' : 'Invite your partner'}
                </div>
                {joined ? (
                  <p>
                    This is {ownerName}'s book.{' '}
                    {ownership!.canShare
                      ? 'You can share it with another Google account too, then send them the link.'
                      : `Only ${ownerName} can share it — ask them to invite anyone else.`}
                  </p>
                ) : (
                  <p>
                    Share this book with your partner's Google account, then send them the link. They
                    open it, sign in, and pick the book once — from then on you both sync to it.
                  </p>
                )}
                {joined && !ownership!.canShare ? null : sync.bookId ? (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="partner@gmail.com"
                        aria-label="Partner's Google email"
                        className="w-60 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1 text-sm text-slate-50 focus:border-brand-400 focus:outline-none"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleInvite}
                        disabled={inviting || !inviteEmail.trim()}
                      >
                        {inviting ? 'Sharing…' : 'Share book'}
                      </Button>
                    </div>
                    {invitedEmail && link && (
                      <div className="mt-2 space-y-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-success">
                        <div>
                          Shared with {invitedEmail}. Now send them this link. If they can't
                          find the book, it may be in their Drive's Spam.
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="break-all rounded bg-slate-900/60 px-1.5 py-0.5 text-slate-300">
                            {link}
                          </code>
                          <Button variant="ghost" size="sm" onClick={handleCopyLink}>
                            {copied ? 'Copied!' : 'Copy link'}
                          </Button>
                        </div>
                      </div>
                    )}
                    {inviteError && (
                      <div className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
                        {inviteError}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-slate-500">Sync once to create your book, then invite.</p>
                )}
              </div>

              <div className="border-t border-slate-800 pt-3">
                <div className="mb-1 font-medium text-slate-300">
                  {joined ? 'Join a different book' : "Join your partner's book"}
                </div>
                <p>Got an invite? Open the link they sent, or choose the book they shared here.</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openBookPicker()}
                    disabled={book.busy || busy}
                  >
                    {book.busy ? 'Opening…' : 'Choose shared book…'}
                  </Button>
                  <DevJoinById onPick={(f) => openBookPicker(undefined, f)} disabled={book.busy || busy} />
                </div>
                <SpamHint className="mt-2" />
                {book.error && (
                  <div className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">
                    {book.error}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Modal open={confirmFresh} onClose={() => setConfirmFresh(false)} title="Load the shared book again">
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            This clears Copper on this device and loads the shared book in its place.
          </p>
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            Changes made on this device since it last synced are lost. Download a backup first if
            you want to keep them.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmFresh(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                stashJoinTarget(sync.bookId!, db.siteid);
                requestLocalReset();
              }}
            >
              Load shared book
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!book.picked}
        onClose={() => !connecting && closeJoin()}
        title="Join a shared book"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Joining this book. Choose what happens to the data already on this device.
          </p>

          {book.picked && (
            <BookIdentity
              name={book.picked.name}
              peek={book.peek}
              peekError={book.peekError}
              onRetry={() => book.choose(book.picked!.id)}
              retrying={book.busy}
            />
          )}

          <div className="space-y-2">
            <JoinModeOption
              active={joinMode === 'fresh'}
              onSelect={() => setJoinMode('fresh')}
              title="Start fresh"
              badge="Recommended"
              desc="Erase this device and load the shared book. Nothing here is copied into it. Best for a new device, or when you're joining your partner's book."
            />
            <JoinModeOption
              active={joinMode === 'merge'}
              onSelect={() => setJoinMode('merge')}
              title="Merge my data in"
              desc="Combine this device's data with the shared book. Everything here is copied into it for both of you. Best when you each have data to keep."
            />
          </div>

          {joinMode === 'fresh' && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              This erases everything on this device and can't be undone. Download a backup first if you
              have data you might want.
            </div>
          )}

          {joinMode === 'merge' && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              Merging adds this device's copy on top — if it's the same book you just restored,
              you'll get duplicates. If you only want what's already in the book, choose{' '}
              <span className="font-medium">Start fresh</span> instead. A backup of the book is saved
              before merging.
            </div>
          )}

          {/* Overwrite is the sharp tool: dangerous with other devices. Kept
              behind a disclosure. */}
          <div className="border-t border-slate-800 pt-3">
            {!showAdvanced ? (
              <button
                type="button"
                onClick={() => setShowAdvanced(true)}
                className="text-xs text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-300"
              >
                Advanced: replace the shared book with this device's data
              </button>
            ) : (
              <div className="space-y-2">
                <JoinModeOption
                  active={joinMode === 'replace'}
                  onSelect={() => setJoinMode('replace')}
                  title="Replace the shared book"
                  desc="Everyone ends up with exactly what's on this device. Only for when this device holds the version you all want."
                />
                {joinMode === 'replace' && (
                  <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                    Your partner's devices lose any changes they haven't synced yet, and will ask to
                    load the book again. A backup of the book is saved to your Drive first, so you can
                    undo this with Restore from Drive.
                  </div>
                )}
              </div>
            )}
          </div>

          {connectError && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {connectError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeJoin} disabled={connecting}>
              Cancel
            </Button>
            <Button
              variant={joinMode === 'merge' ? 'primary' : 'danger'}
              onClick={handleConfirmJoin}
              disabled={connecting || book.peekError}
            >
              {joinMode === 'fresh'
                ? 'Erase & join'
                : joinMode === 'replace'
                  ? connecting
                    ? 'Replacing…'
                    : 'Replace shared book'
                  : connecting
                    ? 'Merging…'
                    : 'Merge & join'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function JoinModeOption({
  active,
  onSelect,
  title,
  desc,
  badge,
}: {
  active: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
        active
          ? 'border-brand-400 bg-slate-800/60'
          : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          active ? 'border-brand-400' : 'border-slate-600'
        }`}
      >
        {active && <span className="h-2 w-2 rounded-full bg-brand-500" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-100">{title}</span>
          {badge && (
            <span className="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-400">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-1 block text-xs text-slate-400">{desc}</span>
      </span>
    </button>
  );
}

function AuthSection() {
  const auth = useAuth();
  const [busy, setBusy] = useState<'google' | null>(null);

  const doGoogle = async () => {
    setBusy('google');
    try {
      await auth.signInGoogle();
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

        {auth.googleConfigured && <GoogleAccessNote />}

        {auth.googleConfigured && <TrustDeviceToggle />}

        {!auth.googleConfigured && (
          <div className="rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-500">
            Set <code className="text-slate-400">VITE_GOOGLE_CLIENT_ID</code> in{' '}
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
      <Combobox
        value={settings.defaultCurrency}
        onChange={settings.setDefaultCurrency}
        options={CURRENCY_OPTIONS}
      />
      <div className="mt-1 text-xs text-slate-500">
        Used for new accounts and budgets. Each account can still use a different currency.
      </div>
    </Card>
  );
}

function FxRatesSection() {
  const { defaultCurrency, manualRates, rateInfo, setFxRate } = useAppSettings();
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
    <Section id="rates">
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-slate-300">Exchange rates</h3>
      <p className="mb-3 text-xs text-slate-500">
        Used when Reports, Budgets, Tags and Cashflow add up amounts in different currencies (marked
        with ≈). Copper works these out for you from your latest transfer between the two currencies,
        or an approximate built-in rate. Type a rate only if you want to use your own.
      </p>
      <div className="space-y-2">
        {foreignCurrencies.map((code) => (
          <FxRateRow
            key={code}
            code={code}
            defaultCurrency={defaultCurrency}
            value={manualRates[code]}
            automatic={rateInfo[code]}
            onSave={(v) => setFxRate(code, v)}
          />
        ))}
      </div>
    </Card>
    </Section>
  );
}

function FxRateRow({
  code,
  defaultCurrency,
  value,
  automatic,
  onSave,
}: {
  code: string;
  defaultCurrency: string;
  /** The rate typed here, if any. */
  value: number | undefined;
  /** The rate in use and where it came from. */
  automatic: FxRate | undefined;
  /** A number to use it, null to go back to the automatic rate. */
  onSave: (v: number | null) => void;
}) {
  const [text, setText] = useState(value != null ? String(value) : '');
  useEffect(() => {
    setText(value != null ? String(value) : '');
  }, [value]);

  const commit = () => {
    if (!text.trim()) {
      if (value != null) onSave(null);
      return;
    }
    const n = Number(text);
    if (Number.isFinite(n) && n > 0 && n !== value) onSave(n);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-24 shrink-0 text-sm text-slate-300">1 {code} =</span>
      <Input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        placeholder={automatic ? automatic.rate.toLocaleString(undefined, { maximumSignificantDigits: 4 }) : '0.00'}
        className="max-w-[8rem]"
      />
      <span className="text-sm text-slate-400">{defaultCurrency}</span>
      {value != null ? (
        <button
          type="button"
          className="text-xs font-medium text-brand-400 hover:underline"
          onClick={() => onSave(null)}
        >
          Use automatic
        </button>
      ) : (
        automatic && <span className="text-xs text-slate-500">Automatic: {describeSource(automatic.source)}</span>
      )}
    </div>
  );
}

const ACCOUNT_TYPES: AccountType[] = ['cash', 'bank', 'credit_card', 'wallet', 'loan', 'other'];

function ExportSection() {
  const db = useDB();
  const auth = useAuth();
  const sync = useSync();
  const [busy, setBusy] = useState<null | 'csv' | 'backup' | 'encrypted'>(null);
  const [note, setNote] = useState<string | null>(null);

  // Google Drive backup controls.
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveNote, setDriveNote] = useState<string | null>(null);
  const [retention, setRetention] = useState(String(sync.backupRetention));
  useEffect(() => {
    setRetention(String(sync.backupRetention));
  }, [sync.backupRetention]);

  // Encrypted-backup modal state.
  const [encryptOpen, setEncryptOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [encryptError, setEncryptError] = useState<string | null>(null);

  const backupToDrive = async () => {
    setDriveBusy(true);
    setDriveNote(null);
    try {
      await sync.backupNow();
      setDriveNote('Backup saved to your Backups folder in Drive.');
    } catch (e) {
      setDriveNote((e as Error).message);
    } finally {
      setDriveBusy(false);
    }
  };

  // Commit the retention field on blur/Enter, snapping back if it's not a
  // sensible count (the store clamps to ≥1, but don't persist junk on the way).
  const commitRetention = () => {
    const n = Number(retention);
    if (Number.isFinite(n) && n >= 1) sync.setBackupRetention(n);
    else setRetention(String(sync.backupRetention));
  };

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
        setNote(`Backup downloaded (${total.toLocaleString()} entries). Look for it in your Downloads.`);
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
      setNote(`Password-protected backup downloaded (${total.toLocaleString()} entries). Look for it in your Downloads.`);
      closeEncrypt();
    } catch (e) {
      setEncryptError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-300">Export</h3>
          <div className="text-xs text-slate-500">
            A spreadsheet of your transactions, or a backup file you can restore later. Add a password
            to keep the backup private.
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
          <Button variant="secondary" disabled={busy !== null} onClick={() => run('csv')}>
            {busy === 'csv' ? 'Downloading…' : 'Download spreadsheet'}
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => run('backup')}>
            {busy === 'backup' ? 'Downloading…' : 'Download backup'}
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => setEncryptOpen(true)}>
            Backup with password
          </Button>
        </div>
      </div>
      {note && <div className="mt-3 text-xs text-slate-400">{note}</div>}

      {auth.google && (
        <div className="mt-5 border-t border-slate-800 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="mb-1 text-sm font-semibold text-slate-300">Google Drive backups</h4>
              <div className="text-xs text-slate-500">
                A copy of your book is saved to “{APP_FOLDER_NAME}/Backups” on a schedule, before any
                merge, overwrite, restore or import, and whenever you back up by hand. Bring one back
                under Restore below.
              </div>
            </div>
            <Button
              variant="secondary"
              className="shrink-0"
              disabled={driveBusy}
              onClick={backupToDrive}
            >
              {driveBusy ? 'Backing up…' : 'Back up now'}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
            <div>
              Last backup:{' '}
              <span className="text-slate-400">
                {sync.lastBackupAt
                  ? new Date(sync.lastBackupAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                  : 'never'}
              </span>
            </div>
            <label className="flex items-center gap-2">
              Keep
              <input
                type="number"
                min={1}
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
                onBlur={commitRetention}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className="w-14 rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1 text-center text-sm text-slate-50 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
              />
              backups
            </label>
            <label className="flex items-center gap-2">
              Back up
              <select
                value={sync.backupIntervalDays}
                onChange={(e) => sync.setBackupIntervalDays(Number(e.target.value))}
                className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1 text-sm text-slate-50 focus:border-brand-400 focus:outline-none"
              >
                <option value={1}>daily</option>
                <option value={7}>weekly</option>
                <option value={30}>monthly</option>
              </select>
            </label>
          </div>
          {driveNote && <div className="mt-3 text-xs text-slate-400">{driveNote}</div>}
        </div>
      )}

      <Modal open={encryptOpen} onClose={() => busy !== 'encrypted' && closeEncrypt()} title="Backup with password">
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

// Above this many rows a restore is slow enough to warn about up front and show
// a progress bar for — small books restore near-instantly and need neither.
const LARGE_RESTORE_ROWS = 2000;

function RestoreSection() {
  const db = useDB();
  const auth = useAuth();
  const sync = useSync();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ backup: BackupFile; rows: number; tables: number; name: string } | null>(null);
  const [encrypted, setEncrypted] = useState<{ env: EncryptedBackup; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [busy, setBusy] = useState(false);
  // Restore progress. 'inserting' streams a live row count; 'finishing' covers
  // the commit + durability flush, which can't be measured. `rowsDone` is a true
  // count of rows written — the bar itself is indeterminate (see the modal).
  const [phase, setPhase] = useState<'inserting' | 'finishing' | null>(null);
  const [rowsDone, setRowsDone] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Drive snapshot picker state.
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveSnaps, setDriveSnaps] = useState<DriveSnapshot[] | null>(null);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);

  const preview = (backup: BackupFile, name: string) => {
    const rows = Object.values(backup.tables).reduce(
      (n, r) => n + (Array.isArray(r) ? r.length : 0),
      0,
    );
    const tables = Object.values(backup.tables).filter((r) => Array.isArray(r) && r.length > 0).length;
    setPending({ backup, rows, tables, name });
  };

  const openDrive = async () => {
    setDriveOpen(true);
    setDriveSnaps(null);
    setDriveError(null);
    setDriveLoading(true);
    try {
      setDriveSnaps(await sync.listBackups());
    } catch (e) {
      setDriveError((e as Error).message);
    } finally {
      setDriveLoading(false);
    }
  };

  // Download a snapshot and hand it to the same confirm/replace flow as a file.
  const pickDriveSnapshot = async (snap: DriveSnapshot) => {
    setFetchingId(snap.id);
    setDriveError(null);
    try {
      const backup = await sync.fetchBackup(snap);
      setDriveOpen(false);
      preview(backup, snap.name);
    } catch (e) {
      setDriveError((e as Error).message);
    } finally {
      setFetchingId(null);
    }
  };

  const onFile = async (file: File) => {
    setError(null);
    setNote(null);
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError("That doesn't look like a Copper backup. Choose a file saved with Download backup in Settings.");
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
    setPhase('inserting');
    setRowsDone(0);
    try {
      await restoreBackup(db, pending.backup, (done) => setRowsDone(done));
      // The restore deletes the old rows and inserts the backup's, and the next
      // sync carries both to the shared book. Back the book up first so this
      // can be undone. No-op when not connected.
      await markSafetyBackup(db, 'before restore');
      // The VFS persists with "relaxed" durability, so the write isn't
      // guaranteed flushed to IndexedDB when restoreBackup resolves — reloading
      // here can tear the page down mid-flush and leave a malformed file.
      // close() then a fresh open() is a durability barrier: IndexedDB orders
      // the reopen's reads after all pending writes, so once open() resolves
      // the file is fully written. Only then is it safe to reload. This flush
      // can't be measured, so the UI shows an unquantified "Finishing up…".
      setPhase('finishing');
      setNote('Restored — reloading…');
      await closeDB();
      await openDB();
      // Reload so every reactive query re-reads the freshly rebuilt tables.
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setPhase(null);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
        <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
          {auth.google && (
            <Button variant="secondary" onClick={openDrive}>
              Restore from Drive…
            </Button>
          )}
          <Button variant="secondary" onClick={() => inputRef.current?.click()}>
            Choose backup file…
          </Button>
        </div>
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
              Restore <span className="font-medium text-slate-100">{pending.name}</span>? Everything
              in Copper now is replaced by the{' '}
              <span className="font-medium text-slate-100">
                {pending.rows.toLocaleString()} entries
              </span>{' '}
              in this backup.{!sync.bookId && " This can't be undone."}
            </p>
            {!busy && pending.rows > LARGE_RESTORE_ROWS && (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                This is a large backup — restoring can take a few minutes. Once you start, keep this
                tab open until the app reloads on its own.
              </div>
            )}
            {!busy && sync.bookId && (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                This device syncs to a shared book, so the restored data replaces the book for
                {sync.peers.length > 0 ? ' everyone using it' : ' all your devices'} on the next sync. A
                backup of the book is saved to your Drive first, so you can undo this with Restore from
                Drive.
              </div>
            )}
            {busy && phase && (
              <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5">
                <div className="text-xs font-medium text-warning">
                  {phase === 'finishing'
                    ? 'Finishing up — saving your data…'
                    : `Restoring your data — ${rowsDone.toLocaleString()} of ${pending.rows.toLocaleString()} items…`}
                </div>
                {/* Indeterminate: completion time can't be measured, so the bar
                    animates to show activity rather than a false percentage. */}
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-warning/20 motion-reduce:animate-pulse"
                  role="progressbar"
                  aria-label="Restoring your data"
                >
                  <div className="h-full w-1/4 rounded-full bg-warning motion-safe:animate-progress-slide" />
                </div>
                <div className="text-[11px] text-warning/80">
                  The bar shows activity, not exact progress. A large backup can take a few minutes —
                  keep this tab open until the app reloads on its own.
                </div>
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
        open={driveOpen}
        onClose={() => {
          if (!fetchingId) setDriveOpen(false);
        }}
        title="Restore from Google Drive"
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            Pick a backup to bring back. Each is a full copy of your book from your Backups folder —
            the newest is at the top.
          </p>
          {driveError && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {driveError}
            </div>
          )}
          {driveLoading && <div className="text-xs text-slate-400">Loading backups…</div>}
          {!driveLoading && driveSnaps && driveSnaps.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/40 px-3 py-6 text-center text-xs text-slate-400">
              No backups yet. Use “Back up now” under Export, or sync once and one is saved
              automatically.
            </div>
          )}
          {driveSnaps && driveSnaps.length > 0 && (
            <ul className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800">
              {driveSnaps.map((snap) => (
                <li key={snap.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div>
                    <div className="text-sm text-slate-200">
                      {snap.at ? new Date(snap.at).toLocaleString() : snap.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {snap.otherBook ? 'A different book · ' : 'Backup · '}
                      {snap.reason ?? 'older'}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!!fetchingId}
                    onClick={() => pickDriveSnapshot(snap)}
                  >
                    {fetchingId === snap.id ? 'Loading…' : 'Restore'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
        title="Password-protected backup"
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
  const sync = useSync();
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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
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
        // Count every account; the person switches off the ones they don't own.
        initialInclude[a.name] = true;
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
    setProgress(null);
    try {
      const overrides: ImportOverrides = {
        accountTypes: typeOverrides,
        names: nameOverrides,
        includeInTotal: includeOverrides,
        mainAccount: mainAccount || null,
        wipeFirst,
      };
      // Back the shared book up before any imported row can reach it — set before
      // the import starts, since a sync could otherwise run mid-import.
      await markSafetyBackup(db, 'before import');
      const res = await runMonefyImport(db, plan, overrides, (done, total) => setProgress({ done, total }));
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-slate-300">Import</h3>
          <div className="text-xs text-slate-500">
            Load a Monefy CSV export to replace or fill in your data.
          </div>
        </div>
        <Button variant="secondary" className="self-start sm:shrink-0" onClick={() => setOpen(true)}>
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
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={wipeFirst}
                    onChange={(e) => setWipeFirst(e.target.checked)}
                    className="h-4 w-4 accent-brand-500"
                  />
                  Replace what&rsquo;s in Copper now
                </label>
                <p
                  className={`mt-1 pl-6 text-xs ${wipeFirst ? 'text-warning' : 'text-slate-500'}`}
                >
                  {!wipeFirst
                    ? 'The file’s accounts and categories are added next to yours. Ones with the same name will appear twice.'
                    : sync.bookId
                      ? 'Everything in your book is deleted first, on every device that shares it. A backup is saved to your Google Drive before anything changes.'
                      : 'Everything on this device is deleted first. Download a backup above if you might want it back.'}
                </p>
              </div>
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
                            checked={includeOverrides[a.name] ?? true}
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

            {importing && (
              <div role="status" className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-slate-200">
                    {!progress
                      ? wipeFirst
                        ? 'Clearing your current data…'
                        : 'Starting…'
                      : progress.done < progress.total
                        ? `Importing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} entries…`
                        : 'Finishing up…'}
                  </span>
                  <span className="text-xs text-slate-500">Keep this tab open</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-[width]"
                    style={{ width: `${progress ? Math.round((progress.done / progress.total) * 100) : 2}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={reset} disabled={importing}>
                Pick another file
              </Button>
              <Button variant={wipeFirst ? 'danger' : 'primary'} onClick={runImport} disabled={importing}>
                {importing ? 'Importing…' : wipeFirst ? 'Replace and import' : 'Import'}
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
