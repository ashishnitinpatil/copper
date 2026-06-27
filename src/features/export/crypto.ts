// Optional password encryption for backup files. A backup is encrypted with a
// key derived from the user's password alone (PBKDF2 → AES-GCM); there is no
// app-wide master key or recovery key, by design — this is a client-side PWA, so
// any key baked into the bundle would be readable by anyone and defeat the point.
// Forgetting an encrypted file's password means that file can't be opened, but
// encryption is opt-in per export and the live data is untouched, so a fresh
// backup can always be made.

// OWASP-recommended floor for PBKDF2-HMAC-SHA256 (2023). A backup is encrypted
// or opened once, so the ~half-second cost is invisible in practice.
const ITERATIONS = 600_000;

export interface EncryptedBackup {
  format: 'expense-tracker-backup-encrypted';
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: 'AES-GCM';
  iv: string;
  ciphertext: string;
}

export function isEncryptedBackup(json: unknown): json is EncryptedBackup {
  return (
    !!json &&
    typeof json === 'object' &&
    (json as { format?: unknown }).format === 'expense-tracker-backup-encrypted'
  );
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt backup JSON text with a password, returning the envelope as JSON text. */
export async function encryptBackup(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const envelope: EncryptedBackup = {
    format: 'expense-tracker-backup-encrypted',
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toBase64(salt) },
    cipher: 'AES-GCM',
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(envelope);
}

/** Decrypt an envelope back to the original backup JSON text. Throws on a wrong password. */
export async function decryptBackup(envelope: EncryptedBackup, password: string): Promise<string> {
  const key = await deriveKey(password, fromBase64(envelope.kdf.salt), envelope.kdf.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.ciphertext),
    );
  } catch {
    // AES-GCM authentication failed — the password is wrong or the file is corrupt.
    throw new Error('Wrong password — could not open this backup.');
  }
  return new TextDecoder().decode(plaintext);
}
