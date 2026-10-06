import type { DB } from '@/db/wasm';
import { setSetting, SETTINGS_KEYS } from '@/db/queries/settings';
import { SYNC_KEYS } from './syncKeys';

// "Start fresh" join: adopt a partner's shared ledger instead of merging this
// device's data into it. The wipe can only run at the next boot (see
// requestLocalReset in db/client), so we stash the target book here and pick
// it up in applyPendingJoin() once the DB has been recreated empty.
const JOIN_BOOK_KEY = 'et-join-book-id';
const RETIRE_SITE_KEY = 'et-join-retire-site';

/**
 * Remember this device's identity before a wipe. If it was in the book this
 * device next joins, it's retired there (see retireDevice) rather than left
 * behind as a phantom device — even when the join comes later, from Welcome.
 */
export function rememberRetiringIdentity(siteId: string): void {
  localStorage.setItem(RETIRE_SITE_KEY, siteId);
}

/** Remember which shared book to adopt after the wipe-and-reload completes. */
export function stashJoinTarget(bookId: string, currentSiteId?: string): void {
  localStorage.setItem(JOIN_BOOK_KEY, bookId);
  if (currentSiteId) rememberRetiringIdentity(currentSiteId);
}

/**
 * Whether the next boot should adopt a partner's ledger. Checked before seeding:
 * a "start fresh" join takes the partner's categories wholesale, so seeding the
 * defaults first would leave all 16 behind, unioned with what we pull.
 */
export function hasPendingJoin(): boolean {
  return localStorage.getItem(JOIN_BOOK_KEY) !== null;
}

/**
 * Boot-time step for a "start fresh" join. On the empty (unseeded) DB, point
 * sync at the partner's book; the next sync pulls it in whole. No-op when no
 * join is pending.
 */
export async function applyPendingJoin(db: DB): Promise<void> {
  const bookId = localStorage.getItem(JOIN_BOOK_KEY);
  if (!bookId) return;
  localStorage.removeItem(JOIN_BOOK_KEY);
  await setSetting(db, SYNC_KEYS.BOOK_FILE_ID, bookId);
  const retire = localStorage.getItem(RETIRE_SITE_KEY);
  localStorage.removeItem(RETIRE_SITE_KEY);
  if (retire) await setSetting(db, SYNC_KEYS.RETIRE_SITE, retire);
  // Mark onboarded here. The user deliberately chose to adopt an existing shared
  // ledger, so they must skip the first-run flow — and `onboarded` lives in the
  // device-local `meta` table, which is NOT a CRR, so the partner's flag never
  // arrives over sync. Without this the device pulls all the data but stays
  // stranded on the Welcome page.
  await setSetting(db, SETTINGS_KEYS.ONBOARDED, 'true');
}
