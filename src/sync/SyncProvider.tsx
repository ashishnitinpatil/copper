import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useDB } from '@/db/DBProvider';
import { useAuth } from '@/auth/AuthProvider';
import { CAN_RENEW_SILENTLY } from '@/auth/google';
import { useAppSettings } from '@/app/AppSettingsProvider';
import { retireDevice, setLocalDevicePerson } from '@/db/changeLog';
import {
  syncNow,
  getSyncStatus,
  hasUnsyncedChanges,
  listKnownPeers,
  joinSharedBook,
  BookFoundError,
  BookReplacedError,
  NewerBookError,
  SYNC_KEYS,
  type JoinMode,
  type SyncResult,
  type SyncProgress,
  type KnownPeer,
} from './household';
import { describeSyncError, isReauthError } from './googleDrive';
import {
  backupBook,
  maybeScheduledBackup,
  listDriveSnapshots,
  readDriveBackup,
  DEFAULT_BACKUP_RETENTION,
  DEFAULT_BACKUP_INTERVAL_DAYS,
  type DriveSnapshot,
} from './driveBackup';
import type { BackupFile } from '@/features/export/exportData';
import { getSetting, getSettingNumber, setSetting, SETTINGS_KEYS } from '@/db/queries/settings';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'signed-out';

interface SyncContextValue {
  status: SyncStatus;
  lastSyncAt: string | null;
  lastResult: SyncResult | null;
  // Non-null only while a sync is applying the shared book's changes. Drives the
  // "N of M" progress banner during a large first pull.
  progress: SyncProgress | null;
  error: string | null;
  // True when the last sync failed because Google Drive access needs
  // re-granting (missing scope) — the UI offers a Reconnect button, not a retry.
  needsReauth: boolean;
  // True when sync stopped because another device replaced the shared book —
  // the UI offers Start fresh, not a retry.
  bookReplaced: boolean;
  // True when the book holds columns from a newer Copper — reload to update.
  newerBook: boolean;
  // Set when this device's first sync found a book this account already has:
  // sync pauses until the person picks Start fresh or Merge for it.
  foundBookId: string | null;
  /** The shared book file this device syncs with (null before the first sync). */
  bookId: string | null;
  /** This account's own "Copper Expense Tracker" folder. */
  appFolderId: string | null;
  peers: KnownPeer[];
  /** This device has changes the shared book doesn't have yet. */
  unsynced: boolean;
  triggerSync: (reason?: string) => Promise<void>;
  // Switch to a partner's shared book (picked in the Picker). "merge" unions
  // both ledgers; "replace" overwrites the book with this device's data. Both
  // back the book up first. Start fresh goes through joinFresh instead.
  joinBook: (bookId: string, mode: JoinMode) => Promise<void>;
  dismissError: () => void;
  // Drive backups: copies of the book in this account's Backups folder.
  lastBackupAt: string | null;
  backupRetention: number;
  setBackupRetention: (n: number) => Promise<void>;
  backupIntervalDays: number;
  setBackupIntervalDays: (n: number) => Promise<void>;
  backupNow: () => Promise<void>;
  // Run a restore or import with sync held off: waits for a running sync to
  // finish, and none starts until it's done — so the safety backup it queues is
  // taken before any of its rows can reach the shared book.
  withSyncPaused: <T>(fn: () => Promise<T>) => Promise<T>;
  listBackups: () => Promise<DriveSnapshot[]>;
  fetchBackup: (snap: DriveSnapshot) => Promise<BackupFile>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

// While the app is on screen, check the book this often. A check with nothing
// to do is one small metadata request; data only moves when something changed.
const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;
const ERROR_BACKOFF_MS = 5 * 60_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useDB();
  const auth = useAuth();
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [bookReplaced, setBookReplaced] = useState(false);
  const [newerBook, setNewerBook] = useState(false);
  const [foundBookId, setFoundBookId] = useState<string | null>(null);
  const [bookId, setBookId] = useState<string | null>(null);
  const [appFolderId, setAppFolderId] = useState<string | null>(null);
  const [peers, setPeers] = useState<KnownPeer[]>([]);
  const [unsynced, setUnsynced] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [backupRetention, setBackupRetentionState] = useState<number>(DEFAULT_BACKUP_RETENTION);
  const [backupIntervalDays, setBackupIntervalState] = useState<number>(DEFAULT_BACKUP_INTERVAL_DAYS);
  const { onboarded } = useAppSettings();
  const inFlight = useRef(false);
  // Settles when the running sync (or backup, restore or import) finishes, so
  // the next one waits its turn rather than running alongside it.
  const running = useRef<Promise<void> | null>(null);
  const lastErrorAt = useRef<number>(0);

