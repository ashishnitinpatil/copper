import type { DB } from '@/db/wasm';
import { getSetting, getSettingNumber, setSetting, SETTINGS_KEYS } from '@/db/queries/settings';
import { BACKUP_TABLES, type BackupFile } from '@/features/export/exportData';
import { parseBackup } from '@/features/export/restoreBackup';
import { copyFile, deleteFile, downloadBytes, listFolderFiles } from './googleDrive';
import { bookToBackup, gunzipJson, type BookFile } from './bookFile';
import { ensureBackupsFolder } from './driveFolders';
import { SYNC_KEYS } from './syncKeys';

// Drive backups are server-side COPIES of the shared book file, kept in this
// account's own "Copper Expense Tracker/Backups" folder. Copying on Drive's
// side costs no upload, so backups are free on mobile data. Restoring converts
// the copy back into the ordinary backup format (bookToBackup).
//
// Names are for people browsing Drive, hyphenated so they survive downloads
// and shells intact (local time, then why it was taken):
//   "Copper-Expense-Tracker-backup-2026-09-27-1951-weekly.json.gz"
// Ordering and pruning use Drive's createdTime, never the name.
const BACKUP_PREFIX = 'Copper-Expense-Tracker-backup-';
const BACKUP_EXT = '.json.gz';
// appProperties key on each backup: the id of the book it's a copy of.
const BOOK_PROP = 'copperBook';

export const DEFAULT_BACKUP_RETENTION = 3;
export const DEFAULT_BACKUP_INTERVAL_DAYS = 7;

export type BackupReason =
  | 'scheduled'
  | 'manual'
  | 'before merge'
  | 'before overwrite'
  | 'before restore'
  | 'before import';

export interface DriveSnapshot {
  id: string;
  name: string;
  /** When it was taken (ISO). */
  at: string;
  /** Why it was taken, e.g. "weekly" or "before merge" (null if the name doesn't say). */
  reason: string | null;
  /**
   * A copy of a different book than the one this device syncs with now (it
   * switched books since). Still restorable, but labelled, and never pruned.
   */
  otherBook: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

function scheduleLabel(intervalDays: number): string {
  if (intervalDays === 1) return 'daily';
  if (intervalDays === 7) return 'weekly';
  return `every ${intervalDays} days`;
}

export function backupFileName(at: Date, label: string): string {
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `${BACKUP_PREFIX}${day}-${time}-${label.replace(/ /g, '-')}${BACKUP_EXT}`;
}

// "…-2026-09-27-1951-before-merge.json.gz" → "before merge"
function parseLabel(name: string): string | null {
  const m = /-\d{4}-\d{2}-\d{2}-\d{4}-(.+)\.json\.gz$/.exec(name);
  return m ? m[1].replace(/-/g, ' ') : null;
}

/** Backups available to restore, newest first. */
export async function listDriveSnapshots(db: DB, token: string): Promise<DriveSnapshot[]> {
  const [folderId, bookId] = await Promise.all([
    ensureBackupsFolder(db, token),
    getSetting(db, SYNC_KEYS.BOOK_FILE_ID),
  ]);
  return (await listFolderFiles(token, folderId, BACKUP_PREFIX))
    .filter((f) => f.name.startsWith(BACKUP_PREFIX) && f.name.endsWith(BACKUP_EXT))
    .map((f) => ({
      id: f.id,
      name: f.name,
      at: f.createdTime ?? f.modifiedTime ?? '',
      reason: parseLabel(f.name),
      otherBook: !!bookId && !!f.appProperties?.[BOOK_PROP] && f.appProperties[BOOK_PROP] !== bookId,
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

// Keep the newest `retention` backups. Best-effort: a failed delete must not
// fail the backup that triggered it.
async function pruneBackups(db: DB, token: string, retention: number): Promise<void> {
  const keep = Math.max(1, Math.round(retention));
  const snaps = (await listDriveSnapshots(db, token)).filter((s) => !s.otherBook);
  for (const s of snaps.slice(keep)) await deleteFile(token, s.id).catch(() => {});
}

/** Copy the shared book into Backups, labelled with why, then prune. */
export async function backupBook(
  db: DB,
  token: string,
  bookId: string,
  reason: BackupReason,
): Promise<DriveSnapshot> {
  const [folderId, retention, intervalDays] = await Promise.all([
    ensureBackupsFolder(db, token),
    getSettingNumber(db, SETTINGS_KEYS.BACKUP_RETENTION, DEFAULT_BACKUP_RETENTION),
    getSettingNumber(db, SETTINGS_KEYS.BACKUP_INTERVAL_DAYS, DEFAULT_BACKUP_INTERVAL_DAYS),
  ]);
  const label = reason === 'scheduled' ? scheduleLabel(intervalDays) : reason;
  const now = new Date();
  const file = await copyFile(token, bookId, backupFileName(now, label), folderId, { [BOOK_PROP]: bookId });
  await setSetting(db, SYNC_KEYS.LAST_BACKUP_AT, now.toISOString());
  await pruneBackups(db, token, retention);
  return { id: file.id, name: file.name, at: file.createdTime ?? now.toISOString(), reason: label, otherBook: false };
}

/** Take the scheduled backup if the last one is older than the interval. */
export async function maybeScheduledBackup(
  db: DB,
  token: string,
  bookId: string,
  now: Date = new Date(),
): Promise<DriveSnapshot | null> {
  const [last, intervalDays] = await Promise.all([
    getSetting(db, SYNC_KEYS.LAST_BACKUP_AT),
    getSettingNumber(db, SETTINGS_KEYS.BACKUP_INTERVAL_DAYS, DEFAULT_BACKUP_INTERVAL_DAYS),
  ]);
  const dueMs = Math.max(1, intervalDays) * 86_400_000;
  if (last && now.getTime() - new Date(last).getTime() < dueMs) return null;
  return backupBook(db, token, bookId, 'scheduled');
}

async function primaryKeyColumns(db: DB): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const t of BACKUP_TABLES) {
    const rows = await db.execO<{ name: string }>(
      `SELECT name FROM pragma_table_info('${t}') WHERE pk > 0 ORDER BY pk`,
    );
    out[t] = rows.map((r) => r.name);
  }
  return out;
}

/** Download a backup and turn it into a BackupFile, ready for restoreBackup. */
export async function readDriveBackup(db: DB, token: string, snap: DriveSnapshot): Promise<BackupFile> {
  const book = await gunzipJson<BookFile>(await downloadBytes(token, snap.id));
  // Validate through the same checks as a file picked from disk.
  return parseBackup(JSON.stringify(bookToBackup(book, await primaryKeyColumns(db))));
}
