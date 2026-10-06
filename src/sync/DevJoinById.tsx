import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { PickedFile } from './googlePicker';

// Dev-only stand-in for the Google Picker, for end-to-end testing with browser
// automation: the Picker is a cross-origin Google iframe that automation can't
// click. Feeds a book id into the same confirm/join flow the Picker would, so
// everything after the pick runs for real. Drive access is still real too: under
// `drive.file` an account can only open a partner's book after picking it at
// least once, so the first pick per account still has to be genuine.
// Renders nothing outside `npm run dev`.
export function DevJoinById({
  onPick,
  disabled,
}: {
  onPick: (file: PickedFile) => void;
  disabled?: boolean;
}) {
  const [id, setId] = useState('');
  if (!import.meta.env.DEV) return null;
  const bookId = id.trim();
  return (
    <div className="flex items-center gap-2" data-testid="dev-join-by-id">
      <input
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="Dev: book file ID"
        aria-label="Dev: book file ID"
        className="w-56 rounded-md border border-dashed border-slate-700 bg-transparent px-2 py-1 text-xs text-slate-300"
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || !bookId}
        onClick={() => onPick({ id: bookId, name: `Dev: ${bookId}` })}
      >
        Open by ID
      </Button>
    </div>
  );
}
