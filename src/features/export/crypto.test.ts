import { describe, expect, it } from 'vitest';
import { decryptBackup, encryptBackup, isEncryptedBackup } from './crypto';

const PLAINTEXT = JSON.stringify({ format: 'expense-tracker-backup', version: 1, secret: 'salary 9999' });

describe('backup encryption', () => {
  it('round-trips plaintext through the right password', async () => {
    const envelope = await encryptBackup(PLAINTEXT, 'correct horse battery');
    const parsed = JSON.parse(envelope);
    expect(isEncryptedBackup(parsed)).toBe(true);
    // The plaintext must not leak into the envelope.
    expect(envelope).not.toContain('salary');
    const out = await decryptBackup(parsed, 'correct horse battery');
    expect(out).toBe(PLAINTEXT);
  });

  it('rejects a wrong password with a friendly error', async () => {
    const envelope = JSON.parse(await encryptBackup(PLAINTEXT, 'right'));
    await expect(decryptBackup(envelope, 'wrong')).rejects.toThrow(/wrong password/i);
  });

  it('uses a fresh salt and iv each time (no reuse)', async () => {
    const a = JSON.parse(await encryptBackup(PLAINTEXT, 'pw'));
    const b = JSON.parse(await encryptBackup(PLAINTEXT, 'pw'));
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('isEncryptedBackup ignores a plain backup', () => {
    expect(isEncryptedBackup({ format: 'expense-tracker-backup', version: 1 })).toBe(false);
    expect(isEncryptedBackup(null)).toBe(false);
    expect(isEncryptedBackup('a string')).toBe(false);
  });
});
