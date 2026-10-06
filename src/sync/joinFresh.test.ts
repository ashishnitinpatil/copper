import { beforeEach, describe, expect, it, vi } from 'vitest';

// applyPendingJoin writes settings; back them with a plain Map so we can assert
// exactly what the "start fresh" join persists onto the freshly-wiped device.
vi.mock('@/db/queries/settings', () => ({
  SETTINGS_KEYS: { ONBOARDED: 'onboarded' },
  setSetting: async (db: FakeDb, key: string, value: string) => {
    db.meta.set(key, String(value));
  },
}));

import { applyPendingJoin, rememberRetiringIdentity, stashJoinTarget } from './joinFresh';
import { SYNC_KEYS } from './syncKeys';

interface FakeDb {
  meta: Map<string, string>;
}

const JOIN_BOOK_KEY = 'et-join-book-id';

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
});

describe('stashJoinTarget', () => {
  it('records the book id for the next boot to pick up', () => {
    stashJoinTarget('book-abc');
    expect(localStorage.getItem(JOIN_BOOK_KEY)).toBe('book-abc');
  });
});

describe('applyPendingJoin', () => {
  it('is a no-op when no join is pending', async () => {
    const db = makeDb();
    await applyPendingJoin(db as never);
    expect(db.meta.size).toBe(0);
  });

  it('adopts the book and marks onboarding done', async () => {
    stashJoinTarget('partner-book');
    const db = makeDb();

    await applyPendingJoin(db as never);

    expect(db.meta.get(SYNC_KEYS.BOOK_FILE_ID)).toBe('partner-book');
    // onboarded lives in the non-replicated meta table, so the join must set it
    // locally or the device stays stranded on Welcome (regression guard for #82).
    expect(db.meta.get('onboarded')).toBe('true');
  });

  it('consumes the pending target so a later boot does not re-adopt', async () => {
    stashJoinTarget('partner-book');
    const first = makeDb();
    await applyPendingJoin(first as never);
    expect(localStorage.getItem(JOIN_BOOK_KEY)).toBeNull();

    // A subsequent boot (fresh db, nothing stashed) writes nothing.
    const second = makeDb();
    await applyPendingJoin(second as never);
    expect(second.meta.size).toBe(0);
  });

  it('hands a reset device’s old identity to the next join, even one made later from Welcome', async () => {
    // Reset (signed out): remember the identity being wiped; no join yet.
    rememberRetiringIdentity('OLDSITE');
    const welcomeDb = makeDb();
    await applyPendingJoin(welcomeDb as never); // boot onto Welcome: nothing pending
    expect(welcomeDb.meta.has(SYNC_KEYS.RETIRE_SITE)).toBe(false);

    // Welcome → "Load my book": stash the book, wipe, boot.
    stashJoinTarget('book-1');
    const db = makeDb();
    await applyPendingJoin(db as never);
    expect(db.meta.get(SYNC_KEYS.BOOK_FILE_ID)).toBe('book-1');
    expect(db.meta.get(SYNC_KEYS.RETIRE_SITE)).toBe('OLDSITE');

    // Consumed: a later join doesn't retire it again.
    stashJoinTarget('book-2');
    const later = makeDb();
    await applyPendingJoin(later as never);
    expect(later.meta.has(SYNC_KEYS.RETIRE_SITE)).toBe(false);
  });
});
