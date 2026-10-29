import { describe, it, expect, vi, afterEach } from 'vitest';
import { DriveError, describeSyncError, downloadBytes, isReauthError } from './googleDrive';

describe('describeSyncError', () => {
  it('translates the invalid-session 401 into actionable guidance', () => {
    const err = new DriveError(
      'Drive 401: { "error": { "code": 401, "message": "The caller does not have permission", "errors": [ { "message": "Active session is invalid. Error code: 4" } ] } }',
      401,
    );
    const msg = describeSyncError(err);
    expect(msg).toMatch(/sign in again/i);
    expect(msg).toMatch(/single personal Google account/i);
    expect(msg).not.toMatch(/Active session is invalid/);
  });

  it('passes other Drive errors through unchanged', () => {
    const err = new DriveError('Drive 500: backend error', 500);
    expect(describeSyncError(err)).toBe('Drive 500: backend error');
  });

  it('translates a 403 insufficient-scopes error into a reconnect prompt', () => {
    const err = new DriveError(
      'Drive 403: { "error": { "code": 403, "message": "Request had insufficient authentication scopes.", "errors": [ { "message": "Insufficient Permission", "domain": "global" } ] } }',
      403,
    );
    const msg = describeSyncError(err);
    expect(msg).toMatch(/Drive permission/i);
    expect(msg).toMatch(/reconnect/i);
    expect(msg).not.toMatch(/insufficient authentication scopes/i);
    expect(isReauthError(err)).toBe(true);
  });

  it('does not misfire on an unrelated 403 (e.g. no folder permission)', () => {
    const err = new DriveError('Drive 403: The user does not have sufficient permissions for file', 403);
    expect(describeSyncError(err)).toBe(
      'Drive 403: The user does not have sufficient permissions for file',
    );
    expect(isReauthError(err)).toBe(false);
  });

  it('handles non-Error values', () => {
    expect(describeSyncError('boom')).toBe('boom');
    expect(describeSyncError(null)).toBe('Sync failed');
    expect(isReauthError('boom')).toBe(false);
  });
});

describe('downloadBytes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports bytes as they arrive and returns the whole file', async () => {
    const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        parts.forEach((p) => c.enqueue(p));
        c.close();
      },
    });
    vi.stubGlobal('fetch', async () => new Response(body, { headers: { 'Content-Length': '5' } }));
    const seen: [number, number][] = [];
    const bytes = await downloadBytes('t', 'f', (done, total) => seen.push([done, total]));
    expect([...bytes]).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual([[3, 5], [5, 5]]);
  });
});
