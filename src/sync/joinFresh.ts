import type { DB } from '@/db/wasm';
import { setSetting, SETTINGS_KEYS } from '@/db/queries/settings';
import { getLocalDbVersion } from './changesets';
import { SYNC_KEYS } from './household';

// "Start fresh" join: adopt a partner's shared ledger instead of merging this
// device's data into it. The wipe can only run at the next boot (see
// requestLocalReset in db/client), so we stash the target folder here and pick
// it up in applyPendingJoin() once the DB has been recreated empty.
const JOIN_FOLDER_KEY = 'et-join-folder-id';

/** Remember which shared folder to adopt after the wipe-and-reload completes. */
export function stashJoinTarget(folderId: string): void {
  localStorage.setItem(JOIN_FOLDER_KEY, folderId);
}

/**
 * Whether the next boot should adopt a partner's ledger. Checked before seeding:
 * a "start fresh" join takes the partner's categories wholesale, so seeding the
 * defaults first would leave all 16 behind, unioned with what we pull.
 */
export function hasPendingJoin(): boolean {
  return localStorage.getItem(JOIN_FOLDER_KEY) !== null;
}

/**
 * Boot-time step for a "start fresh" join. On the freshly-seeded DB, point sync
 * at the partner's folder and baseline the local version to the current one, so
 * the seed defaults are never pushed into their folder — this device only pulls
 * the partner's ledger. No-op when no join is pending.
 */
export async function applyPendingJoin(db: DB): Promise<void> {
  const folderId = localStorage.getItem(JOIN_FOLDER_KEY);
  if (!folderId) return;
  localStorage.removeItem(JOIN_FOLDER_KEY);
  const version = await getLocalDbVersion(db);
  await setSetting(db, SYNC_KEYS.FOLDER_ID, folderId);
  await setSetting(db, SYNC_KEYS.LOCAL_VERSION, String(version));
  // Mark onboarded here. The user deliberately chose to adopt an existing shared
  // ledger, so they must skip the first-run flow — and `onboarded` lives in the
  // device-local `meta` table, which is NOT a CRR, so the partner's flag never
  // arrives over sync. Without this the device pulls all the data but stays
  // stranded on the Welcome page.
  await setSetting(db, SETTINGS_KEYS.ONBOARDED, 'true');
}
