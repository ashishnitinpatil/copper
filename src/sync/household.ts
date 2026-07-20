import type { DB } from '@/db/wasm';
import { getSetting, setSetting } from '@/db/queries/settings';
import {
  findOrCreateFolder,
  listFolderFiles,
  uploadJsonFile,
  downloadJsonFile,
  type DriveFile,
} from './googleDrive';
import {
  applyRemoteChanges,
  exportLocalChanges,
  getLocalDbVersion,
  getLocalSiteIdHex,
  type ChangesetPayload,
} from './changesets';

export const HOUSEHOLD_FOLDER_NAME = 'Expense Tracker';

export const SYNC_KEYS = {
  FOLDER_ID: 'sync.folder_id',
  LOCAL_VERSION: 'sync.local_version',
  LAST_SYNC_AT: 'sync.last_sync_at',
  PEER_PREFIX: 'sync.peer.',
  // Drive backup snapshots: when the last one was written, and its calendar day
  // (used to throttle to one automatic snapshot per day). These live under
  // `sync.*` so switching folders re-baselines them and a fresh snapshot is
  // written into the new folder.
  LAST_BACKUP_AT: 'sync.last_backup_at',
  LAST_BACKUP_DATE: 'sync.last_backup_date',
} as const;

const CHANGES_PREFIX = 'changes-';
const CHANGES_EXT = '.json';

export interface SyncResult {
  pushed: number;
  pulled: number;
  peers: number;
  uploadedFile: string | null;
}

function changesetFileName(siteIdHex: string, seq: number): string {
  return `${CHANGES_PREFIX}${siteIdHex}-${String(seq).padStart(6, '0')}${CHANGES_EXT}`;
}

function parseChangesetFileName(name: string): { siteIdHex: string; seq: number } | null {
  if (!name.startsWith(CHANGES_PREFIX) || !name.endsWith(CHANGES_EXT)) return null;
  const core = name.slice(CHANGES_PREFIX.length, -CHANGES_EXT.length);
  const lastDash = core.lastIndexOf('-');
  if (lastDash < 0) return null;
  const siteIdHex = core.slice(0, lastDash);
  const seq = Number(core.slice(lastDash + 1));
  if (!Number.isFinite(seq)) return null;
  return { siteIdHex, seq };
}

export async function ensureFolderId(db: DB, token: string): Promise<string> {
  const cached = await getSetting(db, SYNC_KEYS.FOLDER_ID);
  if (cached) return cached;
  const folder = await findOrCreateFolder(token, HOUSEHOLD_FOLDER_NAME);
  await setSetting(db, SYNC_KEYS.FOLDER_ID, folder.id);
  return folder.id;
}

async function getNextLocalSeq(
  token: string,
  folderId: string,
  localSiteIdHex: string,
): Promise<number> {
  const existing = await listFolderFiles(
    token,
    folderId,
    `${CHANGES_PREFIX}${localSiteIdHex}`,
  );
  let max = 0;
  for (const f of existing) {
    const parsed = parseChangesetFileName(f.name);
    if (parsed && parsed.siteIdHex === localSiteIdHex) max = Math.max(max, parsed.seq);
  }
  return max + 1;
}

async function pushLocalChanges(
  db: DB,
  token: string,
  folderId: string,
  localSiteIdHex: string,
): Promise<{ pushed: number; uploadedFile: string | null }> {
  const lastVersionStr = await getSetting(db, SYNC_KEYS.LOCAL_VERSION);
  const lastVersion = lastVersionStr ? Number(lastVersionStr) : 0;
  const { rows, maxVersion } = await exportLocalChanges(db, lastVersion);
  if (rows.length === 0) return { pushed: 0, uploadedFile: null };

  const seq = await getNextLocalSeq(token, folderId, localSiteIdHex);
  const fileName = changesetFileName(localSiteIdHex, seq);
  const payload: ChangesetPayload = {
    version: 1,
    site_id: localSiteIdHex,
    seq,
    from_db_version: lastVersion,
    to_db_version: maxVersion,
    created_at: new Date().toISOString(),
    rows,
  };
  await uploadJsonFile(token, folderId, fileName, payload);
  await setSetting(db, SYNC_KEYS.LOCAL_VERSION, String(maxVersion));
  return { pushed: rows.length, uploadedFile: fileName };
}

