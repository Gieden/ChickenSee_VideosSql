import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SyncedFileMeta {
  url: string;
  pathname: string;
  storagePath: string;
  size: number;
  uploadedAt: string;
  /** Human-readable session label derived from the parent folder (e.g. "rec_2026-10-13_14-33"). */
  sessionLabel?: string;
}

export class StorageDownloadError extends Error {
  constructor(storagePath: string, message: string, readonly statusCode: number | null) {
    super(`Failed to download Supabase Storage object "${storagePath}": ${message}`);
    this.name = 'StorageDownloadError';
  }
}

type StorageObject = {
  name: string;
  created_at?: string;
  updated_at?: string;
  metadata?: { size?: number };
};

let storageClient: SupabaseClient | undefined;

function getStorageClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  if (!storageClient) {
    storageClient = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  return storageClient;
}

function getBucketName() {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'chickensee-sync';
}

export async function createStorageUploadUrl(storagePath: string) {
  const { data, error } = await getStorageClient()
    .storage
    .from(getBucketName())
    .createSignedUploadUrl(storagePath, { upsert: true });

  if (error) {
    throw new Error(`Failed to create Supabase upload URL: ${error.message}`);
  }

  return data.signedUrl;
}

export async function listStorageFiles(folder: string): Promise<SyncedFileMeta[]> {
  const client = getStorageClient();
  const bucket = client.storage.from(getBucketName());
  const files: SyncedFileMeta[] = [];
  const limit = 1000;

  for (let offset = 0; ; offset += limit) {
    const { data, error } = await bucket.list(folder, {
      limit,
      offset,
      sortBy: { column: 'created_at', order: 'desc' },
    });

    if (error) {
      throw new Error(`Failed to list Supabase Storage folder "${folder}": ${error.message}`);
    }

    const objects = (data || []) as StorageObject[];
    files.push(...objects
      .filter((object) => object.name && !object.name.endsWith('/'))
      .map((object) => {
        const storagePath = `${folder}/${object.name}`;
        const uploadedAt = object.updated_at || object.created_at || new Date(0).toISOString();
        return {
          url: '',
          pathname: object.name,
          storagePath,
          size: Number(object.metadata?.size || 0),
          uploadedAt,
        };
      }));

    if (objects.length < limit) break;
  }

  return files;
}

export async function downloadStorageFile(storagePath: string) {
  const { data, error } = await getStorageClient()
    .storage
    .from(getBucketName())
    .download(storagePath);

  if (error) {
    const statusCode = Number(error.statusCode);
    throw new StorageDownloadError(
      storagePath,
      error.message,
      Number.isInteger(statusCode) ? statusCode : null,
    );
  }

  return data;
}

export async function uploadStorageFile(
  storagePath: string,
  body: string | Uint8Array | ArrayBuffer,
  contentType = 'application/octet-stream',
) {
  const { error } = await getStorageClient()
    .storage
    .from(getBucketName())
    .upload(storagePath, body, { contentType, upsert: true });

  if (error) {
    throw new Error(`Failed to upload Supabase Storage object "${storagePath}": ${error.message}`);
  }
}

export async function deleteStorageFiles(storagePaths: string[]) {
  if (storagePaths.length === 0) return;

  const { error } = await getStorageClient()
    .storage
    .from(getBucketName())
    .remove(storagePaths);

  if (error) {
    throw new Error(`Failed to delete Supabase Storage objects: ${error.message}`);
  }
}

export async function listSyncedVideos(): Promise<SyncedFileMeta[]> {
  return [];
}

export async function listSyncedDatabases(): Promise<SyncedFileMeta[]> {
  // The Supabase Storage list API only returns folder "entries" when a delimiter
  // is used; without it, nested objects come back with their full path in `name`
  // (e.g. "rec_2026-11-05_10-09-13_763336/sensors.sqlite"). We do one recursive
  // listing of databases/ and derive session folders from the object paths, so
  // each recording's database shows up as its own viewer entry.
  const client = getStorageClient();
  const bucket = client.storage.from(getBucketName());
  const all: Array<{ name: string; created_at?: string; updated_at?: string; metadata?: { size?: number } }> = [];
  const limit = 1000;

  for (let offset = 0; ; offset += limit) {
    const { data, error } = await bucket.list('databases', {
      limit,
      offset,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    if (error) {
      throw new Error(`Failed to list Supabase Storage folder "databases": ${error.message}`);
    }
    const objects = (data || []) as Array<{ name: string; created_at?: string; updated_at?: string; metadata?: { size?: number } }>;
    all.push(...objects);
    if (objects.length < limit) break;
  }

  const files: SyncedFileMeta[] = [];
  for (const object of all) {
    if (!object.name || object.name.endsWith('/')) continue;
    // Top-level file: name is "sensors.sqlite". Nested file: name is
    // "<session_folder>/sensors.sqlite".
    const slashIdx = object.name.indexOf('/');
    const isNested = slashIdx > 0;
    const fileName = isNested ? object.name.slice(slashIdx + 1).split('/').pop()! : object.name;
    if (!/\.(sqlite|db)$/i.test(fileName)) continue;
    if (isNested && !/\.(sqlite|db)$/i.test(object.name)) continue;

    const sessionFolder = isNested ? object.name.slice(0, slashIdx) : undefined;
    const storagePath = isNested ? `databases/${object.name}` : `databases/${fileName}`;
    const uploadedAt = object.updated_at || object.created_at || new Date(0).toISOString();
    const sessionLabel = sessionFolder
      ? sessionFolder.replace(/_\d{6}$/, '').replace(/_/g, ' ')
      : undefined;

    files.push({
      url: '',
      pathname: fileName,
      storagePath,
      size: Number(object.metadata?.size || 0),
      uploadedAt,
      sessionLabel,
    });
  }

  // De-duplicate by storagePath (recursive listing can return a folder marker
  // plus its children) and sort newest first.
  const unique = new Map<string, SyncedFileMeta>();
  for (const f of files) unique.set(f.storagePath, f);

  // Only sensors.sqlite files are treated as sensor databases — other stray
  // .db / .sqlite uploads (old flat duplicates, telemetry test files) are
  // excluded from the viewer so the session list stays clean.
  return Array.from(unique.values())
    .filter((f) => f.pathname.toLowerCase() === 'sensors.sqlite')
    .sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );
}

export async function cleanupOldVideos(retentionDays = 7): Promise<{
  deletedCount: number;
  freedBytes: number;
  freedMB: number;
  deletedFiles: string[];
}> {
  const videos = (await listStorageFiles('videos'))
    .filter((file) => file.pathname.toLowerCase().endsWith('.mp4'));
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const expiredFiles = videos.filter((file) => new Date(file.uploadedAt).getTime() < cutoffMs);
  const freedBytes = expiredFiles.reduce((total, file) => total + file.size, 0);

  await deleteStorageFiles(expiredFiles.map((file) => file.storagePath));

  return {
    deletedCount: expiredFiles.length,
    freedBytes,
    freedMB: Number((freedBytes / 1024 / 1024).toFixed(2)),
    deletedFiles: expiredFiles.map((file) => file.pathname),
  };
}
