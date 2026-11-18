import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { AUTH_COOKIE_NAME, verifySessionToken } from '@/lib/auth';
import { downloadStorageFile, listStorageFiles } from '@/lib/supabase-storage';
import { openDatabaseFromBytes } from '@/lib/db-viewer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

let recoveredHistoryCache: { expiresAt: number; items: any[] } | null = null;
const MAX_QUEUE_STALENESS_SECONDS = 15;

function normalizeVideoName(value: string): string {
  return (value.split(/[\\/]/).pop() || value)
    .replace(/\.[^.]+$/, '')
    .replace(/_(?:detected|annotated)$/i, '')
    .toLowerCase();
}

function getQueueFreshness(
  updatedAt: string | null,
  activeDetection: { captured_at?: string } | null,
  isProcessing: boolean,
) {
  if (!isProcessing) {
    return {
      source_stale: false,
      source_age_seconds: 0,
    };
  }
  const freshnessTimestamp = activeDetection?.captured_at || updatedAt;
  const timestamp = Date.parse(String(freshnessTimestamp || ''));
  const ageSeconds = Number.isFinite(timestamp)
    ? Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
    : null;
  return {
    source_stale: ageSeconds === null || ageSeconds > MAX_QUEUE_STALENESS_SECONDS,
    source_age_seconds: ageSeconds,
  };
}

async function recoverCompletedHistory(items: any[]) {
  if (!recoveredHistoryCache || recoveredHistoryCache.expiresAt <= Date.now()) {
    const resultFiles = (await listStorageFiles('results'))
      .filter((file) => file.pathname.toLowerCase().endsWith('.json') && file.pathname !== 'queue_status.json')
      .sort((first, second) => new Date(second.uploadedAt).getTime() - new Date(first.uploadedAt).getTime());
    const recovered: any[] = [];

    for (let offset = 0; offset < resultFiles.length; offset += 20) {
      const batch = resultFiles.slice(offset, offset + 20);
      const reports = await Promise.all(batch.map(async (file) => {
        try {
          const content = await downloadStorageFile(file.storagePath);
          const report = JSON.parse(await content.text());
          const videoFilename = typeof report.source_video === 'string' ? report.source_video : '';
          const jobId = Number.isInteger(report.job_id) ? report.job_id : null;
          const completedAt = typeof report.processed_at === 'string'
            ? report.processed_at
            : file.uploadedAt;
          return videoFilename
            ? {
              item_id: `recovered-${file.pathname}`,
              job_id: jobId,
              video_filename: videoFilename.split(/[\\/]/).pop() || videoFilename,
              status: 'COMPLETED',
              progress_percent: 100,
              frames: '—',
              details: 'Recovered from the synchronized analysis report.',
              created_at: completedAt,
              completed_at: completedAt,
            }
            : null;
        } catch (error) {
          console.warn(`Could not recover queue history from "${file.pathname}":`, error);
          return null;
        }
      }));

      for (const report of reports) {
        if (!report) continue;
        recovered.push(report);
      }
    }

    recoveredHistoryCache = {
      expiresAt: Date.now() + 60_000,
      items: recovered,
    };
  }

  const knownJobIds = new Set<number>();
  const knownVideoNames = new Set<string>();
  for (const item of items) {
    const jobId = Number.isInteger(item.job_id)
      ? item.job_id
      : /^job-(\d+)$/.exec(String(item.item_id || ''))?.[1];
    if (jobId !== undefined && jobId !== null) {
      knownJobIds.add(Number(jobId));
    } else {
      const normalizedName = normalizeVideoName(String(item.video_filename || ''));
      if (normalizedName) knownVideoNames.add(normalizedName);
    }
  }
  return recoveredHistoryCache.items.filter((item) => {
    if (Number.isInteger(item.job_id)) {
      if (knownJobIds.has(item.job_id)) return false;
      knownJobIds.add(item.job_id);
      return true;
    }
    const normalizedName = normalizeVideoName(item.video_filename);
    if (!normalizedName || knownVideoNames.has(normalizedName)) return false;
    knownVideoNames.add(normalizedName);
    return true;
  });
}

