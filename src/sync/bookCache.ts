// The last shared book this device fully merged or wrote, kept on the device
// (its own IndexedDB store, next to the database) so a routine sync needn't read
// every cell out of the local database. Reading crsql_changes in full takes
// seconds on a large book and holds the database the whole time — every page
// and every new entry waits behind it.
//
// With this copy, local state = this book + whatever changed here since
// `dbVersion`. A pull merges only the cells that differ between this copy and
// the new book; an upload is this copy (or the new book) plus those local
// changes. The stamps say exactly which state the copy matches; household.ts
// trusts it only when every stamp still matches, and otherwise does the full
// read, as before.

const DB_NAME = 'copper-sync-cache';
const STORE = 'book';
const KEY = 'last';

export interface CachedBook {
  /** This device's site id (hex). A reset gives a new one, so its copy no longer applies. */
  site: string;
  bookId: string;
  /** Drive version of the book this copy is. */
  version: string;
  /** Local db_version when it was recorded. */
  dbVersion: number;
  generation: string;
  /** When a sync last compared the whole local database with the book (ms). */
  checkedAt: number;
  /** The book file as stored on Drive (gzipped). */
  bytes: Uint8Array;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadBookCache(): Promise<CachedBook | null> {
  try {
    return (await run<CachedBook>('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

/** Best-effort: without a copy the next sync just does the full read. */
export async function saveBookCache(book: CachedBook): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(book, KEY));
  } catch (e) {
    console.warn('Could not keep a copy of the shared book on this device:', e);
    await clearBookCache();
  }
}

export async function clearBookCache(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY));
  } catch {
    /* nothing to clear */
  }
}
