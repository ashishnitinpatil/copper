import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { DB } from './wasm';
import { openDB } from './client';

interface DBContextValue {
  db: DB;
  siteId: string;
}

const DBContext = createContext<DBContextValue | null>(null);

interface DBProviderProps {
  children: ReactNode;
  fallback?: ReactNode;
  errorFallback?: (error: Error) => ReactNode;
}

/**
 * Ask the browser to keep our IndexedDB data durable so it isn't silently
 * evicted under storage pressure. Best-effort: support and the user's answer
 * vary by browser, and a denial is fine — we just log it.
 */
async function requestPersistentStorage(): Promise<void> {
  if (!navigator.storage?.persist) return;
  try {
    if (await navigator.storage.persisted()) return;
    const granted = await navigator.storage.persist();
    if (!granted) console.info('Persistent storage not granted; data may be evicted under pressure.');
  } catch {
    // Storage API unavailable or blocked — nothing actionable.
  }
}

export function DBProvider({ children, fallback, errorFallback }: DBProviderProps) {
  const [state, setState] = useState<{ db: DB | null; error: Error | null }>({
    db: null,
    error: null,
  });

  useEffect(() => {
    requestPersistentStorage();
  }, []);

  useEffect(() => {
    let cancelled = false;
    openDB()
      .then((db) => {
        if (!cancelled) setState({ db, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ db: null, error: err instanceof Error ? err : new Error(String(err)) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.error) {
    return <>{errorFallback ? errorFallback(state.error) : <DefaultErrorScreen error={state.error} />}</>;
  }

  if (!state.db) {
    return <>{fallback ?? <DefaultLoadingScreen />}</>;
  }

  return (
    <DBContext.Provider value={{ db: state.db, siteId: state.db.siteid }}>{children}</DBContext.Provider>
  );
}

export function useDB(): DB {
  const ctx = useContext(DBContext);
  if (!ctx) throw new Error('useDB must be used inside <DBProvider>');
  return ctx.db;
}

export function useSiteId(): string {
  const ctx = useContext(DBContext);
  if (!ctx) throw new Error('useSiteId must be used inside <DBProvider>');
  return ctx.siteId;
}

function DefaultLoadingScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-slate-950 text-slate-400">
      <div className="text-sm">Getting your data ready…</div>
    </div>
  );
}

function DefaultErrorScreen({ error }: { error: Error }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-950 p-6 text-center text-slate-300">
      <div className="text-lg font-semibold text-danger">Couldn't start the app — try refreshing</div>
      <div className="max-w-md text-xs text-slate-500">{error.message}</div>
    </div>
  );
}
