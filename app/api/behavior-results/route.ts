import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';
import initSqlJs from 'sql.js';
import { createClient } from '@supabase/supabase-js';
import { formatShortDay, normalizeIsoDate } from '@/lib/date-range';
import { averageAvailableSensorValues } from '@/lib/telemetry-averages';
import { SUPABASE_SENSOR_URL, SUPABASE_SENSOR_ANON_KEY } from '@/lib/supabase-sensor';
import {
  getArchivedDateCutoffs,
  getArchivedDatesSet,
  isItemArchivedByDate,
  parseTimestampMs,
  syncManifestFromCloud,
} from '@/lib/data-archive';
import { downloadStorageFile, listStorageFiles, listSyncedDatabases } from '@/lib/supabase-storage';
import {
  buildStrictIdentityTransferMap,
  resolveStrictBirdDef,
  SHORT_ID_TO_CANONICAL_LABEL,
} from '@/lib/strict-identity-transfer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import {
  BirdBehaviorCounts,
  IntervalTelemetry,
  getCachedIntervals,
  setCachedIntervals,
} from '@/lib/behavior-cache';

const BIRD_LABEL_TO_ID: Record<string, string> = {
  'Hen1 (Yellow)': 'hen1_yellow',
  'Hen2 (Blue)': 'hen2_blue',
  'Hen3 (Red)': 'hen3_red',
  'Hen4 (White)': 'hen4_white',
  'Hen5 (YellowGreen)': 'hen5_yellowgreen',
  'Saddle_Yellow(Hen1)': 'hen1_yellow',
  'Saddle_Blue(Hen2)': 'hen2_blue',
  'Saddle_Red(Hen3)': 'hen3_red',
  'Saddle_White(Hen4)': 'hen4_white',
  'Saddle_YellowGreen(Hen5)': 'hen5_yellowgreen',
  'ID1_H1 Yellow': 'hen1_yellow',
  'ID2_H2 Blue': 'hen2_blue',
  'ID_3_H3 Red': 'hen3_red',
  'ID4_H4 White': 'hen4_white',
  'ID5_H5 Yellow-Green': 'hen5_yellowgreen',
  // Older labels are folded into the same fixed flock IDs for historical reports.
  'Hen2 (Green)': 'hen2_blue',
  'Hen3 (Blue)': 'hen3_red',
  'Hen4 (Bluegreen)': 'hen4_white',
  'Saddle_Green(Hen2)': 'hen2_blue',
  'Saddle_Blue(Hen3)': 'hen3_red',
  'Saddle_Bluegreen(Hen4)': 'hen4_white',
  'Hen1 (Green)': 'hen1_yellow',
  'Hen2 (White)': 'hen2_blue',
  'Hen4 (Yellow)': 'hen4_white',
  'Hen5 (Pink)': 'hen5_yellowgreen',
  'Rooster': 'rooster',
  'ID6_R1 Rooster': 'rooster',
  'Chicken': 'chicken_orange',
  'Chicken (Unidentified)': 'chicken_orange',
  'ID7_Chicken(Unidentified)': 'chicken_orange',
};

function computeThi(tempC: number, rhPct: number): number {
  return Math.round((0.8 * tempC + (rhPct / 100.0) * (tempC - 14.4) + 46.4) * 10) / 10;
}

function classifyHeatStress(thi: number): 'Normal' | 'Moderate' | 'Severe' | 'Emergency' {
  if (thi >= 84.0) return 'Emergency';
  if (thi >= 79.0) return 'Severe';
  if (thi >= 74.0) return 'Moderate';
  return 'Normal';
}

function formatDateLabel(dateStr: string): string {
  const normalized = normalizeIsoDate(dateStr) ?? dateStr;
  return formatShortDay(normalized);
}

