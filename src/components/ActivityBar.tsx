import { useEffect, useState, useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import { pendingQueries, subscribePendingQueries } from '@/db/useQuery';
import { useSync } from '@/sync/SyncProvider';
import type { SyncProgress } from '@/sync/household';

// A page that loads within this long just appears; past it, the bar shows it's working.
const SHOW_AFTER_MS = 300;

/** Share of a sync step that's done (0–1), or null when it can't be measured. */
function measured(p: SyncProgress | null): number | null {
  if (!p || p.stage === 'prepare' || !p.total) return null;
  return Math.min(1, p.done / p.total);
}

/**
 * A thin bar along the top of the screen while anything is working: a sync
 * (whose results may change what's on screen), or a page still loading its
 * data. It fills when the work can be measured and sweeps when it can't.
 */
export function ActivityBar() {
  const { status, progress } = useSync();
  const loading = useSyncExternalStore(subscribePendingQueries, pendingQueries) > 0;
  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlowLoad(false);
      return;
    }
    const t = setTimeout(() => setSlowLoad(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [loading]);

  const syncing = status === 'syncing';
  if (!syncing && !slowLoad) return null;
  const share = syncing ? measured(progress) : null;
  return (
    <div
      role="progressbar"
      aria-label={syncing ? 'Syncing' : 'Loading'}
      aria-valuenow={share === null ? undefined : Math.round(share * 100)}
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-brand-500/15"
    >
      {share === null ? (
        <div className="h-full w-1/4 bg-brand-500 motion-safe:animate-progress-slide" />
      ) : (
        <div className="h-full bg-brand-500 transition-[width] duration-300" style={{ width: `${share * 100}%` }} />
      )}
    </div>
  );
}

const STEP: Record<SyncProgress['stage'], string> = {
  download: 'Downloading',
  prepare: 'Comparing',
  apply: 'Merging',
  upload: 'Uploading',
};

/** "Syncing…" beside the app name while a sync runs, so updates don't come out of nowhere. */
export function SyncChip() {
  const { status, progress } = useSync();
  if (status !== 'syncing') return null;
  const share = measured(progress);
  const label = progress
    ? `${STEP[progress.stage]}${share === null ? '…' : ` ${Math.round(share * 100)}%`}`
    : 'Syncing…';
  return (
    <span
      role="status"
      title="Bringing in changes from your other devices. What's on screen may update when it's done."
      className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 font-sans text-xs font-medium text-brand-300"
    >
      <RefreshCw aria-hidden className="h-3 w-3 motion-safe:animate-spin" />
      {label}
    </span>
  );
}
