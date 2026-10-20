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

// Hosted builds sign in through Copper's helper (worker/index.ts), which gets a
// refresh token from Google and keeps people signed in for months. The dev
// server has no helper, so it uses the browser-only flow: 1-hour tokens,
// silently renewed while Google allows it.
const USE_HELPER = import.meta.env.PROD;
/** Whether an expired token can be renewed without a click (via the helper). */
export const CAN_RENEW_SILENTLY = USE_HELPER;

/** The sign-in window was closed (or left) without finishing. Not an error worth showing. */
export class SignInClosed extends Error {}

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
// `remember` (Trust this device) keeps the helper's sign-in after the browser closes.
export async function signInWithGoogle(hint?: string, remember = false): Promise<GoogleSession> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not set');
  // Before any await: the popup must open within the click.
  if (USE_HELPER) return signInViaHelper(hint, remember);

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

  return sessionFromToken(token);
}

async function sessionFromToken(token: TokenResponse): Promise<GoogleSession> {
  // The Drive permission is an unticked-by-default checkbox on Google's consent
  // screen. If the user leaves it off, Google still returns a token — just without
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

// How long after the app gets focus back, with no result yet, to decide the
// sign-in window was closed. The success message normally arrives first.
const POPUP_GONE_MS = 3000;

/**
 * Sign in through the helper: a popup goes to Google's consent screen and
 * back to /api/auth/callback, which sets this device's refresh-token cookie
 * and broadcasts the first access token to this tab.
 */
function signInViaHelper(hint: string | undefined, remember: boolean): Promise<GoogleSession> {
  const params = new URLSearchParams({ remember: remember ? '1' : '0' });
  if (hint) params.set('hint', hint);
  const popup = window.open(`/api/auth/start?${params}`, 'copper-signin', 'popup,width=480,height=640');
  if (!popup) {
    return Promise.reject(
      new Error('Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.'),
    );
  }
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel('copper-auth');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      channel.close();
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
    channel.onmessage = (e: MessageEvent<TokenResponse & { error?: string }>) => {
      finish();
      if (e.data.error) {
        reject(e.data.error === 'cancelled' ? new SignInClosed() : new Error(e.data.error));
      } else {
        sessionFromToken(e.data).then(resolve, reject);
      }
    };
    // Google's pages cut the link to the popup, so its closing can't be seen
    // directly. When the app gets focus back with no result, ask the helper:
    // on phones the "popup" is a browser tab that may have finished without
    // reaching this tab, but its cookie is set either way.
    const onFocus = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        finish();
        helperToken(remember)
          .then((token) => (token ? sessionFromToken(token) : Promise.reject(new SignInClosed())))
          .then(resolve, reject);
      }, POPUP_GONE_MS);
    };
    window.addEventListener('focus', onFocus);
  });
}

/** A fresh access token from the helper, or null when this device isn't signed in there. */
async function helperToken(remember: boolean): Promise<TokenResponse | null> {
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remember }),
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  return res.json();
}

export async function refreshGoogleToken(hint?: string, remember = false): Promise<GoogleSession | null> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) return null;

  if (USE_HELPER) {
    try {
      const token = await helperToken(remember);
      if (token) return await sessionFromToken(token);
    } catch (e) {
      console.warn('Sign-in helper refresh failed:', e);
    }
    // Signed in before the helper existed (no cookie yet): fall through to the
    // browser-only refresh until the next sign-in.
  }

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
    return await sessionFromToken(token);
  } catch {
    return null;
  }
}

export function revokeGoogleToken(token: string): void {
  // The helper revokes the refresh token, which ends Copper's access at Google.
  if (USE_HELPER) void fetch('/api/auth/signout', { method: 'POST' }).catch(() => {});
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
