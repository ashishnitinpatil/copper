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

// Opening a big book can take a few seconds; a static line then looks stuck.
const LOADING_STEPS = [
  { after: 0, text: 'Getting your data ready…' },
  { after: 4000, text: 'Still opening your book…' },
  { after: 10000, text: 'Almost there — big books take a little longer.' },
];

function DefaultLoadingScreen() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = LOADING_STEPS.slice(1).map((s, i) => setTimeout(() => setStep(i + 1), s.after));
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-slate-950 text-slate-400" role="status">
      <img src="/icon.svg" alt="" aria-hidden="true" className="h-10 w-10 motion-safe:animate-loading-breathe" />
      <div className="h-0.5 w-28 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
        <div className="h-full w-1/4 rounded-full bg-brand-500 motion-safe:animate-progress-slide" />
      </div>
      <div className="text-sm">{LOADING_STEPS[step].text}</div>
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
