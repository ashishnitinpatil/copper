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
// Set by requestLocalReset(); consumed once at the next boot.
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
  localStorage.setItem(RESET_FLAG, '1');
  window.location.reload();
}

// How long to wait for the wipe before assuming another tab is holding the
// database open. Chrome does not reliably fire 'blocked' when the holder is a
// different tab, so the request can just sit there forever — without this the
// app hangs on its loading screen with nothing to act on.
const DELETE_TIMEOUT_MS = 5_000;

const DB_HELD_MESSAGE = 'Local data is open in another tab — close it and try again.';

async function deleteLocalDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(VFS_IDB_NAME);
    // Nothing should hold the DB this early in boot; if another tab does, say so
    // rather than hang. The flag survives, so a retry after closing tabs works.
    const timer = setTimeout(() => reject(new Error(DB_HELD_MESSAGE)), DELETE_TIMEOUT_MS);
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    req.onsuccess = () => settle(resolve);
    req.onerror = () => settle(() => reject(req.error ?? new Error('Could not erase local data.')));
    req.onblocked = () => settle(() => reject(new Error(DB_HELD_MESSAGE)));
  });
}

export async function openDB(): Promise<DB> {
  if (dbInstance) return dbInstance;
  if (openPromise) return openPromise;

  openPromise = (async () => {
    if (localStorage.getItem(RESET_FLAG) === '1') {
      await deleteLocalDatabase();
      localStorage.removeItem(RESET_FLAG);
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
