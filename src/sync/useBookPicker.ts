import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { pickSharedBook, PickerBlockedError, type PickedFile } from './googlePicker';
import { peekBook, type BookPeek } from './household';

// Pick a partner's shared book in the Google Picker, then peek it (owner, last
// change) so the confirm step can show what was actually picked. Shared by the
// Welcome join flow and Settings.
export function useBookPicker() {
  const auth = useAuth();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [peek, setPeek] = useState<BookPeek | null>(null);
  const [peekError, setPeekError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `fileId` narrows the Picker to one file (from an invite link). `devFile`
  // skips the Picker entirely (see DevJoinById).
  const choose = async (fileId?: string, devFile?: PickedFile) => {
    setBusy(true);
    setError(null);
    try {
      const token = await auth.getGoogleAccessToken();
      if (!token) {
        setError('Your Google sign-in has expired. Tap Reconnect, then try again.');
        return;
      }
      const file = devFile ?? (await pickSharedBook(token, fileId));
      if (!file) return;
      setPicked(file);
      setPeek(null);
      setPeekError(false);
      try {
        // Re-fetch: the Picker can sit open past the token it was opened with.
        const fresh = await auth.getGoogleAccessToken();
        if (!fresh) throw new Error('Your Google sign-in has expired. Sign in again and retry.');
        setPeek(await peekBook(fresh, file.id));
      } catch (e) {
        console.warn('Could not open the picked book:', e);
        setPeekError(true);
      }
    } catch (e) {
      if (e instanceof PickerBlockedError) {
        setError(
          "The Google picker couldn't load. This usually means more than one Google account " +
            'is signed in to this browser. Open Copper in a browser or profile signed in to only ' +
            'this Google account, then try again.',
        );
      } else {
        setError(e instanceof Error ? e.message : 'Could not open the picker.');
      }
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setPicked(null);
    setPeek(null);
    setPeekError(false);
    setError(null);
  };

  return { picked, peek, peekError, busy, error, choose, clear };
}
