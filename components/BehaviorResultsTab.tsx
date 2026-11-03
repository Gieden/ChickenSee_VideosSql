'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Bird,
  Calendar,
  Clock,
  Activity,
  Thermometer,
  Droplets,
  Wind,
  Radio,
  Download,
  Search,
  Filter,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Info,
  Check,
  Zap,
  Flame,
  Volume2,
  CalendarX2,
  Sparkles,
} from 'lucide-react';

import RangeAwareDatePicker from '@/components/RangeAwareDatePicker';
import {
  IsoDate,
  addDays,
  enumerateDates,
  formatLongDay,
  formatRange,
  formatShortDay,
  formatWeekdayDay,
  isAfterDate,
  rangeLength,
  relativeDayLabel,
  todayIso,
} from '@/lib/date-range';

export interface ChickenProfile {
  id: string;
  name: string;
  role: string;
  gender: string;
  tagColorName: string;
  tagColorHex: string;
  summaryText: string;
  behaviorDistribution: {
    reducedFeeding: number;
    reducedDrinking: number;
    prolongedInactivity: number;
    socialIsolation: number;
  };
  dominantBehavior: string;
}

export interface IntervalTelemetry {
  id: string;
  date: string; // YYYY-MM-DD
  dateLabel: string; // e.g. "24 Oct"
  timeSlot: string; // e.g. "06:00"
  intervalLabel: string; // e.g. "24 Oct · 06:00"
  fullTimeLabel: string; // e.g. "24 Oct 2026 · 06:00 AM – 12:00 PM"
  tempC: number;
  humidityPct: number;
  ammoniaPpm: number;
  soundDb: number;
  thi: number;
  heatStress: 'Normal' | 'Moderate' | 'Severe' | 'Emergency';
  // Per-bird behavior counts in this interval
  behaviorsByBird: Record<
    string,
    {
      reducedFeeding: number;
      reducedDrinking: number;
      prolongedInactivity: number;
      socialIsolation: number;
    }
  >;
}

// ── Profile definitions aligned strictly with system COLOR_MAP ──
// Rooster -> Red (#FF0000)
// Chicken -> Orange (#FFA500)
// Hen1 (Green) -> Green (#00FF00)
// Hen2 (White) -> White (#FFFFFF)
// Hen3 (Blue) -> Blue (#0000FF)
// Hen4 (Yellow) -> Yellow (#FFFF00)
// Hen5 (Pink) -> Pink (#FF69B4)
export const CHICKEN_PROFILES: ChickenProfile[] = [
  {
    id: 'hen1_green',
    name: 'Hen1 (Green)',
    role: 'Hen',
    gender: 'Female',
    tagColorName: 'Green tag',
    tagColorHex: '#00FF00',
    summaryText: 'All four behaviors present in the example; reduced feeding behavior is most frequent.',
    behaviorDistribution: {
      reducedFeeding: 32,
      reducedDrinking: 18,
      prolongedInactivity: 9,
      socialIsolation: 4,
    },
    dominantBehavior: 'Reduced feeding behavior',
  },
  {
    id: 'hen2_white',
    name: 'Hen2 (White)',
    role: 'Hen',
    gender: 'Female',
    tagColorName: 'White tag',
    tagColorHex: '#FFFFFF',
    summaryText: 'Reduced drinking behavior most frequent; feeding remained relatively steady.',
    behaviorDistribution: {
      reducedFeeding: 14,
      reducedDrinking: 28,
      prolongedInactivity: 8,
      socialIsolation: 3,
    },
    dominantBehavior: 'Reduced drinking behavior',
  },
  {
    id: 'hen3_blue',
    name: 'Hen3 (Blue)',
    role: 'Hen',
    gender: 'Female',
    tagColorName: 'Blue tag',
    tagColorHex: '#0000FF',
    summaryText: 'Occasional prolonged low activity; otherwise regular feeding and drinking.',
    behaviorDistribution: {
      reducedFeeding: 12,
      reducedDrinking: 11,
      prolongedInactivity: 22,
      socialIsolation: 5,
    },
    dominantBehavior: 'Prolonged low activity',
  },
  {
    id: 'hen4_yellow',
    name: 'Hen4 (Yellow)',
    role: 'Hen',
    gender: 'Female',
    tagColorName: 'Yellow tag',
    tagColorHex: '#FFFF00',
    summaryText: 'Brief reduced-feeding episodes; lower prolonged low activity.',
    behaviorDistribution: {
      reducedFeeding: 19,
      reducedDrinking: 10,
      prolongedInactivity: 6,
      socialIsolation: 2,
    },
    dominantBehavior: 'Reduced feeding episodes',
  },
  {
    id: 'hen5_pink',
    name: 'Hen5 (Pink)',
    role: 'Hen',
    gender: 'Female',
    tagColorName: 'Pink tag',
    tagColorHex: '#FF69B4',
    summaryText: 'Intermittent reduced drinking behavior and prolonged low activity during the window.',
    behaviorDistribution: {
      reducedFeeding: 11,
      reducedDrinking: 20,
      prolongedInactivity: 19,
      socialIsolation: 6,
    },
    dominantBehavior: 'Reduced drinking & inactivity',
  },
  {
    id: 'rooster',
    name: 'Rooster',
    role: 'Rooster',
    gender: 'Male',
    tagColorName: 'Red tag',
    tagColorHex: '#FF0000',
    summaryText: 'Prolonged low activity episodes between otherwise active periods; dominant vocalizations.',
    behaviorDistribution: {
      reducedFeeding: 8,
      reducedDrinking: 9,
      prolongedInactivity: 26,
      socialIsolation: 7,
    },
    dominantBehavior: 'Prolonged low activity episodes',
  },
  {
    id: 'chicken_orange',
    name: 'Chicken (Unidentified)',
    role: 'Flock Member',
    gender: 'Unidentified',
    tagColorName: 'Orange tag',
    tagColorHex: '#FFA500',
    summaryText: 'General flock observation without distinct leg band detection.',
    behaviorDistribution: {
      reducedFeeding: 15,
      reducedDrinking: 14,
      prolongedInactivity: 12,
      socialIsolation: 4,
    },
    dominantBehavior: 'General flock activity',
  },
];

// Helper to compute THI
function computeThi(tempC: number, rhPct: number): number {
  return Math.round((0.8 * tempC + (rhPct / 100.0) * (tempC - 14.4) + 46.4) * 10) / 10;
}

function getStressDescription(level: IntervalTelemetry['heatStress']): string {
  switch (level) {
    case 'Emergency':
      return 'Immediate attention needed';
    case 'Severe':
      return 'High heat-stress risk';
    case 'Moderate':
      return 'Watch conditions closely';
    default:
      return 'Conditions look comfortable';
  }
}

