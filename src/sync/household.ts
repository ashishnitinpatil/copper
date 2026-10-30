import type { DB } from '@/db/wasm';
import { getSetting, setSetting } from '@/db/queries/settings';
import {
  createBinaryFile,
  downloadBytes,
  deleteFile,
  findFilesByName,
  getFileMeta,
  updateBinaryFile,
  type DriveFile,
} from './googleDrive';
import {
  applyRemoteChanges,
  exportAllChanges,
  exportChangesSince,
  getLocalDbVersion,
  getLocalSiteIdHex,
  type ChangeRow,
} from './changesets';
import {
  BOOK_FILE_NAME,
  BOOK_MIME,
  bookRegressed,
  decodeBook,
  diffBook,
  encodeBook,
  gunzipJson,
  gzipJson,
  NewerBookError,
  overlayBook,
  type BookFile,
} from './bookFile';
import { loadBookCache, saveBookCache } from './bookCache';
import { uuid } from '@/db/uuid';
import { ensureAppFolder } from './driveFolders';
import { backupBook, type BackupReason } from './driveBackup';
import { SYNC_KEYS } from './syncKeys';

export { SYNC_KEYS };

/**
 * A merge of this many cells or more holds the app behind the setup screen
 * (one entry is ~20 cells with its audit row, so roughly 100 entries).
 */
export const BIG_MERGE_CELLS = 2000;

export interface SyncResult {
  /** Local cells the book was missing (0 when nothing was uploaded). */
  pushed: number;
  /** Cells merged in from the book. */
  pulled: number;
  /** Other devices that have written to the book. */
  peers: number;
  uploadedFile: string | null;
  /** Set when this sync wrote the whole book: created it, or overwrote it on join. */
  wrote?: 'created' | 'replaced';
}

// Progress of the merge phase, in cells applied. Drives the "N of M" banner
// during a big first pull.
export interface SyncProgress {
  /** Downloading the book (bytes), getting it ready (unpacking and comparing
   *  with this device; no count), merging (cells), then sending this device's
   *  changes back up (no count). */
  stage: 'download' | 'prepare' | 'apply' | 'upload';
  done: number;
  total: number;
}

export type SyncProgressFn = (progress: SyncProgress) => void;

/**
 * This Google account already has a book, found by a device that has never
 * synced with it. Joining would merge this device's own data — at the very
 * least the default categories every new device starts with — into it, so the
 * person chooses: start fresh from the book, or merge.
 */
export class BookFoundError extends Error {
  constructor(public bookId: string) {
    super(
      'This Google account already has a shared book. Sync is paused until you choose what to ' +
        'do with this device’s data: start fresh from the book, or merge it in.',
    );
    this.name = 'BookFoundError';
  }
}

// The shared book was overwritten by another device (someone joined it with
// "Replace the shared book") since this device last synced. Merging now would
// bring every replaced row back as a duplicate, so sync stops until this device
// Starts fresh from the book.
export class BookReplacedError extends Error {
  constructor() {
    super(
      'The shared book was replaced from another device. Sync is paused here so your old copy ' +
        'doesn’t bring duplicates back. Load the shared book again to keep syncing — changes made ' +
        'on this device since its last sync will be lost.',
    );
    this.name = 'BookReplacedError';
  }
}

// How many times to re-merge when the book changed on Drive while we were
// merging it. Each loser of a write race self-heals on its next sync anyway (its
// cells are still local, so it sees itself ahead and re-uploads) — this just
// avoids overwriting a partner's write we already know about.
const MAX_MERGE_ATTEMPTS = 3;

async function readBook(
  token: string,
  fileId: string,
  onProgress?: SyncProgressFn,
): Promise<{ book: BookFile; bytes: Uint8Array }> {
  const bytes = await downloadBytes(
    token,
    fileId,
    onProgress && ((done, total) => onProgress({ stage: 'download', done, total })),
  );
  onProgress?.({ stage: 'prepare', done: 0, total: 0 });
  return { book: await gunzipJson<BookFile>(bytes), bytes };
}

