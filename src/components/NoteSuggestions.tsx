import { useCallback } from 'react';
import { useQuery } from '@/db/useQuery';
import { listPastNotes } from '@/db/queries/transactions';
import type { PastNote } from '@/lib/noteSuggestions';
import type { TransactionKind } from '@/db/types';

/**
 * Notes used before on this kind of entry, kept fresh as entries change. A
 * dialog that stays mounted while closed passes `active` so it doesn't re-query
 * on every change in the background.
 */
export function usePastNotes(kind: TransactionKind, active = true) {
  return useQuery<PastNote[]>(
    useCallback((d) => (active ? listPastNotes(d, kind) : Promise.resolve([])), [kind, active]),
    { deps: ['transactions'] },
  );
}

/** Earlier notes to tap instead of typing the rest. */
export function NoteSuggestions({ notes, onPick }: { notes: string[]; onPick: (note: string) => void }) {
  if (notes.length === 0) return null;
  return (
    <div className="-mt-1 flex flex-wrap gap-1.5" aria-label="Notes you've used before">
      {notes.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPick(n)}
          className="max-w-full truncate rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-50"
        >
          {n}
        </button>
      ))}
    </div>
  );
}
