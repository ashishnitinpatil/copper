export interface DecodedJwt {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  exp?: number;
  [key: string]: unknown;
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Invalid JWT');
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const json = atob(b64 + pad);
  return JSON.parse(
    decodeURIComponent(
      Array.from(json)
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    ),
  );
}
