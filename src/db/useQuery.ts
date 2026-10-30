import { useEffect, useState, useRef } from 'react';
import { useDB } from './DBProvider';
import type { DB } from './wasm';

type Loader<T> = (db: DB) => Promise<T>;

// Long enough to absorb a burst of row events, short enough to feel instant.
const UPDATE_COALESCE_MS = 50;

interface QueryOptions {
  /**
   * Tables to subscribe to. When any of these tables fire an update event,
   * the loader is re-run. If omitted, the query only runs on mount.
   */
  deps?: string[];
  /**
   * Remember the last result under this key, so coming back to a page shows it
   * straight away (then refreshes) instead of an empty loading state.
   */
  cacheKey?: string;
}

const lastResults = new Map<string, unknown>();

// How many queries are loading right now, app-wide, so the shell can show that
// a page is still working rather than leave it blank (see ActivityBar).
let pending = 0;
const pendingListeners = new Set<() => void>();
function setPending(delta: number) {
  pending += delta;
  pendingListeners.forEach((l) => l());
}
export function subscribePendingQueries(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => pendingListeners.delete(listener);
}
export function pendingQueries(): number {
  return pending;
}

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Reactive query hook. Re-runs the loader whenever cr-sqlite emits an update
 * event for any of the listed tables. The query also re-runs whenever the
 * loader function reference changes — wrap loaders in `useCallback` if you
 * pass closures.
 */
export function useQuery<T>(loader: Loader<T>, options: QueryOptions = {}): QueryState<T> {
  const db = useDB();
  const { cacheKey } = options;
  const [state, setState] = useState<QueryState<T>>(() => ({
    data: cacheKey && lastResults.has(cacheKey) ? (lastResults.get(cacheKey) as T) : null,
    loading: true,
    error: null,
  }));
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const depsKey = options.deps?.join(',') ?? '';

  useEffect(() => {
    let cancelled = false;

    const run = () => {
      setPending(1);
      loaderRef
        .current(db)
        .finally(() => setPending(-1))
        .then((data) => {
          if (cancelled) return;
          if (cacheKey) lastResults.set(cacheKey, data);
          setState({ data, loading: false, error: null });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        });
    };

    run();

    if (!options.deps || options.deps.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    // cr-sqlite fires one update event per changed ROW. Coalesce a burst into a
    // single re-run: an import, restore or sync pull writes tens of thousands of
    // rows, and re-running every open query per row (on the same connection,
    // between the writer's statements) made a 12k-row import effectively hang.
    const watched = new Set(options.deps);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = db.onUpdate((_type, _dbName, tblName) => {
      if (!watched.has(tblName) || timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (!cancelled) run();
      }, UPDATE_COALESCE_MS);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      off();
    };
    // Re-run when the (memoized) loader identity changes — this is how param
    // changes like Reports' month filter trigger a refetch. Callers must wrap
    // closures in useCallback (see hook doc) or this loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, depsKey, loader, cacheKey]);

  return state;
}
