const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
  /** Drive's monotonically increasing content version (a decimal string). */
  version?: string;
  owners?: { displayName?: string; emailAddress?: string; me?: boolean }[];
  /** Private key/values this app attached to the file. */
  appProperties?: Record<string, string>;
  /** Whether the signed-in account may share it (an owner can restrict editors). */
  capabilities?: { canShare?: boolean };
}

const META_FIELDS = 'id,name,mimeType,modifiedTime,createdTime,size,version,owners(displayName,emailAddress,me),appProperties,capabilities(canShare)';

interface DriveListResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

class DriveError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'DriveError';
  }
}

async function driveFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith('http') ? path : `${DRIVE_API}${path}`;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DriveError(`Drive ${res.status}: ${body.slice(0, 200)}`, res.status);
  }
  return res;
}

function q(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Oldest match first, so every device of one account resolves the same folder
// even if a race ever created two with the same name.
export async function findFolder(
  token: string,
  name: string,
  parentId?: string,
): Promise<DriveFile | null> {
  const parts = [
    `mimeType='application/vnd.google-apps.folder'`,
    `name='${q(name)}'`,
    'trashed=false',
  ];
  if (parentId) parts.push(`'${parentId}' in parents`);
  const res = await driveFetch(
    token,
    `/files?q=${encodeURIComponent(parts.join(' and '))}&orderBy=createdTime&fields=files(${META_FIELDS})&pageSize=10`,
  );
  const data = (await res.json()) as DriveListResponse;
  return data.files[0] ?? null;
}

export async function createFolder(token: string, name: string, parentId?: string): Promise<DriveFile> {
  const res = await driveFetch(token, `/files?fields=${META_FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  return (await res.json()) as DriveFile;
}

export async function findOrCreateFolder(
  token: string,
  name: string,
  parentId?: string,
): Promise<DriveFile> {
  const existing = await findFolder(token, name, parentId);
  if (existing) return existing;
  return createFolder(token, name, parentId);
}

/** Oldest non-trashed file with this exact name directly inside the folder. */
/**
 * Every file with this name the app can open, oldest first — ones this account
 * created plus ones picked in the Picker (drive.file shows nothing else).
 */
export async function findFilesByName(token: string, name: string): Promise<DriveFile[]> {
  const query = `name='${q(name)}' and trashed=false`;
  const res = await driveFetch(
    token,
    `/files?q=${encodeURIComponent(query)}&orderBy=createdTime&fields=files(${META_FIELDS})&pageSize=100`,
  );
  return ((await res.json()) as DriveListResponse).files;
}

export async function listFolderFiles(
  token: string,
  folderId: string,
  namePrefix?: string,
): Promise<DriveFile[]> {
  const queryParts = [`'${folderId}' in parents`, 'trashed=false'];
  if (namePrefix) queryParts.push(`name contains '${q(namePrefix)}'`);
  const query = encodeURIComponent(queryParts.join(' and '));
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const res = await driveFetch(
      token,
      `/files?q=${query}&fields=files(${META_FIELDS}),nextPageToken&pageSize=1000${pageParam}`,
    );
    const data = (await res.json()) as DriveListResponse;
    files.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

export async function getFileMeta(token: string, fileId: string): Promise<DriveFile> {
  const res = await driveFetch(token, `/files/${fileId}?fields=${META_FIELDS}`);
  return (await res.json()) as DriveFile;
}

export async function createBinaryFile(
  token: string,
  folderId: string,
  name: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<DriveFile> {
  const boundary = `-------copper-${Math.random().toString(36).slice(2)}`;
  const metadata = { name, parents: [folderId], mimeType };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    bytes as BlobPart,
    `\r\n--${boundary}--`,
  ]);
  const res = await driveFetch(
    token,
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=${META_FIELDS}`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  return (await res.json()) as DriveFile;
}

// Replace a file's content in place — same id, so a partner's grant keeps working.
export async function updateBinaryFile(
  token: string,
  fileId: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<DriveFile> {
  const res = await driveFetch(
    token,
    `${DRIVE_UPLOAD}/files/${fileId}?uploadType=media&fields=${META_FIELDS}`,
    { method: 'PATCH', headers: { 'Content-Type': mimeType }, body: bytes as BodyInit },
  );
  return (await res.json()) as DriveFile;
}

export async function downloadBytes(
  token: string,
  fileId: string,
  /** Bytes received so far, and the file size (0 when Drive doesn't say). */
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const res = await driveFetch(token, `/files/${fileId}?alt=media`);
  if (!onProgress || !res.body) return new Uint8Array(await res.arrayBuffer());
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    chunks.push(value);
    done += value.length;
    onProgress(done, total);
  }
  const bytes = new Uint8Array(done);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

// Server-side copy: no download/upload, so a backup costs no mobile data.
export async function copyFile(
  token: string,
  fileId: string,
  name: string,
  parentId: string,
  appProperties?: Record<string, string>,
): Promise<DriveFile> {
  const res = await driveFetch(token, `/files/${fileId}/copy?fields=${META_FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parents: [parentId], appProperties }),
  });
  return (await res.json()) as DriveFile;
}

// Give another Google account edit access to a file this app created.
export async function shareFileWithEmail(
  token: string,
  fileId: string,
  email: string,
  notify: boolean,
): Promise<void> {
  await driveFetch(
    token,
    `/files/${fileId}/permissions?sendNotificationEmail=${notify}&fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
    },
  );
}

export async function deleteFile(token: string, fileId: string): Promise<void> {
  await driveFetch(token, `/files/${fileId}`, { method: 'DELETE' });
}

// Turn a raw sync failure into something a person can act on. Google's Drive
// 401 "Active session is invalid. Error code: 4" is a session/credential
// rejection with no single documented cause — it shows up with expired tokens,
// several Google accounts signed into one browser, managed Workspace accounts,
// and Guest/Incognito or blocked third-party cookies. So point at reconnecting
// first (fixes the common token case) and then list the usual culprits, rather
// than asserting one. Other errors pass through unchanged.
export function describeSyncError(e: unknown): string {
  const raw = e instanceof Error ? e.message : e ? String(e) : '';
  if (e instanceof DriveError && e.status === 401 && /active session is invalid/i.test(raw)) {
    return (
      'Google rejected the sync session. Disconnect and sign in again to refresh it. ' +
      'If it keeps failing, sign in with a single personal Google account in a normal ' +
      'window — this error is common when several accounts are signed in at once, with ' +
      'managed Workspace accounts, or when third-party cookies are blocked.'
    );
  }
  if (isInsufficientScopeError(e)) {
    return (
      "Copper can't reach Google Drive because the Drive permission wasn't granted. " +
      'Reconnect to Google and keep the Google Drive permission checkbox ticked on the ' +
      'consent screen.'
    );
  }
  if (e instanceof DriveError && e.status === 404) {
    return (
      "Copper can't open the shared book — it may have been deleted, or it's no longer " +
      'shared with this Google account. Choose the shared book again below.'
    );
  }
  return raw || 'Sync failed';
}

// A 403 "insufficient authentication scopes" means the stored token is valid but
// was never granted `drive.file` — the user unticked the Drive permission on the
// consent screen. Reconnecting (re-consenting) is the fix, not a plain retry.
function isInsufficientScopeError(e: unknown): boolean {
  if (!(e instanceof DriveError) || e.status !== 403) return false;
  return /insufficient authentication scopes|insufficient permission/i.test(e.message);
}

// True when a sync failure is fixed by re-consenting to Google (missing Drive
// scope), so the UI can offer a "Reconnect" button instead of a bare retry.
export function isReauthError(e: unknown): boolean {
  return isInsufficientScopeError(e);
}

export { DriveError };
