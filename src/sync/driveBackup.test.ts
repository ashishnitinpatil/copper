import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory Drive + a controllable "today", so snapshot naming, same-day
// replacement, pruning and the daily throttle are all assertable without a
// real clock or network.
const h = vi.hoisted(() => ({
  today: '2026-07-18',
  seq: 0, // makes each upload's modifiedTime strictly increasing
  drive: {
    files: [] as { id: string; name: string; modifiedTime?: string; content: unknown }[],
    calls: [] as string[],
  },
}));

vi.mock('@/lib/dates', () => ({ toDateString: () => h.today }));

vi.mock('@/features/export/exportData', () => ({
  buildFullBackup: async () => ({
    format: 'expense-tracker-backup',
    version: 1,
    exported_at: 'x',
    tables: { accounts: [{ id: 'a1', name: 'Cash' }] },
  }),
}));

// Pass-through validator: the real parseBackup is exercised elsewhere; here we
// only care that readDriveBackup routes the download through it.
vi.mock('@/features/export/restoreBackup', () => ({
  parseBackup: (text: string) => JSON.parse(text),
}));

vi.mock('@/db/queries/settings', () => ({
  getSetting: async (db: FakeDb, key: string) => db.meta.get(key) ?? null,
  setSetting: async (db: FakeDb, key: string, value: string) => {
    db.meta.set(key, String(value));
  },
}));

vi.mock('./googleDrive', () => ({
  listFolderFiles: async (_t: string, _f: string, prefix?: string) =>
    h.drive.files.filter((f) => f.name.startsWith(prefix ?? '')),
  uploadJsonFile: async (_t: string, _f: string, name: string, payload: unknown) => {
    h.drive.calls.push(`upload:${name}`);
    const file = {
      id: `id-${name}-${h.seq}`,
      name,
      modifiedTime: `2026-07-18T00:00:0${h.seq}Z`,
      content: payload,
    };
    h.seq += 1;
    h.drive.files.push(file);
    return file;
  },
  downloadJsonFile: async (_t: string, id: string) =>
    h.drive.files.find((f) => f.id === id)?.content ?? null,
  deleteFile: async (_t: string, id: string) => {
    h.drive.calls.push(`delete:${id}`);
    h.drive.files = h.drive.files.filter((f) => f.id !== id);
  },
}));

import {
  writeDriveSnapshot,
  maybeDailyDriveSnapshot,
  listDriveSnapshots,
  readDriveBackup,
  DEFAULT_BACKUP_RETENTION,
} from './driveBackup';
import { SYNC_KEYS } from './household';

interface FakeDb {
  meta: Map<string, string>;
}
function makeDb(): FakeDb {
  return { meta: new Map<string, string>() };
}

/** Drop a pre-existing snapshot into the fake Drive for a given day. */
function seedSnapshot(date: string) {
  h.drive.files.push({
    id: `id-backup-${date}.json`,
    name: `backup-${date}.json`,
    modifiedTime: `${date}T00:00:00Z`,
    content: { format: 'expense-tracker-backup', version: 1, tables: {} },
  });
}

beforeEach(() => {
  h.today = '2026-07-18';
  h.seq = 0;
  h.drive.files = [];
  h.drive.calls = [];
});

describe('writeDriveSnapshot', () => {
  it('uploads a date-named snapshot and records the watermark', async () => {
    const db = makeDb();
    const snap = await writeDriveSnapshot(db as never, 'token', 'folder1', 3);

    expect(snap.name).toBe('backup-2026-07-18.json');
    expect(h.drive.calls).toContain('upload:backup-2026-07-18.json');
    expect(db.meta.get(SYNC_KEYS.LAST_BACKUP_DATE)).toBe('2026-07-18');
    expect(db.meta.get(SYNC_KEYS.LAST_BACKUP_AT)).toBeTruthy();
    // The snapshot carries the full backup payload.
    expect(h.drive.files[0].content).toMatchObject({ format: 'expense-tracker-backup' });
  });

  it('replaces an existing same-day snapshot instead of duplicating it', async () => {
    const db = makeDb();
    seedSnapshot('2026-07-18'); // an earlier snapshot from today
    await writeDriveSnapshot(db as never, 'token', 'folder1', 3);

    const today = h.drive.files.filter((f) => f.name === 'backup-2026-07-18.json');
    expect(today).toHaveLength(1); // exactly one file per day
    expect(h.drive.calls).toContain('delete:id-backup-2026-07-18.json');
  });

  it('prunes to the newest `retention` days, deleting the oldest', async () => {
    const db = makeDb();
    for (const d of ['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17']) seedSnapshot(d);

    await writeDriveSnapshot(db as never, 'token', 'folder1', 3);

    const remaining = (await listDriveSnapshots('token', 'folder1')).map((s) => s.date);
    // 5 days existed after the write (14–18); keep only the newest 3.
    expect(remaining).toEqual(['2026-07-18', '2026-07-17', '2026-07-16']);
  });

  it('never prunes below one snapshot even for a bad retention value', async () => {
    const db = makeDb();
    await writeDriveSnapshot(db as never, 'token', 'folder1', 0);
    expect(await listDriveSnapshots('token', 'folder1')).toHaveLength(1);
  });
});

describe('maybeDailyDriveSnapshot', () => {
  it('writes when no snapshot exists for today', async () => {
    const db = makeDb();
    const snap = await maybeDailyDriveSnapshot(db as never, 'token', 'folder1', 3);
    expect(snap?.date).toBe('2026-07-18');
    expect(h.drive.calls.some((c) => c.startsWith('upload:'))).toBe(true);
  });

  it('is a no-op when today’s snapshot was already written', async () => {
    const db = makeDb();
    db.meta.set(SYNC_KEYS.LAST_BACKUP_DATE, '2026-07-18');
    const snap = await maybeDailyDriveSnapshot(db as never, 'token', 'folder1', 3);
    expect(snap).toBeNull();
    expect(h.drive.calls).toHaveLength(0);
  });

  it('writes again once the day rolls over', async () => {
    const db = makeDb();
    db.meta.set(SYNC_KEYS.LAST_BACKUP_DATE, '2026-07-17');
    const snap = await maybeDailyDriveSnapshot(db as never, 'token', 'folder1', 3);
    expect(snap?.date).toBe('2026-07-18');
  });
});

describe('listDriveSnapshots', () => {
  it('parses and orders snapshots newest day first, ignoring other files', async () => {
    seedSnapshot('2026-07-16');
    seedSnapshot('2026-07-18');
    seedSnapshot('2026-07-17');
    h.drive.files.push({ id: 'x', name: 'changes-aa-000001.json', content: {} }); // not a snapshot

    const snaps = await listDriveSnapshots('token', 'folder1');
    expect(snaps.map((s) => s.date)).toEqual(['2026-07-18', '2026-07-17', '2026-07-16']);
  });
});

describe('readDriveBackup', () => {
  it('downloads and validates a snapshot into a BackupFile', async () => {
    const db = makeDb();
    const written = await writeDriveSnapshot(db as never, 'token', 'folder1', 3);
    const backup = await readDriveBackup('token', written.id);
    expect(backup.format).toBe('expense-tracker-backup');
    expect(backup.tables.accounts).toHaveLength(1);
  });
});

describe('defaults', () => {
  it('defaults retention to 3', () => {
    expect(DEFAULT_BACKUP_RETENTION).toBe(3);
  });
});