// ── Complete Master Sample Intervals (matching attached image and extending through 28 Oct / Yesterday) ──
export const ALL_INTERVAL_TELEMETRY: IntervalTelemetry[] = [
  // Day 1: 24 Oct (Matching the exact intervals shown in attached image)
  {
    id: 'int_24_06',
    date: '2026-10-24',
    dateLabel: '24 Oct',
    timeSlot: '06:00',
    intervalLabel: '24 Oct · 06:00',
    fullTimeLabel: '24 Oct 2026 · 06:00 AM – 12:00 PM',
    tempC: 26.0,
    humidityPct: 62.0,
    ammoniaPpm: 3.0,
    soundDb: 48.0,
    thi: computeThi(26.0, 62.0),
    heatStress: 'Moderate',
    behaviorsByBird: {
      hen1_green:    { reducedFeeding: 4, reducedDrinking: 2, prolongedInactivity: 1, socialIsolation: 0 },
      hen2_white:    { reducedFeeding: 2, reducedDrinking: 4, prolongedInactivity: 1, socialIsolation: 0 },
      hen3_blue:     { reducedFeeding: 1, reducedDrinking: 1, prolongedInactivity: 3, socialIsolation: 1 },
      hen4_yellow:   { reducedFeeding: 3, reducedDrinking: 1, prolongedInactivity: 0, socialIsolation: 0 },
      hen5_pink:     { reducedFeeding: 1, reducedDrinking: 3, prolongedInactivity: 2, socialIsolation: 1 },
      rooster:       { reducedFeeding: 1, reducedDrinking: 1, prolongedInactivity: 3, socialIsolation: 1 },
      chicken_orange:{ reducedFeeding: 2, reducedDrinking: 2, prolongedInactivity: 1, socialIsolation: 0 },
    },
  },
  {
    id: 'int_24_12',
    date: '2026-10-24',
    dateLabel: '24 Oct',
    timeSlot: '12:00',
    intervalLabel: '24 Oct · 12:00',
    fullTimeLabel: '24 Oct 2026 · 12:00 PM – 06:00 PM',
    tempC: 30.0,
    humidityPct: 58.0,
    ammoniaPpm: 4.0,
    soundDb: 56.0,
    thi: computeThi(30.0, 58.0),
    heatStress: 'Severe',
    behaviorsByBird: {
      hen1_green:    { reducedFeeding: 5, reducedDrinking: 3, prolongedInactivity: 2, socialIsolation: 1 },
      hen2_white:    { reducedFeeding: 2, reducedDrinking: 5, prolongedInactivity: 1, socialIsolation: 0 },
      hen3_blue:     { reducedFeeding: 2, reducedDrinking: 2, prolongedInactivity: 4, socialIsolation: 1 },
      hen4_yellow:   { reducedFeeding: 3, reducedDrinking: 2, prolongedInactivity: 1, socialIsolation: 0 },
      hen5_pink:     { reducedFeeding: 2, reducedDrinking: 3, prolongedInactivity: 3, socialIsolation: 1 },
      rooster:       { reducedFeeding: 1, reducedDrinking: 2, prolongedInactivity: 4, socialIsolation: 1 },
      chicken_orange:{ reducedFeeding: 3, reducedDrinking: 2, prolongedInactivity: 2, socialIsolation: 1 },
    },
  },
  {
    id: 'int_24_18',
    date: '2026-10-24',
    dateLabel: '24 Oct',
    timeSlot: '18:00',
    intervalLabel: '24 Oct · 18:00',
    fullTimeLabel: '24 Oct 2026 · 06:00 PM – 12:00 AM',
    tempC: 28.0,
    humidityPct: 65.0,
    ammoniaPpm: 3.0,
    soundDb: 51.0,
    thi: computeThi(28.0, 65.0),
    heatStress: 'Moderate',
    behaviorsByBird: {
      hen1_green:    { reducedFeeding: 4, reducedDrinking: 2, prolongedInactivity: 1, socialIsolation: 0 },
      hen2_white:    { reducedFeeding: 1, reducedDrinking: 3, prolongedInactivity: 1, socialIsolation: 0 },
      hen3_blue:     { reducedFeeding: 2, reducedDrinking: 1, prolongedInactivity: 3, socialIsolation: 0 },
      hen4_yellow:   { reducedFeeding: 2, reducedDrinking: 1, prolongedInactivity: 1, socialIsolation: 0 },
      hen5_pink:     { reducedFeeding: 1, reducedDrinking: 2, prolongedInactivity: 3, socialIsolation: 1 },
      rooster:       { reducedFeeding: 1, reducedDrinking: 1, prolongedInactivity: 4, socialIsolation: 1 },
      chicken_orange:{ reducedFeeding: 2, reducedDrinking: 1, prolongedInactivity: 1, socialIsolation: 0 },
    },
  },

  // Day 2: 27 Oct (Matching the exact intervals shown in attached image)
  {
    id: 'int_27_06',
    date: '2026-10-27',
    dateLabel: '27 Oct',
    timeSlot: '06:00',
    intervalLabel: '27 Oct · 06:00',
    fullTimeLabel: '27 Oct 2026 · 06:00 AM – 12:00 PM',
    tempC: 33.0,
    humidityPct: 54.0,
    ammoniaPpm: 6.0,
    soundDb: 70.0,
    thi: computeThi(33.0, 54.0),
    heatStress: 'Emergency',
    behaviorsByBird: {
      hen1_green:    { reducedFeeding: 7, reducedDrinking: 4, prolongedInactivity: 2, socialIsolation: 1 },
      hen2_white:    { reducedFeeding: 3, reducedDrinking: 6, prolongedInactivity: 2, socialIsolation: 1 },
      hen3_blue:     { reducedFeeding: 2, reducedDrinking: 3, prolongedInactivity: 5, socialIsolation: 1 },
      hen4_yellow:   { reducedFeeding: 4, reducedDrinking: 2, prolongedInactivity: 1, socialIsolation: 1 },
      hen5_pink:     { reducedFeeding: 3, reducedDrinking: 5, prolongedInactivity: 4, socialIsolation: 1 },
      rooster:       { reducedFeeding: 2, reducedDrinking: 2, prolongedInactivity: 6, socialIsolation: 2 },
      chicken_orange:{ reducedFeeding: 4, reducedDrinking: 3, prolongedInactivity: 3, socialIsolation: 2 },
    },
  },
  {
    id: 'int_27_12',
    date: '2026-10-27',
    dateLabel: '27 Oct',
    timeSlot: '12:00',
    intervalLabel: '27 Oct · 12:00',
    fullTimeLabel: '27 Oct 2026 · 12:00 PM – 06:00 PM',
    tempC: 31.0,
    humidityPct: 59.0,
    ammoniaPpm: 5.0,
    soundDb: 62.0,
    thi: computeThi(31.0, 59.0),
    heatStress: 'Severe',
    behaviorsByBird: {
      hen1_green:    { reducedFeeding: 5, reducedDrinking: 3, prolongedInactivity: 1, socialIsolation: 1 },
      hen2_white:    { reducedFeeding: 3, reducedDrinking: 5, prolongedInactivity: 1, socialIsolation: 1 },
      hen3_blue:     { reducedFeeding: 3, reducedDrinking: 2, prolongedInactivity: 4, socialIsolation: 1 },
      hen4_yellow:   { reducedFeeding: 4, reducedDrinking: 2, prolongedInactivity: 1, socialIsolation: 0 },
      hen5_pink:     { reducedFeeding: 2, reducedDrinking: 4, prolongedInactivity: 4, socialIsolation: 1 },
      rooster:       { reducedFeeding: 2, reducedDrinking: 1, prolongedInactivity: 5, socialIsolation: 1 },
      chicken_orange:{ reducedFeeding: 3, reducedDrinking: 2, prolongedInactivity: 2, socialIsolation: 1 },
    },
  },
  {
    id: 'int_27_18',
    date: '2026-10-27',
    dateLabel: '27 Oct',
    timeSlot: '18:00',
    intervalLabel: '27 Oct · 18:00',
    fullTimeLabel: '27 Oct 2026 · 06:00 PM – 12:00 AM',
    tempC: 29.0,
    humidityPct: 63.0,
    ammoniaPpm: 4.0,
    soundDb: 55.0,
    thi: computeThi(29.0, 63.0),
    heatStress: 'Severe',
    behaviorsByBird: {
      hen1_green:    { reducedFeeding: 6, reducedDrinking: 4, prolongedInactivity: 2, socialIsolation: 1 },
      hen2_white:    { reducedFeeding: 3, reducedDrinking: 5, prolongedInactivity: 2, socialIsolation: 1 },
      hen3_blue:     { reducedFeeding: 2, reducedDrinking: 2, prolongedInactivity: 3, socialIsolation: 1 },
      hen4_yellow:   { reducedFeeding: 3, reducedDrinking: 2, prolongedInactivity: 2, socialIsolation: 1 },
      hen5_pink:     { reducedFeeding: 2, reducedDrinking: 3, prolongedInactivity: 3, socialIsolation: 1 },
      rooster:       { reducedFeeding: 1, reducedDrinking: 2, prolongedInactivity: 4, socialIsolation: 1 },
      chicken_orange:{ reducedFeeding: 2, reducedDrinking: 2, prolongedInactivity: 2, socialIsolation: 1 },
    },
  },

  // Day 3: 28 Oct (Yesterday's Data from sensors.sqlite / paired telemetry)
  {
    id: 'int_28_06',
    date: '2026-10-28',
    dateLabel: '28 Oct',
    timeSlot: '06:00',
    intervalLabel: '28 Oct · 06:00',
    fullTimeLabel: '28 Oct 2026 · 06:00 AM – 12:00 PM',
    tempC: 28.5,
    humidityPct: 68.0,
    ammoniaPpm: 3.5,
    soundDb: 64.0,
    thi: computeThi(28.5, 68.0),
    heatStress: 'Severe',
    behaviorsByBird: {
      hen1_green:    { reducedFeeding: 5, reducedDrinking: 3, prolongedInactivity: 1, socialIsolation: 0 },
      hen2_white:    { reducedFeeding: 2, reducedDrinking: 4, prolongedInactivity: 1, socialIsolation: 0 },
      hen3_blue:     { reducedFeeding: 2, reducedDrinking: 1, prolongedInactivity: 3, socialIsolation: 1 },
      hen4_yellow:   { reducedFeeding: 3, reducedDrinking: 2, prolongedInactivity: 1, socialIsolation: 0 },
      hen5_pink:     { reducedFeeding: 2, reducedDrinking: 3, prolongedInactivity: 2, socialIsolation: 1 },
      rooster:       { reducedFeeding: 1, reducedDrinking: 1, prolongedInactivity: 4, socialIsolation: 1 },
      chicken_orange:{ reducedFeeding: 2, reducedDrinking: 2, prolongedInactivity: 1, socialIsolation: 0 },
    },
  },
  {
    id: 'int_28_12',
    date: '2026-10-28',
    dateLabel: '28 Oct',
    timeSlot: '12:00',
    intervalLabel: '28 Oct · 12:00',
    fullTimeLabel: '28 Oct 2026 · 12:00 PM – 06:00 PM',
    tempC: 31.8,
    humidityPct: 60.5,
    ammoniaPpm: 5.2,
    soundDb: 71.5,
    thi: computeThi(31.8, 60.5),
    heatStress: 'Severe',
    behaviorsByBird: {
      hen1_green:    { reducedFeeding: 6, reducedDrinking: 4, prolongedInactivity: 2, socialIsolation: 1 },
      hen2_white:    { reducedFeeding: 3, reducedDrinking: 6, prolongedInactivity: 1, socialIsolation: 0 },
      hen3_blue:     { reducedFeeding: 2, reducedDrinking: 2, prolongedInactivity: 4, socialIsolation: 1 },
      hen4_yellow:   { reducedFeeding: 4, reducedDrinking: 2, prolongedInactivity: 1, socialIsolation: 0 },
      hen5_pink:     { reducedFeeding: 2, reducedDrinking: 4, prolongedInactivity: 3, socialIsolation: 1 },
      rooster:       { reducedFeeding: 2, reducedDrinking: 2, prolongedInactivity: 5, socialIsolation: 1 },
      chicken_orange:{ reducedFeeding: 3, reducedDrinking: 3, prolongedInactivity: 2, socialIsolation: 1 },
    },
  },
  {
    id: 'int_28_18',
    date: '2026-10-28',
    dateLabel: '28 Oct',
    timeSlot: '18:00',
    intervalLabel: '28 Oct · 18:00',
    fullTimeLabel: '28 Oct 2026 · 06:00 PM – 12:00 AM',
    tempC: 28.8,
    humidityPct: 70.0,
    ammoniaPpm: 4.1,
    soundDb: 74.5,
    thi: computeThi(28.8, 70.0),
    heatStress: 'Severe',
    behaviorsByBird: {
      hen1_green:    { reducedFeeding: 5, reducedDrinking: 3, prolongedInactivity: 1, socialIsolation: 0 },
      hen2_white:    { reducedFeeding: 2, reducedDrinking: 4, prolongedInactivity: 1, socialIsolation: 1 },
      hen3_blue:     { reducedFeeding: 1, reducedDrinking: 1, prolongedInactivity: 3, socialIsolation: 0 },
      hen4_yellow:   { reducedFeeding: 2, reducedDrinking: 1, prolongedInactivity: 0, socialIsolation: 0 },
      hen5_pink:     { reducedFeeding: 2, reducedDrinking: 3, prolongedInactivity: 3, socialIsolation: 1 },
      rooster:       { reducedFeeding: 1, reducedDrinking: 1, prolongedInactivity: 4, socialIsolation: 1 },
      chicken_orange:{ reducedFeeding: 2, reducedDrinking: 2, prolongedInactivity: 1, socialIsolation: 1 },
    },
  },
];

