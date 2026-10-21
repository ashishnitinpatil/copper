import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeRow } from './changesets';

// Simulated devices syncing through an in-memory Google Drive. The book format,
// diff and gzip (bookFile.ts) run for real; only Drive's HTTP API and
// cr-sqlite's merge are faked. The fake merge is last-writer-wins per cell on
// (col_version, site_id) — the same ordering cr-sqlite uses — so convergence
// here means the sync protocol moves every cell where it needs to go.

interface FakeFile {
  id: string;
  name: string;
  parents: string[];
  folder: boolean;
  bytes?: Uint8Array;
  json?: unknown;
  version: number;
  createdTime: string;
  /** The Google account that created it. */
  owner: string;
}

interface Device {
  /** Google account this device is signed in with. */
  account: string;
  siteHex: string;
  siteB64: string;
  cells: Map<string, ChangeRow>;
  dbv: number;
  db: FakeDb;
}

interface FakeDb {
  meta: Map<string, string>;
  execO: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  exec: (sql: string) => Promise<void>;
}

const h = vi.hoisted(() => ({
  files: new Map<string, FakeFile>(),
  nextId: 1,
  clock: 0,
  calls: [] as string[],
  cur: null as Device | null,
  // Files another account picked (account|fileId) — drive.file lets it see them.
  grants: new Set<string>(),
  // Hidden from the next lookup only, to stage a race with another device.
  hideOnce: new Set<string>(),
}));

// Columns this (fake) app version knows; a book cell outside these came from a newer version.
const SCHEMA: Record<string, string[]> = { transactions: ['id', 'note'], devices: ['site_id', 'name'] };

const key = (r: { table: string; pk: string; cid: string }) => `${r.table}|${r.pk}|${r.cid}`;
// Site ids travel as base64 of their raw bytes; the book reports them as hex.
const hexToB64 = (hex: string) => btoa(String.fromCharCode(...(hex.match(/../g) ?? []).map((b) => parseInt(b, 16))));

vi.mock('./googleDrive', () => {
  const meta = (f: FakeFile) => ({
    id: f.id,
    name: f.name,
    mimeType: f.folder ? 'folder' : 'file',
    version: String(f.version),
    createdTime: f.createdTime,
    modifiedTime: f.createdTime,
    size: f.bytes ? String(f.bytes.length) : undefined,
    owners: [{ emailAddress: `${f.owner}@example.com`, me: f.owner === h.cur?.account }],
  });
  const add = (f: Omit<FakeFile, 'id' | 'version' | 'createdTime' | 'owner'>) => {
    const file: FakeFile = {
      ...f,
      owner: h.cur?.account ?? 'a',
      id: `f${h.nextId++}`,
      version: 1,
      createdTime: new Date(2026, 0, 1, 0, 0, h.clock++).toISOString(),
    };
    h.files.set(file.id, file);
    return file;
  };
  const get = (id: string) => {
    const f = h.files.get(id);
    if (!f) throw new Error(`Drive 404: ${id}`);
    return f;
  };
  const inFolder = (parent: string | undefined, name: string, folder: boolean) =>
    [...h.files.values()].filter(
      (f) => f.folder === folder && f.name === name && (!parent || f.parents.includes(parent)),
    );
  return {
    findFolder: async (_t: string, name: string, parent?: string) => {
      const f = inFolder(parent, name, true)[0];
      return f ? meta(f) : null;
    },
    findOrCreateFolder: async (_t: string, name: string, parent?: string) => {
      const f = inFolder(parent, name, true)[0] ?? add({ name, parents: parent ? [parent] : [], folder: true });
      return meta(f);
    },
    findFilesByName: async (_t: string, name: string) => {
      const acct = h.cur!.account;
      const hidden = new Set(h.hideOnce);
      h.hideOnce.clear();
      return [...h.files.values()]
        .filter((f) => !f.folder && f.name === name && !hidden.has(f.id))
        .filter((f) => f.owner === acct || h.grants.has(`${acct}|${f.id}`))
        .map(meta);
    },
    listFolderFiles: async (_t: string, folderId: string, prefix = '') =>
      [...h.files.values()]
        .filter((f) => !f.folder && f.parents.includes(folderId) && f.name.includes(prefix))
        .map(meta),
    createBinaryFile: async (_t: string, folderId: string, name: string, _m: string, bytes: Uint8Array) => {
      h.calls.push(`create:${name}`);
      return meta(add({ name, parents: [folderId], folder: false, bytes }));
    },
    updateBinaryFile: async (_t: string, id: string, _m: string, bytes: Uint8Array) => {
      h.calls.push(`upload:${id}`);
      const f = get(id);
      f.bytes = bytes;
      f.version++;
      return meta(f);
    },
    downloadBytes: async (_t: string, id: string) => {
      h.calls.push(`download:${id}`);
      return get(id).bytes!;
    },
    getFileMeta: async (_t: string, id: string) => {
      h.calls.push(`meta:${id}`);
      return meta(get(id));
    },
    copyFile: async (_t: string, id: string, name: string, parent: string) => {
      h.calls.push(`copy:${name}`);
      return meta(add({ name, parents: [parent], folder: false, bytes: get(id).bytes }));
    },
    deleteFile: async (_t: string, id: string) => {
      h.calls.push(`delete:${id}`);
      h.files.delete(id);
    },
  };
});

