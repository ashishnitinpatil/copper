// Copper's only server code: a small, stateless Google sign-in helper.
//
// A browser-only app gets 1-hour Google tokens and has to ask again after
// that. Long-lived access needs a refresh token, which Google only issues to a
// party holding the OAuth client secret — so that one step happens here. The
// refresh token is never stored on this side: it goes back to the device,
// encrypted, in an HttpOnly cookie that only this Worker can read. Nothing
// about anyone's book ever passes through; sync still goes browser → Drive.
//
// Everything that isn't /api/* is served straight from static assets without
// running this code (see run_worker_first in wrangler.jsonc).

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  GOOGLE_CLIENT_ID: string;
  /** `wrangler secret put GOOGLE_CLIENT_SECRET` */
  GOOGLE_CLIENT_SECRET: string;
  /** 32 random bytes, base64 — encrypts the refresh-token cookie. */
  TOKEN_KEY: string;
  /**
   * The key before the last rotation, still accepted so changing TOKEN_KEY
   * doesn't sign everyone out: put the old value here, the new one in
   * TOKEN_KEY, and each device's cookie moves to the new key on its next
   * refresh. Delete it once a cookie's lifetime (400 days) has passed.
   */
  TOKEN_KEY_PREVIOUS?: string;
  /** Per-address limit on /api/* (see "ratelimits" in wrangler.jsonc). */
  AUTH_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const RT_COOKIE = '__Host-copper_rt';
const STATE_COOKIE = '__Host-copper_oauth';
// Browsers cap cookie lifetimes at about 400 days; each refresh extends it.
const REMEMBER_SECONDS = 400 * 24 * 60 * 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/') && env.AUTH_LIMIT) {
        const { success } = await env.AUTH_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
        if (!success) return json({ error: 'rate_limited' }, 429);
      }
      switch (url.pathname) {
        case '/api/auth/start':
          return start(url, env);
        case '/api/auth/callback':
          return await callback(request, url, env);
        case '/api/auth/refresh':
          return await refresh(request, url, env);
        case '/api/auth/signout':
          return signout(request, url);
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return json({ error: 'server_error' }, 500);
    }
  },
};

