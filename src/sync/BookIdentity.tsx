import type { BookPeek } from './household';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// What the person picked, so they can confirm it's the right book before
// joining: whose it is and when it last changed.
export function BookIdentity({
  name,
  peek,
  peekError,
  onRetry,
  retrying,
}: {
  name: string;
  peek: BookPeek | null;
  peekError: boolean;
  /** Re-open the Picker when the pick didn't grant access. */
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const details = peek
    ? [
        peek.ownedByMe ? 'Your book' : peek.owner && `Shared by ${peek.owner}`,
        peek.modifiedTime && `last changed ${new Date(peek.modifiedTime).toLocaleString()}`,
        peek.sizeBytes != null && formatSize(peek.sizeBytes),
      ]
        .filter(Boolean)
        .join(' · ')
    : peekError
      ? // A pick only grants access if Google accepts it — it silently doesn't
        // when the picker sat open past the sign-in's expiry, for example.
        "Copper couldn't open this book yet. Pick it again — and check it was shared with the Google account you're signed in with."
      : 'Checking…';
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
      <div className="truncate text-sm font-medium text-slate-100">{peek?.name ?? name}</div>
      <div className={`mt-0.5 text-xs ${peekError ? 'text-danger' : 'text-slate-400'}`}>{details}</div>
      {peekError && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-2 rounded border border-danger/50 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
        >
          {retrying ? 'Opening…' : 'Pick it again'}
        </button>
      )}
    </div>
  );
}