async function encodeCells(db: DB, cells: ChangeRow[], siteHex: string): Promise<Uint8Array> {
  const generation = (await getSetting(db, SYNC_KEYS.BOOK_GENERATION)) || undefined;
  return gzipJson(encodeBook(cells, siteHex, generation));
}

// Reads every cell out of the local database: seconds on a large book, with
// the database held throughout. Only for when this device's copy of the book
// can't be trusted (see trustedCopy).
async function encodeLocalBook(db: DB, siteHex: string): Promise<Uint8Array> {
  return encodeCells(db, await exportAllChanges(db), siteHex);
}

// How long a device goes on syncing from its copy of the book before one sync
// compares its whole database with the book again — a backstop, should the
// copy ever drift from what's really on the device.
const FULL_CHECK_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

interface TrustedCopy {
  cells: ChangeRow[];
  checkedAt: number;
}

/**
 * This device's copy of the last book it merged or wrote (bookCache.ts), when
 * it still describes this device exactly: local state = the copy + what changed
 * here since the last sync. Any doubt — no copy, a reset, a restore, another
 * book or version, an interrupted write, a week since the last full compare —
 * returns null, and the sync reads the whole database instead.
 */
async function trustedCopy(db: DB, bookId: string, siteHex: string): Promise<TrustedCopy | null> {
  const copy = await loadBookCache();
  if (!copy) return null;
  const [version, synced, generation] = await Promise.all([
    getSetting(db, SYNC_KEYS.BOOK_VERSION),
    getSetting(db, SYNC_KEYS.SYNCED_DB_VERSION),
    getSetting(db, SYNC_KEYS.BOOK_GENERATION),
  ]);
  const matches =
    copy.site === siteHex &&
    copy.bookId === bookId &&
    !!version &&
    copy.version === version &&
    String(copy.dbVersion) === synced &&
    copy.generation === (generation ?? '') &&
    Date.now() - copy.checkedAt < FULL_CHECK_EVERY_MS;
  if (!matches) return null;
  try {
    return { cells: decodeBook(await gunzipJson<BookFile>(copy.bytes)), checkedAt: copy.checkedAt };
  } catch {
    return null;
  }
}

// Start a new book generation — on creating the book, or overwriting it.
async function newGeneration(db: DB): Promise<void> {
  await setSetting(db, SYNC_KEYS.BOOK_GENERATION, uuid());
}

export { NewerBookError };

// A newer Copper on another device may have added a table or column this
// version doesn't have yet. Applying those cells fails deep in SQLite with a
// bare "SQL logic error", so check first and say what's actually wrong. cid
// '-1' is cr-sqlite's row-existence marker, not a column.
async function assertKnownColumns(db: DB, rows: ChangeRow[]): Promise<void> {
  const byTable = new Map<string, Set<string>>();
  for (const r of rows) {
    const cids = byTable.get(r.table) ?? new Set<string>();
    // A deleted row arrives as a '-1' marker with no columns — but its table
    // must still exist here, or the apply fails on a table this version lacks.
    if (r.cid !== '-1') cids.add(r.cid);
    byTable.set(r.table, cids);
  }
  for (const [table, cids] of byTable) {
    const cols = await db.execO<{ name: string }>('SELECT name FROM pragma_table_info(?)', [table]);
    if (cols.length === 0) throw new NewerBookError();
    const known = new Set(cols.map((c) => c.name));
    for (const cid of cids) if (!known.has(cid)) throw new NewerBookError();
  }
}

// Edits made on this device since `dbVersion` (merged-in cells keep their
// origin device's site id).
async function countOwnChangesSince(db: DB, dbVersion: number): Promise<number> {
  const rows = await db.execO<{ n: number }>(
    'SELECT count(*) AS n FROM crsql_changes WHERE db_version > ? AND site_id = crsql_site_id()',
    [dbVersion],
  );
  return Number(rows[0]?.n ?? 0);
}