vi.mock('./changesets', () => {
  const merge = (d: Device, r: ChangeRow) => {
    const cur = d.cells.get(key(r));
    const wins =
      !cur ||
      r.col_version > cur.col_version ||
      (r.col_version === cur.col_version && r.site_id > cur.site_id);
    if (!wins) return;
    d.dbv++;
    d.cells.set(key(r), { ...r, db_version: d.dbv });
  };
  return {
    getLocalSiteIdHex: async () => h.cur!.siteHex,
    getLocalDbVersion: async () => h.cur!.dbv,
    exportAllChanges: async () => [...h.cur!.cells.values()].map((c) => ({ ...c })),
    applyRemoteChanges: async (_db: unknown, rows: ChangeRow[], onProgress?: (n: number) => void) => {
      for (const r of rows) merge(h.cur!, r);
      onProgress?.(rows.length);
      return rows.length;
    },
  };
});

vi.mock('@/db/queries/settings', () => ({
  SETTINGS_KEYS: { BACKUP_RETENTION: 'backup.retention', BACKUP_INTERVAL_DAYS: 'backup.interval_days' },
  getSetting: async (db: FakeDb, k: string) => db.meta.get(k) ?? null,
  getSettingNumber: async (db: FakeDb, k: string, fallback: number) =>
    db.meta.has(k) ? Number(db.meta.get(k)) : fallback,
  setSetting: async (db: FakeDb, k: string, v: string) => {
    db.meta.set(k, String(v));
  },
}));

import {
  syncNow,
  joinSharedBook,
  markSafetyBackup,
  listKnownPeers,
  BookFoundError,
  BookReplacedError,
  NewerBookError,
  SYNC_KEYS,
} from './household';
import { BOOK_FILE_NAME, decodeBook, gunzipJson, type BookFile } from './bookFile';
import { APP_FOLDER_NAME } from './driveFolders';

function makeDevice(siteHex: string, account = 'a'): Device {
  const d: Device = {
    account,
    siteHex,
    siteB64: hexToB64(siteHex),
    cells: new Map(),
    dbv: 0,
    db: {
      meta: new Map(),
      async execO(sql: string, params?: unknown[]) {
        if (sql.includes('count(*)')) {
          const since = Number(params?.[0] ?? 0);
          return [{ n: [...d.cells.values()].filter((c) => c.db_version > since).length }];
        }
        if (sql.includes('pragma_table_info')) {
          return (SCHEMA[String(params?.[0])] ?? []).map((name) => ({ name }));
        }
        if (sql.includes('FROM devices')) {
          const ids = new Set([...d.cells.values()].filter((c) => c.table === 'devices').map((c) => c.pk));
          return [...ids].map((site_id) => ({ site_id }));
        }
        throw new Error(`unmocked execO: ${sql}`);
      },
      async exec(sql: string) {
        if (sql.includes("DELETE FROM meta WHERE key LIKE 'sync.%'")) {
          for (const k of [...d.db.meta.keys()]) if (k.startsWith('sync.')) d.db.meta.delete(k);
          return;
        }
        throw new Error(`unmocked exec: ${sql}`);
      },
    },
  };
  return d;
}

/** A local edit on `d`: bumps the cell's col_version like cr-sqlite does. */
function edit(d: Device, pk: string, cid: string, val: unknown, cl = 1) {
  const r = { table: 'transactions', pk, cid };
  const cur = d.cells.get(key(r));
  d.dbv++;
  d.cells.set(key(r), {
    ...r,
    val,
    val_is_blob: false,
    col_version: (cur?.col_version ?? 0) + 1,
    db_version: d.dbv,
    site_id: d.siteB64,
    cl,
    seq: 0,
  });
}

