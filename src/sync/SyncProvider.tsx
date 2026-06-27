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
  type SyncResult,
  type KnownPeer,
} from './household';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'signed-out';

interface SyncContextValue {
  status: SyncStatus;
  lastSyncAt: string | null;
  lastResult: SyncResult | null;
  error: string | null;
  folderId: string | null;
  peers: KnownPeer[];
  triggerSync: (reason?: string) => Promise<void>;
  dismissError: () => void;
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
  const [error, setError] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [peers, setPeers] = useState<KnownPeer[]>([]);
  const inFlight = useRef(false);
  const lastErrorAt = useRef<number>(0);

  const refreshStatus = useCallback(async () => {
    const [s, p] = await Promise.all([getSyncStatus(db), listKnownPeers(db)]);
    setLastSyncAt(s.lastSyncAt);
    setFolderId(s.folderId);
    setPeers(p);
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
      try {
        // Acquire the token up front. A failed/timed-out silent refresh returns
        // null — that's a "needs reconnect" situation, not a sync error, so show
        // the amber reconnect hint rather than a red failure.
        const token = await auth.getGoogleAccessToken();
        if (!token) {
          setStatus('signed-out');
          return;
        }
        const result = await syncNow(db, async () => token);
        setLastResult(result);
        setStatus('idle');
        await refreshStatus();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sync failed');
        setStatus('error');
        lastErrorAt.current = Date.now();
      } finally {
        inFlight.current = false;
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

  const dismissError = useCallback(() => {
    setError(null);
    if (status === 'error') setStatus('idle');
  }, [status]);

  return (
    <SyncContext.Provider
      value={{
        status,
        lastSyncAt,
        lastResult,
        error,
        folderId,
        peers,
        triggerSync,
        dismissError,
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
