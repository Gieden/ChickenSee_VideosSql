import { list, head, del } from '@vercel/blob';

export interface SyncedFileMeta {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
}

export async function listSyncedVideos(): Promise<SyncedFileMeta[]> {
  try {
    const { blobs } = await list({ prefix: 'videos/' });
    return blobs
      .filter((b) => b.pathname.toLowerCase().endsWith('.mp4'))
      .map((b) => ({
        url: b.url,
        pathname: b.pathname.replace(/^videos\//, ''),
        size: b.size,
        uploadedAt: b.uploadedAt.toISOString(),
      }))
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  } catch (error) {
    console.error('Error listing video blobs:', error);
    throw error;
  }
}

export async function listSyncedDatabases(): Promise<SyncedFileMeta[]> {
  try {
    const { blobs } = await list({ prefix: 'databases/' });
    return blobs
      .filter((b) => {
        const lower = b.pathname.toLowerCase();
        return lower.endsWith('.sqlite') || lower.endsWith('.db');
      })
      .map((b) => ({
        url: b.url,
        pathname: b.pathname.replace(/^databases\//, ''),
        size: b.size,
        uploadedAt: b.uploadedAt.toISOString(),
      }))
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  } catch (error) {
    console.error('Error listing database blobs:', error);
    throw error;
  }
}

/**
 * Automatically cleans up .mp4 videos older than the specified retention window (default: 7 days).
 * Strictly preserves all SQLite telemetry databases in databases/ folder.
 */
export async function cleanupOldVideos(retentionDays = 7): Promise<{
  deletedCount: number;
  freedBytes: number;
  freedMB: number;
  deletedFiles: string[];
}> {
  try {
    const { blobs } = await list({ prefix: 'videos/' });
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const expiredBlobs = blobs.filter((b) => {
      const isVideo = b.pathname.toLowerCase().endsWith('.mp4');
      const isExpired = new Date(b.uploadedAt).getTime() < cutoffMs;
      return isVideo && isExpired;
    });

    if (expiredBlobs.length === 0) {
      return { deletedCount: 0, freedBytes: 0, freedMB: 0, deletedFiles: [] };
    }

    const urlsToDelete = expiredBlobs.map((b) => b.url);
    const freedBytes = expiredBlobs.reduce((acc, b) => acc + b.size, 0);
    const deletedFiles = expiredBlobs.map((b) => b.pathname.replace(/^videos\//, ''));

    await del(urlsToDelete);

    return {
      deletedCount: expiredBlobs.length,
      freedBytes,
      freedMB: Number((freedBytes / 1024 / 1024).toFixed(2)),
      deletedFiles,
    };
  } catch (error) {
    console.error('Error during video retention cleanup:', error);
    throw error;
  }
}
