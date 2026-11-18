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
  dateLabel: string;
  timeSlot: string;
  intervalLabel: string;
  fullTimeLabel: string;
  tempC: number | null;
  humidityPct: number | null;
  ammoniaPpm: number | null;
  soundDb: number | null;
  thi: number | null;
  heatStress: 'Normal' | 'Moderate' | 'Severe' | 'Emergency' | 'Unavailable';
  behaviorsByBird: Record<string, BirdBehaviorCounts>;
}

let cachedIntervals: IntervalTelemetry[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute

export function getCachedIntervals(forceRefresh = false): IntervalTelemetry[] | null {
  if (forceRefresh) return null;
  const now = Date.now();
  if (cachedIntervals && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedIntervals;
  }
  return null;
}

export function setCachedIntervals(intervals: IntervalTelemetry[]): void {
  cachedIntervals = intervals;
  lastCacheTime = Date.now();
}

export function clearBehaviorResultsCache(): void {
  cachedIntervals = null;
  lastCacheTime = 0;
}
