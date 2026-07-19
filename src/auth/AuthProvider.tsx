import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthIdentity, AuthState, GoogleSession } from './types';
import {
  isGoogleConfigured,
  signInWithGoogle,
  refreshGoogleToken,
  revokeGoogleToken,
} from './google';

const STORAGE_KEY = 'expense-tracker.auth.identities';
// The "trust this device" preference always lives in localStorage so the device
// remembers the user's choice across restarts. The session blob itself lives in
// localStorage when trusted (survives a browser restart) or sessionStorage when
// not (cleared when the tab closes — the safe default for shared machines).
const TRUST_KEY = 'expense-tracker.auth.trust-device';

interface StoredState {
  google: GoogleSession | null;
}

function readTrustDevice(): boolean {
  try {
    return localStorage.getItem(TRUST_KEY) === '1';
  } catch {
    return false;
  }
}

// Accepts both the current session shape ({ identity, accessToken, ... }) and
// the legacy identity-only shape we used to persist, so an existing sign-in
// survives the upgrade (the token is just treated as absent → silent refresh).
function normalizeGoogle(g: unknown): GoogleSession | null {
  if (!g || typeof g !== 'object') return null;
  const obj = g as Record<string, unknown>;
  if (obj.identity) {
    return {
      identity: obj.identity as AuthIdentity,
      accessToken: (obj.accessToken as string) ?? '',
      expiresAt: (obj.expiresAt as number) ?? 0,
      scopes: (obj.scopes as string[]) ?? [],
    };
  }
  return { identity: g as AuthIdentity, accessToken: '', expiresAt: 0, scopes: [] };
}

function loadStored(): StoredState {
  // A trusted session is in localStorage; an untrusted one in sessionStorage.
  // Read whichever exists so a reload restores the in-memory token too.
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      return { google: normalizeGoogle(parsed.google) };
    } catch {
      /* try the next store */
    }
  }
  return { google: null };
}

// Write the session to the store the trust setting selects and clear it from the
// other, so toggling re-homes the blob and never leaves a stale copy behind.
function persistSession(state: StoredState, trust: boolean): void {
  const keep = trust ? localStorage : sessionStorage;
  const drop = trust ? sessionStorage : localStorage;
  try {
    keep.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  try {
    drop.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

interface AuthContextValue extends AuthState {
  googleConfigured: boolean;
  trustDevice: boolean;
  setTrustDevice: (value: boolean) => void;
  signInGoogle: () => Promise<void>;
  signOutGoogle: () => void;
  getGoogleAccessToken: () => Promise<string | null>;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [trustDevice, setTrustDeviceState] = useState<boolean>(readTrustDevice);
  const [state, setState] = useState<AuthState>(() => {
    const stored = loadStored();
    return { google: stored.google };
  });
  const [error, setError] = useState<string | null>(null);

  // Persist the full session (identity + token) so a reload within the token's
  // hour-long life reuses it instead of round-tripping to Google. Re-runs when
  // the trust setting flips, which moves the blob to the right store.
  useEffect(() => {
    persistSession({ google: state.google }, trustDevice);
  }, [state, trustDevice]);

  const setTrustDevice = useCallback((value: boolean) => {
    try {
      localStorage.setItem(TRUST_KEY, value ? '1' : '0');
    } catch {
      /* ignore */
    }
    setTrustDeviceState(value);
  }, []);

  const signInGoogle = useCallback(async () => {
    setError(null);
    try {
      // On a reconnect we know which account this is — pin to it so a
      // multi-account browser re-mints against the right one.
      const session = await signInWithGoogle(state.google?.identity.email);
      setState((s) => ({ ...s, google: session }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed');
    }
  }, [state.google?.identity.email]);

  const signOutGoogle = useCallback(() => {
    setState((s) => {
      if (s.google?.accessToken) revokeGoogleToken(s.google.accessToken);
      return { ...s, google: null };
    });
  }, []);

  const getGoogleAccessToken = useCallback(async () => {
    const current = state.google;
    if (!current) return null;
    if (current.accessToken && current.expiresAt - 60_000 > Date.now()) {
      return current.accessToken;
    }
    const refreshed = await refreshGoogleToken(current.identity.email);
    if (refreshed) {
      setState((s) => ({ ...s, google: refreshed }));
      return refreshed.accessToken;
    }
    return null;
  }, [state.google]);

  const value = useMemo<AuthContextValue>(
    () => ({
      google: state.google,
      googleConfigured: isGoogleConfigured(),
      trustDevice,
      setTrustDevice,
      signInGoogle,
      signOutGoogle,
      getGoogleAccessToken,
      error,
      clearError: () => setError(null),
    }),
    [
      state,
      error,
      trustDevice,
      setTrustDevice,
      signInGoogle,
      signOutGoogle,
      getGoogleAccessToken,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
