import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSync } from './SyncProvider';

/**
 * Whether a first sync is in flight: the book here is empty or half-merged
 * until it's done, so the app is held behind the setup screen. The Dashboard
 * also uses it to hide its "getting started" checklist, which would otherwise
 * urge "record your first transaction" while thousands are streaming in.
 *
 * A device that has synced before never waits here, however far behind it is
 * (after an update, say): it catches up in the background while in use.
 */
export function useIsFirstPull(): boolean {
  const { bookId, lastSyncAt, mergePending, status } = useSync();
  // Linked to a book but never synced (it was just loaded or joined), or such a
  // first merge was cut short (the app was closed or reloaded mid-way). Signed
  // out, offline or failed, nothing is coming — let the app and its banner show.
  return !!bookId && (!lastSyncAt || mergePending) && (status === 'idle' || status === 'syncing');
}

/** Keeps a phone's screen on while `active`, so it doesn't sleep mid-setup. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const request = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (stopped) void l.release();
          else lock = l;
        })
        .catch(() => {});
    };
    request();
    // The browser drops the lock whenever the page is hidden; take it back on return.
    document.addEventListener('visibilitychange', request);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', request);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}

/**
 * Full-screen hold while a device's first sync brings the book in. Covers the whole app (and, being a modal,
 * pauses keyboard shortcuts) so nothing can be edited mid-merge.
 */
export function SyncSetupScreen() {
  const show = useIsFirstPull();
  const { progress } = useSync();
  useWakeLock(show);
  if (!show) return null;

  // Until the merge starts there's the download (sized, when Drive says how
  // big the file is) and then a step with no count: unpacking the book and
  // comparing it with what's on this device, which can take a while on a phone.
  const merging = progress?.stage === 'apply';
  const sized = merging || (progress?.stage === 'download' && progress.total > 0);
  // A resumed merge can find nothing left to do (0 of 0): that's done, not NaN.
  const pct = !progress || !sized ? 0 : progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 100;
  const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
  const label = merging
    ? `${pct}% done`
    : progress?.stage === 'prepare'
      ? 'Getting your book ready…'
      : progress?.stage === 'finish'
        ? 'Finishing up…'
        : progress?.stage === 'upload'
          ? 'Saving your book to Google Drive…'
          : progress?.stage === 'download' && progress.total > 0
            ? `Downloading your book — ${mb(progress.done)} of ${mb(progress.total)} MB`
            : 'Downloading your book…';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-setup-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-center gap-2.5">
          <RefreshCw className="h-5 w-5 shrink-0 animate-spin text-brand-400" />
          <h2 id="sync-setup-title" className="font-display text-lg font-semibold text-slate-50">
            Setting up your book
          </h2>
        </div>
        <p className="mt-1.5 text-sm text-slate-400">
          Bringing your transactions in from Google Drive. Copper opens as soon as it’s done.
        </p>

        <p className="mt-5 text-sm text-slate-300">{label}</p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={sized ? pct : undefined}
          aria-label="Sync progress"
        >
          {sized ? (
            <div className="h-full rounded-full bg-brand-500 transition-all duration-300" style={{ width: `${pct}%` }} />
          ) : (
            <div className="h-full w-1/4 rounded-full bg-brand-500 motion-safe:animate-progress-slide" />
          )}
        </div>

        <ul className="mt-6 space-y-2.5 text-sm text-slate-300">
          <li>
            <span className="font-medium text-slate-100">Saved as it goes.</span> If you close Copper or
            lose your connection, it carries on from where it stopped next time you open it.
          </li>
          <li>
            <span className="font-medium text-slate-100">Nothing is lost or doubled.</span> Entries
            already brought in are skipped when it resumes.
          </li>
          <li>
            <span className="font-medium text-slate-100">Faster with Copper on screen.</span> Phones
            pause apps in the background — it picks up again when you come back.
          </li>
        </ul>
        <p className="mt-5 text-xs text-slate-500">This only happens once. After this, syncs take seconds.</p>
      </div>
    </div>
  );
}
