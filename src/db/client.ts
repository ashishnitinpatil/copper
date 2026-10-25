import { getSQLite, type DB } from './wasm';
import { SCHEMA_NAME, SCHEMA_SQL } from './schema';
import { seedIfEmpty } from './seed';
import { materializeDueRecurrences } from './queries/recurring';
import { ensureLocalDevice } from './changeLog';
import { applyPendingJoin, hasPendingJoin } from '@/sync/joinFresh';
import { SYNC_KEYS } from '@/sync/syncKeys';
import { getSetting } from './queries/settings';

const DB_FILE = 'household.db';

// wa-sqlite's IDBBatchAtomicVFS keeps every sqlite file in one IndexedDB database
// under this fixed name. Deleting it is how we wipe all local data.
const VFS_IDB_NAME = 'idb-batch-atomic';
// Set by requestLocalReset(); consumed once at this tab's next boot. Per tab
// (sessionStorage), so other tabs that happen to reload don't erase too.
const RESET_FLAG = 'et-reset-pending';

let dbInstance: DB | null = null;
let openPromise: Promise<DB> | null = null;

/**
 * Queue a full local wipe and reload. The deletion itself can't happen now: the
 * VFS holds its IndexedDB connection open for the page's whole lifetime, so
 * deleteDatabase() would block, and tearing the file out from under an open
 * connection corrupts it (and can leave a stuck wa-sqlite write lock). So we just
 * flag it and reload — openDB() does the delete at the next boot, before anything
 * reopens the DB.
 */
export function requestLocalReset(): void {
  sessionStorage.setItem(RESET_FLAG, '1');
  window.location.reload();
}

// How long to wait for the wipe before assuming another tab is holding the
// database open. Chrome does not reliably fire 'blocked' when the holder is a
// different tab, so the request can just sit there forever — without this the
// app hangs on its loading screen with nothing to act on.
const DELETE_TIMEOUT_MS = 5_000;

const DB_HELD_MESSAGE = 'Copper is open in another tab. Close the other Copper tabs, then refresh this one.';

// Every tab shares the one local database, and erasing it can't go ahead while
// another tab holds it open. Closing the DB isn't enough (the storage layer
// keeps its connection for the page's life), so the erasing tab asks the others
// to reload into a waiting state that never opens it, then tells them once the
// book is back. The flag is per tab and survives that reload.
type TabMessage = { type: 'release' } | { type: 'ready' };
const WAITING_KEY = 'copper-waiting-for-erase';
const tabs = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('copper-db') : null;
const waiting = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(WAITING_KEY) === '1';

/** This tab stepped aside while another tab erases this device's data. */
export function isWaitingForErase(): boolean {
  return waiting;
}

/** Stop waiting for the other tab and open the book. */
export function stopWaitingForErase(): void {
  sessionStorage.removeItem(WAITING_KEY);
  window.location.reload();
}

tabs?.addEventListener('message', (e: MessageEvent<TabMessage>) => {
  // The erasing tab itself never steps aside.
  if (e.data.type === 'release' && !waiting && sessionStorage.getItem(RESET_FLAG) !== '1') {
    sessionStorage.setItem(WAITING_KEY, '1');
    window.location.reload();
  } else if (e.data.type === 'ready' && waiting) {
    stopWaitingForErase();
  }
});

async function deleteLocalDatabase(): Promise<void> {
  tabs?.postMessage({ type: 'release' } satisfies TabMessage);
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(VFS_IDB_NAME);
    // Other tabs let go by reloading; if one hasn't within the timeout, say so
    // rather than hang. The flag survives, so refreshing after closing it retries.
    const timer = setTimeout(() => reject(new Error(DB_HELD_MESSAGE)), DELETE_TIMEOUT_MS);
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    req.onsuccess = () => settle(resolve);
    req.onerror = () => settle(() => reject(req.error ?? new Error('Could not erase local data.')));
    // 'blocked' only means other tabs haven't let go yet; they're reloading.
    // The timeout above covers a tab on an older Copper that never does.
  });
}

export async function openDB(): Promise<DB> {
  if (dbInstance) return dbInstance;
  if (openPromise) return openPromise;

  openPromise = (async () => {
    // Waiting on another tab's erase: never open the DB (that would block it).
    if (waiting) return new Promise<DB>(() => {});
    if (sessionStorage.getItem(RESET_FLAG) === '1') {
      await deleteLocalDatabase();
      sessionStorage.removeItem(RESET_FLAG);
      // Don't open here. Creating a fresh DB in the same page session that just
      // deleted the IndexedDB races the deletion and reads a torn ("malformed")
      // image. Reloading lets the DB be created in a clean page that did no
      // delete — exactly the first-run install path, which is known good.
      window.location.reload();
      // The reload replaces this page; never resolve so nothing reads a half-DB.
      return new Promise<DB>(() => {});
    }
    const sqlite = await getSQLite();
    const db = await sqlite.open(DB_FILE);
    await db.automigrateTo(SCHEMA_NAME, SCHEMA_SQL);
    // A large sync drops indexes while it applies (see applyRemoteChanges); if
    // the page was closed mid-way, put back any that are missing.
    await ensureIndexes(db);
    // Seed only a brand-new, unconnected device. Sync merges the whole local
    // state into the shared book, so defaults seeded on a device that is joining
    // (or already joined — e.g. reloaded before its first sync landed) would be
    // pushed into the book as 16 duplicate categories.
    const connected = !!(await getSetting(db, SYNC_KEYS.BOOK_FILE_ID));
    if (!hasPendingJoin() && !connected) await seedIfEmpty(db);
    // If a "start fresh" join was queued before the wipe, point this device at
    // the partner's book now — before the first sync — so it pulls their ledger.
    await applyPendingJoin(db);
    // Register this device (and refresh its last-seen) so the audit trail can
    // show a friendly name for changes it makes. Best-effort: a failure here
    // shouldn't keep the app from opening.
    await ensureLocalDevice(db).catch((err) => {
      console.error('Failed to register local device', err);
    });
    // Don't block app startup if a rule has a malformed rrule, but do surface
    // the failure rather than swallowing it — otherwise pending recurrences go
    // missing with no trace.
    await materializeDueRecurrences(db).catch((err) => {
      console.error('Failed to materialize due recurrences', err);
    });
    dbInstance = db;
    // Tabs that stepped aside for an erase reload now that the book is back.
    tabs?.postMessage({ type: 'ready' } satisfies TabMessage);
    return db;
  })();

  return openPromise;
}

export async function closeDB(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
    openPromise = null;
  }
}

export function getOpenDB(): DB {
  if (!dbInstance) {
    throw new Error('Database not opened yet — call openDB() first');
  }
  return dbInstance;
}

const INDEX_STATEMENTS = SCHEMA_SQL.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS[^;]+;/g) ?? [];

/** Re-create any schema index that's missing. Cheap when they all exist. */
export async function ensureIndexes(db: DB): Promise<void> {
  for (const sql of INDEX_STATEMENTS) await db.exec(sql);
}