async function countLocalChangesSince(db: DB, dbVersion: number): Promise<number> {
  const rows = await db.execO<{ n: number }>(
    'SELECT count(*) AS n FROM crsql_changes WHERE db_version > ?',
    [dbVersion],
  );
  return Number(rows[0]?.n ?? 0);
}

// ── sync ────────────────────────────────────────────────────────────────────

// The book a device that doesn't know its book yet (a new or reset device)
// should use. A book this account joined — shared by someone else — beats its
// own: joining was a deliberate choice, and an account that joined may still
// have its own pre-join book lying around. Otherwise the oldest of its own, so
// devices that raced to create one all settle on the same book.
export async function findBook(token: string): Promise<DriveFile | null> {
  const books = await findFilesByName(token, BOOK_FILE_NAME);
  return books.find((f) => !f.owners?.some((o) => o.me)) ?? books[0] ?? null;
}

// Resolve the book this device syncs with. Returns null when this account has
// none yet, and the caller creates it. Finding one it hasn't synced with pauses
// for the person's choice (BookFoundError) rather than merging into it.
async function resolveBook(db: DB, token: string): Promise<string | null> {
  const cached = await getSetting(db, SYNC_KEYS.BOOK_FILE_ID);
  if (cached) return cached;
  const existing = await findBook(token);
  if (existing) throw new BookFoundError(existing.id);
  return null;
}

// `dbVersion` is the local version the book now holds, read before the export
// (or merge) began — not after, or an edit made while the book uploaded would
// count as synced and never reach it. `book` is that book's file, kept as this
// device's copy (see trustedCopy). The copy is saved first: if the page dies
// before the settings below are written, its stamps don't match them and the
// next sync simply doesn't trust it.
async function recordSynced(
  db: DB,
  version: string | undefined,
  dbVersion: number,
  book: { bookId: string; siteHex: string; bytes: Uint8Array; checkedAt: number },
): Promise<void> {
  await saveBookCache({
    site: book.siteHex,
    bookId: book.bookId,
    version: version ?? '',
    dbVersion,
    generation: (await getSetting(db, SYNC_KEYS.BOOK_GENERATION)) ?? '',
    checkedAt: book.checkedAt,
    bytes: book.bytes,
  });
  await setSetting(db, SYNC_KEYS.BOOK_VERSION, version ?? '');
  await setSetting(db, SYNC_KEYS.SYNCED_DB_VERSION, String(dbVersion));
  await setSetting(db, SYNC_KEYS.LAST_SYNC_AT, new Date().toISOString());
  await setSetting(db, SYNC_KEYS.MERGE_PENDING, '');
}

// Other devices in the book, as lower-case hex site ids. Read from the synced
// `devices` table, where every device registers itself on each boot — not from
// whose cells are in the book, which drops a device once all its cells are
// overwritten or deleted (after a restore on another device, say).
async function otherDeviceIds(db: DB, siteHex: string): Promise<string[]> {
  const rows = await db.execO<{ site_id: string }>("SELECT site_id FROM devices WHERE retired_at = ''");
  const self = siteHex.toLowerCase();
  return rows.map((r) => r.site_id.toLowerCase()).filter((s) => s !== self);
}

async function peerCount(db: DB, siteHex: string): Promise<number> {
  return (await otherDeviceIds(db, siteHex)).length;
}

