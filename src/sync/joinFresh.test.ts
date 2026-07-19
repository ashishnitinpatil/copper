import { beforeEach, describe, expect, it, vi } from 'vitest';

// applyPendingJoin reaches for the current db version and writes settings; drive
// the version and back the settings with a plain Map so we can assert exactly
// what the "start fresh" join persists onto the freshly-seeded device.
const h = vi.hoisted(() => ({ dbVersion: 0 }));

vi.mock('./changesets', () => ({
  getLocalDbVersion: async () => h.dbVersion,
}));

vi.mock('@/db/queries/settings', () => ({
  SETTINGS_KEYS: { ONBOARDED: 'onboarded' },
  setSetting: async (db: FakeDb, key: string, value: string) => {
    db.meta.set(key, String(value));
  },
}));

import { applyPendingJoin, stashJoinTarget } from './joinFresh';
import { SYNC_KEYS } from './household';

interface FakeDb {
  meta: Map<string, string>;
}

const JOIN_FOLDER_KEY = 'et-join-folder-id';

// Minimal in-memory localStorage — the vitest node environment has none, and
// joinFresh reads/writes the pending-join marker through it.
function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

function makeDb(): FakeDb {
  return { meta: new Map<string, string>() };
}

beforeEach(() => {
  installLocalStorage();
  h.dbVersion = 0;
});

describe('stashJoinTarget', () => {
  it('records the folder id for the next boot to pick up', () => {
    stashJoinTarget('folder-abc');
    expect(localStorage.getItem(JOIN_FOLDER_KEY)).toBe('folder-abc');
  });
});

describe('applyPendingJoin', () => {
  it('is a no-op when no join is pending', async () => {
    const db = makeDb();
    await applyPendingJoin(db as never);
    expect(db.meta.size).toBe(0);
  });

  it('adopts the folder, baselines the version, and marks onboarding done', async () => {
    stashJoinTarget('partner-folder');
    // The seed defaults have already bumped the local clock to 42.
    h.dbVersion = 42;
    const db = makeDb();

    await applyPendingJoin(db as never);

    expect(db.meta.get(SYNC_KEYS.FOLDER_ID)).toBe('partner-folder');
    // Baselined to the *current* version so the seed defaults are never pushed
    // back into the partner's folder — this device only pulls their ledger.
    expect(db.meta.get(SYNC_KEYS.LOCAL_VERSION)).toBe('42');
    // onboarded lives in the non-replicated meta table, so the join must set it
    // locally or the device stays stranded on Welcome (regression guard for #82).
    expect(db.meta.get('onboarded')).toBe('true');
  });

  it('consumes the pending target so a later boot does not re-adopt', async () => {
    stashJoinTarget('partner-folder');
    const first = makeDb();
    await applyPendingJoin(first as never);
    expect(localStorage.getItem(JOIN_FOLDER_KEY)).toBeNull();

    // A subsequent boot (fresh db, nothing stashed) writes nothing.
    const second = makeDb();
    await applyPendingJoin(second as never);
    expect(second.meta.size).toBe(0);
  });
});
