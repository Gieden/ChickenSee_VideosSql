import { list, head } from '@vercel/blob';

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
    return [];
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
    return [];
  }
}