export async function syncNow(
  db: DB,
  getAccessToken: () => Promise<string | null>,
  onProgress?: SyncProgressFn,
): Promise<SyncResult> {
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in with Google and try again.');
  const siteHex = await getLocalSiteIdHex(db);

  let bookId = await resolveBook(db, token);
  let pulled = 0;

  // First device of this account: publish the local book.
  if (!bookId) {
    await newGeneration(db);
    const folderId = await ensureAppFolder(db, token);
    const dbv = await getLocalDbVersion(db);
    const body = await encodeLocalBook(db, siteHex);
    const file = await createBinaryFile(token, folderId, BOOK_FILE_NAME, BOOK_MIME, body);
    await setSetting(db, SYNC_KEYS.PENDING_OVERWRITE, '');
    await setSetting(db, SYNC_KEYS.PENDING_SAFETY_BACKUP, '');
    // Another device of this account may have created one at the same moment.
    // Everyone keeps the oldest; the others delete theirs and merge into it.
    const winner = await findBook(token);
    if (!winner || winner.id === file.id) {
      await setSetting(db, SYNC_KEYS.BOOK_FILE_ID, file.id);
      await recordSynced(db, file.version, dbv, { bookId: file.id, siteHex, bytes: body, checkedAt: Date.now() });
      return { pushed: 1, pulled, peers: 0, uploadedFile: BOOK_FILE_NAME, wrote: 'created' };
    }
    await deleteFile(token, file.id);
    bookId = winner.id;
    await setSetting(db, SYNC_KEYS.BOOK_FILE_ID, bookId);
    await setSetting(db, SYNC_KEYS.BOOK_GENERATION, '');
    await setSetting(db, SYNC_KEYS.BOOK_VERSION, '');
  }

  // A major change is about to reach the shared book: snapshot it first, so the
  // change can be undone by restoring that copy.
  const safetyReason = (await getSetting(db, SYNC_KEYS.PENDING_SAFETY_BACKUP)) as BackupReason | null;
  if (safetyReason) {
    await backupBook(db, token, bookId, safetyReason);
    await setSetting(db, SYNC_KEYS.PENDING_SAFETY_BACKUP, '');
  }

  // "Overwrite the shared book" on join: replace the book with this device's
  // state (the safety backup above kept the old one). A new generation makes
  // every other device pause and Start fresh rather than merge the replaced
  // rows back in as duplicates.
  if (await getSetting(db, SYNC_KEYS.PENDING_OVERWRITE)) {
    await newGeneration(db);
    const dbv = await getLocalDbVersion(db);
    const body = await encodeLocalBook(db, siteHex);
    const file = await updateBinaryFile(token, bookId, BOOK_MIME, body);
    await setSetting(db, SYNC_KEYS.PENDING_OVERWRITE, '');
    await recordSynced(db, file.version, dbv, { bookId, siteHex, bytes: body, checkedAt: Date.now() });
    return { pushed: 1, pulled, peers: 0, uploadedFile: BOOK_FILE_NAME, wrote: 'replaced' };
  }

  let pushed = 0;
  const book = bookId;
  // Loaded on first need; a retry below reuses it (the settings it's checked
  // against don't change until the sync is recorded).
  let copy: TrustedCopy | null | undefined;
  const getCopy = async () => (copy === undefined ? (copy = await trustedCopy(db, book, siteHex)) : copy);
  for (let attempt = 1; ; attempt++) {
    const meta = await getFileMeta(token, bookId);
    const remoteChanged = meta.version !== (await getSetting(db, SYNC_KEYS.BOOK_VERSION));
    const syncedDbv = Number((await getSetting(db, SYNC_KEYS.SYNCED_DB_VERSION)) ?? -1);
    const localChanged = (await getLocalDbVersion(db)) !== syncedDbv;

    // The common case: nothing changed anywhere — one metadata request, done.
    if (!remoteChanged && !localChanged) {
      // Never leave the setup screen up over a book that's up to date.
      if (await getSetting(db, SYNC_KEYS.MERGE_PENDING)) await setSetting(db, SYNC_KEYS.MERGE_PENDING, '');
      break;
    }

    let needsUpload = localChanged;
    let mergedDbv = 0;
    const known = await getCopy();
    // Whether this sync compares the whole local database with the book (slow;
    // see trustedCopy), or works from this device's copy of it.
    let full = !known;
    // The book an upload builds on, plus what changed here since the last sync.
    let base: ChangeRow[] | null = known?.cells ?? null;
    let pulledBytes: Uint8Array | null = null;
    if (remoteChanged) {
      const { book: remote, bytes } = await readBook(token, bookId, onProgress);
      const mine = await getSetting(db, SYNC_KEYS.BOOK_GENERATION);
      if (remote.generation !== mine) {
        if (mine) throw new BookReplacedError();
        // First sync with this book (a join): adopt its generation.
        if (remote.generation) await setSetting(db, SYNC_KEYS.BOOK_GENERATION, remote.generation);
      }
      const remoteCells = decodeBook(remote);
      // A book that lost cells this device had (a write race) needs the full
      // compare to see them and put them back.
      full = !known || bookRegressed(known.cells, remoteCells);
      // From the copy: everything here is the copy plus local changes, so only
      // what changed in the book since the copy needs merging.
      const diff = !full && known
        ? { toApply: diffBook(known.cells, remoteCells).toApply, localAhead: 0 }
        : diffBook(await exportAllChanges(db), remoteCells);
      await assertKnownColumns(db, diff.toApply);
      const total = diff.toApply.length;
      onProgress?.({ stage: 'apply', done: 0, total });
      if (total >= BIG_MERGE_CELLS) await setSetting(db, SYNC_KEYS.MERGE_PENDING, '1');
      const beforeApply = await getLocalDbVersion(db);
      pulled += await applyRemoteChanges(db, diff.toApply, (done) => onProgress?.({ stage: 'apply', done, total }));
      // Cleared whatever this merge's size: one resumed after being cut short
      // can be under the threshold.
      await setSetting(db, SYNC_KEYS.MERGE_PENDING, '');
      // Before the merge, a local cell that's about to lose to a newer remote
      // value also looks "different". Re-compare after cr-sqlite has merged, so
      // only cells that are genuinely ahead (local-only, or won the merge)
      // trigger an upload — a pure pull must not re-upload the whole book.
      // From the copy, only this device's own edits can be ahead of the book:
      // everything else here came from the book.
      if (full) {
        pushed = diff.localAhead > 0 ? diffBook(await exportAllChanges(db), remoteCells).localAhead : 0;
      } else {
        pushed = await countOwnChangesSince(db, syncedDbv);
      }
      // Anything added here while the merge ran is ahead of the book too.
      mergedDbv = await getLocalDbVersion(db);
      pushed = Math.max(pushed, await countOwnChangesSince(db, beforeApply));
      needsUpload = pushed > 0;
      pulledBytes = bytes;
      base = full ? null : remoteCells;
    } else {
      pushed = await countLocalChangesSince(db, syncedDbv);
    }
    const checkedAt = full ? Date.now() : known!.checkedAt;

    if (!needsUpload) {
      // Only a pull gets here (a local change always uploads).
      await recordSynced(db, meta.version, mergedDbv, { bookId, siteHex, bytes: pulledBytes!, checkedAt });
      break;
    }
    onProgress?.({ stage: 'upload', done: 0, total: 0 });
    const dbv = await getLocalDbVersion(db);
    const body = base
      ? await encodeCells(db, overlayBook(base, await exportChangesSince(db, syncedDbv)), siteHex)
      : await encodeLocalBook(db, siteHex);
    // Someone wrote while we merged (or encoded): merge their write too before
    // uploading. Checked after encoding, which takes seconds on a big book.
    const latest = await getFileMeta(token, bookId);
    if (latest.version !== meta.version && attempt < MAX_MERGE_ATTEMPTS) continue;
    const file = await updateBinaryFile(token, bookId, BOOK_MIME, body);
    await recordSynced(db, file.version, dbv, { bookId, siteHex, bytes: body, checkedAt });
    return { pushed, pulled, peers: await peerCount(db, siteHex), uploadedFile: BOOK_FILE_NAME };
  }
  await setSetting(db, SYNC_KEYS.LAST_SYNC_AT, new Date().toISOString());
  return { pushed: 0, pulled, peers: await peerCount(db, siteHex), uploadedFile: null };
}

