import { useEffect, useState, useRef } from 'react';
import { useDB } from './DBProvider';
import type { DB } from './wasm';

type Loader<T> = (db: DB) => Promise<T>;

interface QueryOptions {
  /**
   * Tables to subscribe to. When any of these tables fire an update event,
   * the loader is re-run. If omitted, the query only runs on mount.
   */
  deps?: string[];
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
  const [state, setState] = useState<QueryState<T>>({ data: null, loading: true, error: null });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const depsKey = options.deps?.join(',') ?? '';

  useEffect(() => {
    let cancelled = false;

    const run = () => {
      loaderRef
        .current(db)
        .then((data) => {
          if (cancelled) return;
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

    const watched = new Set(options.deps);
    const off = db.onUpdate((_type, _dbName, tblName) => {
      if (watched.has(tblName)) run();
    });

    return () => {
      cancelled = true;
      off();
    };
    // Re-run when the (memoized) loader identity changes — this is how param
    // changes like Reports' month filter trigger a refetch. Callers must wrap
    // closures in useCallback (see hook doc) or this loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, depsKey, loader]);

  return state;
}
