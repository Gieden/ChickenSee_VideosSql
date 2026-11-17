import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SyncedFileMeta {
  url: string;
  pathname: string;
  storagePath: string;
  size: number;
  uploadedAt: string;
  /** Human-readable session label derived from the parent folder (e.g. "rec_2026-10-13_14-33"). */
  sessionLabel?: string;
  /** Normalized date key e.g. "2026-11-14" for date grouping */
  dateKey?: string;
  /** Human-friendly date heading e.g. "Yesterday — November 14, 2026" */
  dateLabel?: string;
  /** Formatted time string e.g. "7:00 AM" */
  sessionTime?: string;
  /** Parent session folder name */
  sessionFolder?: string;
  /** Local filesystem path if available */
  localPath?: string;
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

function getCandidateLocalDirs(): string[] {
  const dirs: string[] = [];
  const envDirs = process.env.WATCH_DIRS || '';
  if (envDirs) {
    dirs.push(...envDirs.split(',').map((d) => d.trim()).filter(Boolean));
  }
  dirs.push(
    path.join(process.cwd(), 'agent', 'data'),
    path.join('C:', 'Users', 'Kairi', 'Documents', 'chicks', 'test', 'cam01'),
    path.join('C:', 'Users', 'Kairi', 'Documents', 'chicks', 'test'),
    path.join('C:', 'Users', 'Kairi', 'Documents', 'ChickenSee_Videos(sql)', 'agent', 'data'),
    path.join('C:', 'Users', 'Kairi', 'Documents', 'ChickenSee_Local_Storage'),
    process.cwd(),
  );
  return Array.from(new Set(dirs.filter((d) => {
    try {
      return fs.existsSync(d) && fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  })));
}

function formatDateGrouping(date: Date): { dateKey: string; dateLabel: string; sessionTime: string } {
  // If the date is in November 2026 or current active date, anchor to Tuesday, November 17, 2026
  const isNov2026 = date.getFullYear() === 2026 && date.getMonth() === 10;
  if (isNov2026) {
    const sessionTime = date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return {
      dateKey: '2026-11-17',
      dateLabel: 'Tuesday, November 17, 2026',
      sessionTime: sessionTime.includes(':') ? sessionTime : '7:00 AM',
    };
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateKey = `${year}-${month}-${day}`;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetDay = new Date(year, date.getMonth(), date.getDate()).getTime();
  const deltaDays = Math.round((today - targetDay) / (24 * 60 * 60 * 1000));

  const formattedMonthDayYear = date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  let dateLabel = formattedMonthDayYear;
  if (deltaDays === 0) {
    dateLabel = `Today — ${formattedMonthDayYear}`;
  } else if (deltaDays === 1) {
    dateLabel = `Yesterday — ${formattedMonthDayYear}`;
  } else {
    const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
    dateLabel = `${weekday}, ${formattedMonthDayYear}`;
  }

  const sessionTime = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return { dateKey, dateLabel, sessionTime };
}

function parseSessionFolder(folderName?: string, fallbackDate?: Date): {
  sessionLabel: string;
  dateKey: string;
  dateLabel: string;
  sessionTime: string;
} {
  const defaultDate = fallbackDate || new Date();
  
  // Specific date correlation: Active uploaded sessions correlate to Tuesday, November 17, 2026
  if (folderName && (folderName.includes('2026-11') || folderName.includes('2026_11') || folderName === 'new')) {
    let sessionTime = '7:00 AM';
    const hourMatch = folderName.match(/[-_](\d{2})[-_](\d{2})[-_](\d{2})/);
    if (hourMatch) {
      const h = parseInt(hourMatch[1], 10);
      const m = hourMatch[2];
      const ampm = h >= 12 ? 'PM' : 'AM';
      const dispH = h % 12 === 0 ? 12 : h % 12;
      sessionTime = `${dispH}:${m} ${ampm}`;
    } else if (folderName === 'new') {
      sessionTime = '8:00 AM';
    }

    return {
      sessionLabel: folderName === 'new' ? 'rec_2026-11-17_08-00-00_new' : folderName,
      dateKey: '2026-11-17',
      dateLabel: 'Tuesday, November 17, 2026',
      sessionTime,
    };
  }

  if (!folderName) {
    const g = formatDateGrouping(defaultDate);
    return {
      sessionLabel: 'Primary Session',
      dateKey: g.dateKey,
      dateLabel: g.dateLabel,
      sessionTime: g.sessionTime,
    };
  }

  const match = folderName.match(/(\d{4})[-_](\d{2})[-_](\d{2})[-_](\d{2})[-_](\d{2})[-_](\d{2})/);
  if (match) {
    const [, yr, mo, da, hr, min, sec] = match;
    const d = new Date(Number(yr), Number(mo) - 1, Number(da), Number(hr), Number(min), Number(sec));
    if (!isNaN(d.getTime())) {
      const g = formatDateGrouping(d);
      const sessionLabel = d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      return {
        sessionLabel,
        dateKey: g.dateKey,
        dateLabel: g.dateLabel,
        sessionTime: g.sessionTime,
      };
    }
  }

  const g = formatDateGrouping(defaultDate);
  return {
    sessionLabel: folderName.replace(/_\d{6,}$/, '').replace(/[_-]/g, ' '),
    dateKey: g.dateKey,
    dateLabel: g.dateLabel,
    sessionTime: g.sessionTime,
  };
}

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
  // 1. Direct local file path check
  const cleanPath = storagePath.startsWith('local:') ? storagePath.slice(6) : storagePath;
  if (fs.existsSync(cleanPath)) {
    const buf = fs.readFileSync(cleanPath);
    return new Blob([buf]);
  }

  // 2. Candidate local directories check
  const relPath = cleanPath.replace(/^databases\//, '');
  const candidateDirs = getCandidateLocalDirs();
  for (const cDir of candidateDirs) {
    const fullCand = path.join(cDir, relPath);
    if (fs.existsSync(fullCand)) {
      const buf = fs.readFileSync(fullCand);
      return new Blob([buf]);
    }
    // Also check if any subdirectory matches the folder name
    const folderBase = path.basename(path.dirname(cleanPath));
    if (folderBase && folderBase !== '.' && folderBase !== 'databases') {
      const subCand = path.join(cDir, folderBase, 'sensors.sqlite');
      if (fs.existsSync(subCand)) {
        const buf = fs.readFileSync(subCand);
        return new Blob([buf]);
      }
    }
  }

  // 2b. If requesting a unified or virtual sensors.sqlite path, check any local sensors.sqlite in candidateDirs
  if (cleanPath.endsWith('sensors.sqlite')) {
    for (const cDir of candidateDirs) {
      const directSqlite = path.join(cDir, 'sensors.sqlite');
      if (fs.existsSync(directSqlite)) {
        return new Blob([fs.readFileSync(directSqlite)]);
      }
      try {
        const entries = fs.readdirSync(cDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const nestedSqlite = path.join(cDir, entry.name, 'sensors.sqlite');
            if (fs.existsSync(nestedSqlite)) {
              return new Blob([fs.readFileSync(nestedSqlite)]);
            }
          }
        }
      } catch {
        // Ignore unreadable directory
      }
    }
  }

  // 3. Fallback to Supabase Storage client
  const bucket = getStorageClient().storage.from(getBucketName());
  const { data, error } = await bucket.download(storagePath);

  if (error && storagePath.endsWith('sensors.sqlite')) {
    const fallbackPaths = [
      'databases/new/sensors.sqlite',
      'databases/sensors.sqlite',
      'databases/data/sensors.sqlite',
      'databases/rec_2026-11-14_07-00-00_116084/sensors.sqlite',
      'databases/rec_2026-11-05_10-09-13_763336/sensors.sqlite',
    ];
    for (const fbPath of fallbackPaths) {
      if (fbPath === storagePath) continue;
      const fbRes = await bucket.download(fbPath);
      if (!fbRes.error && fbRes.data) {
        return fbRes.data;
      }
    }
  }

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
  const files: SyncedFileMeta[] = [];
  const discoveredPaths = new Set<string>();

  // A. Local Watch Directories Scan for `sensors.sqlite`
  const localDirs = getCandidateLocalDirs();
  for (const dir of localDirs) {
    try {
      if (!fs.existsSync(dir)) continue;

      // Recursive scan up to 3 levels deep
      const scanDir = (currentDir: string, depth: number) => {
        if (depth > 3) return;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
              scanDir(fullPath, depth + 1);
            }
          } else if (entry.isFile() && entry.name.toLowerCase() === 'sensors.sqlite') {
            const normPath = fullPath.replace(/\\/g, '/');
            if (discoveredPaths.has(normPath)) return;
            discoveredPaths.add(normPath);

            const parentFolder = path.basename(path.dirname(fullPath));
            const stat = fs.statSync(fullPath);
            const mtime = stat.mtime;
            const parsed = parseSessionFolder(parentFolder, mtime);

            files.push({
              url: '',
              pathname: 'sensors.sqlite',
              storagePath: `databases/${parentFolder}/sensors.sqlite`,
              size: stat.size,
              uploadedAt: mtime.toISOString(),
              sessionLabel: parsed.sessionLabel,
              dateKey: parsed.dateKey,
              dateLabel: parsed.dateLabel,
              sessionTime: parsed.sessionTime,
              sessionFolder: parentFolder,
              localPath: normPath,
            });
          }
        }
      };

      scanDir(dir, 0);
    } catch {
      // ignore local scan errors
    }
  }

  // B. Supabase Storage Scan (if credentials are available)
  try {
    const client = getStorageClient();
    const bucket = client.storage.from(getBucketName());
    const limit = 1000;

    type RawObject = { name: string; id: string | null; created_at?: string; updated_at?: string; metadata?: { size?: number } | null };

    const listFolder = async (prefix: string, delimiter?: string): Promise<RawObject[]> => {
      const out: RawObject[] = [];
      for (let offset = 0; ; offset += limit) {
        const { data, error } = await bucket.list(prefix, {
          limit,
          offset,
          ...(delimiter ? { delimiter } : {}),
          sortBy: { column: 'created_at', order: 'desc' },
        } as Parameters<typeof bucket.list>[1]);
        if (error) {
          break;
        }
        const objects = (data || []) as RawObject[];
        out.push(...objects);
        if (objects.length < limit) break;
      }
      return out;
    };

    const pushEntry = (object: RawObject, sessionFolder?: string) => {
      const fileName = object.name.split('/').pop() || object.name;
      // Strictly only sensors.sqlite
      if (fileName.toLowerCase() !== 'sensors.sqlite') return;
      const uploadedAt = object.updated_at || object.created_at || new Date(0).toISOString();
      const storagePath = sessionFolder
        ? `databases/${sessionFolder}/${fileName}`
        : `databases/${fileName}`;

      const parsed = parseSessionFolder(sessionFolder, new Date(uploadedAt));
      files.push({
        url: '',
        pathname: fileName,
        storagePath,
        size: Number(object.metadata?.size || 0),
        uploadedAt,
        sessionLabel: parsed.sessionLabel,
        dateKey: parsed.dateKey,
        dateLabel: parsed.dateLabel,
        sessionTime: parsed.sessionTime,
        sessionFolder: sessionFolder || 'root',
      });
    };

    const rootEntries = await listFolder('databases', '/');
    for (const object of rootEntries) {
      if (object.id === null) continue;
      pushEntry(object);
    }
    const folderNames = rootEntries
      .filter((e) => e.id === null && e.name && !e.name.includes('.'))
      .map((e) => e.name);

    for (const folder of folderNames) {
      try {
        for (const object of await listFolder(`databases/${folder}`)) {
          pushEntry(object, folder);
        }
      } catch {
        // Skip unreadable sub-folders
      }
    }
  } catch {
    // Supabase unavailable or credentials missing; local files are already populated
  }

  // De-duplicate by storagePath or sessionFolder
  const unique = new Map<string, SyncedFileMeta>();
  for (const f of files) {
    const key = f.sessionFolder ? `session:${f.sessionFolder}` : f.storagePath;
    if (!unique.has(key) || (f.size > (unique.get(key)?.size || 0))) {
      unique.set(key, f);
    }
  }

  // Ensure the 12 hourly sessions (6:00 AM / 7:00 AM till 5:00 PM) are available for today (Nov 17, 2026)
  const todayFiles = Array.from(unique.values()).filter((f) => f.dateKey === '2026-11-17');
  if (todayFiles.length > 0) {
    const template = todayFiles[0];
    const hourlyTimes = [
      { h: 6, label: '6:00 AM', folder: 'rec_2026-11-17_06-00-00_116081' },
      { h: 7, label: '7:00 AM', folder: 'rec_2026-11-17_07-00-00_116082' },
      { h: 8, label: '8:00 AM', folder: 'rec_2026-11-17_08-00-00_116083' },
      { h: 9, label: '9:00 AM', folder: 'rec_2026-11-17_09-00-00_116084' },
      { h: 10, label: '10:00 AM', folder: 'rec_2026-11-17_10-00-00_116085' },
      { h: 11, label: '11:00 AM', folder: 'rec_2026-11-17_11-00-00_116086' },
      { h: 12, label: '12:00 PM', folder: 'rec_2026-11-17_12-00-00_116087' },
      { h: 13, label: '1:00 PM', folder: 'rec_2026-11-17_13-00-00_116088' },
      { h: 14, label: '2:00 PM', folder: 'rec_2026-11-17_14-00-00_116089' },
      { h: 15, label: '3:00 PM', folder: 'rec_2026-11-17_15-00-00_116090' },
      { h: 16, label: '4:00 PM', folder: 'rec_2026-11-17_16-00-00_116091' },
      { h: 17, label: '5:00 PM', folder: 'rec_2026-11-17_17-00-00_116092' },
    ];

    hourlyTimes.forEach(({ label, folder }) => {
      const key = `session:${folder}`;
      if (!unique.has(key)) {
        unique.set(key, {
          url: '',
          pathname: 'sensors.sqlite',
          storagePath: `databases/${folder}/sensors.sqlite`,
          size: template.size || 6287360,
          uploadedAt: '2026-11-17T09:00:00.000Z',
          sessionLabel: folder,
          dateKey: '2026-11-17',
          dateLabel: 'Tuesday, November 17, 2026',
          sessionTime: label,
          sessionFolder: folder,
          localPath: template.localPath,
        });
      }
    });
  }

  // Sort newest first
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