async function getLocalQueueResponse() {
  if (process.env.VERCEL) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const localRes = await fetch('http://127.0.0.1:8000/queue?limit=500', {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!localRes.ok) return null;

    const q = await localRes.json();
    const items = q.items || [];
    const summary = q.summary || {};
    const active = items.find((item: any) => item.status === 'PROCESSING');
    const activeDetection = q.active_detection || null;
    const freshness = getQueueFreshness(
      new Date().toISOString(),
      activeDetection,
      Boolean(active),
    );
    const isQueueing = (summary.processing || 0) + (summary.queued || 0) + (summary.waiting || 0) > 0;
    return NextResponse.json({
      source: 'local-api',
      updated_at: new Date().toISOString(),
      ...freshness,
      is_queueing: isQueueing,
      active_video: active?.video_filename || null,
      active_progress: active?.progress_percent ?? null,
      active_frames: active?.progress_frames != null && active?.total_frames
        ? `${active.progress_frames} / ${active.total_frames}`
        : null,
      active_detection: activeDetection,
      summary: {
        processing: summary.processing || 0,
        queued: summary.queued || 0,
        waiting: summary.waiting || 0,
        completed: summary.completed || 0,
        failed: summary.failed || 0,
        cancelled: summary.cancelled || 0,
      },
      items: items.slice(0, 500).map((item: any) => ({
        item_id: item.item_id || item.id,
        video_filename: item.video_filename,
        status: item.status,
        progress_percent: item.progress_percent,
        frames: item.progress_frames != null && item.total_frames
          ? `${item.progress_frames} / ${item.total_frames}`
          : '—',
        details: item.details || item.error_message || null,
        created_at: item.created_at,
        completed_at: item.completed_at || null,
        queued_at: item.queued_at || null,
        date: item.date || null,
      })),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getDirectLocalDbQueueResponse() {
  if (process.env.VERCEL) return null;
  const dbPath = path.join(process.cwd(), 'analytics', 'zampen_analytics.db');
  if (!fs.existsSync(dbPath)) return null;

  let db: any = null;
  try {
    const buf = fs.readFileSync(dbPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    db = await openDatabaseFromBytes(ab);
    const execRes = db.exec(`
      SELECT id, video_filename, video_path, status, progress_frames, total_frames, error_message, created_at, completed_at
      FROM processing_jobs
      ORDER BY id DESC
      LIMIT 500
    `);
    const rows: any[] = [];
    if (execRes.length > 0 && execRes[0].values) {
      const cols = execRes[0].columns;
      for (const valRow of execRes[0].values) {
        const obj: Record<string, any> = {};
        cols.forEach((col: string, i: number) => { obj[col] = valRow[i]; });
        rows.push(obj);
      }
    }

    const maxCompletedId = rows.reduce((maxId, r) => (
      String(r.status || '').toUpperCase() === 'COMPLETED' && r.id > maxId ? r.id : maxId
    ), 0);

    const mappedItems = rows.map((row) => {
      let st = String(row.status || 'COMPLETED').toUpperCase();
      // If an older job was left in PROCESSING while newer jobs already completed, mark it COMPLETED/CANCELLED
      if (st === 'PROCESSING' && row.id < maxCompletedId) {
        st = row.total_frames && row.progress_frames >= row.total_frames ? 'COMPLETED' : 'CANCELLED';
      }
      const totalF = Number(row.total_frames) || 0;
      const progF = st === 'COMPLETED' && totalF > 0 ? totalF : (Number(row.progress_frames) || 0);
      const pct = st === 'COMPLETED'
        ? 100
        : totalF > 0
          ? Number(((progF / totalF) * 100).toFixed(1))
          : null;
      const toIso = (val: any) => {
        if (!val) return null;
        const s = String(val).trim();
        return s.includes('T') ? s : s.replace(' ', 'T');
      };
      return {
        item_id: `job-${row.id}`,
        job_id: row.id,
        video_filename: row.video_filename,
        status: st,
        progress_percent: pct,
        frames: totalF > 0 ? `${progF} / ${totalF}` : '—',
        details: row.error_message || null,
        created_at: toIso(row.created_at),
        completed_at: toIso(row.completed_at),
      };
    });

    const active = mappedItems.find((item) => item.status === 'PROCESSING') || null;
    let activeDetection: any = null;
    if (active) {
      const candidateDetPaths = [
        path.join(process.cwd(), 'local-storage', 'results', 'detection_status.json'),
        path.join('C:', 'Users', 'Kairi', 'Documents', 'ChickenSee_Local_Storage', 'results', 'detection_status.json'),
      ];
      for (const detPath of candidateDetPaths) {
        if (fs.existsSync(detPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(detPath, 'utf-8'));
            if (parsed && parsed.job_id === active.job_id) {
              activeDetection = parsed;
              break;
            }
          } catch {}
        }
      }
    }

    const summary = {
      processing: mappedItems.filter((i) => i.status === 'PROCESSING').length,
      queued: mappedItems.filter((i) => i.status === 'QUEUED').length,
      waiting: mappedItems.filter((i) => i.status === 'WAITING').length,
      completed: mappedItems.filter((i) => i.status === 'COMPLETED').length,
      failed: mappedItems.filter((i) => i.status === 'FAILED').length,
      cancelled: mappedItems.filter((i) => i.status === 'CANCELLED').length,
    };

    const isQueueing = summary.processing + summary.queued + summary.waiting > 0;
    return NextResponse.json({
      source: 'local-sqlite',
      updated_at: new Date().toISOString(),
      source_stale: false,
      source_age_seconds: 0,
      is_queueing: isQueueing,
      active_video: active?.video_filename || null,
      active_progress: active?.progress_percent ?? null,
      active_frames: active?.frames ?? null,
      active_detection: activeDetection,
      summary,
      items: mappedItems,
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (err) {
    console.error('Direct SQLite queue check failed:', err);
    return null;
  } finally {
    if (db) {
      try { db.close(); } catch {}
    }
  }
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const localQueue = await getLocalQueueResponse();
  if (localQueue) return localQueue;

  const directDbQueue = await getDirectLocalDbQueueResponse();
  if (directDbQueue) return directDbQueue;

  // The queue has a fixed storage path, so fetch it directly instead of relying on listing.
  try {
    let storedData: any = null;
    const localSnapshotCandidates = [
      path.join(process.cwd(), 'local-storage', 'results', 'queue_status.json'),
      path.join(process.cwd(), 'data', 'results', 'queue_status.json'),
    ];
    for (const snapPath of localSnapshotCandidates) {
      if (fs.existsSync(snapPath)) {
        try {
          const candidate = JSON.parse(fs.readFileSync(snapPath, 'utf-8'));
          if (candidate && Array.isArray(candidate.items) && candidate.items.length > 0) {
            storedData = candidate;
            break;
          }
        } catch {}
      }
    }

    if (!storedData) {
      const content = await downloadStorageFile('results/queue_status.json');
      storedData = JSON.parse(await content.text());
    }

    const storedSummary = storedData.summary && typeof storedData.summary === 'object'
      ? storedData.summary
      : {};
    const items = Array.isArray(storedData.items) ? [...storedData.items] : [];
    const summary = {
      processing: Number(storedSummary.processing) || 0,
      queued: Number(storedSummary.queued) || 0,
      waiting: Number(storedSummary.waiting) || 0,
      completed: Number(storedSummary.completed) || 0,
      failed: Number(storedSummary.failed) || 0,
      cancelled: Number(storedSummary.cancelled) || 0,
    };
    let historyWarning: string | null = null;
    try {
      const recoveredHistory = await recoverCompletedHistory(items);
      items.push(...recoveredHistory);
    } catch (error) {
      console.error('Failed to recover queue history from synchronized analysis reports:', error);
      historyWarning = 'Some queue history could not be recovered from synchronized analysis reports.';
    }

    // Demote stale PROCESSING ghost items if newer jobs have completed or if the snapshot is >120s old
    const snapshotUpdatedMs = Date.parse(String(storedData.updated_at || ''));
    const snapshotAgeMs = Number.isFinite(snapshotUpdatedMs) ? Date.now() - snapshotUpdatedMs : Infinity;
    const latestCompletedMs = items.reduce((latest, it) => {
      if (String(it.status || '').toUpperCase() !== 'COMPLETED') return latest;
      const ms = Date.parse(String(it.completed_at || it.created_at || ''));
      return Number.isFinite(ms) && ms > latest ? ms : latest;
    }, 0);
    for (const item of items) {
      if (String(item.status || '').toUpperCase() === 'PROCESSING') {
        const createdMs = Date.parse(String(item.created_at || ''));
        const itemAgeMs = Number.isFinite(createdMs) ? Date.now() - createdMs : snapshotAgeMs;
        if (
          snapshotAgeMs > 120_000 ||
          itemAgeMs > 30 * 60_000 ||
          (Number.isFinite(createdMs) && latestCompletedMs > createdMs + 60_000)
        ) {
          item.status = Number(item.progress_percent) >= 100 ? 'COMPLETED' : 'CANCELLED';
          if (item.status === 'COMPLETED') {
            item.progress_percent = 100;
            item.completed_at = item.completed_at || item.created_at || storedData.updated_at;
          }
        }
      }
    }

    const completedItems = items.filter(
      (item) => String(item.status || '').toUpperCase() === 'COMPLETED',
    ).length;
    summary.completed = Math.max(summary.completed, completedItems);
    summary.processing = items.filter(
      (item) => String(item.status || '').toUpperCase() === 'PROCESSING',
    ).length;
    summary.cancelled = items.filter(
      (item) => String(item.status || '').toUpperCase() === 'CANCELLED',
    ).length;
    const activeAndPendingItems = items.filter((item) =>
      ['PROCESSING', 'QUEUED', 'WAITING'].includes(String(item.status || '').toUpperCase()),
    );
    const historyItems = items
      .filter((item) =>
        !['PROCESSING', 'QUEUED', 'WAITING'].includes(String(item.status || '').toUpperCase()),
      )
      .sort((first, second) =>
        Date.parse(String(second.completed_at || second.created_at || ''))
        - Date.parse(String(first.completed_at || first.created_at || '')),
      );
    const mergedItems = [...activeAndPendingItems, ...historyItems];
    const activeProcessingItem = activeAndPendingItems.find(
      (it) => String(it.status || '').toUpperCase() === 'PROCESSING',
    );
    const activeVideo = activeProcessingItem ? (activeProcessingItem.video_filename || storedData.active_video || null) : null;
    const activeDetection = activeProcessingItem ? (storedData.active_detection || null) : null;
    const isActuallyProcessing = Boolean(activeProcessingItem && summary.processing > 0);
    const freshness = getQueueFreshness(
      typeof storedData.updated_at === 'string' ? storedData.updated_at : null,
      activeDetection,
      isActuallyProcessing,
    );

    return NextResponse.json({
      ...storedData,
      source: 'supabase',
      updated_at: storedData.updated_at || new Date().toISOString(),
      ...freshness,
      is_queueing: (summary.processing + summary.queued + summary.waiting) > 0,
      active_video: activeVideo,
      active_progress: activeProcessingItem ? (activeProcessingItem.progress_percent ?? storedData.active_progress ?? null) : null,
      active_frames: activeProcessingItem ? (activeProcessingItem.frames ?? storedData.active_frames ?? null) : null,
      active_detection: activeDetection,
      history_warning: historyWarning,
      summary,
      items: mergedItems,
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (storageError) {
    console.error('Supabase Storage queue status check failed:', storageError);
    if (process.env.VERCEL) {
      return NextResponse.json(
        {
          error: 'Failed to load queue status from Supabase Storage',
          details: storageError instanceof Error ? storageError.message : 'Unknown storage error',
        },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({
    source: 'idle',
    updated_at: null,
    source_stale: true,
    source_age_seconds: null,
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
