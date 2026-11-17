import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';
import { createClient } from '@supabase/supabase-js';
import { formatShortDay, normalizeIsoDate } from '@/lib/date-range';
import { averageAvailableSensorValues } from '@/lib/telemetry-averages';
import { SUPABASE_SENSOR_URL, SUPABASE_SENSOR_ANON_KEY } from '@/lib/supabase-sensor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface BirdBehaviorCounts {
  reducedFeeding: number;
  reducedDrinking: number;
  prolongedInactivity: number;
  featherPecking: number;
  socialIsolation: number;
  reducedLocomotor: number;
}

export interface IntervalTelemetry {
  id: string;
  date: string; // YYYY-MM-DD
  dateLabel: string; // e.g. "24 Oct"
  timeSlot: string; // e.g. "06:00"
  intervalLabel: string; // e.g. "24 Oct · 06:00"
  fullTimeLabel: string; // e.g. "24 Oct 2026 · 06:00 AM – 12:00 PM"
  tempC: number | null;
  humidityPct: number | null;
  ammoniaPpm: number | null;
  soundDb: number | null;
  thi: number | null;
  heatStress: 'Normal' | 'Moderate' | 'Severe' | 'Emergency' | 'Unavailable';
  behaviorsByBird: Record<string, BirdBehaviorCounts>;
}

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
  if (timeSlot === '06:00') {
    return `${dateLbl} ${year} · 06:00 AM – 12:00 PM`;
  } else if (timeSlot === '12:00') {
    return `${dateLbl} ${year} · 12:00 PM – 06:00 PM`;
  } else if (timeSlot === '18:00') {
    return `${dateLbl} ${year} · 06:00 PM – 12:00 AM`;
  }
  return `${dateLbl} ${year} · ${timeSlot}`;
}

// In-memory cache for fast repeated queries
let cachedIntervals: IntervalTelemetry[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute

async function loadAnalyticsDbData() {
  const dbPath = path.join(process.cwd(), 'analytics', 'zampen_analytics.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error('The behavior analytics database is not available.');
  }

  const SQL = await initSqlJs();
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);

  try {
    const metricsRes = db.exec(`
      SELECT id, date_slot, hour_slot, temp_avg_c, humidity_avg_pct,
             ammonia_ppm_avg, thi_avg, sensor_data_available
      FROM half_hour_metrics
      ORDER BY date_slot ASC, hour_slot ASC
    `);

    const birdsRes = db.exec(`
      SELECT chunk_metric_id, bird_label,
             sum(reduced_eating_flag) as red_eat,
             sum(case when feeding_bouts = 0 and feeding_s < 1.0 then 1 else 0 end) as low_feed,
             sum(case when drinking_bouts = 0 and drinking_s < 1.0 then 1 else 0 end) as low_drink,
             sum(is_lethargic) as leth,
             sum(case when inactivity_s > 60.0 then 1 else 0 end) as inact,
             sum(pecking_aggressor_count + pecking_victim_count) as pecking
      FROM bird_track_metrics
      GROUP BY chunk_metric_id, bird_label
    `);

    const metrics = metricsRes?.[0]?.values || [];
    const birds = birdsRes?.[0]?.values || [];
    const birdsByChunk = new Map<number, Record<string, BirdBehaviorCounts>>();
    for (const row of birds) {
      const [chunkId, label, redEat, lowFeed, lowDrink, leth, inact, pecking] = row as [
        number, string, number, number, number, number, number, number
      ];
      const birdId = BIRD_LABEL_TO_ID[label];
      if (!birdId) continue;

      if (!birdsByChunk.has(chunkId)) birdsByChunk.set(chunkId, {});
      const feedCount = Math.max(Number(redEat) || 0, Number(lowFeed) || 0);
      const drinkCount = Number(lowDrink) || 0;
      const locomotorCount = Math.max(Number(leth) || 0, Number(inact) || 0);
      const isolationCount = Number(pecking) || 0;

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

    const now = Date.now();
    let intervals: IntervalTelemetry[] = [];

    if (!forceRefresh && cachedIntervals && now - lastCacheTime < CACHE_TTL_MS) {
      intervals = cachedIntervals;
    } else {
      const analyticsData = await loadAnalyticsDbData();
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
        ] = metricRow as [number, string, string, unknown, unknown, unknown, unknown, unknown];
        const date = normalizeIsoDate(rawDate);
        const hour = Number.parseInt(hourSlot, 10);
        if (!date || !Number.isInteger(hour) || hour < 6 || hour >= 24) continue;

        const startHour = hour < 12 ? 6 : hour < 18 ? 12 : 18;
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

      cachedIntervals = builtIntervals;
      lastCacheTime = now;
      intervals = builtIntervals;
    }

    // Apply query filters if requested
    const normalizedReqDate = reqDate ? normalizeIsoDate(reqDate) : null;
    const normalizedStartDate = reqStartDate ? normalizeIsoDate(reqStartDate) : null;
    const normalizedEndDate = reqEndDate ? normalizeIsoDate(reqEndDate) : null;

    let filtered = intervals;
    if (normalizedReqDate) {
      filtered = filtered.filter((i) => i.date === normalizedReqDate);
    } else if (normalizedStartDate && normalizedEndDate) {
      filtered = filtered.filter((i) => i.date >= normalizedStartDate && i.date <= normalizedEndDate);
    }

    const availableDates = Array.from(new Set(intervals.map((i) => i.date))).sort().reverse();

    return NextResponse.json({
      success: true,
      source: 'zampen_analytics.db + Supabase sensor_logs',
      count: filtered.length,
      availableDates,
      intervals: filtered,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in /api/behavior-results:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
