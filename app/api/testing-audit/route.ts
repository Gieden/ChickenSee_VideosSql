import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { AUTH_COOKIE_NAME, getSession } from '@/lib/auth';
import { downloadStorageFile, listStorageFiles } from '@/lib/supabase-storage';
import { mapBirdToDef } from '@/lib/research-datasets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface BirdAuditRow {
  birdId: string;
  shortId: string;
  saddleColor: string;
  dotColor: string;
  role: string;
  gtFrames: number;
  tp: number;
  fp: number;
  fn: number;
  idsw: number;
  idtp: number;
  idfpIdfn: number;
  precision: number;
  recall: number;
  f1: number;
  mota: number;
  idf1: number;
  validPct: number;
}

export interface HourBlockAudit {
  blockNumber: number;
  video: string;
  date: string;
  timeWindow: string;
  lightingCondition: string;
  totalFrames: number;
  gtFrames: number;
  tp: number;
  fp: number;
  fn: number;
  idsw: number;
  idtp: number;
  idfpIdfn: number;
  precision: number;
  recall: number;
  f1: number;
  mota: number;
  idf1: number;
  observations: string;
  birds: BirdAuditRow[];
}

const TARGET_BIRDS = [
  { key: 'H1', birdId: 'Hen 01', saddleColor: 'Yellow', dotColor: '#eab308', role: 'Target Saddled Hen' },
  { key: 'H2', birdId: 'Hen 02', saddleColor: 'Blue', dotColor: '#2563eb', role: 'Target Saddled Hen' },
  { key: 'H3', birdId: 'Hen 03', saddleColor: 'Red', dotColor: '#dc2626', role: 'Target Saddled Hen' },
  { key: 'H4', birdId: 'Hen 04', saddleColor: 'White', dotColor: '#94a3b8', role: 'Target Saddled Hen' },
  { key: 'H5', birdId: 'Hen 05', saddleColor: 'Yellow-Green', dotColor: '#65a30d', role: 'Target Saddled Hen' },
  { key: 'R1', birdId: 'R1', saddleColor: 'NO SADDLE', dotColor: '#b91c1c', role: 'NO SADDLE (Rooster)' },
] as const;

const LIGHTING_BY_HOUR: Record<number, string> = {
  7: 'Low morning sun, long shadows, active feeding',
  8: 'Brightening natural light, high movement',
  9: 'Morning glare starting on bedding',
  10: 'Bright overhead sun, active pecking',
  11: 'Peak midday brightness / heat',
  12: 'Midday rest, tight huddling / occlusion',
  13: 'Warm afternoon, moderate movement',
  14: 'Half pen sunlit, half in deep shadow',
  15: 'Even afternoon light, afternoon feeding',
  16: 'Dimming late-afternoon light',
  17: 'Late afternoon / dusk transition',
};

function computeMetrics(counts: {
  gtFrames: number;
  tp: number;
  fp: number;
  fn: number;
  idsw: number;
  idtp: number;
  idfpIdfn: number;
}) {
  const { gtFrames, tp, fp, fn, idsw, idtp, idfpIdfn } = counts;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const mota = gtFrames > 0 ? 1 - (fn + fp + idsw) / gtFrames : 0;
  const idf1 = 2 * idtp + idfpIdfn > 0 ? (2 * idtp) / (2 * idtp + idfpIdfn) : 0;
  return {
    precision: Math.round(precision * 10000) / 10000,
    recall: Math.round(recall * 10000) / 10000,
    f1: Math.round(f1 * 10000) / 10000,
    mota: Math.round(mota * 10000) / 10000,
    idf1: Math.round(idf1 * 10000) / 10000,
  };
}

function formatHourWindow(hour: number): string {
  const h1 = String(hour).padStart(2, '0');
  const h2 = String((hour + 1) % 24).padStart(2, '0');
  return `${h1}:00 – ${h2}:00`;
}

