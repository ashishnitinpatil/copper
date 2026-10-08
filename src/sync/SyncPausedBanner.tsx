import { Link, useLocation } from 'react-router-dom';
import { PauseCircle } from 'lucide-react';
import { useSync } from './SyncProvider';

// Sync that stops for a reason only the person can resolve would otherwise fail
// quietly in the background — the details live in Settings, which nobody visits
// day to day. Say so on every page (except Settings, which shows the details).
export function SyncPausedBanner() {
  const sync = useSync();
  const { pathname } = useLocation();
  if (pathname === '/settings') return null;

  const message = sync.newerBook
    ? 'Another device saved your book with a newer version of Copper. Reload to update, then it syncs again.'
    : sync.bookReplaced
      ? 'Your shared book was replaced from another device. Load it again on this device to keep syncing.'
      : sync.foundBookId
        ? 'Your Google account already has a book. Choose how this device joins it.'
        : null;
  if (!message) return null;

  return (
    <div
      className="mx-auto mb-4 flex max-w-6xl flex-col gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning sm:flex-row sm:items-center sm:justify-between"
      role="status"
    >
      <div className="flex items-start gap-2">
        <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <span className="font-medium">Sync is paused.</span> {message}
        </span>
      </div>
      {sync.newerBook ? (
        <button
          type="button"
          className="self-start rounded border border-warning/50 px-2.5 py-1 text-xs font-medium hover:bg-warning/20 sm:shrink-0 sm:self-auto"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      ) : (
        <Link
          to="/settings#sync"
          className="self-start rounded border border-warning/50 px-2.5 py-1 text-xs font-medium hover:bg-warning/20 sm:shrink-0 sm:self-auto"
        >
          Open sync settings
        </Link>
      )}
    </div>
  );
}
