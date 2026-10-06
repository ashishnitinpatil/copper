import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory Drive so naming, pruning, the schedule and restore conversion are
// assertable without a network. Backups are copies of the book file; the book
// codec (bookFile.ts) runs for real.
interface FakeFile {
  id: string;
  name: string;
  parents: string[];
  folder: boolean;
  createdTime: string;
  bytes?: Uint8Array;
  json?: unknown;
  appProperties?: Record<string, string>;
}

const h = vi.hoisted(() => ({
  files: [] as FakeFile[],
  nextId: 1,
  clock: 0,
}));

vi.mock('@/features/export/restoreBackup', () => ({
  // Pass-through validator: the real parseBackup is exercised elsewhere.
  parseBackup: (text: string) => JSON.parse(text),
}));

vi.mock('@/db/queries/settings', () => ({
  SETTINGS_KEYS: { BACKUP_RETENTION: 'backup.retention', BACKUP_INTERVAL_DAYS: 'backup.interval_days' },
  getSetting: async (db: FakeDb, k: string) => db.meta.get(k) ?? null,
  getSettingNumber: async (db: FakeDb, k: string, fallback: number) =>
    db.meta.has(k) ? Number(db.meta.get(k)) : fallback,
  setSetting: async (db: FakeDb, k: string, v: string) => {
    db.meta.set(k, String(v));
  },
}));

vi.mock('./googleDrive', () => {
  const add = (f: Omit<FakeFile, 'id' | 'createdTime'>) => {
    const file = {
      ...f,
      id: `f${h.nextId++}`,
      createdTime: new Date(Date.UTC(2026, 8, 1, 0, 0, h.clock++)).toISOString(),
    };
    h.files.push(file);
    return file;
  };
  return {
    findOrCreateFolder: async (_t: string, name: string, parent?: string) =>
      h.files.find((f) => f.folder && f.name === name && (!parent || f.parents.includes(parent))) ??
      add({ name, parents: parent ? [parent] : [], folder: true }),
    listFolderFiles: async (_t: string, folderId: string, prefix = '') =>
      h.files.filter((f) => !f.folder && f.parents.includes(folderId) && f.name.includes(prefix)),
    copyFile: async (_t: string, id: string, name: string, parent: string, appProperties?: Record<string, string>) =>
      add({ name, parents: [parent], folder: false, bytes: h.files.find((f) => f.id === id)!.bytes, appProperties }),
    deleteFile: async (_t: string, id: string) => {
      h.files = h.files.filter((f) => f.id !== id);
    },
    downloadBytes: async (_t: string, id: string) => h.files.find((f) => f.id === id)!.bytes!,
  };
});

import {
  backupBook,
  backupFileName,
  maybeScheduledBackup,
  listDriveSnapshots,
  readDriveBackup,
  DEFAULT_BACKUP_RETENTION,
  DEFAULT_BACKUP_INTERVAL_DAYS,
} from './driveBackup';
import { encodeBook, gzipJson } from './bookFile';
import { SYNC_KEYS } from './syncKeys';

interface FakeDb {
  meta: Map<string, string>;
  execO: (sql: string) => Promise<{ name: string }[]>;
}
function makeDb(): FakeDb {
  return {
    meta: new Map(),
    // primaryKeyColumns: every table here is keyed by `id`.
    execO: async () => [{ name: 'id' }],
  };
}

const token = 'token';
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const textPk = (s: string) => b64([1, (1 << 3) | 3, s.length, ...Array.from(s, (c) => c.charCodeAt(0))]);

async function seedBook(): Promise<string> {
  const bytes = await gzipJson(
    encodeBook(
      [
        {
          table: 'accounts',
          pk: textPk('a1'),
          cid: 'name',
          val: 'Cash',
          val_is_blob: false,
          col_version: 1,
          db_version: 1,
          site_id: b64([0xaa]),
          cl: 1,
          seq: 0,
        },
      ],
      'aa',
    ),
  );
  h.files.push({ id: 'book', name: 'Copper-Expense-Tracker-shared-book.json.gz', parents: [], folder: false, createdTime: '', bytes });
  return 'book';
}

const backupFiles = () => h.files.filter((f) => f.name.startsWith('Copper-Expense-Tracker-backup-'));

beforeEach(() => {
  h.files = [];
  h.nextId = 1;
  h.clock = 0;
});

describe('naming', () => {
  it('uses a readable local timestamp and the reason', () => {
    expect(backupFileName(new Date(2026, 8, 27, 9, 5), 'before merge')).toBe(
      'Copper-Expense-Tracker-backup-2026-09-27-0905-before-merge.json.gz',
    );
  });
});

