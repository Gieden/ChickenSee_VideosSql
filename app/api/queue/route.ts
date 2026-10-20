import { NextRequest, NextResponse } from 'next/server';
import { list } from '@vercel/blob';
import { AUTH_COOKIE_NAME, verifySessionToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Prefer the latest uploaded queue status; never report a bundled snapshot as live on Vercel.
  try {
    const { blobs } = await list({ prefix: 'results/queue_status.json' });
    const queueBlob = blobs.find((b) => b.pathname.endsWith('queue_status.json'));

    if (queueBlob) {
      const res = await fetch(queueBlob.url, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Failed to download queue status: HTTP ${res.status}`);
      }
      const data = await res.json();
      return NextResponse.json({
        source: 'blob',
        synced_at: queueBlob.uploadedAt,
        ...data,
      });
    }
  } catch (blobError) {
    console.error('Vercel Blob queue status check failed:', blobError);
    return NextResponse.json(
      { error: 'Failed to load queue status from Vercel Blob' },
      { status: 503 },
    );
  }

  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: 'No queue status has been synced to Vercel yet' },
      { status: 503 },
    );
  }

  // Fallback to the local OptiPlex analytics API during local development.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const localRes = await fetch('http://127.0.0.1:8000/queue?limit=40', {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (localRes.ok) {
      const q = await localRes.json();
      const items = q.items || [];
      const summary = q.summary || {};
      const active = items.find((it: any) => it.status === 'PROCESSING');
      const isQueueing = (summary.processing || 0) + (summary.queued || 0) + (summary.waiting || 0) > 0;

      return NextResponse.json({
        source: 'local-api',
        updated_at: new Date().toISOString(),
        is_queueing: isQueueing,
        active_video: active?.video_filename || null,
        active_progress: active?.progress_percent ?? null,
        active_frames: active?.progress_frames && active?.total_frames
          ? `${active.progress_frames} / ${active.total_frames}`
          : null,
        summary: {
          processing: summary.processing || 0,
          queued: summary.queued || 0,
          waiting: summary.waiting || 0,
          completed: summary.completed || 0,
          failed: summary.failed || 0,
          cancelled: summary.cancelled || 0,
        },
        items: items.slice(0, 100).map((it: any) => ({
          item_id: it.item_id || it.id,
          video_filename: it.video_filename,
          status: it.status,
          progress_percent: it.progress_percent,
          frames: it.progress_frames && it.total_frames ? `${it.progress_frames} / ${it.total_frames}` : '—',
          details: it.details || it.error_message || null,
          created_at: it.created_at,
          completed_at: it.completed_at || null,
          queued_at: it.queued_at || null,
          date: it.date || null,
        })),
      });
    }
  } catch (localErr) {
    // Local API not reachable from this environment
  }

  // Default to idle only after checking live local data during local development.
  return NextResponse.json({
    source: 'idle',
    updated_at: null,
    is_queueing: false,
    active_video: null,
    active_progress: null,
    active_frames: null,
    summary: {
      processing: 0,
      queued: 0,
      waiting: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
    items: [],
  });
}
