import { RefreshCw } from 'lucide-react';
import { useSync } from './SyncProvider';

// Progress counts merged cells (one entry is ~20 with its audit row). Below this
// many a merge finishes near-instantly, so a banner would just flash on every
// routine background sync. Above it there's a real wait worth showing — this is
// the case that used to look like a broken app: an empty dashboard while a large
// first pull ran silently for minutes.
const VISIBLE_THRESHOLD = 2000;
// Roughly a thousand entries or more: almost always a first-time adoption.
const SETTING_UP_THRESHOLD = 20_000;

/**
 * Whether a pull large enough to be worth showing is in flight. Shared with the
 * Dashboard so it can hide its "getting started" checklist during a first pull —
 * that checklist urges "record your first transaction" while thousands are
 * streaming in, which is exactly what made the join look broken.
 */
export function useIsFirstPull(): boolean {
  const { progress } = useSync();
  return !!progress && progress.total >= VISIBLE_THRESHOLD;
}

export function SyncProgressBanner() {
  const { progress } = useSync();
  if (!progress || progress.total < VISIBLE_THRESHOLD) return null;

  const { done, total } = progress;
  const pct = Math.round((done / total) * 100);
  // A large backlog is almost always a first-time adoption of a shared ledger;
  // a smaller one is routine catch-up. Say which so the wait feels expected.
  const settingUp = total >= SETTING_UP_THRESHOLD;

  return (
    <div
      className="mx-auto mb-4 max-w-6xl rounded-xl border border-brand-500/30 bg-brand-500/[0.06] p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-brand-400" />
        {settingUp ? 'Setting up your book' : 'Syncing changes'}
      </div>
      <p className="mt-0.5 text-xs text-slate-400">
        {settingUp
          ? 'Downloading your transactions from Drive — this can take a minute.'
          : 'Bringing in the latest changes.'}{' '}
        {pct}% done.
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
