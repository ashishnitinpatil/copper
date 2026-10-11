import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';

/**
 * The Google access token while it's still good for a minute, else null —
 * re-rendering when it runs out. Getting a new one opens a Google popup, which
 * the browser only allows from a click, so screens use this to say "reconnect".
 */
export function useFreshToken(): string | null {
  const { google } = useAuth();
  const [, setTick] = useState(0);
  const fresh = google && google.expiresAt - 60_000 > Date.now() ? google.accessToken : null;
  useEffect(() => {
    if (!fresh || !google) return;
    const ms = google.expiresAt - 60_000 - Date.now();
    const id = setTimeout(() => setTick((n) => n + 1), Math.max(0, ms) + 500);
    return () => clearTimeout(id);
  }, [fresh, google]);
  return fresh;
}