function formatFullTimeLabel(dateStr: string, timeSlot: string): string {
  const normalized = normalizeIsoDate(dateStr) ?? dateStr;
  const dateLbl = formatShortDay(normalized);
  const year = normalized.slice(0, 4);
  if (timeSlot === '00:00') {
    return `${dateLbl} ${year} · 12:00 AM – 06:00 AM`;
  } else if (timeSlot === '06:00') {
    return `${dateLbl} ${year} · 06:00 AM – 12:00 PM`;
  } else if (timeSlot === '12:00') {
    return `${dateLbl} ${year} · 12:00 PM – 06:00 PM`;
  } else if (timeSlot === '18:00') {
    return `${dateLbl} ${year} · 06:00 PM – 12:00 AM`;
  }
  return `${dateLbl} ${year} · ${timeSlot}`;
}


interface SessionTimeSlot {
  hour: number;
  minute: number;
  folderName?: string;
}

/**
 * Parses paired video/sensor folder names such as:
 *   rec_2026-10-20_09-00-00_000000
 *   rec_2026 - 10-20_09-00-00_000000
 */
function parseRecFolderDateTime(raw: string): { date: string; hour: number; minute: number; folderName: string } | null {
  if (!raw) return null;
  const m = raw.match(/rec[_\s-]*(\d{4})\s*-\s*(\d{2})\s*-\s*(\d{2})[_\s]+(\d{2})\s*-\s*(\d{2})(?:\s*-\s*(\d{2}))?(?:[_\s]+\d+)?/i);
  if (!m) return null;
  const year = m[1];
  const month = m[2];
  const day = m[3];
  const hour = Number.parseInt(m[4], 10);
  const minute = Number.parseInt(m[5], 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
    folderName: m[0].trim(),
  };
}

function addSessionTime(
  map: Map<string, Map<string, SessionTimeSlot>>,
  date: string,
  hour: number,
  minute: number,
  folderName?: string,
) {
  if (!date || hour < 0 || hour > 23 || minute < 0 || minute > 59) return;
  let dayMap = map.get(date);
  if (!dayMap) {
    dayMap = new Map();
    map.set(date, dayMap);
  }
  const key = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const existing = dayMap.get(key);
  if (!existing || (folderName && !existing.folderName)) {
    dayMap.set(key, { hour, minute, folderName });
  }
}

async function loadAnalyticsDbData() {
  const candidateDbPaths = [
    path.join(os.tmpdir(), 'zampen_analytics.db'),
    path.join(process.cwd(), 'analytics', 'zampen_analytics.db'),
  ].filter((p) => fs.existsSync(p));

  if (candidateDbPaths.length === 0) {
    return {
      metrics: [] as unknown[][],
      birdsByChunk: new Map<number, Record<string, BirdBehaviorCounts>>(),
    };
  }

  // Pick the most recently updated database file so a stale /tmp copy never masks fresh analytics
  candidateDbPaths.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const dbPath = candidateDbPaths[0];

  const SQL = await initSqlJs();
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);

  try {
    const metricsRes = db.exec(`
      SELECT hm.id, hm.date_slot, hm.hour_slot, hm.temp_avg_c, hm.humidity_avg_pct,
             hm.ammonia_ppm_avg, hm.thi_avg, hm.sensor_data_available,
             pj.video_path, pj.video_filename, pj.completed_at, hm.created_at
      FROM half_hour_metrics hm
      LEFT JOIN processing_jobs pj ON pj.id = hm.job_id
      ORDER BY hm.date_slot ASC, hm.hour_slot ASC
    `);

    const birdsRes = db.exec(`
      SELECT chunk_metric_id, bird_label,
             sum(reduced_eating_flag) as red_eat,
             sum(case when feeding_bouts = 0 and feeding_s < 1.0 then 1 else 0 end) as low_feed,
             sum(case when drinking_bouts = 0 and drinking_s < 1.0 then 1 else 0 end) as low_drink,
             sum(is_lethargic) as leth,
             sum(case when inactivity_s > 60.0 then 1 else 0 end) as inact,
             sum(pecking_aggressor_count) as isolation_events
      FROM bird_track_metrics
      GROUP BY chunk_metric_id, bird_label
    `);

    const metrics = metricsRes?.[0]?.values || [];
    const birds = birdsRes?.[0]?.values || [];
    const birdsByChunk = new Map<number, Record<string, BirdBehaviorCounts>>();
    for (const row of birds) {
      const [chunkId, label, redEat, lowFeed, lowDrink, leth, inact, isoEvents] = row as [
        number, string, number, number, number, number, number, number
      ];
      const birdId = BIRD_LABEL_TO_ID[label];
      if (!birdId) continue;

      if (!birdsByChunk.has(chunkId)) birdsByChunk.set(chunkId, {});
      const feedCount = Math.max(Number(redEat) || 0, Number(lowFeed) || 0);
      const drinkCount = Number(lowDrink) || 0;
      const locomotorCount = Math.max(Number(leth) || 0, Number(inact) || 0);
      const isolationCount = Number(isoEvents) || 0;

      birdsByChunk.get(chunkId)![birdId] = {
        reducedFeeding: feedCount,
        reducedDrinking: drinkCount,
        prolongedInactivity: locomotorCount,
        reducedLocomotor: locomotorCount,
        featherPecking: isolationCount,
        socialIsolation: isolationCount,
      };
    }

    return { metrics, birdsByChunk };
  } finally {
    db.close();
  }
}