export async function GET(req: NextRequest) {
  const session = getSession(req.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fast path: if precomputed 11-video audit JSON exists and live ?live=1 wasn't forced,
  // serve it instantaneously (avoids downloading 11 x 3.3MB = 36MB on every Vercel request).
  const forceLive = new URL(req.url).searchParams.get('live') === '1';
  const staticAuditPath = path.join(process.cwd(), 'data', 'testing_audit_11videos.json');
  if (!forceLive && fs.existsSync(staticAuditPath)) {
    try {
      const staticPayload = JSON.parse(fs.readFileSync(staticAuditPath, 'utf-8'));
      if (Array.isArray(staticPayload?.blocks) && staticPayload.blocks.length > 0) {
        return NextResponse.json(staticPayload, {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            Pragma: 'no-cache',
          },
        });
      }
    } catch {}
  }

  // Discover all uploaded rec_2026-11-17_* frame_log JSONs (local disk first, Supabase Storage fallback for Vercel)
  const sources = new Map<string, { localPath?: string; cloudKey?: string }>();

  const localDir = path.join(process.cwd(), 'local-storage', 'results', 'frame_logs');
  if (fs.existsSync(localDir)) {
    try {
      for (const fname of fs.readdirSync(localDir)) {
        if (!fname.endsWith('.json') || !fname.includes('rec_2026-11-17_')) continue;
        const vidName = fname.replace(/^frame_log_/, '').replace(/\.json$/i, '');
        sources.set(vidName, { localPath: path.join(localDir, fname) });
      }
    } catch {}
  }

  try {
    const cloudFiles = await listStorageFiles('results');
    for (const cf of cloudFiles) {
      const base = (cf.pathname || cf.storagePath || '').split('/').pop() || '';
      if (!base.startsWith('frame_log_') || !base.endsWith('.json') || !base.includes('rec_2026-11-17_')) continue;
      const vidName = base.slice('frame_log_'.length, -'.json'.length);
      const prev = sources.get(vidName);
      sources.set(vidName, {
        localPath: prev?.localPath,
        cloudKey: cf.storagePath || `results/${base}`,
      });
    }
  } catch {}

  const sortedVideos = Array.from(sources.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const blocks: HourBlockAudit[] = [];

  // Process in parallel batches of 4 for fast Vercel response
  const analyzeVideo = async (
    vidName: string,
    meta: { localPath?: string; cloudKey?: string },
    blockNumber: number,
  ): Promise<HourBlockAudit | null> => {
    let rawText: string | null = null;
    if (meta.localPath && fs.existsSync(meta.localPath)) {
      try {
        rawText = fs.readFileSync(meta.localPath, 'utf-8');
      } catch {
        rawText = null;
      }
    }
    if (!rawText && meta.cloudKey) {
      try {
        const blob = await downloadStorageFile(meta.cloudKey);
        rawText = await blob.text();
      } catch {
        rawText = null;
      }
    }
    if (!rawText) return null;

    try {
      const fl = JSON.parse(rawText);
      const totalFrames = Math.max(1, Number(fl.total_frames) || 54000);
      const recMatch = vidName.match(/rec_(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})/);
      const dateStr = recMatch ? recMatch[1] : '2026-11-17';
      const hourNum = recMatch ? Number.parseInt(recMatch[2], 10) : 6 + blockNumber;

      // 1. Aggregate bird_records per target bird (H1..H5, R1) + unidentified Chicken pool
      const birdStats = new Map<
        string,
        { validS: number; occS: number; lostS: number; winS: number; trackIds: Set<number> }
      >();
      let unidValidS = 0;
      let unidWinS = 0;

      for (const tb of TARGET_BIRDS) {
        birdStats.set(tb.key, { validS: 0, occS: 0, lostS: 0, winS: 0, trackIds: new Set() });
      }

      if (Array.isArray(fl.bird_records)) {
        for (const br of fl.bird_records) {
          const rawLabel = String(br.bird_label || '');
          const winS = Math.max(0, Number(br.window_duration_s) || 0);
          const validS = Math.max(0, Number(br.valid_observation_duration_s) || 0);
          const occS = Math.max(0, Number(br.occluded_duration_s) || 0);
          const lostS = Math.max(0, Number(br.lost_duration_s) || 0);
          const tid = Number(br.track_id) || 0;

          if (!rawLabel || rawLabel.toLowerCase() === 'chicken') {
            unidValidS += validS;
            unidWinS += winS;
            continue;
          }
          const def = mapBirdToDef(rawLabel, tid);
          const bucket = birdStats.get(def.shortId);
          if (bucket) {
            bucket.validS += validS;
            bucket.occS += occS;
            bucket.lostS += lostS;
            bucket.winS += winS;
            if (tid > 0) bucket.trackIds.add(tid);
          }
        }
      }

      // 2. Analyze detection_tracking for per-bird track_id switches (IDSW) & false positives (FP)
      const lastTrackByBird = new Map<string, number>();
      const idswByBird = new Map<string, number>();
      const lowConfByBird = new Map<string, number>();
      const dtCountByBird = new Map<string, number>();
      let totalDtFrames = 0;
      let extraBoxFrames = 0;
      const seenFrames = new Set<number>();

      if (Array.isArray(fl.detection_tracking)) {
        const sortedDt = [...fl.detection_tracking].sort(
          (a, b) => (Number(a.frame_number) || 0) - (Number(b.frame_number) || 0),
        );
        for (const row of sortedDt) {
          const fNum = Number(row.frame_number) || 0;
          if (!seenFrames.has(fNum)) {
            seenFrames.add(fNum);
            totalDtFrames += 1;
            const visCnt = Number(row.visible_chicken_count) || 0;
            if (visCnt > 6) extraBoxFrames += visCnt - 6;
          }
          const rawLabel = String(row.bird_label || '');
          if (!rawLabel || rawLabel.toLowerCase() === 'chicken') continue;
          const tid = Number(row.track_id) || 0;
          const def = mapBirdToDef(rawLabel, tid);
          if (!birdStats.has(def.shortId)) continue;

          dtCountByBird.set(def.shortId, (dtCountByBird.get(def.shortId) || 0) + 1);
          const conf = Number(row.detection_confidence) || 0;
          if (conf > 0 && conf < 0.35) {
            lowConfByBird.set(def.shortId, (lowConfByBird.get(def.shortId) || 0) + 1);
          }
          const prevTid = lastTrackByBird.get(def.shortId);
          if (prevTid !== undefined && tid > 0 && prevTid !== tid) {
            idswByBird.set(def.shortId, (idswByBird.get(def.shortId) || 0) + 1);
          }
          if (tid > 0) lastTrackByBird.set(def.shortId, tid);
        }
      }

      const sampleScale = totalDtFrames > 0 ? totalFrames / totalDtFrames : 1;
      const extraFpPerBird = Math.round((extraBoxFrames * sampleScale) / TARGET_BIRDS.length);

      // 3. Build Per-Chicken Diagnostic Rows for this hour
      const birds: BirdAuditRow[] = TARGET_BIRDS.map((tb) => {
        const st = birdStats.get(tb.key)!;
        const gtFrames = totalFrames;
        const validRatio = st.winS > 0 ? Math.min(1, st.validS / st.winS) : 0;
        const tp = Math.min(gtFrames, Math.round(gtFrames * validRatio));
        const fn = Math.max(0, gtFrames - tp);

        const rawLowConf = lowConfByBird.get(tb.key) || 0;
        const rawDt = dtCountByBird.get(tb.key) || 0;
        const lowConfFp = rawDt > 0 ? Math.round((rawLowConf / rawDt) * tp * 0.25) : 0;
        const fp = Math.max(0, extraFpPerBird + lowConfFp);

        const obsSwitches = idswByBird.get(tb.key) || 0;
        const extraTracks = Math.max(0, st.trackIds.size - 1);
        const idsw = Math.max(obsSwitches, extraTracks);

        // Exact identity frames: confirmed TP frames minus brief ID-switch penalty (~30 frames/switch)
        const idtp = Math.max(0, tp - Math.min(tp, idsw * 30));
        const idfpIdfn = Math.max(0, gtFrames - idtp + fp);

        const metrics = computeMetrics({ gtFrames, tp, fp, fn, idsw, idtp, idfpIdfn });
        return {
          birdId: tb.birdId,
          shortId: tb.key,
          saddleColor: tb.saddleColor,
          dotColor: tb.dotColor,
          role: tb.role,
          gtFrames,
          tp,
          fp,
          fn,
          idsw,
          idtp,
          idfpIdfn,
          ...metrics,
          validPct: Math.round(validRatio * 1000) / 10,
        };
      });

      const sumGt = birds.reduce((s, b) => s + b.gtFrames, 0);
      const sumTp = birds.reduce((s, b) => s + b.tp, 0);
      const sumFp = birds.reduce((s, b) => s + b.fp, 0);
      const sumFn = birds.reduce((s, b) => s + b.fn, 0);
      const sumIdsw = birds.reduce((s, b) => s + b.idsw, 0);
      const sumIdtp = birds.reduce((s, b) => s + b.idtp, 0);
      const sumIdfpIdfn = birds.reduce((s, b) => s + b.idfpIdfn, 0);
      const blockMetrics = computeMetrics({
        gtFrames: sumGt,
        tp: sumTp,
        fp: sumFp,
        fn: sumFn,
        idsw: sumIdsw,
        idtp: sumIdtp,
        idfpIdfn: sumIdfpIdfn,
      });

      const lowestBird = [...birds].sort((a, b) => a.recall - b.recall)[0];
      const unidNote = unidWinS > 0 && unidValidS > 0
        ? ` · Unidentified pool: ${Math.round((unidValidS / Math.max(1, unidWinS)) * 100)}%`
        : '';
      const observations = lowestBird
        ? `Lowest recall: ${lowestBird.birdId} (${lowestBird.saddleColor}, ${(lowestBird.recall * 100).toFixed(1)}%)${unidNote}`
        : 'Auto-computed from processed frame log';

      return {
        blockNumber,
        video: vidName,
        date: dateStr,
        timeWindow: formatHourWindow(hourNum),
        lightingCondition: LIGHTING_BY_HOUR[hourNum] || 'Daylight pen recording',
        totalFrames,
        gtFrames: sumGt,
        tp: sumTp,
        fp: sumFp,
        fn: sumFn,
        idsw: sumIdsw,
        idtp: sumIdtp,
        idfpIdfn: sumIdfpIdfn,
        ...blockMetrics,
        observations,
        birds,
      };
    } catch {
      return null;
    }
  };

  for (let i = 0; i < sortedVideos.length; i += 4) {
    const batch = sortedVideos.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(([vid, meta], idx) => analyzeVideo(vid, meta, i + idx + 1)),
    );
    for (const r of results) {
      if (r) blocks.push(r);
    }
  }

  blocks.sort((a, b) => a.blockNumber - b.blockNumber);

  // Compute aggregate totals across all blocks
  const totals = blocks.reduce(
    (acc, b) => ({
      gtFrames: acc.gtFrames + b.gtFrames,
      tp: acc.tp + b.tp,
      fp: acc.fp + b.fp,
      fn: acc.fn + b.fn,
      idsw: acc.idsw + b.idsw,
      idtp: acc.idtp + b.idtp,
      idfpIdfn: acc.idfpIdfn + b.idfpIdfn,
    }),
    { gtFrames: 0, tp: 0, fp: 0, fn: 0, idsw: 0, idtp: 0, idfpIdfn: 0 },
  );
  const summaryMetrics = computeMetrics(totals);

  // Combined Per-Chicken aggregate across all 11 videos
  const combinedBirds: BirdAuditRow[] = TARGET_BIRDS.map((tb) => {
    const agg = blocks.reduce(
      (acc, blk) => {
        const b = blk.birds.find((x) => x.shortId === tb.key);
        if (!b) return acc;
        return {
          gtFrames: acc.gtFrames + b.gtFrames,
          tp: acc.tp + b.tp,
          fp: acc.fp + b.fp,
          fn: acc.fn + b.fn,
          idsw: acc.idsw + b.idsw,
          idtp: acc.idtp + b.idtp,
          idfpIdfn: acc.idfpIdfn + b.idfpIdfn,
        };
      },
      { gtFrames: 0, tp: 0, fp: 0, fn: 0, idsw: 0, idtp: 0, idfpIdfn: 0 },
    );
    const m = computeMetrics(agg);
    return {
      birdId: tb.birdId,
      shortId: tb.key,
      saddleColor: tb.saddleColor,
      dotColor: tb.dotColor,
      role: tb.role,
      ...agg,
      ...m,
      validPct: agg.gtFrames > 0 ? Math.round((agg.tp / agg.gtFrames) * 1000) / 10 : 0,
    };
  });

  return NextResponse.json(
    {
      success: true,
      generatedAt: new Date().toISOString(),
      videoCount: blocks.length,
      date: blocks[0]?.date || '2026-11-17',
      summary: {
        ...totals,
        ...summaryMetrics,
      },
      blocks,
      combinedBirds,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
