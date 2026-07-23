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
import {
  syncNow,
  getSyncStatus,
  listKnownPeers,
  setHouseholdFolder,
  ensureFolderId,
  SYNC_KEYS,
  type SyncResult,
  type SyncProgress,
  type KnownPeer,
} from './household';
import { describeSyncError, isReauthError } from './googleDrive';
import {
  writeDriveSnapshot,
  maybeDailyDriveSnapshot,
  listDriveSnapshots,
  readDriveBackup,
  DEFAULT_BACKUP_RETENTION,
  type DriveSnapshot,
} from './driveBackup';
import type { BackupFile } from '@/features/export/exportData';
import { getSetting, getSettingNumber, setSetting, SETTINGS_KEYS } from '@/db/queries/settings';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'signed-out';

interface SyncContextValue {
  status: SyncStatus;
  lastSyncAt: string | null;
  lastResult: SyncResult | null;
  // Non-null only while the pull phase is applying changesets. Drives the
  // "N of M" progress banner during a large first pull.
  progress: SyncProgress | null;
  error: string | null;
  // True when the last sync failed because Google Drive access needs
  // re-granting (missing scope) — the UI offers a Reconnect button, not a retry.
  needsReauth: boolean;
  folderId: string | null;
  peers: KnownPeer[];
  triggerSync: (reason?: string) => Promise<void>;
  connectSharedFolder: (folderId: string) => Promise<void>;
  dismissError: () => void;
  // Drive backup snapshots (full-book restore points in the shared folder).
  lastBackupAt: string | null;
  backupRetention: number;
  setBackupRetention: (n: number) => Promise<void>;
  backupNow: () => Promise<void>;
  listBackups: () => Promise<DriveSnapshot[]>;
  fetchBackup: (fileId: string) => Promise<BackupFile>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

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
  const [folderId, setFolderId] = useState<string | null>(null);
  const [peers, setPeers] = useState<KnownPeer[]>([]);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [backupRetention, setBackupRetentionState] = useState<number>(DEFAULT_BACKUP_RETENTION);
  const inFlight = useRef(false);
  const lastErrorAt = useRef<number>(0);

  const refreshStatus = useCallback(async () => {
    const [s, p, backupAt, retention] = await Promise.all([
      getSyncStatus(db),
      listKnownPeers(db),
      getSetting(db, SYNC_KEYS.LAST_BACKUP_AT),
      getSettingNumber(db, SETTINGS_KEYS.BACKUP_RETENTION, DEFAULT_BACKUP_RETENTION),
    ]);
    setLastSyncAt(s.lastSyncAt);
    setFolderId(s.folderId);
    setPeers(p);
    setLastBackupAt(backupAt);
    setBackupRetentionState(retention);
  }, [db]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

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
      if (!isManual && !hasFreshToken) {
        setStatus('signed-out');
        return;
      }
      if (status === 'error' && Date.now() - lastErrorAt.current < ERROR_BACKOFF_MS) {
        return;
      }

      inFlight.current = true;
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
        const result = await syncNow(db, async () => token, setProgress);
        setLastResult(result);
        setStatus('idle');
        // Piggyback a once-a-day full-book snapshot into the folder. Best-effort:
        // a backup failure must never turn a successful sync red.
        try {
          const { folderId: fid } = await getSyncStatus(db);
          if (fid) {
            const retention = await getSettingNumber(
              db,
              SETTINGS_KEYS.BACKUP_RETENTION,
              DEFAULT_BACKUP_RETENTION,
            );
            await maybeDailyDriveSnapshot(db, token, fid, retention);
          }
        } catch (e) {
          console.warn('Daily Drive backup skipped:', e);
        }
        await refreshStatus();
      } catch (e) {
        setError(describeSyncError(e));
        setNeedsReauth(isReauthError(e));
        setStatus('error');
        lastErrorAt.current = Date.now();
      } finally {
        inFlight.current = false;
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

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      await triggerSyncRef.current('timer');
      if (cancelled) return;
      timer = setTimeout(tick, AUTO_SYNC_INTERVAL_MS);
    };

    tick();

    const onOnline = () => {
      void triggerSyncRef.current('online');
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void triggerSyncRef.current('visible');
      }
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [auth.google]);

  // Switch this device to a partner-shared folder (chosen via the Picker) and
  // sync immediately so both sides start merging.
  const connectSharedFolder = useCallback(
    async (id: string) => {
      await setHouseholdFolder(db, id);
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

  // Manual "Back up to Drive now": writes today's snapshot immediately,
  // regardless of whether the daily one already ran.
  const backupNow = useCallback(async () => {
    const token = await auth.getGoogleAccessToken();
    if (!token) throw new Error('Reconnect to Google first, then try again.');
    const fid = await ensureFolderId(db, token);
    const retention = await getSettingNumber(
      db,
      SETTINGS_KEYS.BACKUP_RETENTION,
      DEFAULT_BACKUP_RETENTION,
    );
    await writeDriveSnapshot(db, token, fid, retention);
    await refreshStatus();
  }, [db, auth, refreshStatus]);

  const listBackups = useCallback(async () => {
    const token = await auth.getGoogleAccessToken();
    if (!token) throw new Error('Reconnect to Google first, then try again.');
    const { folderId: fid } = await getSyncStatus(db);
    if (!fid) return [];
    return listDriveSnapshots(token, fid);
  }, [db, auth]);

  const fetchBackup = useCallback(
    async (fileId: string) => {
      const token = await auth.getGoogleAccessToken();
      if (!token) throw new Error('Reconnect to Google first, then try again.');
      return readDriveBackup(token, fileId);
    },
    [auth],
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
        folderId,
        peers,
        triggerSync,
        connectSharedFolder,
        dismissError,
        lastBackupAt,
        backupRetention,
        setBackupRetention,
        backupNow,
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
