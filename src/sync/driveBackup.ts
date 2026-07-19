import type { DB } from '@/db/wasm';
import { getSetting, setSetting } from '@/db/queries/settings';
import { toDateString } from '@/lib/dates';
import { buildFullBackup, type BackupFile } from '@/features/export/exportData';
import { parseBackup } from '@/features/export/restoreBackup';
import { listFolderFiles, uploadJsonFile, downloadJsonFile, deleteFile } from './googleDrive';
import { SYNC_KEYS } from './household';

// Full-book restore snapshots written into the shared Drive folder, alongside
// the live `changes-*.json` changesets. One snapshot per calendar day, named by
// date so a same-day rewrite replaces rather than accumulates. Stored as
// plaintext to match the changesets already in the folder — folder access
// already exposes the data, so encrypting only the snapshot would add key
// distribution pain for no real gain.
const BACKUP_PREFIX = 'backup-';
const BACKUP_EXT = '.json';

export const DEFAULT_BACKUP_RETENTION = 3;

export interface DriveSnapshot {
  id: string;
  name: string;
  /** Calendar day parsed from the file name (YYYY-MM-DD). */
  date: string;
  modifiedTime?: string;
}

function snapshotFileName(date: string): string {
  return `${BACKUP_PREFIX}${date}${BACKUP_EXT}`;
}

function parseSnapshotName(name: string): string | null {
  if (!name.startsWith(BACKUP_PREFIX) || !name.endsWith(BACKUP_EXT)) return null;
  const date = name.slice(BACKUP_PREFIX.length, -BACKUP_EXT.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** Backup snapshots in the folder, newest day first. */
export async function listDriveSnapshots(token: string, folderId: string): Promise<DriveSnapshot[]> {
  const files = await listFolderFiles(token, folderId, BACKUP_PREFIX);
  const snaps: DriveSnapshot[] = [];
  for (const f of files) {
    const date = parseSnapshotName(f.name);
    if (date) snaps.push({ id: f.id, name: f.name, date, modifiedTime: f.modifiedTime });
  }
  // Newest day first; a duplicate day (rare write race) breaks the tie on the
  // later modifiedTime so the freshest file sorts ahead.
  snaps.sort((a, b) =>
    a.date === b.date
      ? (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? '')
      : b.date.localeCompare(a.date),
  );
  return snaps;
}

// Delete everything past the newest `retention` distinct days. Deletes are
// best-effort — a failed prune must not fail the backup that triggered it.
async function pruneSnapshots(token: string, folderId: string, retention: number): Promise<void> {
  const keep = Math.max(1, retention);
  const snaps = await listDriveSnapshots(token, folderId);
  const keptDates = new Set<string>();
  for (const s of snaps) {
    if (!keptDates.has(s.date) && keptDates.size >= keep) {
      await deleteFile(token, s.id).catch(() => {});
    } else {
      keptDates.add(s.date);
    }
  }
}

/**
 * Write today's snapshot into the folder, replacing any existing same-day one,
 * then prune to `retention` days. Also records the watermark used to throttle
 * the daily automatic snapshot.
 */
export async function writeDriveSnapshot(
  db: DB,
  token: string,
  folderId: string,
  retention: number = DEFAULT_BACKUP_RETENTION,
): Promise<DriveSnapshot> {
  const today = toDateString();
  const name = snapshotFileName(today);
  const backup = await buildFullBackup(db);

  // Keep exactly one file per day: drop any earlier snapshot for today first.
  const existing = await listDriveSnapshots(token, folderId);
  for (const s of existing) {
    if (s.date === today) await deleteFile(token, s.id).catch(() => {});
  }

  const file = await uploadJsonFile(token, folderId, name, backup);

  await setSetting(db, SYNC_KEYS.LAST_BACKUP_AT, new Date().toISOString());
  await setSetting(db, SYNC_KEYS.LAST_BACKUP_DATE, today);

  await pruneSnapshots(token, folderId, retention);
  return { id: file.id, name, date: today, modifiedTime: file.modifiedTime };
}

/**
 * Write a snapshot only if none has been written today. Returns the snapshot on
 * a write, or null when today's is already present. Used to piggyback a daily
 * backup on an ordinary sync.
 */
export async function maybeDailyDriveSnapshot(
  db: DB,
  token: string,
  folderId: string,
  retention: number = DEFAULT_BACKUP_RETENTION,
): Promise<DriveSnapshot | null> {
  const lastDate = await getSetting(db, SYNC_KEYS.LAST_BACKUP_DATE);
  if (lastDate === toDateString()) return null;
  return writeDriveSnapshot(db, token, folderId, retention);
}

/** Download and validate a snapshot, ready to hand to restoreBackup. */
export async function readDriveBackup(token: string, fileId: string): Promise<BackupFile> {
  const raw = await downloadJsonFile(token, fileId);
  // Snapshots are stored plaintext, so they run through the same validator as a
  // file the user picked from disk.
  return parseBackup(JSON.stringify(raw));
}
