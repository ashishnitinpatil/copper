import { beforeEach, describe, expect, it, vi } from 'vitest';

// Shared, hoisted state the module mocks read from and tests drive. vi.mock
// factories are hoisted above imports, so the state they close over must be too.
const h = vi.hoisted(() => ({
  // In-memory Google Drive: a flat list of files + an ordered call log.
  drive: {
    files: [] as { id: string; name: string; content: unknown }[],
    calls: [] as string[],
  },
  // Stand-in for the cr-sqlite changeset layer.
  changes: {
    siteHex: 'aa',
    exportQueue: [] as { rows: unknown[]; maxVersion: number }[],
    exportSince: [] as number[],
    applied: [] as unknown[][],
  },
}));

vi.mock('./googleDrive', () => ({
  findOrCreateFolder: async () => ({ id: 'folder1', name: 'Expense Tracker' }),
  listFolderFiles: async (_t: string, _f: string, prefix: string) =>
    h.drive.files.filter((f) => f.name.startsWith(prefix)).map((f) => ({ id: f.id, name: f.name })),
  uploadJsonFile: async (_t: string, _f: string, name: string, payload: unknown) => {
    h.drive.calls.push(`upload:${name}`);
    h.drive.files.push({ id: `id-${name}`, name, content: payload });
  },
  downloadJsonFile: async (_t: string, id: string) =>
    h.drive.files.find((f) => f.id === id)?.content ?? null,
}));

vi.mock('./changesets', () => ({
  getLocalSiteIdHex: async () => h.changes.siteHex,
  getLocalDbVersion: async () => 0,
  exportLocalChanges: async (_db: unknown, since: number) => {
    h.changes.exportSince.push(since);
    return h.changes.exportQueue.shift() ?? { rows: [], maxVersion: since };
  },
  applyRemoteChanges: async (_db: unknown, rows: unknown[]) => {
    h.changes.applied.push(rows);
    h.drive.calls.push(`apply:${rows.length}`);
    return rows.length;
  },
}));

// Mocked settings, backed by the fake db's own meta map so listKnownPeers /
// resetSyncState (which read the db directly) share the same state.
vi.mock('@/db/queries/settings', () => ({
  getSetting: async (db: FakeDb, key: string) => db.meta.get(key) ?? null,
  setSetting: async (db: FakeDb, key: string, value: string) => {
    db.meta.set(key, String(value));
  },
}));

import {
  syncNow,
  listKnownPeers,
  resetSyncState,
  setHouseholdFolder,
  SYNC_KEYS,
} from './household';

interface FakeDb {
  meta: Map<string, string>;
  execO: (sql: string) => Promise<unknown[]>;
  exec: (sql: string) => Promise<void>;
}

function makeDb(): FakeDb {
  const meta = new Map<string, string>();
  return {
    meta,
    async execO(sql: string) {
      if (sql.includes("key LIKE 'sync.peer.%'")) {
        return [...meta]
          .filter(([k]) => k.startsWith('sync.peer.'))
          .map(([key, value]) => ({ key, value }));
      }
      throw new Error(`unmocked execO: ${sql}`);
    },
    async exec(sql: string) {
      if (sql.includes("DELETE FROM meta WHERE key LIKE 'sync.%'")) {
        for (const k of [...meta.keys()]) if (k.startsWith('sync.')) meta.delete(k);
        return;
      }
      throw new Error(`unmocked exec: ${sql}`);
    },
  };
}

const token = async () => 'token';

/** Seed a peer changeset file directly into the fake Drive. */
function seedPeerFile(siteHex: string, seq: number, rows: unknown[]) {
  const name = `changes-${siteHex}-${String(seq).padStart(6, '0')}.json`;
  h.drive.files.push({ id: `id-${name}`, name, content: { version: 1, site_id: siteHex, seq, rows } });
}

beforeEach(() => {
  h.drive.files = [];
  h.drive.calls = [];
  h.changes.siteHex = 'aa';
  h.changes.exportQueue = [];
  h.changes.exportSince = [];
  h.changes.applied = [];
});

