import { decodeJwt } from './jwt';
import type { AuthIdentity } from './types';

const APPLE_SCRIPT = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

declare global {
  interface Window {
    AppleID?: {
      auth: {
        init(config: AppleAuthConfig): void;
        signIn(): Promise<AppleSignInResponse>;
      };
    };
  }
}

interface AppleAuthConfig {
  clientId: string;
  scope: string;
  redirectURI: string;
  state?: string;
  usePopup: boolean;
}

interface AppleSignInResponse {
  authorization: {
    code: string;
    id_token: string;
    state?: string;
  };
  user?: {
    email?: string;
    name?: { firstName?: string; lastName?: string };
  };
}

let scriptPromise: Promise<void> | null = null;
let initialized = false;

function loadAppleScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.AppleID?.auth) return resolve();
    const s = document.createElement('script');
    s.src = APPLE_SCRIPT;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Failed to load Apple ID script'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function isAppleConfigured(): boolean {
  return !!import.meta.env.VITE_APPLE_CLIENT_ID && !!import.meta.env.VITE_APPLE_REDIRECT_URI;
}

export async function signInWithApple(): Promise<AuthIdentity> {
  const clientId = import.meta.env.VITE_APPLE_CLIENT_ID;
  const redirectURI = import.meta.env.VITE_APPLE_REDIRECT_URI;
  if (!clientId || !redirectURI) throw new Error('Apple auth env vars are not set');

  await loadAppleScript();
  if (!initialized) {
    window.AppleID!.auth.init({
      clientId,
      scope: 'name email',
      redirectURI,
      usePopup: true,
    });
    initialized = true;
  }

  const resp = await window.AppleID!.auth.signIn();
  const claims = decodeJwt(resp.authorization.id_token);
  const name =
    resp.user?.name
      ? [resp.user.name.firstName, resp.user.name.lastName].filter(Boolean).join(' ') || undefined
      : undefined;

  return {
    provider: 'apple',
    sub: claims.sub,
    email: resp.user?.email ?? claims.email,
    name,
  };
}
