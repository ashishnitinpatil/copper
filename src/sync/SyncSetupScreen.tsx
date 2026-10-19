import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSync } from './SyncProvider';

// Progress counts merged cells (one entry is ~20 with its audit row), so this
// is roughly 100 entries. Routine syncs between devices that are in regular use
// stay well under it and merge silently in the background; past it, the app is
// held behind the setup screen until the merge is done — otherwise every page
// keeps redrawing as partial data streams in.
const BLOCKING_THRESHOLD = 2000;
// Roughly a thousand entries or more: almost always a first-time adoption.
const SETTING_UP_THRESHOLD = 20_000;

/**
 * Whether a pull large enough to hold the app is in flight. The Dashboard uses
 * it to hide its "getting started" checklist, which would otherwise urge
 * "record your first transaction" while thousands are streaming in.
 */
export function useIsFirstPull(): boolean {
  const { progress } = useSync();
  return !!progress && progress.total >= BLOCKING_THRESHOLD;
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
 * Full-screen hold while a large pull merges: a first-time join, or a device
 * catching up after a long break. Covers the whole app (and, being a modal,
 * pauses keyboard shortcuts) so nothing can be edited mid-merge.
 */
export function SyncSetupScreen() {
  const show = useIsFirstPull();
  const { progress } = useSync();
  useWakeLock(show);
  if (!show || !progress) return null;

  const { done, total } = progress;
  const pct = Math.min(100, Math.round((done / total) * 100));
  const settingUp = total >= SETTING_UP_THRESHOLD;

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
            {settingUp ? 'Setting up your book' : 'Catching up on changes'}
          </h2>
        </div>
        <p className="mt-1.5 text-sm text-slate-400">
          {settingUp
            ? 'Bringing your transactions in from Google Drive. Copper opens as soon as it’s done.'
            : 'This device has been away for a while. Copper opens as soon as it’s up to date.'}
        </p>

        <p className="mt-5 text-sm text-slate-300">{pct}% done</p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Sync progress"
        >
          <div className="h-full rounded-full bg-brand-500 transition-all duration-300" style={{ width: `${pct}%` }} />
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
        {settingUp && (
          <p className="mt-5 text-xs text-slate-500">This only happens once. After this, syncs take seconds.</p>
        )}
      </div>
    </div>
  );
}