// ── status & joining ────────────────────────────────────────────────────────

export interface SyncStatusInfo {
  lastSyncAt: string | null;
  bookId: string | null;
  appFolderId: string | null;
  /** A big merge was cut short; this device's book is only partly merged. */
  mergePending: boolean;
}

/** True when this device holds changes the shared book doesn't have yet. */
export async function hasUnsyncedChanges(db: DB): Promise<boolean> {
  if (!(await getSetting(db, SYNC_KEYS.BOOK_FILE_ID))) return false;
  const syncedDbv = Number((await getSetting(db, SYNC_KEYS.SYNCED_DB_VERSION)) ?? -1);
  return (await getLocalDbVersion(db)) !== syncedDbv;
}

export async function getSyncStatus(db: DB): Promise<SyncStatusInfo> {
  const [lastSyncAt, bookId, appFolderId, mergePending] = await Promise.all([
    getSetting(db, SYNC_KEYS.LAST_SYNC_AT),
    getSetting(db, SYNC_KEYS.BOOK_FILE_ID),
    getSetting(db, SYNC_KEYS.APP_FOLDER_ID),
    getSetting(db, SYNC_KEYS.MERGE_PENDING),
  ]);
  return { lastSyncAt, bookId: bookId || null, appFolderId: appFolderId || null, mergePending: !!mergePending };
}