/** What ensureLocalDevice does on boot: the device's row in the synced `devices` table (upper-case, like crsql). */
function register(d: Device) {
  d.dbv++;
  d.cells.set(`devices|${d.siteHex.toUpperCase()}|name`, {
    table: 'devices',
    pk: d.siteHex.toUpperCase(),
    cid: 'name',
    val: `Device-${d.siteHex}`,
    val_is_blob: false,
    col_version: 1,
    db_version: d.dbv,
    site_id: d.siteB64,
    cl: 1,
    seq: 0,
  });
}

const valueOf = (d: Device, pk: string, cid: string) =>
  d.cells.get(key({ table: 'transactions', pk, cid }))?.val;

async function sync(d: Device) {
  h.cur = d;
  return syncNow(d.db as never, async () => 'token');
}

const book = () => [...h.files.values()].find((f) => f.name === BOOK_FILE_NAME)!;
const bookCells = async (f: FakeFile = book()) =>
  decodeBook(await gunzipJson<BookFile>(f.bytes!));
const backups = () => [...h.files.values()].filter((f) => f.name.startsWith('Copper-Expense-Tracker-backup-'));

beforeEach(() => {
  h.files = new Map();
  h.nextId = 1;
  h.clock = 0;
  h.calls = [];
  h.cur = null;
  h.grants = new Set();
  h.hideOnce = new Set();
});

describe('single-file sync', () => {
  it('first sync creates the app folder and the book holding this device’s data', async () => {
    const a = makeDevice('aa');
    edit(a, 't1', 'note', 'lunch');
    await sync(a);

    const folder = [...h.files.values()].find((f) => f.folder && f.name === APP_FOLDER_NAME);
    expect(folder).toBeTruthy();
    expect(book().parents).toEqual([folder!.id]);
    expect((await bookCells()).map((c) => c.val)).toEqual(['lunch']);
    expect(a.db.meta.get(SYNC_KEYS.BOOK_FILE_ID)).toBe(book().id);
  });

  it('two partners converge in both directions', async () => {
    const a = makeDevice('aa');
    const b = makeDevice('bb');
    register(a);
    register(b);
    edit(a, 't1', 'note', 'from A');
    await sync(a);
    await joinSharedBook(b.db as never, book().id, 'merge');
    edit(b, 't2', 'note', 'from B');

    await sync(b);
    expect(valueOf(b, 't1', 'note')).toBe('from A');
    await sync(a);
    expect(valueOf(a, 't2', 'note')).toBe('from B');

    // Concurrent edits to the same cell resolve the same way on both sides.
    edit(a, 't1', 'note', 'A again');
    edit(b, 't1', 'note', 'B again');
    await sync(a);
    await sync(b);
    await sync(a);
    expect(valueOf(a, 't1', 'note')).toBe(valueOf(b, 't1', 'note'));
    expect(await listKnownPeers(a.db as never)).toEqual([{ siteIdHex: 'bb' }]);
    h.cur = b;
    expect(await listKnownPeers(b.db as never)).toEqual([{ siteIdHex: 'aa' }]);
  });

  it('does one metadata request and nothing else when nothing changed', async () => {
    const a = makeDevice('aa');
    edit(a, 't1', 'note', 'x');
    await sync(a);
    h.calls = [];
    const res = await sync(a);
    expect(h.calls).toEqual([`meta:${book().id}`]);
    expect(res.uploadedFile).toBeNull();
  });

  it('pulls without re-uploading when only the partner changed', async () => {
    const a = makeDevice('aa');
    const b = makeDevice('bb');
    edit(a, 't1', 'note', 'x');
    await sync(a);
    await joinSharedBook(b.db as never, book().id, 'merge');
    await sync(b); // B has nothing of its own, so the merge is a pure pull…
    edit(a, 't1', 'note', 'y');
    await sync(a);
    h.calls = [];
    await sync(b);
    expect(valueOf(b, 't1', 'note')).toBe('y');
    expect(h.calls.some((c) => c.startsWith('upload:'))).toBe(false);
  });

  it('self-heals a lost write race: the loser re-uploads on its next sync', async () => {
    const a = makeDevice('aa');
    const b = makeDevice('bb');
    edit(a, 't1', 'note', 'x');
    await sync(a);
    await joinSharedBook(b.db as never, book().id, 'merge');
    await sync(b);

    // B uploads its edit; then A's upload (made from state that never saw B's
    // edit) lands on top, as if both wrote at the same instant.
    edit(b, 't2', 'note', 'B edit');
    await sync(b);
    const bWrite = book().bytes!;
    edit(a, 't3', 'note', 'A edit');
    h.cur = a;
    const { encodeBook, gzipJson } = await import('./bookFile');
    book().bytes = await gzipJson(encodeBook([...a.cells.values()], 'aa', a.db.meta.get(SYNC_KEYS.BOOK_GENERATION)));
    book().version++;
    expect((await bookCells()).some((c) => c.val === 'B edit')).toBe(false);
    expect(bWrite).toBeTruthy();

    await sync(b); // sees the book changed, finds itself ahead, re-uploads
    const vals = (await bookCells()).map((c) => c.val);
    expect(vals).toContain('B edit');
    expect(vals).toContain('A edit');
  });
});

