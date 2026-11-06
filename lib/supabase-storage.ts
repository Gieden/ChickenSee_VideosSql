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
  // Supabase Storage's list endpoint is folder-scoped: a plain list of
  // "databases" only returns objects directly inside it, NOT nested ones.
  // With a delimiter of "/" it additionally returns one pseudo-entry per
  // sub-folder (id null, metadata null). So: list the root with a delimiter
  // to discover session folders, then list each folder for its databases.
  const client = getStorageClient();
  const bucket = client.storage.from(getBucketName());
  const limit = 1000;

  type RawObject = { name: string; id: string | null; created_at?: string; updated_at?: string; metadata?: { size?: number } | null };

  async function listFolder(prefix: string, delimiter?: string): Promise<RawObject[]> {
    const out: RawObject[] = [];
    for (let offset = 0; ; offset += limit) {
      const { data, error } = await bucket.list(prefix, {
        limit,
        offset,
        ...(delimiter ? { delimiter } : {}),
        sortBy: { column: 'created_at', order: 'desc' },
      } as Parameters<typeof bucket.list>[1]);
      if (error) {
        throw new Error(`Failed to list Supabase Storage folder "${prefix}": ${error.message}`);
      }
      const objects = (data || []) as RawObject[];
      out.push(...objects);
      if (objects.length < limit) break;
    }
    return out;
  }

  const files: SyncedFileMeta[] = [];

  const pushEntry = (object: RawObject, sessionFolder?: string) => {
    const fileName = object.name.split('/').pop() || object.name;
    // Only sensors.sqlite files are treated as sensor databases — other stray
    // .db / .sqlite uploads (old flat duplicates, telemetry test files) are
    // excluded from the viewer so the session list stays clean.
    if (fileName.toLowerCase() !== 'sensors.sqlite') return;
    const uploadedAt = object.updated_at || object.created_at || new Date(0).toISOString();
    const storagePath = sessionFolder
      ? `databases/${sessionFolder}/${fileName}`
      : `databases/${fileName}`;
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
  };

  // 1. Top-level flat databases (legacy uploads) + folder discovery in one call
  const rootEntries = await listFolder('databases', '/');
  for (const object of rootEntries) {
    if (object.id === null) continue; // folder pseudo-entry
    pushEntry(object);
  }
  const folderNames = rootEntries
    .filter((e) => e.id === null && e.name && !e.name.includes('.'))
    .map((e) => e.name);

  // 2. Session folders discovered from the delimiter listing
  for (const folder of folderNames) {
    try {
      for (const object of await listFolder(`databases/${folder}`)) {
        pushEntry(object, folder);
      }
    } catch {
      // Skip unreadable sub-folders
    }
  }

  // De-duplicate by storagePath and sort newest first.
  const unique = new Map<string, SyncedFileMeta>();
  for (const f of files) unique.set(f.storagePath, f);

  return Array.from(unique.values()).sort(
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
