import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PauseCircle } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useFreshToken } from '@/auth/useFreshToken';
import { useSync } from './SyncProvider';

// Sync that stops for a reason only the person can resolve would otherwise fail
// quietly in the background — the details live in Settings, which nobody visits
// day to day. Say so on every page (except Settings, which shows the details).
export function SyncPausedBanner() {
  const sync = useSync();
  const auth = useAuth();
  const freshToken = useFreshToken();
  const [reconnecting, setReconnecting] = useState(false);
  const { pathname } = useLocation();
  if (pathname === '/settings') return null;

  // An expired Google sign-in only matters once there's something to send: the
  // background sync can't reopen it without a click, so the changes would sit
  // here unnoticed. Just reading needs no nagging.
  const waitingOnSignIn =
    !!auth.google && !freshToken && sync.unsynced && sync.status !== 'syncing' && !!sync.bookId;

  const message = sync.newerBook
    ? 'Another device saved your book with a newer version of Copper. Reload to update, then it syncs again.'
    : sync.bookReplaced
      ? 'Your shared book was replaced from another device. Load it again on this device to keep syncing.'
      : sync.foundBookId
        ? 'Your Google account already has a book. Choose how this device joins it.'
        : waitingOnSignIn
          ? 'Your latest changes are saved on this device but haven’t reached Google Drive yet — your Google sign-in has ended.'
          : null;
  if (!message) return null;

  const button =
    'self-start rounded border border-warning/50 px-2.5 py-1 text-xs font-medium hover:bg-warning/20 disabled:opacity-50 sm:shrink-0 sm:self-auto';

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
        <button type="button" className={button} onClick={() => window.location.reload()}>
          Reload
        </button>
      ) : !sync.bookReplaced && !sync.foundBookId ? (
        // Only the sign-in case is left. A fresh sign-in starts a sync by itself,
        // which sends the waiting changes.
        <button
          type="button"
          className={button}
          disabled={reconnecting}
          onClick={async () => {
            setReconnecting(true);
            try {
              await auth.signInGoogle();
            } finally {
              setReconnecting(false);
            }
          }}
        >
          {reconnecting ? 'Reconnecting…' : 'Reconnect'}
        </button>
      ) : (
        <Link to="/settings#sync" className={button}>
          Open sync settings
        </Link>
      )}
    </div>
  );
}