describe('safety backups', () => {
  it('merge-join copies the book into Backups before this device’s data reaches it', async () => {
    const a = makeDevice('aa');
    const b = makeDevice('bb');
    edit(a, 't1', 'note', 'A only');
    await sync(a);
    edit(b, 't9', 'note', 'B data');
    await joinSharedBook(b.db as never, book().id, 'merge');
    await sync(b);

    const [copy] = backups();
    expect(copy.name).toMatch(/^Copper-Expense-Tracker-backup-\d{4}-\d{2}-\d{2}-\d{4}-before-merge\.json\.gz$/);
    const backupsFolder = h.files.get(copy.parents[0])!;
    expect(backupsFolder.name).toBe('Backups');
    // The copy is the book as it was before B merged in.
    expect((await bookCells(copy)).map((c) => c.val)).toEqual(['A only']);
    expect((await bookCells()).map((c) => c.val).sort()).toEqual(['A only', 'B data']);
    // One-shot: the next sync takes no further safety copy.
    await sync(b);
    expect(backups()).toHaveLength(1);
  });

  it('an import while connected backs the book up before the imported rows land', async () => {
    const a = makeDevice('aa');
    edit(a, 't1', 'note', 'before');
    await sync(a);
    await markSafetyBackup(a.db as never, 'before import');
    edit(a, 't2', 'note', 'imported');
    await sync(a);
    const [copy] = backups();
    expect(copy.name).toContain('-before-import.');
    expect((await bookCells(copy)).map((c) => c.val)).toEqual(['before']);
  });

  it('restore while connected: the partner converges on the restored book, no duplicates', async () => {
    const a = makeDevice('aa');
    const b = makeDevice('bb');
    edit(a, 't1', 'note', 'old copy');
    await sync(a);
    await joinSharedBook(b.db as never, book().id, 'merge');
    await sync(b);

    // B restores: the old row is deleted (a CRDT tombstone — even causal
    // length) and the backup's row is inserted under a fresh id.
    await markSafetyBackup(b.db as never, 'before restore');
    edit(b, 't1', '-1', null, 2);
    edit(b, 'r1', 'note', 'restored copy');
    await sync(b);
    await sync(a);

    expect(valueOf(a, 'r1', 'note')).toBe('restored copy');
    expect(a.cells.get(key({ table: 'transactions', pk: 't1', cid: '-1' }))?.cl).toBe(2);
    const copy = backups().find((f) => f.name.includes('-before-restore.'))!;
    expect((await bookCells(copy)).map((c) => c.val)).toEqual(['old copy']);
  });

  it('after an Overwrite join, other devices pause instead of merging duplicates back', async () => {
    const a = makeDevice('aa');
    const b = makeDevice('bb');
    edit(a, 't1', 'note', 'original');
    await sync(a);

    // B holds its own copy of the same book under different ids, and
    // overwrites the shared book with it.
    edit(b, 'x1', 'note', 'original (B copy)');
    await joinSharedBook(b.db as never, book().id, 'replace');
    await sync(b);
    expect((await bookCells()).map((c) => c.val)).toEqual(['original (B copy)']);
    expect(backups()[0].name).toContain('-before-overwrite.');

    // A still holds t1. Merging would bring it back beside x1 — so it stops.
    h.calls = [];
    await expect(sync(a)).rejects.toBeInstanceOf(BookReplacedError);
    expect(h.calls.some((c) => c.startsWith('upload:'))).toBe(false);

    // Start fresh (wiped device, pointed at the same book) loads it cleanly.
    const fresh = makeDevice('aa');
    fresh.db.meta.set(SYNC_KEYS.BOOK_FILE_ID, book().id);
    await sync(fresh);
    expect(valueOf(fresh, 'x1', 'note')).toBe('original (B copy)');
    expect(valueOf(fresh, 't1', 'note')).toBeUndefined();
  });

  it('markSafetyBackup is a no-op when not connected', async () => {
    const a = makeDevice('aa');
    await markSafetyBackup(a.db as never, 'before import');
    expect(a.db.meta.size).toBe(0);
  });
});