async function loadSupabaseSlotAverages(dateStr: string, startH: number, endH: number) {
  try {
    const serviceRoleKey = process.env.SUPABASE_SENSOR_SERVICE_ROLE_KEY?.trim();
    const activeKey = serviceRoleKey || SUPABASE_SENSOR_ANON_KEY;
    const client = createClient(SUPABASE_SENSOR_URL, activeKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const startIso = `${dateStr}T${String(startH).padStart(2, '0')}:00:00.000Z`;
    const endIso = `${dateStr}T${String(endH - 1).padStart(2, '0')}:59:59.999Z`;

    const { data, error } = await client
      .from('sensor_logs')
      .select('temperature, humidity, ammonia_ppm, sound_db')
      .gte('recorded_at', startIso)
      .lte('recorded_at', endIso)
      .limit(200);

    if (error) {
      console.warn(`Supabase slot average failed for ${dateStr} [${startH}-${endH}]:`, error.message);
      return null;
    }

    if (data && data.length > 0) {
      const average = (values: Array<number | null>) => averageAvailableSensorValues(values);
      const round = (value: number | null, digits: number) =>
        value === null ? null : Number(value.toFixed(digits));

      return {
        tempC: round(average(data.map((d) => d.temperature)), 1),
        humidityPct: round(average(data.map((d) => d.humidity)), 1),
        ammoniaPpm: round(average(data.map((d) => d.ammonia_ppm)), 5),
        soundDb: round(average(data.map((d) => d.sound_db)), 1),
      };
    }
  } catch (err) {
    console.warn(`Supabase slot average failed for ${dateStr} [${startH}-${endH}]:`, err);
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const reqDate = searchParams.get('date');
    const reqStartDate = searchParams.get('startDate');
    const reqEndDate = searchParams.get('endDate');
    const forceRefresh = searchParams.get('refresh') === 'true';

    await syncManifestFromCloud();
    const archivedSet = getArchivedDatesSet();
    const archivedCutoffs = getArchivedDateCutoffs();

    const now = Date.now();
    let intervals: IntervalTelemetry[] = [];

    const cached = getCachedIntervals(forceRefresh);
    if (cached) {
      intervals = cached;
    } else {
      let analyticsData: { metrics: unknown[][]; birdsByChunk: Map<number, Record<string, BirdBehaviorCounts>> } = {
        metrics: [],
        birdsByChunk: new Map(),
      };
      try {
        analyticsData = await loadAnalyticsDbData();
      } catch (dbErr) {
        console.warn('Local zampen_analytics.db unavailable; falling back to Supabase Storage summaries:', dbErr);
      }
      const dbVideoNames = new Set<string>();
      const grouped = new Map<string, {
        date: string;
        slot: string;
        startHour: number;
        endHour: number;
        tempValues: unknown[];
        humidityValues: unknown[];
        ammoniaValues: unknown[];
        thiValues: unknown[];
        behaviorsByBird: Record<string, BirdBehaviorCounts>;
      }>();

      for (const metricRow of analyticsData.metrics) {
        const [
          chunkId,
          rawDate,
          hourSlot,
          tempAvg,
          humidityAvg,
          ammoniaAvg,
          thiAvg,
          sensorDataAvailable,
          ,
          rawVideoFilename,
          rawCompletedAt,
          rawChunkCreatedAt,
        ] = metricRow as [number, string, string, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown];
        const date = normalizeIsoDate(rawDate);
        const hour = Number.parseInt(hourSlot, 10);
        if (!date || !Number.isInteger(hour) || hour < 0 || hour >= 24) continue;
        const chunkMs = parseTimestampMs(String(rawCompletedAt || rawChunkCreatedAt || ''));
        if (isItemArchivedByDate(date, chunkMs, archivedCutoffs)) continue;
        if (rawVideoFilename) dbVideoNames.add(String(rawVideoFilename));

        const startHour = hour < 6 ? 0 : hour < 12 ? 6 : hour < 18 ? 12 : 18;
        const slot = `${String(startHour).padStart(2, '0')}:00`;
        const key = `${date}_${slot}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            date,
            slot,
            startHour,
            endHour: startHour + 6,
            tempValues: [],
            humidityValues: [],
            ammoniaValues: [],
            thiValues: [],
            behaviorsByBird: {},
          });
        }

        const interval = grouped.get(key)!;
        if (Number(sensorDataAvailable)) {
          interval.tempValues.push(tempAvg);
          interval.humidityValues.push(humidityAvg);
          interval.ammoniaValues.push(ammoniaAvg);
          interval.thiValues.push(thiAvg);
        }

        const chunkBirds = analyticsData.birdsByChunk.get(Number(chunkId));
        if (!chunkBirds) continue;
        for (const [birdId, counts] of Object.entries(chunkBirds)) {
          const current = interval.behaviorsByBird[birdId] ??= {
            reducedFeeding: 0,
            reducedDrinking: 0,
            prolongedInactivity: 0,
            featherPecking: 0,
            socialIsolation: 0,
            reducedLocomotor: 0,
          };
          current.reducedFeeding += counts.reducedFeeding;
          current.reducedDrinking += counts.reducedDrinking;
          current.prolongedInactivity += counts.prolongedInactivity;
          current.featherPecking += counts.featherPecking;
          current.socialIsolation += counts.socialIsolation ?? counts.featherPecking;
          current.reducedLocomotor += counts.reducedLocomotor ?? counts.prolongedInactivity;
        }
      }

      // Real-time cloud & local frame-log merge: prefer tiny (~2 KB) behavior_summary_<video>.json
      // sidecars to avoid downloading 3.2 MB frame_logs on every rebuild, with 100% lossless
      // fallback to full frame_log_<video>.json if a sidecar does not exist yet.
      const liveLogs = new Map<string, { localPath?: string; summaryCloudKey?: string; cloudKey?: string; uploadedAt?: string; updatedMs: number }>();
      const localFlDir = path.join(process.cwd(), 'local-storage', 'results', 'frame_logs');
      if (fs.existsSync(localFlDir)) {
        try {
          for (const fname of fs.readdirSync(localFlDir)) {
            if (!fname.endsWith('.json')) continue;
            const vid = fname.replace(/^frame_log_/, '').replace(/\.json$/i, '');
            const fullPath = path.join(localFlDir, fname);
            const mtimeMs = fs.statSync(fullPath).mtimeMs || 0;
            if (vid) liveLogs.set(vid, { localPath: fullPath, updatedMs: mtimeMs });
          }
        } catch {}
      }
      try {
        const [summaryFiles, frameLogFiles] = await Promise.all([
          listStorageFiles('results', 'behavior_summary_'),
          listStorageFiles('results', 'frame_log_'),
        ]);
        for (const cf of summaryFiles) {
          const base = (cf.pathname || cf.storagePath || '').split('/').pop() || '';
          if (!base.startsWith('behavior_summary_') || !base.endsWith('.json')) continue;
          const vid = base.slice('behavior_summary_'.length, -'.json'.length);
          if (!vid) continue;
          const upMs = cf.uploadedAt ? Date.parse(cf.uploadedAt) || 0 : 0;
          const prev = liveLogs.get(vid);
          liveLogs.set(vid, {
            ...prev,
            summaryCloudKey: cf.storagePath || `results/${base}`,
            uploadedAt: cf.uploadedAt || prev?.uploadedAt,
            updatedMs: Math.max(prev?.updatedMs || 0, upMs),
          });
        }
        for (const cf of frameLogFiles) {
          const base = (cf.pathname || cf.storagePath || '').split('/').pop() || '';
          if (!base.startsWith('frame_log_') || !base.endsWith('.json')) continue;
          const vid = base.slice('frame_log_'.length, -'.json'.length);
          if (!vid) continue;
          const upMs = cf.uploadedAt ? Date.parse(cf.uploadedAt) || 0 : 0;
          const prev = liveLogs.get(vid);
          liveLogs.set(vid, {
            ...prev,
            localPath: prev?.localPath,
            cloudKey: cf.storagePath || `results/${base}`,
            uploadedAt: cf.uploadedAt || prev?.uploadedAt,
            updatedMs: Math.max(prev?.updatedMs || 0, upMs),
          });
        }
      } catch {}

      for (const [vid, meta] of Array.from(liveLogs.entries())) {
        if (dbVideoNames.has(vid)) continue;
        // Skip archived dates BEFORE downloading anything from Supabase Storage!
        const preRec = parseRecFolderDateTime(vid);
        if (preRec?.date && isItemArchivedByDate(preRec.date, meta.updatedMs, archivedCutoffs)) {
          continue;
        }
        let rawText: string | null = null;
        if (meta.localPath && fs.existsSync(meta.localPath)) {
          try { rawText = fs.readFileSync(meta.localPath, 'utf-8'); } catch {}
        }
        if (!rawText && meta.summaryCloudKey) {
          try { rawText = await (await downloadStorageFile(meta.summaryCloudKey)).text(); } catch {}
        }
        if (!rawText && meta.cloudKey) {
          try { rawText = await (await downloadStorageFile(meta.cloudKey)).text(); } catch {}
        }
        if (!rawText) continue;
        try {
          const fl = JSON.parse(rawText);
          const parsedRec = parseRecFolderDateTime(String(fl.video || vid));
          const rawStart = String(fl.start_time || meta.uploadedAt || '');
          const isoDate = parsedRec?.date || normalizeIsoDate(rawStart.slice(0, 10));
          if (!isoDate) continue;
          if (isItemArchivedByDate(isoDate, meta.updatedMs, archivedCutoffs)) continue;
          let hour = parsedRec?.hour ?? 8;
          if (!parsedRec && rawStart.length >= 13) {
            const hParsed = Number.parseInt(rawStart.slice(11, 13), 10);
            if (Number.isInteger(hParsed) && hParsed >= 0 && hParsed < 24) hour = hParsed;
          }
          const startHour = hour < 6 ? 0 : hour < 12 ? 6 : hour < 18 ? 12 : 18;
          const slot = `${String(startHour).padStart(2, '0')}:00`;
          const key = `${isoDate}_${slot}`;
          if (!grouped.has(key)) {
            grouped.set(key, {
              date: isoDate,
              slot,
              startHour,
              endHour: startHour + 6,
              tempValues: [],
              humidityValues: [],
              ammoniaValues: [],
              thiValues: [],
              behaviorsByBird: {},
            });
          }
          const interval = grouped.get(key)!;
          const { trackToDesignated } = buildStrictIdentityTransferMap(fl);
          const resolveIntervalBirdId = (rawLbl: string, tid: number) => {
            const { def } = resolveStrictBirdDef(rawLbl, tid, trackToDesignated);
            const canonical = SHORT_ID_TO_CANONICAL_LABEL[def.shortId] || rawLbl;
            return BIRD_LABEL_TO_ID[canonical] || BIRD_LABEL_TO_ID[rawLbl] || 'chicken_orange';
          };
          if (Array.isArray(fl.bird_records) && fl.bird_records.length > 0) {
            for (const br of fl.bird_records) {
              const birdId = resolveIntervalBirdId(String(br.bird_label || ''), Number(br.track_id));
              const cur = interval.behaviorsByBird[birdId] ??= {
                reducedFeeding: 0,
                reducedDrinking: 0,
                prolongedInactivity: 0,
                featherPecking: 0,
                socialIsolation: 0,
                reducedLocomotor: 0,
              };
              const feedFlag = Number(br.reduced_feeding_flag) || Number(br.reduced_eating_flag) || 0;
              const drinkFlag = Number(br.reduced_drinking_flag) || 0;
              const locoFlag = Number(br.is_reduced_locomotor) || Number(br.is_lethargic) || 0;
              const isoEvents = Number(br.social_isolation_events) || 0;
              cur.reducedFeeding += feedFlag;
              cur.reducedDrinking += drinkFlag;
              cur.prolongedInactivity += locoFlag;
              cur.reducedLocomotor += locoFlag;
              cur.featherPecking += isoEvents;
              cur.socialIsolation += isoEvents;
            }
          } else if (Array.isArray(fl.behavior_events)) {
            for (const ev of fl.behavior_events) {
              const birdId = resolveIntervalBirdId(String(ev.bird_label || ''), Number(ev.track_id));
              const cur = interval.behaviorsByBird[birdId] ??= {
                reducedFeeding: 0,
                reducedDrinking: 0,
                prolongedInactivity: 0,
                featherPecking: 0,
                socialIsolation: 0,
                reducedLocomotor: 0,
              };
              const beh = String(ev.behavior || '').toLowerCase();
              if (beh === 'inactive') {
                cur.prolongedInactivity += 1;
                cur.reducedLocomotor += 1;
              } else if (beh === 'social_isolation') {
                cur.socialIsolation += 1;
                cur.featherPecking += 1;
              }
            }
          }
        } catch {}
      }

      const builtIntervals: IntervalTelemetry[] = [];
      for (const group of Array.from(grouped.values())) {
        const sensorAvg = await loadSupabaseSlotAverages(group.date, group.startHour, group.endHour);
        const tempC = sensorAvg?.tempC ?? averageAvailableSensorValues(group.tempValues);
        const humidityPct = sensorAvg?.humidityPct ?? averageAvailableSensorValues(group.humidityValues);
        const ammoniaPpm = sensorAvg?.ammoniaPpm ?? averageAvailableSensorValues(group.ammoniaValues);
        const storedThi = averageAvailableSensorValues(group.thiValues);
        const thi = tempC !== null && humidityPct !== null
          ? computeThi(tempC, humidityPct)
          : storedThi;
        const heatStress = thi === null ? 'Unavailable' : classifyHeatStress(thi);

        builtIntervals.push({
          id: `int_${group.date.replace(/-/g, '_')}_${group.slot.replace(':', '')}`,
          date: group.date,
          dateLabel: formatDateLabel(group.date),
          timeSlot: group.slot,
          intervalLabel: `${formatDateLabel(group.date)} · ${group.slot}`,
          fullTimeLabel: formatFullTimeLabel(group.date, group.slot),
          tempC,
          humidityPct,
          ammoniaPpm,
          soundDb: sensorAvg?.soundDb ?? null,
          thi,
          heatStress,
          behaviorsByBird: group.behaviorsByBird,
        });
      }

      builtIntervals.sort((a, b) => a.date.localeCompare(b.date) || a.timeSlot.localeCompare(b.timeSlot));

      setCachedIntervals(builtIntervals);
      intervals = builtIntervals;
    }

    // Active intervals are already filtered per-chunk/per-log against archivedCutoffs
    // (so pre-wipe dates stay hidden while post-wipe freshly processed videos appear immediately)
    const activeIntervals = intervals;

    // Apply query filters if requested
    const normalizedReqDate = reqDate ? normalizeIsoDate(reqDate) : null;
    const normalizedStartDate = reqStartDate ? normalizeIsoDate(reqStartDate) : null;
    const normalizedEndDate = reqEndDate ? normalizeIsoDate(reqEndDate) : null;

    let filtered = activeIntervals;
    if (normalizedReqDate) {
      filtered = filtered.filter((i) => i.date === normalizedReqDate);
    } else if (normalizedStartDate && normalizedEndDate) {
      filtered = filtered.filter((i) => i.date >= normalizedStartDate && i.date <= normalizedEndDate);
    }

    const availableDates = Array.from(new Set(activeIntervals.map((i) => i.date))).sort().reverse();

    // Build per-date session time slots from paired video/data-sensor folders (rec_YYYY-MM-DD_HH-MM-SS_...)
    const sessionTimesMap = new Map<string, Map<string, SessionTimeSlot>>();
    try {
      const syncedDbs = await listSyncedDatabases({ includeArchived: false });
      for (const dbMeta of syncedDbs) {
        const candidates = [dbMeta.sessionFolder, dbMeta.pathname, dbMeta.storagePath, dbMeta.localPath];
        for (const cand of candidates) {
          if (!cand) continue;
          const parsed = parseRecFolderDateTime(cand);
          if (parsed) {
            addSessionTime(sessionTimesMap, parsed.date, parsed.hour, parsed.minute, parsed.folderName);
            break;
          }
        }
      }
    } catch (err) {
      console.warn('Could not list paired sensor session folders for behavior chart times:', err);
    }

    try {
      const analyticsForTimes = await loadAnalyticsDbData();
      for (const row of analyticsForTimes.metrics) {
        const rawDate = String(row[1] || '');
        const hourSlot = String(row[2] || '');
        const videoPath = String(row[8] || '');
        const videoFilename = String(row[9] || '');
        const parsedFolder = parseRecFolderDateTime(videoPath) || parseRecFolderDateTime(videoFilename);
        if (parsedFolder) {
          addSessionTime(sessionTimesMap, parsedFolder.date, parsedFolder.hour, parsedFolder.minute, parsedFolder.folderName);
        } else {
          const normDate = normalizeIsoDate(rawDate);
          const h = Number.parseInt(hourSlot, 10);
          if (normDate && Number.isInteger(h) && h >= 0 && h < 24 && !sessionTimesMap.has(normDate)) {
            addSessionTime(sessionTimesMap, normDate, h, 0);
          }
        }
      }
    } catch {
      // Non-fatal: paired sensor folders still populate sessionTimesMap
    }

    const sessionTimesByDate: Record<string, SessionTimeSlot[]> = {};
    for (const [d, slotMap] of Array.from(sessionTimesMap.entries())) {
      sessionTimesByDate[d] = Array.from(slotMap.values()).sort(
        (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute),
      );
    }

    return NextResponse.json(
      {
        success: true,
        source: 'zampen_analytics.db + Supabase sensor_logs',
        count: filtered.length,
        availableDates,
        archivedDates: Array.from(archivedSet),
        sessionTimesByDate,
        intervals: filtered,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load behavior analytics from zampen_analytics.db',
        count: 0,
        availableDates: [],
        archivedDates: Array.from(getArchivedDatesSet()),
        intervals: [],
      },
      { status: 500 },
    );
  }
}
