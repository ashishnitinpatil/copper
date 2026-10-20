import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { CAN_RENEW_SILENTLY } from './google';

/**
 * The Google access token while it's still good for a minute, else null —
 * re-rendering when it runs out. With the sign-in helper a new one is fetched
 * straight away; without it, getting one opens a Google popup (which the
 * browser only allows from a click), so screens use null to say "reconnect".
 */
export function useFreshToken(): string | null {
  const { google, getGoogleAccessToken } = useAuth();
  const [, setTick] = useState(0);
  const fresh = google && google.expiresAt - 60_000 > Date.now() ? google.accessToken : null;
  useEffect(() => {
    if (!fresh || !google) return;
    const ms = google.expiresAt - 60_000 - Date.now();
    const id = setTimeout(() => setTick((n) => n + 1), Math.max(0, ms) + 500);
    return () => clearTimeout(id);
  }, [fresh, google]);
  useEffect(() => {
    if (CAN_RENEW_SILENTLY && google && !fresh) void getGoogleAccessToken();
  }, [fresh, google, getGoogleAccessToken]);
  return fresh;
}
