const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
}

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

export async function findFolder(token: string, name: string): Promise<DriveFile | null> {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`,
  );
  const res = await driveFetch(
    token,
    `/files?q=${q}&fields=files(id,name,mimeType,modifiedTime)&pageSize=10`,
  );
  const data = (await res.json()) as DriveListResponse;
  return data.files[0] ?? null;
}

export async function createFolder(token: string, name: string): Promise<DriveFile> {
  const res = await driveFetch(token, '/files?fields=id,name,mimeType', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return (await res.json()) as DriveFile;
}

export async function findOrCreateFolder(token: string, name: string): Promise<DriveFile> {
  const existing = await findFolder(token, name);
  if (existing) return existing;
  return createFolder(token, name);
}

export async function listFolderFiles(
  token: string,
  folderId: string,
  namePrefix?: string,
): Promise<DriveFile[]> {
  const queryParts = [`'${folderId}' in parents`, 'trashed=false'];
  if (namePrefix) queryParts.push(`name contains '${namePrefix.replace(/'/g, "\\'")}'`);
  const q = encodeURIComponent(queryParts.join(' and '));
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const res = await driveFetch(
      token,
      `/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,size),nextPageToken&pageSize=1000${pageParam}`,
    );
    const data = (await res.json()) as DriveListResponse;
    files.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

export async function uploadJsonFile(
  token: string,
  folderId: string,
  name: string,
  payload: unknown,
): Promise<DriveFile> {
  const metadata = { name, parents: [folderId], mimeType: 'application/json' };
  const boundary = `-------expense-tracker-${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify(payload)}\r\n` +
    `--${boundary}--`;
  const res = await fetch(
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new DriveError(`Drive upload ${res.status}: ${errBody.slice(0, 200)}`, res.status);
  }
  return (await res.json()) as DriveFile;
}

export async function downloadJsonFile<T = unknown>(token: string, fileId: string): Promise<T> {
  const res = await driveFetch(token, `/files/${fileId}?alt=media`);
  return (await res.json()) as T;
}

export async function deleteFile(token: string, fileId: string): Promise<void> {
  await driveFetch(token, `/files/${fileId}`, { method: 'DELETE' });
}

export { DriveError };