describe('syncNow — push', () => {
  it('uploads local changes as seq 1 and records local_version', async () => {
    const db = makeDb();
    h.changes.exportQueue = [{ rows: [{ r: 1 }, { r: 2 }], maxVersion: 5 }];

    const res = await syncNow(db as never, token);

    expect(res).toMatchObject({ pushed: 2, pulled: 0, peers: 0, uploadedFile: 'changes-aa-000001.json' });
    expect(h.drive.files.map((f) => f.name)).toEqual(['changes-aa-000001.json']);
    expect(db.meta.get(SYNC_KEYS.LOCAL_VERSION)).toBe('5');
    expect(db.meta.get(SYNC_KEYS.FOLDER_ID)).toBe('folder1');
    expect(db.meta.get(SYNC_KEYS.LAST_SYNC_AT)).toBeTruthy();
    // First export must start from version 0.
    expect(h.changes.exportSince).toEqual([0]);
  });

  it('increments seq and exports from the stored version on the next push', async () => {
    const db = makeDb();
    h.changes.exportQueue = [{ rows: [{ r: 1 }], maxVersion: 5 }];
    await syncNow(db as never, token);

    h.changes.exportQueue = [{ rows: [{ r: 2 }], maxVersion: 7 }];
    const res = await syncNow(db as never, token);

    expect(res.uploadedFile).toBe('changes-aa-000002.json');
    expect(db.meta.get(SYNC_KEYS.LOCAL_VERSION)).toBe('7');
    // Second export resumes from the persisted version.
    expect(h.changes.exportSince).toEqual([0, 5]);
  });

  it('uploads nothing when there are no local changes', async () => {
    const db = makeDb();
    h.changes.exportQueue = [{ rows: [], maxVersion: 0 }];

    const res = await syncNow(db as never, token);

    expect(res.pushed).toBe(0);
    expect(res.uploadedFile).toBeNull();
    expect(h.drive.files).toHaveLength(0);
    expect(db.meta.has(SYNC_KEYS.LOCAL_VERSION)).toBe(false);
  });

  it('reuses a cached folder id without recreating the folder', async () => {
    const db = makeDb();
    db.meta.set(SYNC_KEYS.FOLDER_ID, 'preexisting');
    h.changes.exportQueue = [{ rows: [{ r: 1 }], maxVersion: 1 }];

    await syncNow(db as never, token);

    expect(db.meta.get(SYNC_KEYS.FOLDER_ID)).toBe('preexisting');
  });
});

describe('syncNow — pull', () => {
  it('applies a peer’s changesets in seq order and advances the watermark', async () => {
    const db = makeDb();
    seedPeerFile('bb', 1, [{ tag: 'bb1' }]);
    seedPeerFile('bb', 2, [{ tag: 'bb2a' }, { tag: 'bb2b' }]);

    const res = await syncNow(db as never, token);

    expect(res).toMatchObject({ pulled: 3, peers: 1 });
    expect(h.changes.applied).toEqual([[{ tag: 'bb1' }], [{ tag: 'bb2a' }, { tag: 'bb2b' }]]);
    expect(db.meta.get(SYNC_KEYS.PEER_PREFIX + 'bb')).toBe('2');
  });

  it('orders application by seq even when listed out of order', async () => {
    const db = makeDb();
    seedPeerFile('bb', 3, [{ tag: 'bb3' }]);
    seedPeerFile('bb', 1, [{ tag: 'bb1' }]);
    seedPeerFile('bb', 2, [{ tag: 'bb2' }]);

    await syncNow(db as never, token);

    expect(h.changes.applied).toEqual([[{ tag: 'bb1' }], [{ tag: 'bb2' }], [{ tag: 'bb3' }]]);
  });

  it('skips files at or below the watermark on a second sync', async () => {
    const db = makeDb();
    seedPeerFile('bb', 1, [{ tag: 'bb1' }]);
    await syncNow(db as never, token);

    h.changes.applied = [];
    seedPeerFile('bb', 2, [{ tag: 'bb2' }]);
    const res = await syncNow(db as never, token);

    expect(h.changes.applied).toEqual([[{ tag: 'bb2' }]]); // only the new file
    expect(res.pulled).toBe(1);
    expect(db.meta.get(SYNC_KEYS.PEER_PREFIX + 'bb')).toBe('2');
  });

  it('ignores its own changeset files when pulling', async () => {
    const db = makeDb();
    seedPeerFile('aa', 1, [{ tag: 'mine' }]); // same site id as local
    seedPeerFile('bb', 1, [{ tag: 'theirs' }]);

    const res = await syncNow(db as never, token);

    expect(res.peers).toBe(1);
    expect(h.changes.applied).toEqual([[{ tag: 'theirs' }]]);
    expect(db.meta.has(SYNC_KEYS.PEER_PREFIX + 'aa')).toBe(false);
  });

  it('reconciles multiple peers and tracks a watermark per peer', async () => {
    const db = makeDb();
    seedPeerFile('bb', 1, [{ tag: 'bb1' }]);
    seedPeerFile('cc', 1, [{ tag: 'cc1' }]);
    seedPeerFile('cc', 2, [{ tag: 'cc2' }]);

    const res = await syncNow(db as never, token);

    expect(res).toMatchObject({ pulled: 3, peers: 2 });
    expect(db.meta.get(SYNC_KEYS.PEER_PREFIX + 'bb')).toBe('1');
    expect(db.meta.get(SYNC_KEYS.PEER_PREFIX + 'cc')).toBe('2');
  });

  it('reports pull progress per changeset with the total known upfront', async () => {
    const db = makeDb();
    seedPeerFile('bb', 1, [{ tag: 'bb1' }]);
    seedPeerFile('cc', 1, [{ tag: 'cc1' }]);
    seedPeerFile('cc', 2, [{ tag: 'cc2' }]);

    const progress: { done: number; total: number }[] = [];
    await syncNow(db as never, token, (p) => progress.push({ ...p }));

    // Starts at 0/3 (total known before applying) and ticks up to 3/3.
    expect(progress[0]).toEqual({ done: 0, total: 3 });
    expect(progress.at(-1)).toEqual({ done: 3, total: 3 });
    expect(progress.map((p) => p.done)).toEqual([0, 1, 2, 3]);
    expect(progress.every((p) => p.total === 3)).toBe(true);
  });
});

