import type { DB } from '@/db/wasm';
import { getSetting, setSetting } from '@/db/queries/settings';
import { findOrCreateFolder } from './googleDrive';
import { SYNC_KEYS } from './syncKeys';

// Each Google account keeps its own copy of this folder:
//
//   Copper Expense Tracker/
//     Copper-Expense-Tracker-shared-book.json.gz   ← the book, if this account created it
//     Backups/                     ← this account's backups
//
// A partner who joins someone else's book keeps using their own folder for
// backups; only the book file itself is shared between accounts.
export const APP_FOLDER_NAME = 'Copper Expense Tracker';
export const BACKUPS_FOLDER_NAME = 'Backups';

export async function ensureAppFolder(db: DB, token: string): Promise<string> {
  const cached = await getSetting(db, SYNC_KEYS.APP_FOLDER_ID);
  if (cached) return cached;
  const folder = await findOrCreateFolder(token, APP_FOLDER_NAME);
  await setSetting(db, SYNC_KEYS.APP_FOLDER_ID, folder.id);
  return folder.id;
}

export async function ensureBackupsFolder(db: DB, token: string): Promise<string> {
  const cached = await getSetting(db, SYNC_KEYS.BACKUPS_FOLDER_ID);
  if (cached) return cached;
  const parent = await ensureAppFolder(db, token);
  const folder = await findOrCreateFolder(token, BACKUPS_FOLDER_NAME, parent);
  await setSetting(db, SYNC_KEYS.BACKUPS_FOLDER_ID, folder.id);
  return folder.id;
}
