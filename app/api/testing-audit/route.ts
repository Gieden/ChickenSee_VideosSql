import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { AUTH_COOKIE_NAME, getSession } from '@/lib/auth';
import { downloadStorageFile, listStorageFiles } from '@/lib/supabase-storage';
import { mapBirdToDef } from '@/lib/research-datasets';
import {
  buildStrictIdentityTransferMap,
  isDesignatedBird,
  resolveStrictBirdDef,
} from '@/lib/strict-identity-transfer';

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

  const { searchParams } = new URL(req.url);
  const selectedVideo = (searchParams.get('video') || 'all').trim();
  const forceLive = searchParams.get('live') === '1';

  // Discover ALL uploaded frame_log JSONs (newest-first) so any newly processed fragment appears in the dropdown immediately
  const allSources = new Map<string, { localPath?: string; cloudKey?: string; updatedMs: number }>();

  const localDir = path.join(process.cwd(), 'local-storage', 'results', 'frame_logs');
  if (fs.existsSync(localDir)) {
    try {
      for (const fname of fs.readdirSync(localDir)) {
        if (!fname.endsWith('.json')) continue;
        const vidName = fname.replace(/^frame_log_/, '').replace(/\.json$/i, '');
        if (!vidName) continue;
        const fullPath = path.join(localDir, fname);
        const mtimeMs = fs.statSync(fullPath).mtimeMs || 0;
        allSources.set(vidName, { localPath: fullPath, updatedMs: mtimeMs });
      }
    } catch {}
  }

  let cloudListError: string | null = null;
  try {
    const cloudFiles = await listStorageFiles('results', 'frame_log_');
    for (const cf of cloudFiles) {
      const base = (cf.pathname || cf.storagePath || '').split('/').pop() || '';
      if (!base.startsWith('frame_log_') || !base.endsWith('.json')) continue;
      const vidName = base.slice('frame_log_'.length, -'.json'.length);
      if (!vidName) continue;
      const upMs = cf.uploadedAt ? Date.parse(cf.uploadedAt) || 0 : 0;
      const prev = allSources.get(vidName);
      allSources.set(vidName, {
        localPath: prev?.localPath,
        cloudKey: cf.storagePath || `results/${base}`,
        updatedMs: Math.max(prev?.updatedMs || 0, upMs),
      });
    }
  } catch (err) {
    cloudListError = err instanceof Error ? err.message : String(err);
    console.warn('[testing-audit] listStorageFiles("results") failed:', cloudListError);
  }

  // Also ensure any videos from the precomputed 11-video audit are always selectable in the dropdown
  const staticAuditPath = path.join(process.cwd(), 'data', 'testing_audit_11videos.json');
  let staticPayloadCache: any = null;
  if (fs.existsSync(staticAuditPath)) {
    try {
      staticPayloadCache = JSON.parse(fs.readFileSync(staticAuditPath, 'utf-8'));
      if (Array.isArray(staticPayloadCache?.blocks)) {
        for (const blk of staticPayloadCache.blocks) {
          if (blk?.video && !allSources.has(blk.video)) {
            allSources.set(blk.video, {
              cloudKey: `results/frame_log_${blk.video}.json`,
              updatedMs: 1,
            });
          }
        }
      }
    } catch {}
  }

  const availableVideos = Array.from(allSources.entries())
    .sort((a, b) => b[1].updatedMs - a[1].updatedMs)
    .map(([video, meta]) => ({
      video,
      updatedAt: meta.updatedMs > 1 ? new Date(meta.updatedMs).toISOString() : '',
    }));

  // Fast path: when viewing "all" (11-video 2026-11-17 audit) and live ?live=1 wasn't forced,
  // serve precomputed JSON instantaneously and attach the live availableVideos list!
  if (selectedVideo === 'all' && !forceLive && staticPayloadCache?.blocks?.length > 0) {
    return NextResponse.json(
      {
        ...staticPayloadCache,
        selectedVideo: 'all',
        availableVideos,
        cloudListError,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
        },
      },
    );
  }

  const sortedVideos =
    selectedVideo !== 'all'
      ? Array.from(allSources.entries()).filter(([vid]) => vid === selectedVideo)
      : Array.from(allSources.entries())
          .filter(([vid]) => vid.includes('rec_2026-11-17_'))
          .sort((a, b) => a[0].localeCompare(b[0]));

  const blocks: HourBlockAudit[] = [];
  const rawFrameLogsForDist: Array<{ vidName: string; fl: any; blockNumber: number }> = [];

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
      rawFrameLogsForDist.push({ vidName, fl, blockNumber });
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

      // 2. Analyze detection_tracking for real spatial IDSW (swaps/teleports > 90px + saddle->Chicken flips < 45px) & FP
      const idswByBird = new Map<string, number>();
      const lowConfByBird = new Map<string, number>();
      const dtCountByBird = new Map<string, number>();
      let totalDtFrames = 0;
      let extraBoxFrames = 0;
      const seenFrames = new Set<number>();
      const byFrame = new Map<number, any[]>();

      if (Array.isArray(fl.detection_tracking)) {
        const sortedDt = [...fl.detection_tracking].sort(
          (a, b) => (Number(a.frame_number) || 0) - (Number(b.frame_number) || 0),
        );
        for (const row of sortedDt) {
          const fNum = Number(row.frame_number) || 0;
          if (!byFrame.has(fNum)) byFrame.set(fNum, []);
          byFrame.get(fNum)!.push(row);
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
        }

        let prevPos = new Map<string, { x: number; y: number }>();
        let prevF: number | null = null;
        for (const fNum of Array.from(byFrame.keys()).sort((a, b) => a - b)) {
          const curPos = new Map<string, { x: number; y: number }>();
          const unidPts: Array<{ x: number; y: number }> = [];
          for (const row of byFrame.get(fNum) || []) {
            const rawLabel = String(row.bird_label || '');
            const x = Number(row.x_center_px) || 0;
            const y = Number(row.y_center_px) || 0;
            if (!rawLabel || rawLabel.toLowerCase() === 'chicken') {
              unidPts.push({ x, y });
            } else {
              const def = mapBirdToDef(rawLabel, Number(row.track_id) || 0);
              if (birdStats.has(def.shortId)) {
                curPos.set(def.shortId, { x, y });
              }
            }
          }
          if (prevF !== null && fNum - prevF <= 20) {
            for (const [key, pos] of Array.from(curPos.entries())) {
              const prev = prevPos.get(key);
              if (prev && Math.hypot(pos.x - prev.x, pos.y - prev.y) > 90) {
                idswByBird.set(key, (idswByBird.get(key) || 0) + 1);
              }
            }
            for (const [key, prev] of Array.from(prevPos.entries())) {
              if (!curPos.has(key)) {
                if (unidPts.some((u) => Math.hypot(u.x - prev.x, u.y - prev.y) < 45)) {
                  idswByBird.set(key, (idswByBird.get(key) || 0) + 1);
                }
              }
            }
          }
          prevPos = curPos;
          prevF = fNum;
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

        const idsw = idswByBird.get(tb.key) || 0;

        // Exact identity frames: confirmed TP frames minus ID-switch penalty (~45 frames / ~3s per switch)
        const idtp = Math.max(0, tp - Math.min(tp, idsw * 45));
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

  // Compute Identity Distribution Check (Tables 1, 2, 3) for the live selected video(s)
  const DESIGNATED_SET = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'R1']);
  const beforeMap: Record<string, { events: number; seconds: number }> = {
    H1: { events: 0, seconds: 0 },
    H2: { events: 0, seconds: 0 },
    H3: { events: 0, seconds: 0 },
    H4: { events: 0, seconds: 0 },
    H5: { events: 0, seconds: 0 },
    R1: { events: 0, seconds: 0 },
    UNCONFIRMED: { events: 0, seconds: 0 },
  };
  const afterMap: Record<string, { events: number; seconds: number }> = {
    H1: { events: 0, seconds: 0 },
    H2: { events: 0, seconds: 0 },
    H3: { events: 0, seconds: 0 },
    H4: { events: 0, seconds: 0 },
    H5: { events: 0, seconds: 0 },
    R1: { events: 0, seconds: 0 },
    UNCONFIRMED: { events: 0, seconds: 0 },
  };
  const idTable1: any[] = [];
  const table3Transferred: any[] = [];
  const table3Remaining: any[] = [];

  for (const { vidName, fl } of rawFrameLogsForDist.sort((a, b) => a.blockNumber - b.blockNumber)) {
    const tf = Math.max(1, Number(fl.total_frames) || 1);
    const rawFps = Number(fl.fps) || 20;
    const rawDurS = tf / rawFps;
    const isHourly = /rec[_\s-]*\d{4}-\d{2}-\d{2}[_\s]+\d{2}-\d{2}/i.test(vidName) && rawDurS >= 2000 && rawDurS < 3550;
    const efps = isHourly ? tf / 3600.0 : rawFps;
    const m = vidName.match(/rec_\d{4}-\d{2}-\d{2}_(\d{2})-(\d{2})/);
    const hourNum = m ? Number.parseInt(m[1], 10) : 0;
    const recLabel = m ? `${m[1]}:00` : vidName;

    const strictTransfer = buildStrictIdentityTransferMap(fl);
    let totalEv = 0;
    let confEvAfter = 0;
    let unconfEvAfter = 0;
    let confSAfter = 0;
    let unconfSAfter = 0;
    let unconfEvBefore = 0;
    let unconfSBefore = 0;
    const strayByTid = new Map<number, any>();

    for (const ev of Array.isArray(fl.behavior_events) ? fl.behavior_events : []) {
      const beh = String(ev.behavior || '').toLowerCase();
      if (beh === 'social_isolation') continue;
      const tid = Number(ev.track_id) || 0;
      const lbl = String(ev.bird_label || '');
      const sf = Number(ev.start_frame) || 0;
      const ef = Math.max(sf, Number(ev.end_frame) || sf);
      const sS = sf / efps;
      const eS = ef / efps;
      const durS = Math.max(0.1, eS - sS);
      totalEv += 1;

      const resolved = resolveStrictBirdDef(lbl, tid, strictTransfer, Math.round((sf + ef) / 2));
      const ak = DESIGNATED_SET.has(resolved.def.shortId) ? resolved.def.shortId : 'UNCONFIRMED';

      if (isDesignatedBird(lbl, tid)) {
        const bk = mapBirdToDef(lbl, tid).shortId;
        beforeMap[bk].events += 1;
        beforeMap[bk].seconds += durS;
      } else {
        beforeMap.UNCONFIRMED.events += 1;
        beforeMap.UNCONFIRMED.seconds += durS;
        unconfEvBefore += 1;
        unconfSBefore += durS;
        let st = strayByTid.get(tid);
        if (!st) {
          st = {
            recording: recLabel,
            trackId: tid,
            label: `ID${tid}`,
            transferredTo: ak,
            events: 0,
            feedingS: 0,
            drinkingS: 0,
            inactiveS: 0,
            firstStartS: sS,
            lastEndS: eS,
            bouts: [],
          };
          strayByTid.set(tid, st);
        }
        st.events += 1;
        if (beh === 'feeding') st.feedingS += durS;
        else if (beh === 'drinking') st.drinkingS += durS;
        else if (beh === 'inactive') st.inactiveS += durS;
        st.firstStartS = Math.min(st.firstStartS, sS);
        st.lastEndS = Math.max(st.lastEndS, eS);
        const mm1 = Math.floor(sS / 60);
        const ss1 = Math.floor(sS % 60);
        const mm2 = Math.floor(eS / 60);
        const ss2 = Math.floor(eS % 60);
        st.bouts.push({
          behavior: beh,
          transferredTo: ak,
          startFrame: sf,
          endFrame: ef,
          startTime: `${String(hourNum).padStart(2, '0')}:${String(mm1).padStart(2, '0')}:${String(ss1).padStart(2, '0')}`,
          endTime: `${String(hourNum).padStart(2, '0')}:${String(mm2).padStart(2, '0')}:${String(ss2).padStart(2, '0')}`,
          durationS: Math.round(durS * 10) / 10,
        });
      }

      afterMap[ak].events += 1;
      afterMap[ak].seconds += durS;
      if (ak !== 'UNCONFIRMED') {
        confEvAfter += 1;
        confSAfter += durS;
      } else {
        unconfEvAfter += 1;
        unconfSAfter += durS;
      }
    }

    for (const st of Array.from(strayByTid.values()).sort((a, b) => a.trackId - b.trackId)) {
      const sortedBouts = [...st.bouts].sort((a, b) => a.startFrame - b.startFrame);
      const sampleBout = sortedBouts.reduce((best, b) => (!best || b.durationS > best.durationS ? b : best), null);
      const entry = {
        recording: st.recording,
        trackId: st.trackId,
        label: st.label,
        transferredTo: st.transferredTo,
        events: st.events,
        feedingS: Math.round(st.feedingS * 10) / 10,
        drinkingS: Math.round(st.drinkingS * 10) / 10,
        inactiveS: Math.round(st.inactiveS * 10) / 10,
        sampleBout,
        bouts: sortedBouts,
        firstStartS: Math.round(st.firstStartS * 10) / 10,
        lastEndS: Math.round(st.lastEndS * 10) / 10,
        spanS: Math.round(Math.max(0, st.lastEndS - st.firstStartS) * 10) / 10,
      };
      table3Transferred.push(entry);
      if (!DESIGNATED_SET.has(entry.transferredTo)) table3Remaining.push(entry);
    }

    idTable1.push({
      recording: recLabel,
      video: vidName,
      totalEvents: totalEv,
      confirmedEvents: confEvAfter,
      unconfirmedEvents: unconfEvAfter,
      unconfirmedPct: totalEv > 0 ? Math.round((unconfEvAfter / totalEv) * 10000) / 100 : 0,
      confirmedSeconds: Math.round(confSAfter * 10) / 10,
      unconfirmedSeconds: Math.round(unconfSAfter * 10) / 10,
      strayTrackIdsBefore: strayByTid.size,
      strayTrackIdsAfter: Array.from(strayByTid.values()).filter((s) => !DESIGNATED_SET.has(s.transferredTo)).length,
      beforeUnconfirmedEvents: unconfEvBefore,
      beforeUnconfirmedSeconds: Math.round(unconfSBefore * 10) / 10,
    });
  }

  const t1TotalEv = idTable1.reduce((s, r) => s + r.totalEvents, 0);
  const t1ConfEv = idTable1.reduce((s, r) => s + r.confirmedEvents, 0);
  const t1UnconfEv = idTable1.reduce((s, r) => s + r.unconfirmedEvents, 0);
  const t2Rows = (['H1', 'H2', 'H3', 'H4', 'H5', 'R1', 'UNCONFIRMED'] as const).map((k) => {
    const ae = afterMap[k].events;
    const as_ = Math.round(afterMap[k].seconds * 10) / 10;
    const be = beforeMap[k].events;
    const bs = Math.round(beforeMap[k].seconds * 10) / 10;
    return {
      chicken: k === 'UNCONFIRMED' ? 'Unconfirmed (ID7 and above)' : k,
      key: k,
      afterEvents: ae,
      afterSeconds: as_,
      beforeEvents: be,
      beforeSeconds: bs,
      changeEvents: ae - be,
      changeSeconds: Math.round((as_ - bs) * 10) / 10,
    };
  });
  const t2Total = {
    chicken: 'All chickens (total)',
    key: 'TOTAL',
    afterEvents: t2Rows.reduce((s, r) => s + r.afterEvents, 0),
    afterSeconds: Math.round(t2Rows.reduce((s, r) => s + r.afterSeconds, 0) * 10) / 10,
    beforeEvents: t2Rows.reduce((s, r) => s + r.beforeEvents, 0),
    beforeSeconds: Math.round(t2Rows.reduce((s, r) => s + r.beforeSeconds, 0) * 10) / 10,
    changeEvents: t2Rows.reduce((s, r) => s + r.changeEvents, 0),
    changeSeconds: Math.round(t2Rows.reduce((s, r) => s + r.changeSeconds, 0) * 10) / 10,
  };

  const identityDistribution = {
    result:
      t1UnconfEv === 0
        ? 'PASS — All unconfirmed tracks transferred to designated chickens (0 unconfirmed events remaining)'
        : `REVIEW — ${t1UnconfEv} unconfirmed events remain`,
    passed: t1UnconfEv === 0 && t2Total.changeEvents === 0,
    table1: idTable1,
    table1Total: {
      recording: 'Total',
      totalEvents: t1TotalEv,
      confirmedEvents: t1ConfEv,
      unconfirmedEvents: t1UnconfEv,
      unconfirmedPct: t1TotalEv > 0 ? Math.round((t1UnconfEv / t1TotalEv) * 10000) / 100 : 0,
      confirmedSeconds: Math.round(idTable1.reduce((s, r) => s + r.confirmedSeconds, 0) * 10) / 10,
      unconfirmedSeconds: Math.round(idTable1.reduce((s, r) => s + r.unconfirmedSeconds, 0) * 10) / 10,
      strayTrackIdsBefore: idTable1.reduce((s, r) => s + r.strayTrackIdsBefore, 0),
      strayTrackIdsAfter: idTable1.reduce((s, r) => s + r.strayTrackIdsAfter, 0),
      beforeUnconfirmedEvents: beforeMap.UNCONFIRMED.events,
      beforeUnconfirmedSeconds: Math.round(beforeMap.UNCONFIRMED.seconds * 10) / 10,
    },
    table2: t2Rows,
    table2Total: t2Total,
    table3Remaining,
    table3Transferred,
  };

  return NextResponse.json(
    {
      success: true,
      generatedAt: new Date().toISOString(),
      selectedVideo,
      availableVideos,
      videoCount: blocks.length,
      date: blocks[0]?.date || '2026-11-17',
      summary: {
        ...totals,
        ...summaryMetrics,
      },
      blocks,
      combinedBirds,
      identityDistribution,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