describe('finding the book on a new or reset device', () => {
  it('a new device asks before merging its own data into the account’s book', async () => {
    const phone = makeDevice('aa');
    edit(phone, 't1', 'note', 'phone');
    await sync(phone);
    const laptop = makeDevice('dd');
    edit(laptop, 'seed', 'note', 'default category'); // what every new device starts with
    const err = await sync(laptop).catch((e) => e);
    expect(err).toBeInstanceOf(BookFoundError);
    expect(err.bookId).toBe(book().id);
    // Nothing was uploaded, and it stays paused on the next sync too.
    expect(h.calls.some((c) => c.startsWith('upload:'))).toBe(false);
    await expect(sync(laptop)).rejects.toBeInstanceOf(BookFoundError);

    // Start fresh: after the wipe, applyPendingJoin points the empty device at the book.
    const fresh = makeDevice('ee');
    fresh.db.meta.set(SYNC_KEYS.BOOK_FILE_ID, err.bookId);
    await sync(fresh);
    expect(valueOf(fresh, 't1', 'note')).toBe('phone');
    expect((await bookCells()).map((c) => c.val)).toEqual(['phone']);
  });

  it('a partner’s new device finds the book they joined, not their own old one', async () => {
    // Bob used Copper alone first, so his account has an (older) book of its own…
    const bob = makeDevice('bb', 'bob');
    edit(bob, 'b1', 'note', 'solo');
    await sync(bob);

    const a = makeDevice('aa', 'alice');
    edit(a, 't1', 'note', 'household');
    await sync(a);
    const shared = [...h.files.values()].find((f) => f.name === BOOK_FILE_NAME && f.owner === 'alice')!.id;

    // …then joined Alice's (the Picker grant is per account, so it carries over).
    h.grants.add(`bob|${shared}`);
    await joinSharedBook(bob.db as never, shared, 'merge');
    await sync(bob);

    // Bob's new phone knows nothing yet: it's offered the household book.
    const phone = makeDevice('cc', 'bob');
    await expect(sync(phone)).rejects.toMatchObject({ bookId: shared });
  });

  it('two devices creating a book at the same moment settle on one', async () => {
    const phone = makeDevice('aa');
    edit(phone, 't1', 'note', 'from phone');
    await sync(phone);
    const first = book().id;

    // The laptop looked before the phone's book appeared, so it creates its own.
    const laptop = makeDevice('dd');
    edit(laptop, 't2', 'note', 'from laptop');
    h.hideOnce.add(first);
    await sync(laptop);

    const books = [...h.files.values()].filter((f) => f.name === BOOK_FILE_NAME);
    expect(books.map((f) => f.id)).toEqual([first]);
    expect(laptop.db.meta.get(SYNC_KEYS.BOOK_FILE_ID)).toBe(first);
    expect(valueOf(laptop, 't1', 'note')).toBe('from phone');
    await sync(phone);
    expect(valueOf(phone, 't2', 'note')).toBe('from laptop');
  });

});

describe('books from a newer version of Copper', () => {
  it('stops with a clear message instead of a SQL error, and applies nothing', async () => {
    const a = makeDevice('aa');
    edit(a, 't1', 'note', 'lunch');
    // A newer app added a column; its cells are in the book now.
    a.cells.set('transactions|t1|mood', { ...a.cells.get('transactions|t1|note')!, cid: 'mood', val: 'happy' });
    await sync(a);
    const b = makeDevice('bb');
    await joinSharedBook(b.db as never, book().id, 'merge');
    await expect(sync(b)).rejects.toBeInstanceOf(NewerBookError);
    expect(b.cells.size).toBe(0);
  });

  it('also stops on a deleted row from a table this version lacks', async () => {
    const a = makeDevice('aa');
    edit(a, 't1', 'note', 'lunch');
    // A newer app made and deleted a theme: only the '-1' delete marker remains.
    a.cells.set('themes|th1|-1', { ...a.cells.get('transactions|t1|note')!, table: 'themes', pk: 'th1', cid: '-1', val: null, cl: 2 });
    await sync(a);
    const b = makeDevice('bb');
    await joinSharedBook(b.db as never, book().id, 'merge');
    await expect(sync(b)).rejects.toBeInstanceOf(NewerBookError);
    expect(b.cells.size).toBe(0);
  });
});
