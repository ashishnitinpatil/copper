// Device-local sync state, stored in the (non-synced) `meta` table. Everything
// lives under `sync.*` so resetSyncState can re-baseline a device in one go.
export const SYNC_KEYS = {
  // The shared book file (see bookFile.ts) this device syncs with.
  BOOK_FILE_ID: 'sync.book_file_id',
  // Drive `version` of the book when this device last merged or wrote it. A
  // different version on the server means someone else changed it.
  BOOK_VERSION: 'sync.book_version',
  // Local crsql db_version after the last successful sync. Higher now means
  // this device has changes the book doesn't have yet.
  SYNCED_DB_VERSION: 'sync.synced_db_version',
  // The book generation (see BookFile.generation) this device last synced.
  BOOK_GENERATION: 'sync.book_generation',
  // This account's own "Copper Expense Tracker" folder and its Backups folder.
  APP_FOLDER_ID: 'sync.app_folder_id',
  BACKUPS_FOLDER_ID: 'sync.backups_folder_id',
  LAST_SYNC_AT: 'sync.last_sync_at',
  LAST_BACKUP_AT: 'sync.last_backup_at',
  // Set by "Overwrite the shared book" on join: the next sync REPLACES the book
  // with this device's state instead of merging into it.
  PENDING_OVERWRITE: 'sync.pending_overwrite',
  // Set by a major change (merge-join, overwrite, restore, import). The next
  // sync first copies the shared book into Backups, labelled with this reason,
  // so the change can be undone by restoring that copy.
  PENDING_SAFETY_BACKUP: 'sync.pending_safety_backup',
  // This device's identity before a reset/Start fresh. Retired (see
  // retireDevice) after the first sync brings the book's devices back in.
  RETIRE_SITE: 'sync.retire_site',
  // Set while a merge big enough for the setup screen is under way, cleared
  // when it's done. Still set at start-up means the last one was cut short and
  // this device holds a half-merged book: keep the setup screen up from the
  // start, not only once the merge resumes.
  MERGE_PENDING: 'sync.merge_pending',
} as const;