export interface KnownPeer {
  siteIdHex: string;
}

/** Other devices in the shared book. */
export async function listKnownPeers(db: DB): Promise<KnownPeer[]> {
  const self = await getLocalSiteIdHex(db).catch(() => '');
  return (await otherDeviceIds(db, self)).map((siteIdHex) => ({ siteIdHex }));
}

export async function resetSyncState(db: DB): Promise<void> {
  await db.exec(`DELETE FROM meta WHERE key LIKE 'sync.%'`);
}

export type JoinMode = 'merge' | 'replace';

// Point this device at a shared book (one a partner shared and this device
// picked). Re-baselines sync state, then queues a safety backup of the book so
// the merge or overwrite can be undone. "Start fresh" goes through joinFresh.
export async function joinSharedBook(db: DB, bookId: string, mode: JoinMode): Promise<void> {
  await resetSyncState(db);
  await setSetting(db, SYNC_KEYS.BOOK_FILE_ID, bookId);
  await setSetting(
    db,
    SYNC_KEYS.PENDING_SAFETY_BACKUP,
    mode === 'merge' ? 'before merge' : 'before overwrite',
  );
  if (mode === 'replace') await setSetting(db, SYNC_KEYS.PENDING_OVERWRITE, '1');
}

async function isConnected(db: DB): Promise<boolean> {
  return !!(await getSetting(db, SYNC_KEYS.BOOK_FILE_ID));
}

// After a restore or import while connected: back the book up before the change
// reaches it. The change itself merges normally — a restore deletes the old rows
// (CRDT tombstones) and inserts the restored ones, so partners converge on the
// restored book without duplicates and keep any edits they hadn't synced yet.
export async function markSafetyBackup(db: DB, reason: BackupReason): Promise<void> {
  if (await isConnected(db)) await setSetting(db, SYNC_KEYS.PENDING_SAFETY_BACKUP, reason);
}

export interface BookPeek {
  name: string;
  owner: string | null;
  /** The signed-in account owns it (its own book, not a partner's). */
  ownedByMe: boolean;
  /** The signed-in account may share it with someone else. */
  canShare: boolean;
  modifiedTime: string | null;
  sizeBytes: number | null;
}

// Read-only look at a picked book for the join confirm screen: whose it is and
// when it last changed, so the person can confirm they picked the right one.
export async function peekBook(token: string, bookId: string): Promise<BookPeek> {
  const meta = await getFileMeta(token, bookId);
  const o = meta.owners?.[0];
  return {
    name: meta.name,
    owner: o ? (o.emailAddress ?? o.displayName ?? null) : null,
    ownedByMe: !!o?.me,
    canShare: meta.capabilities?.canShare ?? !!o?.me,
    modifiedTime: meta.modifiedTime ?? null,
    sizeBytes: meta.size ? Number(meta.size) : null,
  };
}
