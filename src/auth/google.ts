import type { GoogleSession } from './types';

const GSI_URL = 'https://accounts.google.com/gsi/client';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const IDENTITY_SCOPES = 'openid email profile';
export const GOOGLE_SCOPES = `${IDENTITY_SCOPES} ${DRIVE_SCOPE}`;

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            // Pins the token request to a specific account (by email). Without it,
            // GIS is free to mint a token for whichever account it likes when
            // several are signed in — which then mismatches the Drive Picker.
            hint?: string;
            callback: (resp: TokenResponse) => void;
            error_callback?: (err: unknown) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  error?: string;
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: '' | 'consent' | 'none' }): void;
}

// How long to wait for a silent (no-popup) token refresh before giving up. GIS
// can leave the request pending indefinitely when it can't refresh silently.
const SILENT_REFRESH_TIMEOUT_MS = 8000;

let scriptPromise: Promise<void> | null = null;

function loadGsi(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = GSI_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Failed to load Google Identity Services'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function isGoogleConfigured(): boolean {
  return !!import.meta.env.VITE_GOOGLE_CLIENT_ID;
}

// `hint` (an email) pre-selects the account for the consent prompt and ties the
// resulting token to it — pass the previously signed-in email on a reconnect so
// a multi-account browser doesn't re-mint against the wrong account.
export async function signInWithGoogle(hint?: string): Promise<GoogleSession> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not set');

  await loadGsi();
  const oauth2 = window.google!.accounts.oauth2;

  const token = await new Promise<TokenResponse>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      ...(hint ? { hint } : {}),
      callback: (resp) => {
        if (resp.error) reject(new Error(resp.error));
        else resolve(resp);
      },
      error_callback: (err) => reject(err),
    });
    client.requestAccessToken({ prompt: 'consent' });
  });

  // The Drive permission is an unticked-by-default checkbox on Google's consent
  // screen. If the user leaves it off, GIS still returns a token — just without
  // the scope — and every sync then fails with an opaque 403. Reject here so we
  // never store a useless session and the user gets an actionable message and a
  // clean retry instead.
  if (!(token.scope ?? '').split(' ').includes(DRIVE_SCOPE)) {
    throw new Error(
      "Drive access wasn't granted, so sync can't work. Sign in again and keep the Google Drive " +
        'permission checkbox ticked.',
    );
  }

  const profile = await fetchUserInfo(token.access_token);

  return {
    identity: {
      provider: 'google',
      sub: profile.sub,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
    },
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    scopes: token.scope.split(' '),
  };
}

export async function refreshGoogleToken(hint?: string): Promise<GoogleSession | null> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) return null;

  await loadGsi();
  const oauth2 = window.google!.accounts.oauth2;

  try {
    const token = await new Promise<TokenResponse>((resolve, reject) => {
      // GIS with prompt:'' can resolve neither callback when it decides it can't
      // mint a token silently (e.g. the user must re-consent). Without a timeout
      // the promise hangs forever and wedges the sync spinner, so race it: a
      // timeout rejects → refresh returns null → caller falls back to a visible
      // "reconnect" state instead of an endless "Syncing…".
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error('silent token refresh timed out'))),
        SILENT_REFRESH_TIMEOUT_MS,
      );
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SCOPES,
        ...(hint ? { hint } : {}),
        callback: (resp) =>
          finish(() => (resp.error ? reject(new Error(resp.error)) : resolve(resp))),
        error_callback: (err) => finish(() => reject(err)),
      });
      client.requestAccessToken({ prompt: '' });
    });
    const profile = await fetchUserInfo(token.access_token);
    return {
      identity: {
        provider: 'google',
        sub: profile.sub,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
      },
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      scopes: token.scope.split(' '),
    };
  } catch {
    return null;
  }
}

export function revokeGoogleToken(token: string): void {
  if (!window.google?.accounts?.oauth2) return;
  window.google.accounts.oauth2.revoke(token);
}

interface UserInfo {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  return res.json();
}