async function pullRemoteChanges(
  db: DB,
  token: string,
  folderId: string,
  localSiteIdHex: string,
): Promise<{ pulled: number; peers: number }> {
  const files = await listFolderFiles(token, folderId, CHANGES_PREFIX);
  const byPeer = new Map<string, { file: DriveFile; seq: number }[]>();
  for (const f of files) {
    const parsed = parseChangesetFileName(f.name);
    if (!parsed) continue;
    if (parsed.siteIdHex === localSiteIdHex) continue;
    const list = byPeer.get(parsed.siteIdHex) ?? [];
    list.push({ file: f, seq: parsed.seq });
    byPeer.set(parsed.siteIdHex, list);
  }

  let pulled = 0;
  for (const [peerId, entries] of byPeer) {
    const watermarkKey = SYNC_KEYS.PEER_PREFIX + peerId;
    const watermarkStr = await getSetting(db, watermarkKey);
    const watermark = watermarkStr ? Number(watermarkStr) : 0;
    const pending = entries
      .filter((e) => e.seq > watermark)
      .sort((a, b) => a.seq - b.seq);
    if (pending.length === 0) continue;

    // Record the watermark after each changeset, not once at the end. A large
    // first pull runs for minutes; if it's interrupted (tab closed, connection
    // dropped) an end-of-loop write would record nothing and the next attempt
    // would re-download and re-apply the whole peer from scratch. `pending` is
    // sorted by seq, so advancing per file keeps the watermark monotonic.
    for (const { file, seq } of pending) {
      const payload = await downloadJsonFile<ChangesetPayload>(token, file.id);
      if (!payload?.rows) continue;
      pulled += await applyRemoteChanges(db, payload.rows);
      await setSetting(db, watermarkKey, String(seq));
    }
  }
  return { pulled, peers: byPeer.size };
}

export async function syncNow(
  db: DB,
  getAccessToken: () => Promise<string | null>,
): Promise<SyncResult> {
  const token = await getAccessToken();
  if (!token) throw new Error('Not signed in to Google');

  const folderId = await ensureFolderId(db, token);
  const localSiteIdHex = await getLocalSiteIdHex(db);

  const pullRes = await pullRemoteChanges(db, token, folderId, localSiteIdHex);
  const pushRes = await pushLocalChanges(db, token, folderId, localSiteIdHex);

  await setSetting(db, SYNC_KEYS.LAST_SYNC_AT, new Date().toISOString());
  return {
    pushed: pushRes.pushed,
    pulled: pullRes.pulled,
    peers: pullRes.peers,
    uploadedFile: pushRes.uploadedFile,
  };
}

export async function getSyncStatus(
  db: DB,
): Promise<{ lastSyncAt: string | null; folderId: string | null; localVersion: number }> {
  const [lastSyncAt, folderId, localVersion] = await Promise.all([
    getSetting(db, SYNC_KEYS.LAST_SYNC_AT),
    getSetting(db, SYNC_KEYS.FOLDER_ID),
    getSetting(db, SYNC_KEYS.LOCAL_VERSION).then((v) => (v ? Number(v) : 0)),
  ]);
  return { lastSyncAt, folderId, localVersion };
}

export interface KnownPeer {
  siteIdHex: string;
  watermarkSeq: number;
}

export async function listKnownPeers(db: DB): Promise<KnownPeer[]> {
  const rows = await db.execO<{ key: string; value: string }>(
    `SELECT key, value FROM meta WHERE key LIKE 'sync.peer.%'`,
  );
  return rows.map((r) => ({
    siteIdHex: r.key.slice(SYNC_KEYS.PEER_PREFIX.length),
    watermarkSeq: Number(r.value) || 0,
  }));
}

export async function resetSyncState(db: DB): Promise<void> {
  await db.exec(`DELETE FROM meta WHERE key LIKE 'sync.%'`);
}

// Point sync at a specific folder — e.g. one a partner shared and this device
// picked via the Google Picker. Clearing the rest of the sync state re-baselines
// the device against the new folder: it re-pushes all local changes into it and
// re-pulls every peer changeset already there, so both sides converge.
export async function setHouseholdFolder(db: DB, folderId: string): Promise<void> {
  await resetSyncState(db);
  await setSetting(db, SYNC_KEYS.FOLDER_ID, folderId);
}

export async function getLocalDbVersionSafe(db: DB): Promise<number> {
  try {
    return await getLocalDbVersion(db);
  } catch {
    return 0;
  }
}