export default function BehaviorResultsTab() {
  // Real API data state
  const [intervals, setIntervals] = useState<IntervalTelemetry[]>(ALL_INTERVAL_TELEMETRY);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRealData, setIsRealData] = useState<boolean>(false);
  const [availableDates, setAvailableDates] = useState<string[]>(['2026-10-28', '2026-10-27', '2026-10-24']);

  // Fetch real synchronized behavior & sensor data from API
  useEffect(() => {
    let active = true;
    async function loadTelemetry() {
      try {
        setIsLoading(true);
        const res = await fetch('/api/behavior-results');
        if (res.ok) {
          const data = await res.json();
          if (active && data.success && Array.isArray(data.intervals) && data.intervals.length > 0) {
            setIntervals(data.intervals);
            setIsRealData(true);
            if (Array.isArray(data.availableDates) && data.availableDates.length > 0) {
              setAvailableDates(data.availableDates);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to fetch real behavior results, using cached telemetry fallback:', err);
      } finally {
        if (active) setIsLoading(false);
      }
    }
    loadTelemetry();
    return () => {
      active = false;
    };
  }, []);

  // Selected Profile state (defaults to 'hen1_green' matching COLOR_MAP)
  const [selectedBirdId, setSelectedBirdId] = useState<string>('hen1_green');

  // Date Filtering Mode:
  // 'preset' | 'single' | 'range'
  const [dateFilterMode, setDateFilterMode] = useState<'preset' | 'single' | 'range'>('preset');
  // 'all' | 'yesterday' | an ISO date coming from the generated preset chips
  const [selectedPreset, setSelectedPreset] = useState<string>('all');
  // `null` until the recorded dates are known (they come from the API), then the filter is
  // anchored on the newest recorded day — never on a hard-coded calendar date.
  const [singleDate, setSingleDate] = useState<IsoDate | null>(null);
  const [rangeStart, setRangeStart] = useState<IsoDate | null>(null);
  const [rangeEnd, setRangeEnd] = useState<IsoDate | null>(null);
  // Bumped by "Today" so relative labels (Today / Yesterday / N days ago) refresh across midnight.
  const [clockAnchor, setClockAnchor] = useState<IsoDate>(() => todayIso());

  // Detailed Log Search & Filter states
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');
  const [logStressFilter, setLogStressFilter] = useState<'all' | 'normal' | 'alert'>('all');

  // Chart tooltip hover state
  const [hoveredIntervalId, setHoveredIntervalId] = useState<string | null>(null);

  // Dynamically compute Chicken Profile metrics based on active intervals
  const dynamicProfiles = useMemo(() => {
    return CHICKEN_PROFILES.map((p) => {
      let redFeed = 0;
      let redDrink = 0;
      let inact = 0;
      let isol = 0;
      intervals.forEach((it) => {
        const b = it.behaviorsByBird[p.id];
        if (b) {
          redFeed += b.reducedFeeding;
          redDrink += b.reducedDrinking;
          inact += b.prolongedInactivity;
          isol += b.socialIsolation;
        }
      });
      const total = redFeed + redDrink + inact + isol;
      const dominant =
        redFeed >= redDrink && redFeed >= inact && redFeed >= isol
          ? 'Reduced feeding behavior'
          : redDrink >= inact && redDrink >= isol
          ? 'Reduced drinking behavior'
          : inact >= isol
          ? 'Prolonged low activity'
          : 'Social isolation';

      return {
        ...p,
        behaviorDistribution: {
          reducedFeeding: redFeed || p.behaviorDistribution.reducedFeeding,
          reducedDrinking: redDrink || p.behaviorDistribution.reducedDrinking,
          prolongedInactivity: inact || p.behaviorDistribution.prolongedInactivity,
          socialIsolation: isol || p.behaviorDistribution.socialIsolation,
        },
        dominantBehavior: dominant,
        summaryText: isRealData
          ? `${total} total observed stress events. ${dominant} is most frequent (${Math.max(redFeed, redDrink, inact, isol)} events).`
          : p.summaryText,
      };
    });
  }, [intervals, isRealData]);

  // Active selected bird profile
  const selectedBird = useMemo(
    () => dynamicProfiles.find((b) => b.id === selectedBirdId) || dynamicProfiles[0],
    [dynamicProfiles, selectedBirdId]
  );

  // ── Recorded-date index ───────────────────────────────────────────────────
  // Every date that actually has telemetry. Presets and the calendar's disabled cells are
  // derived from this, so a day without records can never be selected or shown as "Yesterday".
  const recordedDates = useMemo(() => {
    const fromData = new Set(intervals.map((item) => item.date));
    const fromApi = availableDates.filter((date) => fromData.has(date));
    return (fromApi.length ? fromApi : Array.from(fromData)).sort();
  }, [intervals, availableDates]);

  const recordedLookup = useMemo(() => new Set(recordedDates), [recordedDates]);
  const latestRecorded = recordedDates.length ? recordedDates[recordedDates.length - 1] : null;
  const earliestRecorded = recordedDates.length ? recordedDates[0] : null;

  const today = todayIso();
  // The wall clock can move (tab left open overnight); recompute relative labels then.
  const anchor = clockAnchor || today;
  const yesterday = addDays(today, -1);

  useEffect(() => {
    const timer = window.setInterval(() => setClockAnchor(todayIso()), 60 * 60 * 1000);
    const onFocus = () => setClockAnchor(todayIso());
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Default the single day / range once the recorded dates are known.
  useEffect(() => {
    if (!latestRecorded) return;
    setSingleDate((current) => current ?? latestRecorded);
    setRangeStart((current) => current ?? earliestRecorded ?? latestRecorded);
    setRangeEnd((current) => current ?? latestRecorded);
  }, [latestRecorded, earliestRecorded]);

  // Presets are data-driven: "Yesterday" only exists when yesterday has records.
  const presetDays = useMemo(() => {
    const days: { key: string; date: IsoDate | null; label: string }[] = [];
    const yesterdayHasRecords = recordedLookup.has(yesterday);
    days.push({
      key: 'yesterday',
      date: yesterdayHasRecords ? yesterday : null,
      label: yesterdayHasRecords
        ? `Yesterday (${formatShortDay(yesterday)})`
        : `Yesterday (${formatShortDay(yesterday)}) · no data`,
    });
    const recent = recordedDates
      .filter((date) => date !== yesterday && date !== today)
      .slice(-3)
      .reverse();
    recent.forEach((date) => {
      days.push({ key: date, date, label: formatShortDay(date) });
    });
    return days;
  }, [recordedLookup, recordedDates, yesterday, today]);

  const isCustomRangeReady = Boolean(rangeStart && rangeEnd && !isAfterDate(rangeStart, rangeEnd));

  /** Recorded days inside the current From → To window (for quick-duration chips). */
  const spanRecordedCount = useMemo(() => {
    if (!rangeStart || !rangeEnd) return 0;
    return enumerateDates(rangeStart, rangeEnd).filter((date) => recordedLookup.has(date)).length;
  }, [rangeStart, rangeEnd, recordedLookup]);

  // Filtered intervals based on date selection
  const filteredIntervals = useMemo(() => {
    if (dateFilterMode === 'preset') {
      if (selectedPreset === 'all') return intervals;
      if (selectedPreset === 'yesterday') {
        return recordedLookup.has(yesterday)
          ? intervals.filter((i) => i.date === yesterday)
          : [];
      }
      return intervals.filter((i) => i.date === selectedPreset);
    }
    if (dateFilterMode === 'single') {
      return singleDate ? intervals.filter((i) => i.date === singleDate) : [];
    }
    if (!rangeStart || !rangeEnd) return [];
    return intervals.filter((i) => i.date >= rangeStart && i.date <= rangeEnd);
  }, [intervals, dateFilterMode, selectedPreset, singleDate, rangeStart, rangeEnd, recordedLookup, yesterday]);

  // Selected date range text description
  const dateRangeLabel = useMemo(() => {
    if (dateFilterMode === 'preset') {
      if (selectedPreset === 'all') {
        return recordedDates.length
          ? `All recorded dates (${formatRange(recordedDates[0], recordedDates[recordedDates.length - 1])})`
          : 'All recorded dates';
      }
      const preset = presetDays.find((item) => item.key === selectedPreset);
      if (!preset?.date) return 'No records for that day';
      return `${formatLongDay(preset.date)} · ${relativeDayLabel(preset.date, anchor)}`;
    }
    if (dateFilterMode === 'single') {
      if (!singleDate) return 'No day selected';
      return `${formatLongDay(singleDate)} · ${relativeDayLabel(singleDate, anchor)}`;
    }
    if (!rangeStart || !rangeEnd) return 'No range selected';
    return formatRange(rangeStart, rangeEnd);
  }, [dateFilterMode, selectedPreset, singleDate, rangeStart, rangeEnd, recordedDates, presetDays, anchor]);

  /** Human note shown under the controls: warns when the range includes empty days. */
  const rangeNotice = useMemo(() => {
    if (dateFilterMode !== 'range' || !isCustomRangeReady) return null;
    const totalDays = rangeLength(rangeStart!, rangeEnd!);
    const missing = totalDays - spanRecordedCount;
    if (missing <= 0) return null;
    return `${missing} of ${totalDays} ${totalDays === 1 ? 'day has' : 'days have'} no telemetry records and are excluded.`;
  }, [dateFilterMode, isCustomRangeReady, rangeStart, rangeEnd, spanRecordedCount]);

  // Aggregate behavior counts for the selected bird across the filtered intervals
  const birdAggregates = useMemo(() => {
    let feeding = 0;
    let drinking = 0;
    let inactivity = 0;
    let isolation = 0;

    filteredIntervals.forEach((interval) => {
      const counts = interval.behaviorsByBird[selectedBirdId];
      if (counts) {
        feeding += counts.reducedFeeding;
        drinking += counts.reducedDrinking;
        inactivity += counts.prolongedInactivity;
        isolation += counts.socialIsolation;
      }
    });

    return {
      feeding,
      drinking,
      inactivity,
      isolation,
      total: feeding + drinking + inactivity + isolation,
    };
  }, [filteredIntervals, selectedBirdId]);

  const chartSummary = useMemo(() => {
    const alertIntervals = filteredIntervals.filter((interval) => interval.heatStress !== 'Normal');
    const highestRisk = filteredIntervals.reduce<IntervalTelemetry | null>((highest, interval) => {
      if (!highest) return interval;
      const rank = { Normal: 0, Moderate: 1, Severe: 2, Emergency: 3 };
      return rank[interval.heatStress] > rank[highest.heatStress] ? interval : highest;
    }, null);

    return {
      alertCount: alertIntervals.length,
      highestRisk,
      intervalCount: filteredIntervals.length,
      totalEvents: birdAggregates.total,
    };
  }, [filteredIntervals, birdAggregates.total]);

  // Synchronized telemetry summary aggregates (averages, min/max ranges)
  const telemetryStats = useMemo(() => {
    if (!filteredIntervals.length) return null;
    const temps = filteredIntervals.map((i) => i.tempC);
    const hums = filteredIntervals.map((i) => i.humidityPct);
    const amms = filteredIntervals.map((i) => i.ammoniaPpm);
    const sounds = filteredIntervals.map((i) => i.soundDb);
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const min = (arr: number[]) => (arr.length ? Math.min(...arr) : 0);
    const max = (arr: number[]) => (arr.length ? Math.max(...arr) : 0);

    return {
      temp: { avg: avg(temps), min: min(temps), max: max(temps) },
      hum: { avg: avg(hums), min: min(hums), max: max(hums) },
      ammonia: { avg: avg(amms), min: min(amms), max: max(amms) },
      sound: { avg: avg(sounds), min: min(sounds), max: max(sounds) },
      intervalCount: filteredIntervals.length,
    };
  }, [filteredIntervals]);

  // Filtered log table entries
  const filteredLogEntries = useMemo(() => {
    return filteredIntervals.filter((interval) => {
      if (logStressFilter === 'normal' && interval.heatStress !== 'Normal') return false;
      if (logStressFilter === 'alert' && interval.heatStress === 'Normal') return false;
      if (logSearchQuery.trim()) {
        const q = logSearchQuery.toLowerCase();
        const matchLabel = interval.fullTimeLabel.toLowerCase().includes(q);
        const matchStress = interval.heatStress.toLowerCase().includes(q);
        const matchTemp = String(interval.tempC).includes(q);
        const matchHum = String(interval.humidityPct).includes(q);
        const matchNh3 = String(interval.ammoniaPpm).includes(q);
        if (!matchLabel && !matchStress && !matchTemp && !matchHum && !matchNh3) return false;
      }
      return true;
    });
  }, [filteredIntervals, logStressFilter, logSearchQuery]);

  // Export CSV of correlation log
  const handleExportCsv = () => {
    const headers = [
      'Interval',
      'Date',
      'Time_Slot',
      'Profile',
      'Reduced_Feeding_Events',
      'Reduced_Drinking_Events',
      'Prolonged_Inactivity_Events',
      'Social_Isolation_Events',
      'Temperature_C',
      'Humidity_Pct',
      'Ammonia_PPM',
      'Sound_DB',
      'THI',
      'Heat_Stress_Level',
    ];

    const rows = filteredIntervals.map((i) => {
      const beh = i.behaviorsByBird[selectedBirdId] || {
        reducedFeeding: 0,
        reducedDrinking: 0,
        prolongedInactivity: 0,
        socialIsolation: 0,
      };
      return [
        `"${i.intervalLabel}"`,
        i.date,
        i.timeSlot,
        `"${selectedBird.name} (${selectedBird.tagColorName})"`,
        beh.reducedFeeding,
        beh.reducedDrinking,
        beh.prolongedInactivity,
        beh.socialIsolation,
        i.tempC,
        i.humidityPct,
        i.ammoniaPpm,
        i.soundDb,
        i.thi,
        `"${i.heatStress}"`,
      ];
    });

    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csvContent);
    link.download = `behavior_results_${selectedBird.name.toLowerCase().replace(/\s+/g, '_')}_${dateRangeLabel.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ─────────────────────────── SVG CHART DIMENSIONS & SCALING ───────────────────────────
  const chartConfig = useMemo(() => {
    const W = 880;
    const H = 280;
    const PAD_LEFT = 50;
    const PAD_RIGHT = 60;
    const PAD_TOP = 25;
    const PAD_BOTTOM = 45;
    const innerW = W - PAD_LEFT - PAD_RIGHT;
    const innerH = H - PAD_TOP - PAD_BOTTOM;

    const N = Math.max(1, filteredIntervals.length);
    const slotW = innerW / N;
    const barW = Math.min(10, Math.max(4, (slotW * 0.5) / 4));
    const groupW = barW * 4 + 6;

    // Left Y Axis: Dynamic Behavior scale based on maximum behavior in active intervals
    const maxValInIntervals = Math.max(
      8,
      ...filteredIntervals.flatMap((item) => {
        const counts = item.behaviorsByBird[selectedBirdId];
        return counts
          ? [counts.reducedFeeding, counts.reducedDrinking, counts.prolongedInactivity, counts.socialIsolation]
          : [0];
      })
    );
    const MAX_BEH = Math.max(8, Math.ceil(maxValInIntervals / 4) * 4);
    const behTicks = [0, Math.round(MAX_BEH * 0.25), Math.round(MAX_BEH * 0.5), Math.round(MAX_BEH * 0.75), MAX_BEH];
    const behToY = (val: number) => PAD_TOP + innerH - (Math.min(MAX_BEH, Math.max(0, val)) / MAX_BEH) * innerH;

    // Right Y Axis: Environmental scale (0 to 100%)
    // Temp: 0 to 40°C -> 0 to 100%
    // Humidity: 0 to 100% -> 0 to 100%
    // Ammonia: 0 to 20 ppm -> 0 to 100%
    // Sound: 0 to 100 dBA -> 0 to 100%
    const envToNormPct = {
      temp: (c: number) => (c / 40.0) * 100,
      hum: (h: number) => h,
      nh3: (ppm: number) => (ppm / 20.0) * 100,
      sound: (db: number) => db,
    };

    const normToY = (pct: number) => PAD_TOP + innerH - (Math.min(100, Math.max(0, pct)) / 100) * innerH;

    // Interval slot centers
    const slotCenter = (index: number) => PAD_LEFT + index * slotW + slotW / 2;

    // Environmental Polyline Points
    const tempPoints = filteredIntervals
      .map((item, idx) => `${slotCenter(idx).toFixed(1)},${normToY(envToNormPct.temp(item.tempC)).toFixed(1)}`)
      .join(' ');
    const humPoints = filteredIntervals
      .map((item, idx) => `${slotCenter(idx).toFixed(1)},${normToY(envToNormPct.hum(item.humidityPct)).toFixed(1)}`)
      .join(' ');
    const nh3Points = filteredIntervals
      .map((item, idx) => `${slotCenter(idx).toFixed(1)},${normToY(envToNormPct.nh3(item.ammoniaPpm)).toFixed(1)}`)
      .join(' ');
    const soundPoints = filteredIntervals
      .map((item, idx) => `${slotCenter(idx).toFixed(1)},${normToY(envToNormPct.sound(item.soundDb)).toFixed(1)}`)
      .join(' ');

    return {
      W,
      H,
      PAD_LEFT,
      PAD_RIGHT,
      PAD_TOP,
      PAD_BOTTOM,
      innerW,
      innerH,
      slotW,
      barW,
      groupW,
      MAX_BEH,
      behTicks,
      behToY,
      normToY,
      slotCenter,
      tempPoints,
      humPoints,
      nh3Points,
      soundPoints,
    };
  }, [filteredIntervals, selectedBirdId]);

  return (
    <div className="space-y-6 text-slate-800">
      {/* ──────────────────────── DATE & CUSTOM RANGE TOOLBAR ──────────────────────── */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-orange-600" />
              <h2 className="text-base sm:text-lg font-bold text-slate-900">Telemetry &amp; Behavior Range Filter</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Only days with recorded telemetry can be selected · {recordedDates.length}{' '}
              {recordedDates.length === 1 ? 'day' : 'days'} available
              {latestRecorded ? ` (latest ${formatLongDay(latestRecorded)})` : ''}.
            </p>
          </div>

          {/* Mode + preset buttons (presets are generated from recorded dates) */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDateFilterMode('preset');
                setSelectedPreset('all');
              }}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                dateFilterMode === 'preset' && selectedPreset === 'all'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" /> All Recorded Dates
            </button>

            <button
              type="button"
              onClick={() => {
                setDateFilterMode('single');
                if (!singleDate) setSingleDate(latestRecorded);
              }}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                dateFilterMode === 'single'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Specific Day
            </button>

            <button
              type="button"
              onClick={() => {
                setDateFilterMode('range');
                setRangeStart((current) => current ?? earliestRecorded ?? latestRecorded);
                setRangeEnd((current) => current ?? latestRecorded);
              }}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                dateFilterMode === 'range'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Custom Range
            </button>
          </div>
        </div>

        {/* Dynamic Controls when Single Day or Custom Range is selected */}
        {dateFilterMode === 'single' && (
          <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
            <RangeAwareDatePicker
              label="Specific day"
              value={singleDate ?? ''}
              onChange={(date) => setSingleDate(date)}
              selectableDates={recordedDates}
              minSelectable={earliestRecorded}
              maxSelectable={latestRecorded}
              hint="Greyed-out days have no telemetry records and cannot be selected."
            />
            <span className="pb-1.5 text-[11px] text-slate-500">
              {singleDate
                ? `Showing all 6:00 AM – 6:00 PM intervals for ${formatWeekdayDay(singleDate)}.`
                : 'Select a recorded day to view its intervals.'}
            </span>
          </div>
        )}

        {dateFilterMode === 'range' && (
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-end gap-3">
              <RangeAwareDatePicker
                label="From"
                value={rangeStart ?? ''}
                onChange={(date) => {
                  setRangeStart(date);
                  // Keep the window valid: push the end date forward instead of silently showing nothing.
                  if (rangeEnd && isAfterDate(date, rangeEnd)) setRangeEnd(date);
                }}
                selectableDates={recordedDates}
                minSelectable={earliestRecorded}
                maxSelectable={rangeEnd ?? latestRecorded}
              />

              <span className="pb-2 text-xs font-semibold text-slate-400">→</span>

              <RangeAwareDatePicker
                label="To"
                value={rangeEnd ?? ''}
                onChange={(date) => {
                  setRangeEnd(date);
                  if (rangeStart && isAfterDate(rangeStart, date)) setRangeStart(date);
                }}
                selectableDates={recordedDates}
                minSelectable={rangeStart ?? earliestRecorded}
                maxSelectable={latestRecorded}
              />

              {/* Quick durations end on the newest recorded day (not a hard-coded date) */}
              <div className="flex items-center gap-1.5 pb-1 pl-2 border-l border-slate-200">
                <span className="text-[11px] text-slate-400 font-medium">Quick Duration:</span>
                {[5, 3].map((days) => {
                  const end = latestRecorded ?? today;
                  const start = addDays(end, -(days - 1));
                  const active = rangeStart === start && rangeEnd === end;
                  return (
                    <button
                      key={days}
                      type="button"
                      disabled={!latestRecorded}
                      onClick={() => {
                        setRangeStart(start);
                        setRangeEnd(end);
                      }}
                      title={`${formatLongDay(start)} → ${formatLongDay(end)} (${rangeLength(start, end)} calendar days)`}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                        active
                          ? 'border-orange-300 bg-orange-50 text-orange-700'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-orange-50 hover:text-orange-600'
                      } disabled:opacity-40`}
                    >
                      {days} Days ({formatRange(start, end)})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {isCustomRangeReady ? (
                <span className="font-semibold text-emerald-700">
                  {rangeLength(rangeStart!, rangeEnd!)} calendar days · {spanRecordedCount} with records ·{' '}
                  {filteredIntervals.length} intervals
                </span>
              ) : (
                <span className="font-semibold text-red-600">
                  The “From” day must be on or before the “To” day.
                </span>
              )}
              {rangeNotice && <span className="text-slate-500">· {rangeNotice}</span>}
            </div>
          </div>
        )}
      </div>

      {/* ──────────────────────── 1. CHICKEN PROFILES HEADER & CARDS ──────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">Chicken Profiles</h2>
            <p className="text-xs text-slate-500">
              Individual summaries · {dateRangeLabel} · 6:00 AM–6:00 PM · 5 hens and 1 rooster
            </p>
          </div>
          <span className="self-start rounded-full border border-orange-300 bg-orange-50 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-orange-700 uppercase">
            INDIVIDUAL VIEW
          </span>
        </div>

        {filteredIntervals.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600">
            <div className="flex items-start gap-2.5">
              <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                <p className="font-bold text-slate-800">No telemetry records for {dateRangeLabel}</p>
                <p className="mt-1 text-[11px] leading-relaxed">
                  Pick a highlighted day in the calendar (a green dot marks a recorded day), or choose{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setDateFilterMode('preset');
                      setSelectedPreset('all');
                    }}
                    className="font-semibold text-orange-600 underline underline-offset-2 hover:text-orange-700"
                  >
                    All Recorded Dates
                  </button>
                  .
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Synchronized Telemetry Status Banner */}
        <div className="rounded-2xl border border-emerald-300/80 bg-emerald-50/70 p-4 text-xs text-emerald-950 shadow-sm leading-relaxed">
          <div className="flex items-start gap-2.5">
            <Radio className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 animate-pulse" />
            <div>
              <div className="flex items-center gap-2">
                <p className="font-bold text-emerald-950">
                  {isRealData ? 'Real Synchronized Telemetry Active' : 'Loading Synchronized Sensor Telemetry...'}
                </p>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  <Check className="h-3 w-3 text-emerald-600" />
                  Paired sensors.sqlite &amp; video telemetry
                </span>
              </div>
              <p className="mt-1 text-slate-600 text-[11px]">
                Synchronized ambient sensor readings (temperature, humidity, ammonia, sound dB, THI) correlated with
                individual chicken classifications across all recorded video sessions and date intervals.
              </p>
            </div>
          </div>
        </div>

        {/* Chicken Profile Cards (clickable to filter) */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {dynamicProfiles.map((chicken) => {
            const isSelected = selectedBirdId === chicken.id;
            const beh = chicken.behaviorDistribution;
            const totalEvents =
              beh.reducedFeeding +
              beh.reducedDrinking +
              beh.prolongedInactivity +
              beh.socialIsolation;
            const dominantCount = Math.max(
              beh.reducedFeeding,
              beh.reducedDrinking,
              beh.prolongedInactivity,
              beh.socialIsolation
            );

            // Calculate percentage shares for mini stacked bar
            const pFeed = totalEvents > 0 ? (beh.reducedFeeding / totalEvents) * 100 : 0;
            const pDrink = totalEvents > 0 ? (beh.reducedDrinking / totalEvents) * 100 : 0;
            const pInact = totalEvents > 0 ? (beh.prolongedInactivity / totalEvents) * 100 : 0;
            const pIsol = totalEvents > 0 ? (beh.socialIsolation / totalEvents) * 100 : 0;

            const isWhiteTag = chicken.tagColorHex.toLowerCase() === '#ffffff';

            return (
              <div
                key={chicken.id}
                onClick={() => setSelectedBirdId(chicken.id)}
                className={`group relative flex flex-col justify-between rounded-2xl p-4 transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? 'border-2 border-orange-500 bg-white shadow-lg shadow-orange-500/10 ring-4 ring-orange-500/10'
                    : 'border border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5'
                }`}
              >
                <div>
                  {/* Top row: Avatar & Identity + Tag Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border shadow-xs transition-transform duration-200 group-hover:scale-105"
                        style={{
                          backgroundColor: isWhiteTag ? '#f8fafc' : `${chicken.tagColorHex}18`,
                          borderColor: isWhiteTag ? '#cbd5e1' : `${chicken.tagColorHex}45`,
                        }}
                      >
                        <Bird
                          className="h-5 w-5"
                          style={{
                            color: isWhiteTag ? '#475569' : chicken.tagColorHex,
                          }}
                        />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-slate-900 truncate group-hover:text-orange-600 transition-colors">
                          {chicken.name}
                        </h4>
                        <p className="text-[11px] font-medium text-slate-400">
                          {chicken.role} · {chicken.gender}
                        </p>
                      </div>
                    </div>

                    <div
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-50/80 shadow-2xs"
                      style={{ borderColor: isWhiteTag ? '#cbd5e1' : `${chicken.tagColorHex}40` }}
                    >
                      <span
                        className="h-2 w-2 rounded-full ring-1 ring-black/10 shrink-0"
                        style={{ backgroundColor: chicken.tagColorHex }}
                      />
                      <span className="truncate">{chicken.tagColorName}</span>
                    </div>
                  </div>

                  {/* Metric Highlight Box */}
                  <div className="mt-3.5 rounded-xl bg-slate-50/90 border border-slate-100 p-2.5 space-y-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        Observed Stress
                      </span>
                      <div className="flex items-baseline gap-1">
                        <span className="text-lg font-black text-slate-900 tracking-tight">
                          {totalEvents.toLocaleString()}
                        </span>
                        <span className="text-[11px] font-medium text-slate-400">events</span>
                      </div>
                    </div>

                    {/* 4-segment mini stacked distribution bar */}
                    {totalEvents > 0 ? (
                      <div>
                        <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden flex">
                          {pFeed > 0 && (
                            <div
                              style={{ width: `${pFeed}%` }}
                              className="bg-amber-500 transition-all duration-300"
                              title={`Reduced feeding: ${beh.reducedFeeding} (${pFeed.toFixed(0)}%)`}
                            />
                          )}
                          {pDrink > 0 && (
                            <div
                              style={{ width: `${pDrink}%` }}
                              className="bg-sky-500 transition-all duration-300"
                              title={`Reduced drinking: ${beh.reducedDrinking} (${pDrink.toFixed(0)}%)`}
                            />
                          )}
                          {pInact > 0 && (
                            <div
                              style={{ width: `${pInact}%` }}
                              className="bg-purple-500 transition-all duration-300"
                              title={`Inactivity: ${beh.prolongedInactivity} (${pInact.toFixed(0)}%)`}
                            />
                          )}
                          {pIsol > 0 && (
                            <div
                              style={{ width: `${pIsol}%` }}
                              className="bg-emerald-500 transition-all duration-300"
                              title={`Social isolation: ${beh.socialIsolation} (${pIsol.toFixed(0)}%)`}
                            />
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="h-1.5 w-full rounded-full bg-slate-100" />
                    )}

                    {/* Dominant pattern chip */}
                    <div className="flex items-center justify-between text-[11px] text-slate-600 pt-0.5">
                      <span className="flex items-center gap-1 truncate text-slate-500">
                        <Activity className="h-3 w-3 text-orange-500 shrink-0" />
                        <span className="truncate">{chicken.dominantBehavior}</span>
                      </span>
                      <span className="font-bold text-slate-800 shrink-0">
                        {dominantCount} ev
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer selection status */}
                <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                  {isSelected ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-orange-600 bg-orange-50 border border-orange-200/80 px-2.5 py-1 rounded-lg">
                      <Check className="h-3.5 w-3.5 stroke-[3]" /> Selected Individual
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-500 group-hover:text-orange-600 transition-colors">
                      View individual detail
                      <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all" />
                    </span>
                  )}
                  {isSelected && (
                    <span className="flex h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ──────────────────────── 2. SELECTED INDIVIDUAL HEADER & SUMMARY ──────────────────────── */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="h-3 w-3 rounded-full ring-1 ring-slate-300" style={{ backgroundColor: selectedBird.tagColorHex }} />
            <h3 className="text-lg font-bold text-slate-900">
              {selectedBird.name}{' '}
              <span className="text-sm font-medium text-slate-500">
                {selectedBird.role} · {selectedBird.gender} · {selectedBird.tagColorName}
              </span>
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">
              Selected range: {dateRangeLabel} · 6:00 AM–6:00 PM
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              SYNCHRONIZED TELEMETRY
            </span>
          </div>
        </div>

        {/* Narrative paragraph reflecting real synchronized metrics */}
        <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
          {isRealData ? (
            <>
              <span className="font-semibold text-slate-900">{selectedBird.name} Synchronized Telemetry Profile:</span>{' '}
              All four stress behaviors are actively tracked across the sampled intervals with paired environmental telemetry.{' '}
              Reduced feeding behavior: <span className="font-semibold text-orange-600">{birdAggregates.feeding}</span> events;{' '}
              reduced drinking behavior: <span className="font-semibold text-blue-600">{birdAggregates.drinking}</span> events;{' '}
              prolonged low activity: <span className="font-semibold text-slate-800">{birdAggregates.inactivity}</span> events;{' '}
              and social isolation / pecking: <span className="font-semibold text-rose-600">{birdAggregates.isolation}</span> events.{' '}
              Measured from paired <code className="text-orange-600 font-semibold font-mono">sensors.sqlite</code> and ByteTrack analytics pipeline.
            </>
          ) : (
            <>
              Illustrative {selectedBird.name} summary: all four stress behaviors are present in the sampled intervals.
              Reduced feeding behavior is most frequent ({birdAggregates.feeding} events); reduced drinking behavior{' '}
              {birdAggregates.drinking}, prolonged low activity {birdAggregates.inactivity}, and social isolation{' '}
              {birdAggregates.isolation}.
            </>
          )}
        </p>

        {/* ──────────────────────── 3. DUAL-AXIS COMBINED GRAPH (MATCHING ATTACHED IMAGE) ──────────────────────── */}
        <div className="mt-6 rounded-2xl border border-slate-100 bg-[#fafbfc] p-4 sm:p-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h4 className="text-sm sm:text-base font-bold text-slate-900">
                Stress behaviors &amp; environmental conditions
              </h4>
              <p className="text-[11px] text-slate-500">
                Grouped bars: behavior events per sampled interval · dashed lines: normalized environmental readings · live synchronized telemetry
              </p>
            </div>
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 self-start rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5 text-slate-400" />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-orange-100 bg-orange-50/70 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-orange-700">Behavior events</p>
              <p className="mt-1 text-xl font-extrabold text-orange-900">{chartSummary.totalEvents}</p>
              <p className="text-[10px] text-orange-700">for {selectedBird.name}</p>
            </div>
            <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-sky-700">Intervals reviewed</p>
              <p className="mt-1 text-xl font-extrabold text-sky-900">{chartSummary.intervalCount}</p>
              <p className="text-[10px] text-sky-700">sampled periods</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Needs attention</p>
              <p className="mt-1 text-xl font-extrabold text-amber-900">{chartSummary.alertCount}</p>
              <p className="text-[10px] text-amber-700">intervals above normal</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Highest risk</p>
              <p className="mt-1 truncate text-sm font-extrabold text-slate-900">
                {chartSummary.highestRisk?.heatStress || 'No data'}
              </p>
              <p className="text-[10px] text-slate-500">
                {chartSummary.highestRisk ? getStressDescription(chartSummary.highestRisk.heatStress) : 'Select a range'}
              </p>
            </div>
          </div>

          {/* SVG Canvas for Dual-Axis Bar + Line Chart */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartConfig.W} ${chartConfig.H}`}
              className="w-full min-w-[720px] select-none font-sans"
              style={{ maxHeight: '340px' }}
            >
              {/* Gridlines & Y-Axis Labels */}
              {chartConfig.behTicks.map((behVal) => {
                const y = chartConfig.behToY(behVal);
                const normVal = Math.round((behVal / chartConfig.MAX_BEH) * 100);
                return (
                  <g key={behVal}>
                    {/* Horizontal gridline */}
                    <line
                      x1={chartConfig.PAD_LEFT}
                      y1={y}
                      x2={chartConfig.W - chartConfig.PAD_RIGHT}
                      y2={y}
                      stroke="#f1f5f9"
                      strokeWidth="1"
                    />
                    {/* Left label: Behavior events */}
                    <text
                      x={chartConfig.PAD_LEFT - 12}
                      y={y + 3}
                      fill="#64748b"
                      fontSize="10"
                      textAnchor="end"
                      fontWeight="500"
                    >
                      {behVal}
                    </text>
                    {/* Right label: Environmental scale % */}
                    <text
                      x={chartConfig.W - chartConfig.PAD_RIGHT + 12}
                      y={y + 3}
                      fill="#64748b"
                      fontSize="10"
                      textAnchor="start"
                      fontWeight="500"
                    >
                      {normVal}
                    </text>
                  </g>
                );
              })}

              {/* Axis Titles */}
              <text
                x={chartConfig.PAD_LEFT + 15}
                y={chartConfig.PAD_TOP - 10}
                fill="#475569"
                fontSize="11"
                fontWeight="600"
              >
                Behavior events
              </text>
              <text
                x={chartConfig.W - chartConfig.PAD_RIGHT - 20}
                y={chartConfig.PAD_TOP - 10}
                fill="#475569"
                fontSize="11"
                fontWeight="600"
                textAnchor="end"
              >
                Environmental scale · normalized %
              </text>

              {/* Grouped Bars for each interval */}
              {filteredIntervals.map((interval, idx) => {
                const cx = chartConfig.slotCenter(idx);
                const counts = interval.behaviorsByBird[selectedBirdId] || {
                  reducedFeeding: 0,
                  reducedDrinking: 0,
                  prolongedInactivity: 0,
                  socialIsolation: 0,
                };
                const baseY = chartConfig.behToY(0);

                const b1H = Math.max(0, baseY - chartConfig.behToY(counts.reducedFeeding));
                const b2H = Math.max(0, baseY - chartConfig.behToY(counts.reducedDrinking));
                const b3H = Math.max(0, baseY - chartConfig.behToY(counts.prolongedInactivity));
                const b4H = Math.max(0, baseY - chartConfig.behToY(counts.socialIsolation));

                const b1X = cx - chartConfig.groupW / 2;
                const b2X = b1X + chartConfig.barW + 2;
                const b3X = b2X + chartConfig.barW + 2;
                const b4X = b3X + chartConfig.barW + 2;

                const isHovered = hoveredIntervalId === interval.id;

                return (
                  <g
                    key={interval.id}
                    onMouseEnter={() => setHoveredIntervalId(interval.id)}
                    onMouseLeave={() => setHoveredIntervalId(null)}
                    className="cursor-pointer"
                  >
                    {/* Hover column background highlight */}
                    {isHovered && (
                      <rect
                        x={cx - chartConfig.slotW / 2 + 2}
                        y={chartConfig.PAD_TOP}
                        width={chartConfig.slotW - 4}
                        height={chartConfig.innerH}
                        fill="#ffedd5"
                        opacity="0.35"
                        rx="6"
                      />
                    )}

                    {/* Bar 1: Reduced Feeding (orange) */}
                    {b1H > 0 && (
                      <rect
                        x={b1X}
                        y={baseY - b1H}
                        width={chartConfig.barW}
                        height={b1H}
                        fill="#f97316"
                        rx="1.5"
                      />
                    )}

                    {/* Bar 2: Reduced Drinking (blue) */}
                    {b2H > 0 && (
                      <rect
                        x={b2X}
                        y={baseY - b2H}
                        width={chartConfig.barW}
                        height={b2H}
                        fill="#3b82f6"
                        rx="1.5"
                      />
                    )}

                    {/* Bar 3: Prolonged Low Activity (purple) */}
                    {b3H > 0 && (
                      <rect
                        x={b3X}
                        y={baseY - b3H}
                        width={chartConfig.barW}
                        height={b3H}
                        fill="#a855f7"
                        rx="1.5"
                      />
                    )}

                    {/* Bar 4: Social Isolation (teal/emerald) */}
                    {b4H > 0 && (
                      <rect
                        x={b4X}
                        y={baseY - b4H}
                        width={chartConfig.barW}
                        height={b4H}
                        fill="#10b981"
                        rx="1.5"
                      />
                    )}

                    {/* X-axis tick label */}
                    <text
                      x={cx}
                      y={baseY + 16}
                      fill={isHovered ? '#ea580c' : '#64748b'}
                      fontSize="9.5"
                      fontWeight={isHovered ? '700' : '500'}
                      textAnchor="middle"
                    >
                      {interval.intervalLabel}
                    </text>
                  </g>
                );
              })}

              {/* 4 Environmental Normalized Dashed Curves */}
              {/* 1. Temperature (°C) - Crimson dashed line */}
              <polyline
                points={chartConfig.tempPoints}
                fill="none"
                stroke="#b91c1c"
                strokeWidth="2"
                strokeDasharray="4 3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* 2. Humidity (%) - Sky blue dashed line */}
              <polyline
                points={chartConfig.humPoints}
                fill="none"
                stroke="#0284c7"
                strokeWidth="2"
                strokeDasharray="4 3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* 3. Ammonia (ppm) - Gold/brown dashed line */}
              <polyline
                points={chartConfig.nh3Points}
                fill="none"
                stroke="#b45309"
                strokeWidth="2"
                strokeDasharray="4 3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* 4. Sound (dBA) - Slate dashed line */}
              <polyline
                points={chartConfig.soundPoints}
                fill="none"
                stroke="#475569"
                strokeWidth="2"
                strokeDasharray="4 3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {hoveredIntervalId && (() => {
            const interval = filteredIntervals.find((item) => item.id === hoveredIntervalId);
            if (!interval) return null;
            const counts = interval.behaviorsByBird[selectedBirdId] || {
              reducedFeeding: 0,
              reducedDrinking: 0,
              prolongedInactivity: 0,
              socialIsolation: 0,
            };
            return (
              <div className="mt-3 rounded-xl border border-orange-100 bg-orange-50/60 px-3 py-2.5 text-xs text-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{interval.fullTimeLabel}</span>
                  <span className="font-semibold text-orange-800">
                    {interval.heatStress}: {getStressDescription(interval.heatStress)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                  <span>Feeding <strong>{counts.reducedFeeding}</strong></span>
                  <span>Drinking <strong>{counts.reducedDrinking}</strong></span>
                  <span>Low activity <strong>{counts.prolongedInactivity}</strong></span>
                  <span>Isolation <strong>{counts.socialIsolation}</strong></span>
                  <span>Temp <strong>{interval.tempC.toFixed(1)}°C</strong></span>
                  <span>Humidity <strong>{interval.humidityPct.toFixed(0)}%</strong></span>
                </div>
              </div>
            );
          })()}

          {/* Subtext below chart */}
          <div className="mt-2 text-center text-[10.5px] text-slate-400">
            Sampled intervals within {dateRangeLabel} (2026); gaps between days are omitted.
          </div>

          {/* ──────────────────────── LEGEND & READINGS (MATCHING IMAGE) ──────────────────────── */}
          <div className="mt-6 border-t border-slate-200/70 pt-5 space-y-4">
            {/* Behavior & Environmental Legends */}
            <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-6 text-xs">
              {/* Behaviors */}
              <div className="flex flex-wrap items-center gap-4">
                <span className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#f97316]" />
                  Reduced feeding behavior
                </span>
                <span className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#3b82f6]" />
                  Reduced drinking behavior
                </span>
                <span className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#a855f7]" />
                  Prolonged low activity
                </span>
                <span className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#10b981]" />
                  Social isolation
                </span>
              </div>

              {/* Environmental Dashed Lines */}
              <div className="flex flex-wrap items-center gap-4">
                <span className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="w-4 border-t-2 border-dashed border-[#b91c1c]" />
                  Temperature (°C)
                </span>
                <span className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="w-4 border-t-2 border-dashed border-[#0284c7]" />
                  Humidity (%)
                </span>
                <span className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="w-4 border-t-2 border-dashed border-[#b45309]" />
                  Ammonia level (ppm)
                </span>
                <span className="flex items-center gap-1.5 font-medium text-slate-700">
                  <span className="w-4 border-t-2 border-dashed border-[#475569]" />
                  Sound level (dBA)
                </span>
              </div>
            </div>

            {/* Synchronized Interval Readings Strip */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm space-y-4">
              {/* Header with status pill */}
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-orange-500" />
                  <span className="font-bold text-slate-800 text-xs uppercase tracking-wider">
                    Synchronized Interval Readings
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200/70">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {filteredIntervals.length} interval checkpoints
                  </span>
                </div>
              </div>

              {/* 4 Summary Stat Cards */}
              {telemetryStats ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {/* Temperature */}
                  <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-3 transition hover:border-rose-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-rose-800 uppercase tracking-wider">
                        Temperature
                      </span>
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-rose-100/80 text-rose-600">
                        <Thermometer className="h-3.5 w-3.5" />
                      </div>
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <span className="text-xl font-black text-rose-950 tracking-tight">
                        {telemetryStats.temp.avg.toFixed(1)}
                      </span>
                      <span className="text-xs font-semibold text-rose-700">°C avg</span>
                    </div>
                    <div className="mt-1 text-[11px] text-rose-600 font-medium">
                      Range: {telemetryStats.temp.min.toFixed(0)} – {telemetryStats.temp.max.toFixed(0)} °C
                    </div>
                  </div>

                  {/* Humidity */}
                  <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-3 transition hover:border-sky-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-sky-800 uppercase tracking-wider">
                        Rel. Humidity
                      </span>
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-100/80 text-sky-600">
                        <Droplets className="h-3.5 w-3.5" />
                      </div>
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <span className="text-xl font-black text-sky-950 tracking-tight">
                        {telemetryStats.hum.avg.toFixed(1)}
                      </span>
                      <span className="text-xs font-semibold text-sky-700">% avg</span>
                    </div>
                    <div className="mt-1 text-[11px] text-sky-600 font-medium">
                      Range: {telemetryStats.hum.min.toFixed(0)} – {telemetryStats.hum.max.toFixed(0)} %
                    </div>
                  </div>

                  {/* Ammonia */}
                  <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 transition hover:border-amber-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">
                        Ammonia (NH₃)
                      </span>
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-100/80 text-amber-600">
                        <Wind className="h-3.5 w-3.5" />
                      </div>
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <span className="text-xl font-black text-amber-950 tracking-tight">
                        {telemetryStats.ammonia.avg < 0.01
                          ? telemetryStats.ammonia.avg.toFixed(4)
                          : telemetryStats.ammonia.avg.toFixed(2)}
                      </span>
                      <span className="text-xs font-semibold text-amber-700">ppm avg</span>
                    </div>
                    <div className="mt-1 text-[11px] text-amber-600 font-medium">
                      Peak: {telemetryStats.ammonia.max < 0.01
                        ? telemetryStats.ammonia.max.toFixed(4)
                        : telemetryStats.ammonia.max.toFixed(2)} ppm
                    </div>
                  </div>

                  {/* Sound */}
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 transition hover:border-indigo-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-indigo-800 uppercase tracking-wider">
                        Acoustics
                      </span>
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100/80 text-indigo-600">
                        <Volume2 className="h-3.5 w-3.5" />
                      </div>
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <span className="text-xl font-black text-indigo-950 tracking-tight">
                        {telemetryStats.sound.avg.toFixed(1)}
                      </span>
                      <span className="text-xs font-semibold text-indigo-700">dBA avg</span>
                    </div>
                    <div className="mt-1 text-[11px] text-indigo-600 font-medium">
                      Range: {telemetryStats.sound.min.toFixed(0)} – {telemetryStats.sound.max.toFixed(0)} dBA
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Horizontal Scrollable Timeline Matrix of Interval Checkpoints */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Timeline Sequence (Left to Right)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Scroll horizontally to inspect each interval →
                  </span>
                </div>

                <div className="flex items-stretch gap-2.5 overflow-x-auto pb-2 pt-1 scrollbar-thin">
                  {filteredIntervals.map((interval, idx) => {
                    const isAlert = interval.heatStress !== 'Normal';
                    return (
                      <div
                        key={interval.id || idx}
                        className={`min-w-[155px] shrink-0 rounded-xl border p-2.5 transition-all shadow-xs ${
                          isAlert
                            ? 'border-amber-300 bg-amber-50/30'
                            : 'border-slate-200/80 bg-slate-50/50 hover:bg-white hover:border-slate-300'
                        }`}
                      >
                        {/* Checkpoint Header */}
                        <div className="flex items-center justify-between border-b border-slate-200/60 pb-1.5 mb-2">
                          <span className="font-mono text-xs font-bold text-slate-900">
                            {interval.timeSlot}
                          </span>
                          <span className="rounded-md bg-white border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                            {interval.dateLabel}
                          </span>
                        </div>

                        {/* Metric Readings Stack */}
                        <div className="space-y-1 font-mono text-[11px]">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-sans text-rose-700 font-medium flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Temp
                            </span>
                            <span className="font-bold text-slate-800">
                              {interval.tempC.toFixed(0)} °C
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-sans text-sky-700 font-medium flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Hum
                            </span>
                            <span className="font-bold text-slate-800">
                              {interval.humidityPct.toFixed(0)} %
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-sans text-amber-700 font-medium flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> NH₃
                            </span>
                            <span className="font-bold text-slate-800">
                              {interval.ammoniaPpm < 0.01
                                ? interval.ammoniaPpm.toFixed(4)
                                : interval.ammoniaPpm.toFixed(2)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-sans text-indigo-700 font-medium flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" /> Sound
                            </span>
                            <span className="font-bold text-slate-800">
                              {interval.soundDb.toFixed(0)} dBA
                            </span>
                          </div>
                        </div>

                        {/* Status Footer */}
                        <div className="mt-2 pt-1.5 border-t border-slate-200/50 flex items-center justify-between">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                              interval.heatStress === 'Emergency'
                                ? 'bg-red-100 text-red-700'
                                : interval.heatStress === 'Severe'
                                ? 'bg-rose-100 text-rose-700'
                                : interval.heatStress === 'Moderate'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {interval.heatStress}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            THI {interval.thi.toFixed(0)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Explanatory Footnotes */}
              <div className="border-t border-slate-100 pt-2.5 text-[11px] text-slate-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                <p>Line scales: temperature 0–40 °C · humidity 0–100% · ammonia 0–20 ppm · sound 0–100 dBA.</p>
                <p className="italic text-emerald-700 font-medium flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> Synchronized telemetry from paired sensors.sqlite and video inference.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ──────────────────────── 4. DETAILED TELEMETRY & CORRELATION LOG ──────────────────────── */}
      <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden">
        {/* Header bar */}
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100">
          <div>
            <h4 className="text-base font-bold text-slate-900">Detailed Telemetry &amp; Correlation Log</h4>
            <p className="mt-0.5 text-xs text-slate-500">
              Synchronized readings from paired <code className="text-orange-600 font-semibold font-mono">sensors.sqlite</code> and behavioral event counts.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search readings…"
                value={logSearchQuery}
                onChange={(e) => setLogSearchQuery(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-700 outline-none transition focus:border-orange-500"
              />
            </div>

            {/* Stress Filter */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
              <Filter className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
              <select
                aria-label="Filter stress state"
                value={logStressFilter}
                onChange={(e) => setLogStressFilter(e.target.value as typeof logStressFilter)}
                className="cursor-pointer bg-transparent font-medium text-slate-800 outline-none"
              >
                <option value="all">All conditions</option>
                <option value="normal">Comfortable only</option>
                <option value="alert">Needs attention</option>
              </select>
            </div>

            {/* Export CSV button */}
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5 text-slate-400" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Scrollable table container */}
        <div className="max-h-[480px] overflow-x-auto overflow-y-auto overscroll-contain">
          <table className="w-full min-w-[960px] border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-xs font-semibold text-slate-600">
              <tr>
                <th className="bg-slate-50 px-4 py-3 sm:px-6">INTERVAL &amp; TIME</th>
                <th className="bg-slate-50 px-4 py-3">PROFILE</th>
                <th className="bg-slate-50 px-4 py-3">BEHAVIOR EVENTS</th>
                <th className="bg-slate-50 px-4 py-3">TEMP (°C)</th>
                <th className="bg-slate-50 px-4 py-3">HUMIDITY (%)</th>
                <th className="bg-slate-50 px-4 py-3">AMMONIA (PPM)</th>
                <th className="bg-slate-50 px-4 py-3">SOUND (dBA)</th>
                <th className="bg-slate-50 px-4 py-3">HEAT COMFORT</th>
                <th className="bg-slate-50 px-4 py-3">WHAT TO DO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredLogEntries.map((interval) => {
                const counts = interval.behaviorsByBird[selectedBirdId] || {
                  reducedFeeding: 0,
                  reducedDrinking: 0,
                  prolongedInactivity: 0,
                  socialIsolation: 0,
                };
                const isAlert = interval.heatStress === 'Severe' || interval.heatStress === 'Emergency';

                return (
                  <tr key={interval.id} className="transition hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-4 py-3 sm:px-6">
                      <div className="font-semibold text-slate-800">{interval.intervalLabel}</div>
                      <div className="text-[11px] text-slate-400">{interval.fullTimeLabel}</div>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-700">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full ring-1 ring-slate-300" style={{ backgroundColor: selectedBird.tagColorHex }} />
                        <span>{selectedBird.name}</span>
                      </span>
                    </td>

                    {/* Behavior event badges */}
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1 font-mono text-[11px]">
                        <span className="rounded bg-orange-50 px-1.5 py-0.5 text-orange-700 font-semibold" title="Reduced feeding">
                          F:{counts.reducedFeeding}
                        </span>
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 font-semibold" title="Reduced drinking">
                          D:{counts.reducedDrinking}
                        </span>
                        <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-700 font-semibold" title="Prolonged low activity">
                          I:{counts.prolongedInactivity}
                        </span>
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 font-semibold" title="Social isolation">
                          S:{counts.socialIsolation}
                        </span>
                      </div>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-slate-800">
                      <span className={interval.tempC >= 30 ? 'text-rose-600 font-bold' : ''}>
                        {interval.tempC.toFixed(1)} °C
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-700">
                      {interval.humidityPct.toFixed(1)} %
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-slate-800">
                      <span className={interval.ammoniaPpm >= 5 ? 'text-amber-600 font-bold' : ''}>
                        {interval.ammoniaPpm < 0.01 ? interval.ammoniaPpm.toFixed(4) : interval.ammoniaPpm.toFixed(1)} ppm
                      </span>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-700">
                      {interval.soundDb.toFixed(1)} dBA
                    </td>

                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-800">{interval.thi.toFixed(1)}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            interval.heatStress === 'Emergency'
                              ? 'bg-rose-100 text-rose-800'
                              : interval.heatStress === 'Severe'
                              ? 'bg-orange-100 text-orange-800'
                              : interval.heatStress === 'Moderate'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {interval.heatStress === 'Emergency'
                            ? 'Immediate attention'
                            : interval.heatStress === 'Severe'
                            ? 'High risk'
                            : interval.heatStress === 'Moderate'
                            ? 'Watch closely'
                            : 'Comfortable'}
                        </span>
                      </div>
                    </td>

                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          isAlert
                            ? 'bg-orange-100 text-orange-800'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {isAlert ? 'Review conditions' : 'No concerns'}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {filteredLogEntries.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-xs text-slate-500">
                    No interval telemetry found matching this date filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info bar */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-5 py-2.5 text-[11px] text-slate-500 sm:px-6">
          <span>
            Showing <strong className="text-slate-700">{filteredLogEntries.length}</strong> interval records for{' '}
            <strong className="text-slate-700">{selectedBird.name}</strong> ({dateRangeLabel})
          </span>
          <span className="text-slate-400">Scroll table container to review all intervals</span>
        </div>
      </div>
    </div>
  );
}