/** Opens Google's consent screen (in the sign-in popup). */
function start(url: URL, env: Env): Response {
  const state = randomId();
  const remember = url.searchParams.get('remember') === '1';
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/api/auth/callback`,
    response_type: 'code',
    scope: SCOPES,
    // offline + consent: Google returns a refresh token on every sign-in, not
    // just the first — so a second device of the same person gets one too.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  const hint = url.searchParams.get('hint');
  if (hint) params.set('login_hint', hint);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      // Lax, not Strict: it must come back with Google's redirect to us.
      'Set-Cookie': cookie(STATE_COOKIE, `${state}.${remember ? 1 : 0}`, 600, 'Lax'),
      'Cache-Control': 'no-store',
    },
  });
}

/** Google redirects here; swap the code for tokens and hand them to the app. */
async function callback(request: Request, url: URL, env: Env): Promise<Response> {
  const [state, remember] = (readCookie(request, STATE_COOKIE) ?? '').split('.');
  const clearState = cookie(STATE_COOKIE, '', 0, 'Lax');
  if (!state || url.searchParams.get('state') !== state) {
    return popupResult({ error: 'Sign-in expired. Close this window and try again.' }, [clearState]);
  }
  const denied = url.searchParams.get('error');
  if (denied) return popupResult({ error: denied === 'access_denied' ? 'cancelled' : denied }, [clearState]);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      code: url.searchParams.get('code') ?? '',
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const token = (await res.json()) as GoogleToken;
  if (!res.ok || !token.access_token) {
    return popupResult({ error: token.error_description ?? token.error ?? 'Google sign-in failed' }, [clearState]);
  }
  const cookies = [clearState];
  if (token.refresh_token) {
    cookies.push(cookie(RT_COOKIE, await seal(token.refresh_token, env), remember === '1' ? REMEMBER_SECONDS : null));
  }
  return popupResult(
    { access_token: token.access_token, expires_in: token.expires_in, scope: token.scope },
    cookies,
  );
}

/** A fresh 1-hour access token from this device's refresh-token cookie. */
async function refresh(request: Request, url: URL, env: Env): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
  const sealed = readCookie(request, RT_COOKIE);
  const opened = sealed ? await unseal(sealed, env) : null;
  if (!opened) return json({ error: 'signed_out' }, 401);
  const refreshToken = opened.text;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const token = (await res.json()) as GoogleToken;
  if (!res.ok || !token.access_token) {
    // Revoked, expired or the password changed: this device must sign in again.
    if (token.error === 'invalid_grant') {
      return json({ error: 'signed_out' }, 401, [cookie(RT_COOKIE, '', 0)]);
    }
    return json({ error: token.error ?? 'refresh_failed' }, 502);
  }
  const { remember } = (await request.json().catch(() => ({}))) as { remember?: boolean };
  return json({ access_token: token.access_token, expires_in: token.expires_in, scope: token.scope }, 200, [
    // Re-set on every refresh, so the expiry slides and "Trust this device" changes take effect.
    // A cookie sealed with the previous key moves to the current one.
    cookie(RT_COOKIE, opened.stale ? await seal(refreshToken, env) : sealed!, remember ? REMEMBER_SECONDS : null),
  ]);
}

/**
 * Forget this device's sign-in. Deliberately no revoke at Google: that ends
 * the whole grant, signing the person out on every other device too. Removing
 * Copper's access everywhere is done from their Google Account.
 */
async function signout(request: Request, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
  return json({ ok: true }, 200, [cookie(RT_COOKIE, '', 0)]);
}

interface GoogleToken {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

// The popup's last page: pass the result to the app tab over a same-origin
// BroadcastChannel (window.opener is cut off by Google's pages), then close.
function popupResult(result: Record<string, unknown>, cookies: string[]): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>Copper</title>
<body style="font:15px system-ui;padding:2rem;color:#33241A;background:#FBF7F2">
<p id="m">${result.error ? 'Sign-in didn’t finish. You can close this window.' : 'Signed in. You can close this window.'}</p>
<script>
  const ch = new BroadcastChannel('copper-auth');
  ch.postMessage(${JSON.stringify(result).replace(/</g, '\\u003c')});
  ch.close();
  setTimeout(() => window.close(), 300);
</script>`;
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(html, { headers });
}

function json(body: unknown, status: number, cookies: string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}

/** Refresh and sign-out are only for Copper's own pages. */
function sameOrigin(request: Request, url: URL): boolean {
  return request.method === 'POST' && request.headers.get('Origin') === url.origin;
}

/** `maxAge` null = a session cookie (gone when the browser closes); 0 deletes it. */
function cookie(name: string, value: string, maxAge: number | null, sameSite: 'Strict' | 'Lax' = 'Strict'): string {
  const age = maxAge === null ? '' : `; Max-Age=${maxAge}`;
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=${sameSite}${age}`;
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function randomId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(18)));
}

async function key(b64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(text: string, env: Env): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env.TOKEN_KEY), new TextEncoder().encode(text)),
  );
  const out = new Uint8Array(iv.length + data.length);
  out.set(iv);
  out.set(data, iv.length);
  return b64url(out);
}

/** The sealed text, and whether it was sealed with the previous key. */
async function unseal(sealed: string, env: Env): Promise<{ text: string; stale: boolean } | null> {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(sealed.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  for (const [k, stale] of [[env.TOKEN_KEY, false], [env.TOKEN_KEY_PREVIOUS, true]] as const) {
    if (!k) continue;
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await key(k), bytes.slice(12));
      return { text: new TextDecoder().decode(plain), stale };
    } catch {
      // Not this key (AES-GCM fails on the wrong one); try the next.
    }
  }
  return null;
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