describe('backupBook', () => {
  it('copies the book into Copper Expense Tracker/Backups and records when', async () => {
    const db = makeDb();
    const bookId = await seedBook();
    const snap = await backupBook(db as never, token, bookId, 'manual');

    const [copy] = backupFiles();
    const backups = h.files.find((f) => f.id === copy.parents[0])!;
    const app = h.files.find((f) => f.id === backups.parents[0])!;
    expect([app.name, backups.name]).toEqual(['Copper Expense Tracker', 'Backups']);
    expect(copy.name).toMatch(/-manual\.json\.gz$/);
    expect(snap.reason).toBe('manual');
    expect(db.meta.get(SYNC_KEYS.LAST_BACKUP_AT)).toBeTruthy();
  });

  it('labels scheduled backups by their interval', async () => {
    const db = makeDb();
    const bookId = await seedBook();
    await backupBook(db as never, token, bookId, 'scheduled');
    db.meta.set('backup.interval_days', '1');
    await backupBook(db as never, token, bookId, 'scheduled');
    db.meta.set('backup.interval_days', '3');
    await backupBook(db as never, token, bookId, 'scheduled');
    expect(backupFiles().map((f) => f.name.split('-').slice(8).join('-'))).toEqual([
      'weekly.json.gz',
      'daily.json.gz',
      'every-3-days.json.gz',
    ]);
    // …and read back as words.
    const reasons = (await listDriveSnapshots(db as never, token)).map((s) => s.reason);
    expect(reasons.sort()).toEqual(['daily', 'every 3 days', 'weekly']);
  });

  it('keeps only the newest `retention` backups (default 3), any N >= 1', async () => {
    const db = makeDb();
    const bookId = await seedBook();
    for (let i = 0; i < 5; i++) await backupBook(db as never, token, bookId, 'manual');
    expect(backupFiles()).toHaveLength(DEFAULT_BACKUP_RETENTION);

    db.meta.set('backup.retention', '1');
    await backupBook(db as never, token, bookId, 'manual');
    const left = backupFiles();
    expect(left).toHaveLength(1);
    // The one kept is the newest.
    expect(left[0].id).toBe(`f${h.nextId - 1}`);
  });

});

describe('maybeScheduledBackup', () => {
  it('is weekly by default', async () => {
    expect(DEFAULT_BACKUP_INTERVAL_DAYS).toBe(7);
    const db = makeDb();
    const bookId = await seedBook();
    const t0 = new Date('2026-09-01T10:00:00Z');
    expect(await maybeScheduledBackup(db as never, token, bookId, t0)).not.toBeNull();
    db.meta.set(SYNC_KEYS.LAST_BACKUP_AT, t0.toISOString());
    expect(await maybeScheduledBackup(db as never, token, bookId, new Date('2026-09-07T10:00:00Z'))).toBeNull();
    expect(await maybeScheduledBackup(db as never, token, bookId, new Date('2026-09-08T10:00:00Z'))).not.toBeNull();
  });

  it('honours a custom interval', async () => {
    const db = makeDb();
    db.meta.set('backup.interval_days', '1');
    db.meta.set(SYNC_KEYS.LAST_BACKUP_AT, '2026-09-01T10:00:00Z');
    const bookId = await seedBook();
    expect(await maybeScheduledBackup(db as never, token, bookId, new Date('2026-09-02T11:00:00Z'))).not.toBeNull();
  });
});

describe('listing and restoring', () => {
  it('lists backups newest first', async () => {
    const db = makeDb();
    const bookId = await seedBook();
    await backupBook(db as never, token, bookId, 'manual');
    await backupBook(db as never, token, bookId, 'before merge');
    const snaps = await listDriveSnapshots(db as never, token);
    expect(snaps.map((s) => s.reason)).toEqual(['before merge', 'manual']);
  });

  it('labels copies of a book this device no longer syncs with, and never prunes them', async () => {
    const db = makeDb();
    const bookId = await seedBook();
    db.meta.set(SYNC_KEYS.BOOK_FILE_ID, bookId);
    await backupBook(db as never, token, bookId, 'scheduled');
    // This device then switched to another book (a partner's).
    h.files.push({ ...h.files.find((f) => f.id === bookId)!, id: 'partner' });
    db.meta.set(SYNC_KEYS.BOOK_FILE_ID, 'partner');
    db.meta.set('backup.retention', '1');
    await backupBook(db as never, token, 'partner', 'manual');
    await backupBook(db as never, token, 'partner', 'before merge');

    const snaps = await listDriveSnapshots(db as never, token);
    expect(snaps.map((s) => [s.reason, s.otherBook])).toEqual([
      ['before merge', false],
      ['weekly', true],
    ]);
  });

  it('turns a book copy back into a restorable backup', async () => {
    const db = makeDb();
    const bookId = await seedBook();
    const snap = await backupBook(db as never, token, bookId, 'manual');
    const backup = await readDriveBackup(db as never, token, snap);
    expect(backup.format).toBe('expense-tracker-backup');
    expect(backup.tables.accounts).toEqual([{ id: 'a1', name: 'Cash' }]);
  });
});
