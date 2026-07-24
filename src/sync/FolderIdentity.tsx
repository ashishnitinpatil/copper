import { formatRelativeDate, toDateString } from '@/lib/dates';
import { describeFolderPeek, type FolderPeek } from './household';

// Identity card for a folder the user just picked. The Google Picker shows only
// a folder's name and date, so two folders that share a name are impossible to
// tell apart in it — this surfaces a short id fingerprint and a peek of what the
// folder actually holds, so the user can confirm they chose the right one before
// committing to an erase-and-adopt.
export function FolderIdentity({
  name,
  id,
  peek,
  loading,
}: {
  name: string;
  id: string;
  peek: FolderPeek | null;
  loading: boolean;
}) {
  const lastActive =
    peek?.lastActivity != null
      ? formatRelativeDate(toDateString(new Date(peek.lastActivity)))
      : null;
  return (
    <div className="rounded-md border border-slate-700 bg-slate-800/40 px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-medium text-slate-100">{name}</span>
        <span className="shrink-0 font-mono text-[11px] text-slate-500">#{id.slice(-6)}</span>
      </div>
      <p className="mt-0.5 text-xs text-slate-400">
        {loading
          ? 'Checking what’s inside…'
          : peek
            ? describeFolderPeek(peek) + (lastActive ? ` · last active ${lastActive}` : '')
            : 'Could not read the folder contents.'}
      </p>
    </div>
  );
}