describe('syncNow — ordering & status', () => {
  it('pulls remote changes before pushing local ones', async () => {
    const db = makeDb();
    seedPeerFile('bb', 1, [{ tag: 'bb1' }]);
    h.changes.exportQueue = [{ rows: [{ r: 1 }], maxVersion: 4 }];

    await syncNow(db as never, token);

    const applyIdx = h.drive.calls.findIndex((c) => c.startsWith('apply:'));
    const uploadIdx = h.drive.calls.findIndex((c) => c.startsWith('upload:'));
    expect(applyIdx).toBeGreaterThanOrEqual(0);
    expect(uploadIdx).toBeGreaterThan(applyIdx);
  });

  it('throws when not signed in to Google', async () => {
    const db = makeDb();
    await expect(syncNow(db as never, async () => null)).rejects.toThrow('Not signed in');
  });
});

describe('peer state helpers', () => {
  it('listKnownPeers reflects stored watermarks', async () => {
    const db = makeDb();
    seedPeerFile('bb', 2, [{ tag: 'bb' }]);
    seedPeerFile('cc', 5, [{ tag: 'cc' }]);
    await syncNow(db as never, token);

    const peers = await listKnownPeers(db as never);
    expect(peers).toEqual(
      expect.arrayContaining([
        { siteIdHex: 'bb', watermarkSeq: 2 },
        { siteIdHex: 'cc', watermarkSeq: 5 },
      ]),
    );
  });

  it('resetSyncState clears all sync.* keys', async () => {
    const db = makeDb();
    h.changes.exportQueue = [{ rows: [{ r: 1 }], maxVersion: 3 }];
    seedPeerFile('bb', 1, [{ tag: 'bb' }]);
    await syncNow(db as never, token);
    expect([...db.meta.keys()].some((k) => k.startsWith('sync.'))).toBe(true);

    await resetSyncState(db as never);

    expect([...db.meta.keys()].some((k) => k.startsWith('sync.'))).toBe(false);
  });

  it('setHouseholdFolder re-baselines onto the picked folder', async () => {
    const db = makeDb();
    // Device has already synced against its own folder and a peer.
    h.changes.exportQueue = [{ rows: [{ r: 1 }], maxVersion: 3 }];
    seedPeerFile('bb', 1, [{ tag: 'bb' }]);
    await syncNow(db as never, token);
    expect(db.meta.get(SYNC_KEYS.LOCAL_VERSION)).toBe('3');
    expect(db.meta.get(SYNC_KEYS.PEER_PREFIX + 'bb')).toBe('1');

    await setHouseholdFolder(db as never, 'partner-folder');

    // Only the new folder id survives; watermarks + local version are cleared so
    // the device re-pushes everything into and re-pulls everything from the folder.
    expect(db.meta.get(SYNC_KEYS.FOLDER_ID)).toBe('partner-folder');
    expect(db.meta.has(SYNC_KEYS.LOCAL_VERSION)).toBe(false);
    expect(db.meta.has(SYNC_KEYS.PEER_PREFIX + 'bb')).toBe(false);
  });
});