  const refreshStatus = useCallback(async () => {
    const [s, p, backupAt, retention, interval] = await Promise.all([
      getSyncStatus(db),
      listKnownPeers(db),
      getSetting(db, SYNC_KEYS.LAST_BACKUP_AT),
      getSettingNumber(db, SETTINGS_KEYS.BACKUP_RETENTION, DEFAULT_BACKUP_RETENTION),
      getSettingNumber(db, SETTINGS_KEYS.BACKUP_INTERVAL_DAYS, DEFAULT_BACKUP_INTERVAL_DAYS),
    ]);
    setLastSyncAt(s.lastSyncAt);
    setBookId(s.bookId);
    setAppFolderId(s.appFolderId);
    setPeers(p);
    setUnsynced(await hasUnsyncedChanges(db));
    setLastBackupAt(backupAt);
    setBackupRetentionState(retention);
    setBackupIntervalState(interval);
  }, [db]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Name this device after whoever signed in, so the Activity log on every
  // device can say "Ashish added…" instead of naming a device.
  const person = auth.google?.identity.name?.trim().split(/\s+/)[0] ?? '';
  useEffect(() => {
    if (person) void setLocalDevicePerson(db, person);
  }, [db, person]);

  // Edits mark the device as holding unsent changes (cleared by the next sync,
  // which refreshes status). One check per burst of row events.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = db.onUpdate(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void hasUnsyncedChanges(db).then(setUnsynced);
      }, 500);
    });
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [db]);

  const triggerSync = useCallback(
    async (reason?: string) => {
      if (inFlight.current) return;
      if (!auth.google) {
        setStatus('signed-out');
        return;
      }
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setStatus('offline');
        return;
      }
      const isManual = reason === 'manual';
      const hasFreshToken =
        !!auth.google.accessToken && auth.google.expiresAt - 60_000 > Date.now();
      // Without the sign-in helper, renewing needs a popup, which only a click may open.
      if (!isManual && !hasFreshToken && !CAN_RENEW_SILENTLY) {
        setStatus('signed-out');
        return;
      }
      // Back off background retries after an error — but never ignore a sync the
      // person asked for (Sync now, or the one a join/merge starts).
      if (
        reason !== 'manual' &&
        status === 'error' &&
        Date.now() - lastErrorAt.current < ERROR_BACKOFF_MS
      ) {
        return;
      }

      inFlight.current = true;
      let done!: () => void;
      running.current = new Promise<void>((r) => (done = r));
      setStatus('syncing');
      setError(null);
      setNeedsReauth(false);
      try {
        // Acquire the token up front. A failed/timed-out silent refresh returns
        // null — that's a "needs reconnect" situation, not a sync error, so show
        // the amber reconnect hint rather than a red failure.
        const token = await auth.getGoogleAccessToken();
        if (!token) {
          setStatus('signed-out');
          return;
        }
        let result = await syncNow(db, async () => token, setProgress);
        // The merge is done; the upload and backup that may follow needn't hold the app.
        setProgress(null);
        // First sync after a reset: the book's devices are in now, so retire
        // this device's old identity — and send that straight back up.
        const retire = await getSetting(db, SYNC_KEYS.RETIRE_SITE);
        if (retire) {
          const changed = await retireDevice(db, retire);
          await setSetting(db, SYNC_KEYS.RETIRE_SITE, '');
          if (changed) result = await syncNow(db, async () => token);
        }
        setLastResult(result);
        setStatus('idle');
        setBookReplaced(false);
        setNewerBook(false);
        setFoundBookId(null);
        // Piggyback the scheduled (weekly by default) backup — after the sync,
        // so it includes this device's latest changes. Best-effort: a backup
        // failure must never turn a successful sync red.
        try {
          const { bookId: bid } = await getSyncStatus(db);
          if (bid) await maybeScheduledBackup(db, token, bid);
        } catch (e) {
          console.warn('Scheduled Drive backup skipped:', e);
        }
        await refreshStatus();
      } catch (e) {
        setError(describeSyncError(e));
        setNeedsReauth(isReauthError(e));
        setBookReplaced(e instanceof BookReplacedError);
        setNewerBook(e instanceof NewerBookError);
        setFoundBookId(e instanceof BookFoundError ? e.bookId : null);
        setStatus('error');
        lastErrorAt.current = Date.now();
      } finally {
        inFlight.current = false;
        running.current = null;
        done();
        setProgress(null);
      }
    },
    [db, auth, refreshStatus, status],
  );

  const triggerSyncRef = useRef(triggerSync);
  triggerSyncRef.current = triggerSync;

  useEffect(() => {
    if (!auth.google) {
      setStatus('signed-out');
      return;
    }
    // Not before onboarding: a device still on Welcome only has the seeded
    // defaults, and a sync would merge them into the account's book.
    if (!onboarded) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') await triggerSyncRef.current('timer');
      if (cancelled) return;
      timer = setTimeout(tick, AUTO_SYNC_INTERVAL_MS);
    };

    tick();

    const onOnline = () => {
      void triggerSyncRef.current('online');
    };
    // Coming back: pick up a partner's changes. Going away: upload this
    // device's edits while the page can still run.
    const onVisibility = () => {
      void triggerSyncRef.current(document.visibilityState === 'visible' ? 'visible' : 'hidden');
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [auth.google, onboarded]);

  const joinBook = useCallback(
    async (id: string, mode: JoinMode) => {
      await joinSharedBook(db, id, mode);
      await refreshStatus();
      await triggerSync('manual');
    },
    [db, refreshStatus, triggerSync],
  );

  const dismissError = useCallback(() => {
    setError(null);
    setNeedsReauth(false);
    if (status === 'error') setStatus('idle');
  }, [status]);

  const setBackupRetention = useCallback(
    async (n: number) => {
      const clamped = Math.max(1, Math.round(n));
      await setSetting(db, SETTINGS_KEYS.BACKUP_RETENTION, String(clamped));
      setBackupRetentionState(clamped);
    },
    [db],
  );

  const setBackupIntervalDays = useCallback(
    async (n: number) => {
      const clamped = Math.max(1, Math.round(n));
      await setSetting(db, SETTINGS_KEYS.BACKUP_INTERVAL_DAYS, String(clamped));
      setBackupIntervalState(clamped);
    },
    [db],
  );

  // Manual "Back up now": sync first so the copy includes this device's latest
  // changes, then copy the book into Backups.
  // Runs fn once no sync is running, and holds off syncs (and other callers of
  // this) until it's done — including a restore waiting on a "Back up now".
  const withSyncPaused = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    while (running.current) await running.current;
    inFlight.current = true;
    let done!: () => void;
    running.current = new Promise<void>((r) => (done = r));
    try {
      return await fn();
    } finally {
      inFlight.current = false;
      running.current = null;
      done();
    }
  }, []);

  const backupNow = useCallback(async () => {
    const token = await auth.getGoogleAccessToken();
    if (!token) throw new Error('Your Google sign-in has expired. Tap Reconnect, then try again.');
    // Never run two syncs at once (two could each create a book on first sync).
    await withSyncPaused(async () => {
      await syncNow(db, async () => token);
      const { bookId: bid } = await getSyncStatus(db);
      if (!bid) throw new Error('Tap Sync now first, then back up.');
      await backupBook(db, token, bid, 'manual');
    });
    await refreshStatus();
  }, [db, auth, refreshStatus, withSyncPaused]);

  const listBackups = useCallback(async () => {
    const token = await auth.getGoogleAccessToken();
    if (!token) throw new Error('Your Google sign-in has expired. Tap Reconnect, then try again.');
    return listDriveSnapshots(db, token);
  }, [db, auth]);

  const fetchBackup = useCallback(
    async (snap: DriveSnapshot) => {
      const token = await auth.getGoogleAccessToken();
      if (!token) throw new Error('Your Google sign-in has expired. Tap Reconnect, then try again.');
      return readDriveBackup(db, token, snap);
    },
    [db, auth],
  );

  return (
    <SyncContext.Provider
      value={{
        status,
        lastSyncAt,
        lastResult,
        progress,
        error,
        needsReauth,
        bookReplaced,
        newerBook,
        foundBookId,
        bookId,
        appFolderId,
        peers,
        unsynced,
        triggerSync,
        joinBook,
        dismissError,
        lastBackupAt,
        backupRetention,
        setBackupRetention,
        backupIntervalDays,
        setBackupIntervalDays,
        backupNow,
        withSyncPaused,
        listBackups,
        fetchBackup,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
}
