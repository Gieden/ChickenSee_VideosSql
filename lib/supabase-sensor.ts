import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_SENSOR_URL: string =
  process.env.NEXT_PUBLIC_SUPABASE_SENSOR_URL || 'https://aoskfztsusjucgwdhtmc.supabase.co';

export const SUPABASE_SENSOR_ANON_KEY: string =
  process.env.NEXT_PUBLIC_SUPABASE_SENSOR_ANON_KEY || 'sb_publishable_D56jgW8116Z6v9n19vbmlQ_tkjzllDN';


export interface SensorLogRow {
  id: number;
  recorded_at: string;
  temperature: number | null;
  humidity: number | null;
  ammonia_ppm: number | null;
  ammonia_raw?: number | null;
  sound_db: number | null;
  sound_raw?: number | null;
  temp_status?: number | null;
  hum_status?: number | null;
  ammonia_status?: number | null;
  sound_status?: number | null;
}

export type HeatStressLevel = 'Normal' | 'Moderate' | 'Severe' | 'Emergency' | 'Unavailable';

export interface EnrichedSensorReading extends SensorLogRow {
  thi: number | null;
  heatStressLevel: HeatStressLevel;
  formattedTime: string;
  relativeTime: string;
}

export interface SensorTelemetrySummary {
  totalRecords: number;
  latest: EnrichedSensorReading | null;
  temp: {
    current: number | null;
    avg: number | null;
    min: number | null;
    max: number | null;
  };
  humidity: {
    current: number | null;
    avg: number | null;
    min: number | null;
    max: number | null;
  };
  ammonia: {
    current: number | null;
    avg: number | null;
    max: number | null;
  };
  sound: {
    current: number | null;
    avg: number | null;
    max: number | null;
  };
  thi: {
    current: number | null;
    avg: number | null;
    heatStressLevel: HeatStressLevel;
  };
}

let clientInstance: SupabaseClient | null = null;

export function getSupabaseSensorClient(): SupabaseClient {
  if (!clientInstance) {
    clientInstance = createClient(SUPABASE_SENSOR_URL, SUPABASE_SENSOR_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
  }
  return clientInstance;
}

export function calculateTHI(tempC: number | null | undefined, humidityPct: number | null | undefined): number | null {
  if (tempC === null || tempC === undefined || humidityPct === null || humidityPct === undefined) {
    return null;
  }
  const t = Number(tempC);
  const h = Number(humidityPct);
  if (isNaN(t) || isNaN(h)) return null;
  const thi = 0.8 * t + (h / 100.0) * (t - 14.4) + 46.4;
  return Math.round(thi * 10) / 10;
}

export function getHeatStressLevel(thi: number | null | undefined): HeatStressLevel {
  if (thi === null || thi === undefined || isNaN(thi)) return 'Unavailable';
  if (thi >= 84.0) return 'Emergency';
  if (thi >= 79.0) return 'Severe';
  if (thi >= 74.0) return 'Moderate';
  return 'Normal';
}

export function formatRelativeTime(dateString: string): string {
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return 'Recently';
    const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (diffSec < 5) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Recently';
  }
}

export function enrichSensorReading(row: SensorLogRow): EnrichedSensorReading {
  const thi = calculateTHI(row.temperature, row.humidity);
  const heatStressLevel = getHeatStressLevel(thi);
  const d = new Date(row.recorded_at);
  const formattedTime = !isNaN(d.getTime())
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : String(row.recorded_at);

  return {
    ...row,
    thi,
    heatStressLevel,
    formattedTime,
    relativeTime: formatRelativeTime(row.recorded_at),
  };
}

export function computeTelemetrySummary(readings: EnrichedSensorReading[]): SensorTelemetrySummary {
  if (!readings || readings.length === 0) {
    return {
      totalRecords: 0,
      latest: null,
      temp: { current: null, avg: null, min: null, max: null },
      humidity: { current: null, avg: null, min: null, max: null },
      ammonia: { current: null, avg: null, max: null },
      sound: { current: null, avg: null, max: null },
      thi: { current: null, avg: null, heatStressLevel: 'Unavailable' },
    };
  }

  const latest = readings[0];
  const temps = readings.map((r) => r.temperature).filter((v): v is number => v !== null && !isNaN(v));
  const hums = readings.map((r) => r.humidity).filter((v): v is number => v !== null && !isNaN(v));
  const nh3s = readings.map((r) => r.ammonia_ppm).filter((v): v is number => v !== null && !isNaN(v));
  const sounds = readings.map((r) => r.sound_db).filter((v): v is number => v !== null && !isNaN(v));

  const avg = (arr: number[]) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);
  const min = (arr: number[]) => (arr.length ? Math.min(...arr) : null);
  const max = (arr: number[]) => (arr.length ? Math.max(...arr) : null);

  const tAvg = avg(temps);
  const hAvg = avg(hums);
  const thiAvg = calculateTHI(tAvg, hAvg);

  return {
    totalRecords: readings.length,
    latest,
    temp: {
      current: latest.temperature,
      avg: tAvg,
      min: min(temps),
      max: max(temps),
    },
    humidity: {
      current: latest.humidity,
      avg: hAvg,
      min: min(hums),
      max: max(hums),
    },
    ammonia: {
      current: latest.ammonia_ppm,
      avg: avg(nh3s),
      max: max(nh3s),
    },
    sound: {
      current: latest.sound_db,
      avg: avg(sounds),
      max: max(sounds),
    },
    thi: {
      current: latest.thi,
      avg: thiAvg,
      heatStressLevel: getHeatStressLevel(thiAvg),
    },
  };
}
