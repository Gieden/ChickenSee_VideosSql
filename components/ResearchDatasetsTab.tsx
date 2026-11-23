'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileSpreadsheet,
  Activity,
  Crosshair,
  Calendar,
  CloudSun,
  Search,
  Download,
  RefreshCw,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Eye,
  ShieldAlert,
  FolderArchive,
  Loader2,
} from 'lucide-react';
import {
  ObservationWindowRow,
  BehaviorEventRow,
  DetectionTrackingRow,
  EnvironmentReadingRow,
  ChickenIdDisplayFormat,
  ExcelSheetName,
} from '@/lib/research-datasets';
import { buildZipBlob } from '@/lib/simple-zip';

interface SheetMeta {
  key: ExcelSheetName;
  label: string;
  badgeLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SHEETS: SheetMeta[] = [
  {
    key: 'behavior_events',
    label: 'behavior_events',
    badgeLabel: 'Events',
    description: 'Timestamped behavioral bouts (feeding, drinking, inactive, feather pecking) per tracked chicken.',
    icon: Activity,
  },
  {
    key: 'detection_tracking',
    label: 'detection_tracking',
    badgeLabel: 'Detections',
    description: 'Frame-by-frame YOLOv8 + ByteTrack bounding boxes, visibility states, and spatial neighbor distances.',
    icon: Crosshair,
  },
  {
    key: 'observation_windows',
    label: 'observation_windows',
    badgeLabel: 'Windows',
    description: 'Per-bird tracking continuity, valid observation %, occlusion, and lost-track durations per analysis window.',
    icon: Calendar,
  },
  {
    key: 'environment_readings',
    label: 'environment_readings',
    badgeLabel: 'Sensors',
    description: 'High-frequency microclimate sensor readings (temperature, humidity, ammonia NH3, sound levels).',
    icon: CloudSun,
  },
];

export default function ResearchDatasetsTab() {
  const [activeSheet, setActiveSheet] = useState<ExcelSheetName>('behavior_events');
  const [selectedVideo, setSelectedVideo] = useState<string>('all');
  const [idFormat, setIdFormat] = useState<ChickenIdDisplayFormat>('short');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [liveEnabled, setLiveEnabled] = useState<boolean>(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>('');

  // Data states for the 4 sheets
  const [videos, setVideos] = useState<string[]>([]);
  const [videoDates, setVideoDates] = useState<Record<string, string>>({});
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedExportDate, setSelectedExportDate] = useState<string>('');
  const [exportingDay, setExportingDay] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<string>('');
  const [sheetCounts, setSheetCounts] = useState<Record<ExcelSheetName, number>>({
    behavior_events: 0,
    detection_tracking: 0,
    observation_windows: 0,
    environment_readings: 0,
  });
  const [behaviorEvents, setBehaviorEvents] = useState<BehaviorEventRow[]>([]);
  const [detectionTracking, setDetectionTracking] = useState<DetectionTrackingRow[]>([]);
  const [observationWindows, setObservationWindows] = useState<ObservationWindowRow[]>([]);
  const [environmentReadings, setEnvironmentReadings] = useState<EnvironmentReadingRow[]>([]);

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const fetchDataset = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const url = `/api/research-datasets?video=${encodeURIComponent(selectedVideo)}&sheet=all&_t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load research datasets');

      setVideos(data.videos || []);
      setVideoDates(data.videoDates || {});
      const dates: string[] = Array.isArray(data.availableDates) ? data.availableDates : [];
      setAvailableDates(dates);
      setSelectedExportDate((prev) => (prev && dates.includes(prev) ? prev : dates[0] || ''));
      setSheetCounts(data.sheetCounts || {
        behavior_events: 0,
        detection_tracking: 0,
        observation_windows: 0,
        environment_readings: 0,
      });
      setBehaviorEvents(data.behavior_events || []);
      setDetectionTracking(data.detection_tracking || []);
      setObservationWindows(data.observation_windows || []);
      setEnvironmentReadings(data.environment_readings || []);
      setLastUpdatedAt(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      );

      if (data.videos?.length > 0 && selectedVideo === 'all') {
        setSelectedVideo(data.defaultVideo || data.videos[0]);
      }
    } catch (err: unknown) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Error fetching research datasets.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedVideo]);

  useEffect(() => {
    fetchDataset(false);
  }, [fetchDataset]);

  // Real-time background polling every 5 seconds while tab is visible
  useEffect(() => {
    if (!liveEnabled) return;
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchDataset(true);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [liveEnabled, fetchDataset]);

  // Reset page when switching sheet, video, or searching
  useEffect(() => {
    setCurrentPage(1);
  }, [activeSheet, selectedVideo, searchQuery]);

  // Helper for chicken ID formatting
  const renderChickenId = useCallback(
    (item: { shortId: string; chId: string; profileLabel: string; dotColor: string }) => {
      let text = item.shortId;
      if (idFormat === 'ch') text = item.chId;
      else if (idFormat === 'profile') text = item.profileLabel;

      return (
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300"
            style={{ backgroundColor: item.dotColor }}
          />
          <span>{text}</span>
          {idFormat === 'short' && (
            <span className="font-sans text-[10px] font-normal text-slate-400">
              ({item.chId})
            </span>
          )}
        </span>
      );
    },
    [idFormat],
  );

  // Filtered rows for current sheet (hide social_isolation from display while threshold is being calibrated, without deleting underlying logs)
  const filteredBehaviorEvents = useMemo(() => {
    const visibleEvents = behaviorEvents.filter(
      (r) => r.behavior.toLowerCase() !== 'social_isolation',
    );
    const q = searchQuery.toLowerCase().trim();
    if (!q) return visibleEvents;
    return visibleEvents.filter(
      (r) =>
        r.video.toLowerCase().includes(q) ||
        r.chicken_id.toLowerCase().includes(q) ||
        r.behavior.toLowerCase().includes(q) ||
        r.saddle_color.toLowerCase().includes(q),
    );
  }, [behaviorEvents, searchQuery]);

  const filteredDetectionTracking = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return detectionTracking;
    return detectionTracking.filter(
      (r) =>
        r.chicken_id.toLowerCase().includes(q) ||
        r.saddle_color.toLowerCase().includes(q) ||
        r.visibility_status.toLowerCase().includes(q) ||
        String(r.frame_number).includes(q),
    );
  }, [detectionTracking, searchQuery]);

  const filteredObservationWindows = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return observationWindows;
    return observationWindows.filter(
      (r) =>
        r.video.toLowerCase().includes(q) ||
        r.chicken_id.toLowerCase().includes(q) ||
        r.profileLabel.toLowerCase().includes(q),
    );
  }, [observationWindows, searchQuery]);

  const filteredEnvironmentReadings = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return environmentReadings;
    return environmentReadings.filter(
      (r) =>
        r.timestamp.toLowerCase().includes(q) ||
        String(r.temperature_c).includes(q) ||
        String(r.ammonia_ppm).includes(q),
    );
  }, [environmentReadings, searchQuery]);

  // Current active list
  const currentTotal = useMemo(() => {
    if (activeSheet === 'behavior_events') return filteredBehaviorEvents.length;
    if (activeSheet === 'detection_tracking') return filteredDetectionTracking.length;
    if (activeSheet === 'observation_windows') return filteredObservationWindows.length;
    return filteredEnvironmentReadings.length;
  }, [
    activeSheet,
    filteredBehaviorEvents.length,
    filteredDetectionTracking.length,
    filteredObservationWindows.length,
    filteredEnvironmentReadings.length,
  ]);

  const totalPages = Math.max(1, Math.ceil(currentTotal / pageSize));

  // Shared CSV serializer
  const toCsvString = useCallback((headers: string[], rows: (string | number | boolean)[][]) => {
    return (
      '\uFEFF' +
      [
        headers.join(','),
        ...rows.map((row) =>
          row
            .map((val) => {
              const str = String(val ?? '');
              return str.includes(',') || str.includes('"') || str.includes('\n')
                ? `"${str.replace(/"/g, '""')}"`
                : str;
            })
            .join(','),
        ),
      ].join('\r\n')
    );
  }, []);

  const buildSheetCsv = useCallback(
    (
      sheet: ExcelSheetName,
      data: {
        behaviorEvents: BehaviorEventRow[];
        detectionTracking: DetectionTrackingRow[];
        observationWindows: ObservationWindowRow[];
        environmentReadings: EnvironmentReadingRow[];
      },
    ): string => {
      if (sheet === 'behavior_events') {
        const headers = [
          'video',
          'track_id',
          'chicken_id',
          'saddle_color',
          'identity_status',
          'behavior',
          'start_time',
          'end_time',
          'start_frame',
          'end_frame',
          'start_s',
          'end_s',
          'duration_s',
          'tracking_visible_pct',
          'mean_detection_conf',
          'nearest_distance_mean_px',
          'nearest_distance_min_px',
          'nearest_distance_max_px',
          'nearest_distance_mean_body_lengths',
          'nearest_distance_min_body_lengths',
          'nearest_distance_max_body_lengths',
        ];
        const rows = data.behaviorEvents
          .filter((r) => r.behavior.toLowerCase() !== 'social_isolation')
          .map((r) => [
            r.video,
            r.track_id,
            idFormat === 'ch' ? r.chId : idFormat === 'profile' ? r.profileLabel : r.shortId,
            r.saddle_color,
            r.identity_status,
            r.behavior,
            r.start_time,
            r.end_time,
            r.start_frame ?? '',
            r.end_frame ?? '',
            r.start_s,
            r.end_s,
            r.duration_s,
            r.tracking_visible_pct,
            r.mean_detection_conf,
            r.nearest_distance_mean_px,
            r.nearest_distance_min_px,
            r.nearest_distance_max_px,
            r.nearest_distance_mean_body_lengths,
            r.nearest_distance_min_body_lengths,
            r.nearest_distance_max_body_lengths,
          ]);
        return toCsvString(headers, rows);
      }

      if (sheet === 'detection_tracking') {
        const headers = [
          'timestamp',
          'frame_number',
          'chicken_id',
          'saddle_color',
          'track_id',
          'x_center_px',
          'y_center_px',
          'bbox_width_px',
          'bbox_height_px',
          'detection_confidence',
          'visibility_status',
          'in_feeder_zone',
          'in_waterer_zone',
          'nearest_neighbor_distance_px',
          'nearest_neighbor_distance_body_lengths',
          'visible_chicken_count',
        ];
        const rows = data.detectionTracking.map((r) => [
          r.timestamp,
          r.frame_number,
          idFormat === 'ch' ? r.chId : idFormat === 'profile' ? r.profileLabel : r.shortId,
          r.saddle_color,
          r.track_id,
          r.x_center_px,
          r.y_center_px,
          r.bbox_width_px,
          r.bbox_height_px,
          r.detection_confidence,
          r.visibility_status,
          r.in_feeder_zone ? 'TRUE' : 'FALSE',
          r.in_waterer_zone ? 'TRUE' : 'FALSE',
          r.nearest_neighbor_distance_px,
          r.nearest_neighbor_distance_body_lengths,
          r.visible_chicken_count,
        ]);
        return toCsvString(headers, rows);
      }

      if (sheet === 'observation_windows') {
        const headers = [
          'video',
          'chicken_id',
          'window_start',
          'window_end',
          'window_duration_s',
          'valid_observation_duration_s',
          'occluded_duration_s',
          'lost_duration_s',
          'valid_observation_pct',
        ];
        const rows = data.observationWindows.map((r) => [
          r.video,
          idFormat === 'ch' ? r.chId : idFormat === 'profile' ? r.profileLabel : r.shortId,
          r.window_start,
          r.window_end,
          r.window_duration_s,
          r.valid_observation_duration_s,
          r.occluded_duration_s,
          r.lost_duration_s,
          r.valid_observation_pct,
        ]);
        return toCsvString(headers, rows);
      }

      const headers = ['timestamp', 'temperature_c', 'humidity_pct', 'ammonia_ppm', 'sound_db'];
      const rows = data.environmentReadings.map((r) => [
        r.timestamp,
        r.temperature_c,
        r.humidity_pct,
        r.ammonia_ppm,
        r.sound_db,
      ]);
      return toCsvString(headers, rows);
    },
    [idFormat, toCsvString],
  );

  // CSV Export (current active sheet)
  const exportCurrentSheetCsv = useCallback(() => {
    const filename = `${activeSheet}_${selectedVideo || 'all'}_${new Date().toISOString().slice(0, 10)}.csv`;
    const csvContent = buildSheetCsv(activeSheet, {
      behaviorEvents: filteredBehaviorEvents,
      detectionTracking: filteredDetectionTracking,
      observationWindows: filteredObservationWindows,
      environmentReadings: filteredEnvironmentReadings,
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [
    activeSheet,
    buildSheetCsv,
    filteredBehaviorEvents,
    filteredDetectionTracking,
    filteredObservationWindows,
    filteredEnvironmentReadings,
    selectedVideo,
  ]);

  // Full-Day Multi-Sheet Export (.zip containing all 4 CSV sheets for all videos of a specific day)
  const videosCountByDate = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const vid of videos) {
      const d = videoDates[vid] || vid.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '';
      if (d) counts[d] = (counts[d] || 0) + 1;
    }
    return counts;
  }, [videos, videoDates]);

  const exportDayLogsZip = useCallback(async () => {
    if (!selectedExportDate || exportingDay) return;
    const dayVideos = videos
      .filter((vid) => {
        const d = videoDates[vid] || vid.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '';
        return d === selectedExportDate;
      })
      .sort((a, b) => a.localeCompare(b));

    if (dayVideos.length === 0) {
      setError(`No research logs found for ${selectedExportDate}.`);
      return;
    }

    setExportingDay(true);
    setError(null);
    setExportProgress(`0/${dayVideos.length}`);

    try {
      const allBehavior: BehaviorEventRow[] = [];
      const allDetection: DetectionTrackingRow[] = [];
      const allObs: ObservationWindowRow[] = [];
      const envMap = new Map<string, EnvironmentReadingRow>();

      for (let i = 0; i < dayVideos.length; i++) {
        const vid = dayVideos[i];
        setExportProgress(`${i + 1}/${dayVideos.length}`);
        const url = `/api/research-datasets?video=${encodeURIComponent(vid)}&sheet=all&export=1&_t=${Date.now()}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const payload = await res.json();

        if (Array.isArray(payload.behavior_events)) {
          allBehavior.push(...payload.behavior_events);
        }
        if (Array.isArray(payload.detection_tracking)) {
          allDetection.push(...payload.detection_tracking);
        }
        if (Array.isArray(payload.observation_windows)) {
          allObs.push(...payload.observation_windows);
        }
        if (Array.isArray(payload.environment_readings)) {
          for (const row of payload.environment_readings as EnvironmentReadingRow[]) {
            if (!row?.timestamp) continue;
            if (!envMap.has(row.timestamp)) {
              envMap.set(row.timestamp, row);
            }
          }
        }
      }

      // Fallback: if environment_readings is empty (e.g. on Vercel without live SQLite metrics),
      // pull matching date's session summaries from /api/database (paired sensors.sqlite).
      if (envMap.size === 0) {
        try {
          const dbRes = await fetch(`/api/database?_t=${Date.now()}`, { cache: 'no-store' });
          if (dbRes.ok) {
            const dbData = await dbRes.json();
            const dbs = Array.isArray(dbData.databases) ? dbData.databases : [];
            for (const dbItem of dbs) {
              const folder = String(dbItem.folder || dbItem.name || '');
              if (!folder.includes(selectedExportDate)) continue;
              const sum = dbItem.summary;
              if (!sum) continue;
              const timeMatch = folder.match(/\d{4}-\d{2}-\d{2}_(\d{2})-(\d{2})-(\d{2})/);
              const ts = timeMatch
                ? `${selectedExportDate} ${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`
                : `${selectedExportDate} 00:00:00`;
              if (!envMap.has(ts)) {
                envMap.set(ts, {
                  timestamp: ts,
                  temperature_c: Number(sum.avgTemp) || 0,
                  humidity_pct: Number(sum.avgHumidity) || 0,
                  ammonia_ppm: Number(sum.avgAmmonia) || 0,
                  sound_db: Number(sum.avgSound) || 0,
                });
              }
            }
          }
        } catch {
          // Ignore optional fallback errors
        }
      }

      const allEnv = Array.from(envMap.values()).sort((a, b) =>
        a.timestamp.localeCompare(b.timestamp),
      );
      const visibleBehavior = allBehavior.filter(
        (r) => r.behavior.toLowerCase() !== 'social_isolation',
      );

      const datasetBundle = {
        behaviorEvents: visibleBehavior,
        detectionTracking: allDetection,
        observationWindows: allObs,
        environmentReadings: allEnv,
      };

      const summaryText = [
        `ChickenSee Research Logs — Full Day Export`,
        `Date: ${selectedExportDate}`,
        `Exported At: ${new Date().toISOString()}`,
        `Chicken ID Format: ${idFormat}`,
        `Included Videos (${dayVideos.length}):`,
        ...dayVideos.map((v) => `  - ${v}`),
        ``,
        `Row Counts:`,
        `  - behavior_events_${selectedExportDate}.csv: ${visibleBehavior.length} rows`,
        `  - detection_tracking_${selectedExportDate}.csv: ${allDetection.length} rows`,
        `  - observation_windows_${selectedExportDate}.csv: ${allObs.length} rows`,
        `  - environment_readings_${selectedExportDate}.csv: ${allEnv.length} rows`,
      ].join('\r\n');

      const zipBlob = buildZipBlob([
        {
          name: `behavior_events_${selectedExportDate}.csv`,
          content: buildSheetCsv('behavior_events', datasetBundle),
        },
        {
          name: `detection_tracking_${selectedExportDate}.csv`,
          content: buildSheetCsv('detection_tracking', datasetBundle),
        },
        {
          name: `observation_windows_${selectedExportDate}.csv`,
          content: buildSheetCsv('observation_windows', datasetBundle),
        },
        {
          name: `environment_readings_${selectedExportDate}.csv`,
          content: buildSheetCsv('environment_readings', datasetBundle),
        },
        {
          name: `README_${selectedExportDate}.txt`,
          content: summaryText,
        },
      ]);

      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `chickensee_research_logs_${selectedExportDate}.zip`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to download logs for ${selectedExportDate}.`,
      );
    } finally {
      setExportingDay(false);
      setExportProgress('');
    }
  }, [selectedExportDate, exportingDay, videos, videoDates, idFormat, buildSheetCsv]);

  return (
    <div className="space-y-6">
      {/* ── Top Header Title & Sheet Nav Bar ───────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-bold text-orange-800">
              <FileSpreadsheet className="h-3.5 w-3.5 text-orange-600" />
              <span>Poultry Research Dataset · Multi-Sheet Log</span>
            </div>
            <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Research & Tracking Datasets
            </h1>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              Standardized behavioral analysis, computer-vision detections, observation windows, and microclimate telemetry.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {videos.length > 0 && selectedVideo !== 'all' && selectedVideo !== videos[0] && (
              <button
                type="button"
                onClick={() => setSelectedVideo(videos[0])}
                title={`Switch to latest processed video: ${videos[0]}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-orange-300 bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-800 transition hover:bg-orange-100"
              >
                <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
                <span className="max-w-[160px] truncate">Latest: {videos[0]}</span>
              </button>
            )}
            <button
              onClick={() => setLiveEnabled((prev) => !prev)}
              title={liveEnabled ? 'Real-time polling active (every 5s) — click to pause' : 'Real-time polling paused — click to resume'}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                liveEnabled
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : 'border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="relative flex h-2 w-2">
                {liveEnabled && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    liveEnabled ? 'bg-emerald-500' : 'bg-slate-400'
                  }`}
                />
              </span>
              <span>{liveEnabled ? 'Live · 5s' : 'Paused'}</span>
              {lastUpdatedAt && (
                <span className="hidden text-[10px] font-normal opacity-75 sm:inline">
                  ({lastUpdatedAt})
                </span>
              )}
            </button>
            <button
              onClick={() => fetchDataset(false)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              onClick={exportCurrentSheetCsv}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-orange-700 active:scale-95"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export {activeSheet}.csv</span>
            </button>
          </div>
        </div>

        {/* ── Download All Logs for a Specific Day (.zip) ──────────────────── */}
        {availableDates.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-200/80 bg-orange-50/50 px-3.5 py-2.5">
            <div className="flex items-center gap-2 text-xs text-slate-700">
              <FolderArchive className="h-4 w-4 shrink-0 text-orange-600" />
              <span className="font-semibold text-slate-800">Download All Day Logs:</span>
              <span className="hidden text-slate-500 sm:inline">
                Exports all 4 sheets (behavior, tracking, windows, sensors) across every video recorded on that day.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-slate-500" />
                <select
                  aria-label="Select date to download all logs"
                  value={selectedExportDate}
                  onChange={(e) => setSelectedExportDate(e.target.value)}
                  disabled={exportingDay}
                  className="rounded-lg border border-orange-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-xs focus:border-orange-500 focus:outline-hidden disabled:opacity-60"
                >
                  {availableDates.map((d) => {
                    const count = videosCountByDate[d] || 0;
                    return (
                      <option key={d} value={d}>
                        {d} ({count} {count === 1 ? 'video' : 'videos'})
                      </option>
                    );
                  })}
                </select>
              </div>
              <button
                type="button"
                onClick={exportDayLogsZip}
                disabled={exportingDay || !selectedExportDate}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-900 bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportingDay ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Bundling {selectedExportDate} ({exportProgress})...</span>
                  </>
                ) : (
                  <>
                    <Download className="h-3.5 w-3.5" />
                    <span>Download All Logs (.zip)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── THE 4-SHEET EXCEL NAV BAR ────────────────────────────────────── */}
        <div className="mt-6 border-b border-slate-200">
          <nav aria-label="Dataset Sheets" className="flex flex-wrap gap-2 sm:gap-3">
            {SHEETS.map((sheet) => {
              const Icon = sheet.icon;
              const isActive = activeSheet === sheet.key;
              const count = sheetCounts[sheet.key] || 0;
              return (
                <button
                  key={sheet.key}
                  type="button"
                  onClick={() => setActiveSheet(sheet.key)}
                  className={`group relative flex items-center gap-2 rounded-t-xl px-4 py-3 text-xs font-semibold transition sm:text-sm ${
                    isActive
                      ? 'border-b-2 border-orange-600 bg-orange-50/60 text-orange-950 font-bold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 ${
                      isActive ? 'text-orange-600' : 'text-slate-400 group-hover:text-slate-600'
                    }`}
                  />
                  <span className="font-mono">{sheet.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      isActive
                        ? 'bg-orange-600 text-white'
                        : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Description Banner for Active Sheet */}
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>{SHEETS.find((s) => s.key === activeSheet)?.description}</span>
          <span className="font-mono font-medium text-slate-700">
            Active Sheet: <strong className="text-orange-700">{activeSheet}</strong>
          </span>
        </div>
      </div>

      {/* ── Global Sheet Controls (Video Filter, ID Format, Search) ────────── */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {/* Video Filter (for sheets with video column) */}
          {activeSheet !== 'environment_readings' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-slate-600">Video:</span>
              <select
                value={selectedVideo}
                onChange={(e) => setSelectedVideo(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-xs focus:border-orange-500 focus:outline-hidden"
              >
                <option value="all">All Videos</option>
                {videos.map((vid) => (
                  <option key={vid} value={vid}>
                    {vid === 'rec_2026-11-13_07-00-00_060564__video' ? '★ ' + vid + ' (Raw Research Dataset)' : vid}
                  </option>
                ))}
              </select>
              {selectedVideo.includes('2026-11-13') ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  Exact Research Data (ChickenSee-Raw-Data.xlsx)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                  Analyzed Video Telemetry
                </span>
              )}
            </div>
          )}

          {/* Chicken ID Format Toggle */}
          {activeSheet !== 'environment_readings' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-slate-600">ID Format:</span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setIdFormat('short')}
                  className={`rounded-md px-2 py-0.5 transition ${
                    idFormat === 'short'
                      ? 'bg-white font-bold text-orange-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  H1...R1
                </button>
                <button
                  type="button"
                  onClick={() => setIdFormat('ch')}
                  className={`rounded-md px-2 py-0.5 transition ${
                    idFormat === 'ch'
                      ? 'bg-white font-bold text-orange-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  CH01...CH06
                </button>
                <button
                  type="button"
                  onClick={() => setIdFormat('profile')}
                  className={`rounded-md px-2 py-0.5 transition ${
                    idFormat === 'profile'
                      ? 'bg-white font-bold text-orange-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Profiles
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${activeSheet}...`}
            className="w-full rounded-lg border border-slate-300 bg-slate-50/50 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-orange-500 focus:bg-white focus:outline-hidden"
          />
        </div>
      </div>

      {/* ── KPI Summary Cards (Sheet-Specific) ──────────────────────────────── */}
      {activeSheet === 'behavior_events' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Events</div>
            <div className="mt-1 font-mono text-xl font-bold text-slate-900">{filteredBehaviorEvents.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mean Duration</div>
            <div className="mt-1 font-mono text-xl font-bold text-orange-600">
              {filteredBehaviorEvents.length
                ? (
                    filteredBehaviorEvents.reduce((acc, r) => acc + r.duration_s, 0) /
                    filteredBehaviorEvents.length
                  ).toFixed(1)
                : 0}{' '}
              s
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Feeding Bouts</div>
            <div className="mt-1 font-mono text-xl font-bold text-emerald-600">
              {filteredBehaviorEvents.filter((r) => r.behavior === 'feeding').length}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Drinking Bouts</div>
            <div className="mt-1 font-mono text-xl font-bold text-blue-600">
              {filteredBehaviorEvents.filter((r) => r.behavior === 'drinking').length}
            </div>
          </div>
        </div>
      )}

      {activeSheet === 'detection_tracking' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tracked Detections</div>
            <div className="mt-1 font-mono text-xl font-bold text-slate-900">{filteredDetectionTracking.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mean Detection Conf</div>
            <div className="mt-1 font-mono text-xl font-bold text-emerald-600">
              {filteredDetectionTracking.length
                ? (
                    filteredDetectionTracking.reduce((acc, r) => acc + r.detection_confidence, 0) /
                    filteredDetectionTracking.length
                  ).toFixed(2)
                : '0.00'}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mean Neighbor Distance</div>
            <div className="mt-1 font-mono text-xl font-bold text-slate-800">
              {filteredDetectionTracking.length
                ? (
                    filteredDetectionTracking.reduce((acc, r) => acc + r.nearest_neighbor_distance_body_lengths, 0) /
                    filteredDetectionTracking.length
                  ).toFixed(2)
                : '0.00'}{' '}
              <span className="text-xs font-normal text-slate-500">lengths</span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Visible Rate</div>
            <div className="mt-1 font-mono text-xl font-bold text-blue-600">
              {filteredDetectionTracking.length
                ? (
                    (filteredDetectionTracking.filter((r) => r.visibility_status === 'visible').length /
                      filteredDetectionTracking.length) *
                    100
                  ).toFixed(1)
                : 0}
              %
            </div>
          </div>
        </div>
      )}

      {activeSheet === 'observation_windows' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Identified Birds</div>
            <div className="mt-1 font-mono text-xl font-bold text-slate-900">6 Profiles (H1–H5, R1)</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mean Valid Observation %</div>
            <div className="mt-1 font-mono text-xl font-bold text-emerald-600">
              {filteredObservationWindows.length
                ? (
                    filteredObservationWindows.reduce((acc, r) => acc + r.valid_observation_pct, 0) /
                    filteredObservationWindows.length
                  ).toFixed(1)
                : 0}
              %
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mean Occluded Duration</div>
            <div className="mt-1 font-mono text-xl font-bold text-amber-600">
              {filteredObservationWindows.length
                ? Math.round(
                    filteredObservationWindows.reduce((acc, r) => acc + r.occluded_duration_s, 0) /
                      filteredObservationWindows.length,
                  )
                : 0}{' '}
              s
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mean Lost Duration</div>
            <div className="mt-1 font-mono text-xl font-bold text-rose-600">
              {filteredObservationWindows.length
                ? Math.round(
                    filteredObservationWindows.reduce((acc, r) => acc + r.lost_duration_s, 0) /
                      filteredObservationWindows.length,
                  )
                : 0}{' '}
              s
            </div>
          </div>
        </div>
      )}

      {activeSheet === 'environment_readings' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Avg Temperature</div>
            <div className="mt-1 font-mono text-xl font-bold text-orange-600">
              {filteredEnvironmentReadings.length
                ? (
                    filteredEnvironmentReadings.reduce((acc, r) => acc + r.temperature_c, 0) /
                    filteredEnvironmentReadings.length
                  ).toFixed(1)
                : 0}{' '}
              °C
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Avg Humidity</div>
            <div className="mt-1 font-mono text-xl font-bold text-blue-600">
              {filteredEnvironmentReadings.length
                ? (
                    filteredEnvironmentReadings.reduce((acc, r) => acc + r.humidity_pct, 0) /
                    filteredEnvironmentReadings.length
                  ).toFixed(1)
                : 0}{' '}
              %
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Avg Ammonia (NH3)</div>
            <div className="mt-1 font-mono text-xl font-bold text-emerald-600">
              {filteredEnvironmentReadings.length
                ? (
                    filteredEnvironmentReadings.reduce((acc, r) => acc + r.ammonia_ppm, 0) /
                    filteredEnvironmentReadings.length
                  ).toFixed(2)
                : 0}{' '}
              ppm
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Avg Sound Level</div>
            <div className="mt-1 font-mono text-xl font-bold text-slate-800">
              {filteredEnvironmentReadings.length
                ? (
                    filteredEnvironmentReadings.reduce((acc, r) => acc + r.sound_db, 0) /
                    filteredEnvironmentReadings.length
                  ).toFixed(1)
                : 0}{' '}
              dB
            </div>
          </div>
        </div>
      )}

      {/* ── Table Container ────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
        <div className="overflow-x-auto">
          {/* SHEET 1: behavior_events */}
          {activeSheet === 'behavior_events' && (
            <table className="w-full min-w-[1200px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-orange-700 bg-[#b45309] text-[11px] font-bold text-white">
                  <th className="py-2.5 px-4 border-r border-orange-600/60">video</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-center">track_id</th>
                  <th className="py-2.5 px-4 border-r border-orange-600/60">chicken_id</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60">saddle_color</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60">identity_status</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60">behavior</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60">start_time</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60">end_time</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-center">frames</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-right">start_s</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-right">end_s</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-right">duration_s</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-right">tracking_visible_pct</th>
                  <th className="py-2.5 px-3 text-right">mean_detection_conf</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono text-xs">
                {filteredBehaviorEvents
                  .slice((currentPage - 1) * pageSize, currentPage * pageSize)
                  .map((row, idx) => (
                    <tr
                      key={`${row.video}_${row.track_id}_${row.start_s}_${idx}`}
                      className={idx % 2 === 0 ? 'bg-white hover:bg-orange-50/40' : 'bg-slate-50/60 hover:bg-orange-50/40'}
                    >
                      <td className="py-2 px-4 border-r border-slate-200 text-slate-800">{row.video}</td>
                      <td className="py-2 px-3 border-r border-slate-200 text-center font-bold text-slate-700">
                        {row.track_id}
                      </td>
                      <td className="py-2 px-4 border-r border-slate-200">{renderChickenId(row)}</td>
                      <td className="py-2 px-3 border-r border-slate-200 capitalize text-slate-700">
                        {row.saddle_color}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-[11px] text-slate-600">
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-sans font-medium text-slate-700">
                          {row.identity_status}
                        </span>
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 font-bold capitalize text-slate-900">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 font-sans text-[11px] ${
                            row.behavior === 'feeding'
                              ? 'bg-emerald-100 text-emerald-800'
                              : row.behavior === 'drinking'
                              ? 'bg-blue-100 text-blue-800'
                              : row.behavior === 'feather_pecking'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {row.behavior}
                        </span>
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-slate-600">{row.start_time}</td>
                      <td className="py-2 px-3 border-r border-slate-200 text-slate-600">{row.end_time}</td>
                      <td className="py-2 px-3 border-r border-slate-200 text-center font-mono text-[11px] font-semibold text-indigo-700">
                        {row.start_frame != null && row.end_frame != null
                          ? `#${row.start_frame}–${row.end_frame}`
                          : '—'}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-right text-slate-700">
                        {row.start_s.toFixed(1)}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-right text-slate-700">
                        {row.end_s.toFixed(1)}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-right font-bold text-slate-900">
                        {row.duration_s.toFixed(1)}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-right font-semibold text-emerald-700">
                        {row.tracking_visible_pct.toFixed(1)}%
                      </td>
                      <td className="py-2 px-3 text-right text-slate-700">
                        {row.mean_detection_conf.toFixed(2)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          {/* SHEET 2: detection_tracking */}
          {activeSheet === 'detection_tracking' && (
            <table className="w-full min-w-[1300px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-orange-700 bg-[#b45309] text-[11px] font-bold text-white">
                  <th className="py-2.5 px-4 border-r border-orange-600/60">timestamp</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-right">frame_number</th>
                  <th className="py-2.5 px-4 border-r border-orange-600/60">chicken_id</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60">saddle_color</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-center">track_id</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-right">x_center_px</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-right">y_center_px</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-right">bbox_w</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-right">bbox_h</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-right">detection_conf</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-center">visibility_status</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-center">in_feeder_zone</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-center">in_waterer_zone</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-right">neighbor_dist_px</th>
                  <th className="py-2.5 px-3 border-r border-orange-600/60 text-right">neighbor_dist_bl</th>
                  <th className="py-2.5 px-3 text-center">visible_count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono text-xs">
                {filteredDetectionTracking
                  .slice((currentPage - 1) * pageSize, currentPage * pageSize)
                  .map((row, idx) => (
                    <tr
                      key={`${row.timestamp}_${row.frame_number}_${row.chicken_id}_${idx}`}
                      className={idx % 2 === 0 ? 'bg-white hover:bg-orange-50/40' : 'bg-slate-50/60 hover:bg-orange-50/40'}
                    >
                      <td className="py-2 px-4 border-r border-slate-200 text-slate-800">{row.timestamp}</td>
                      <td className="py-2 px-3 border-r border-slate-200 text-right font-semibold text-slate-900">
                        {row.frame_number}
                      </td>
                      <td className="py-2 px-4 border-r border-slate-200">{renderChickenId(row)}</td>
                      <td className="py-2 px-3 border-r border-slate-200 capitalize text-slate-700">
                        {row.saddle_color}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-center font-bold text-slate-700">
                        {row.track_id}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-right text-slate-800">{row.x_center_px}</td>
                      <td className="py-2 px-3 border-r border-slate-200 text-right text-slate-800">{row.y_center_px}</td>
                      <td className="py-2 px-3 border-r border-slate-200 text-right text-slate-600">{row.bbox_width_px}</td>
                      <td className="py-2 px-3 border-r border-slate-200 text-right text-slate-600">{row.bbox_height_px}</td>
                      <td className="py-2 px-3 border-r border-slate-200 text-right font-semibold text-emerald-700">
                        {row.detection_confidence.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-center font-sans text-[11px]">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 font-bold ${
                            row.visibility_status === 'visible'
                              ? 'bg-emerald-100 text-emerald-800'
                              : row.visibility_status === 'occluded'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {row.visibility_status}
                        </span>
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-center font-sans text-[11px]">
                        {row.in_feeder_zone ? (
                          <span className="font-bold text-emerald-700">TRUE</span>
                        ) : (
                          <span className="text-slate-400">FALSE</span>
                        )}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-center font-sans text-[11px]">
                        {row.in_waterer_zone ? (
                          <span className="font-bold text-blue-700">TRUE</span>
                        ) : (
                          <span className="text-slate-400">FALSE</span>
                        )}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-right text-slate-800">
                        {row.nearest_neighbor_distance_px.toFixed(1)}
                      </td>
                      <td className="py-2 px-3 border-r border-slate-200 text-right text-slate-800">
                        {row.nearest_neighbor_distance_body_lengths.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-center font-bold text-slate-900">{row.visible_chicken_count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          {/* SHEET 3: observation_windows */}
          {activeSheet === 'observation_windows' && (
            <table className="w-full min-w-[980px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-orange-700 bg-[#b45309] text-[11px] font-bold text-white">
                  <th className="py-2.5 px-4 border-r border-orange-600/60">video</th>
                  <th className="py-2.5 px-4 border-r border-orange-600/60">chicken_id</th>
                  <th className="py-2.5 px-4 border-r border-orange-600/60">window_start</th>
                  <th className="py-2.5 px-4 border-r border-orange-600/60">window_end</th>
                  <th className="py-2.5 px-4 border-r border-orange-600/60 text-right">window_duration_s</th>
                  <th className="py-2.5 px-4 border-r border-orange-600/60 text-right">valid_observation_duration_s</th>
                  <th className="py-2.5 px-4 border-r border-orange-600/60 text-right">occluded_duration_s</th>
                  <th className="py-2.5 px-4 border-r border-orange-600/60 text-right">lost_duration_s</th>
                  <th className="py-2.5 px-4 text-right">valid_observation_pct</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono text-xs">
                {filteredObservationWindows
                  .slice((currentPage - 1) * pageSize, currentPage * pageSize)
                  .map((row, idx) => (
                    <tr
                      key={`${row.video}_${row.chicken_id}_${idx}`}
                      className={idx % 2 === 0 ? 'bg-white hover:bg-orange-50/40' : 'bg-slate-50/60 hover:bg-orange-50/40'}
                    >
                      <td className="py-2.5 px-4 border-r border-slate-200 text-slate-800">{row.video}</td>
                      <td className="py-2.5 px-4 border-r border-slate-200">{renderChickenId(row)}</td>
                      <td className="py-2.5 px-4 border-r border-slate-200 text-slate-700">{row.window_start}</td>
                      <td className="py-2.5 px-4 border-r border-slate-200 text-slate-700">{row.window_end}</td>
                      <td className="py-2.5 px-4 border-r border-slate-200 text-right text-slate-900">
                        {row.window_duration_s}
                      </td>
                      <td className="py-2.5 px-4 border-r border-slate-200 text-right font-semibold text-slate-900">
                        {row.valid_observation_duration_s}
                      </td>
                      <td className="py-2.5 px-4 border-r border-slate-200 text-right text-slate-700">
                        {row.occluded_duration_s}
                      </td>
                      <td className="py-2.5 px-4 border-r border-slate-200 text-right text-slate-700">
                        {row.lost_duration_s}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-emerald-700">
                        {row.valid_observation_pct.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          {/* SHEET 4: environment_readings */}
          {activeSheet === 'environment_readings' && (
            <table className="w-full min-w-[700px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-orange-700 bg-[#b45309] text-[11px] font-bold text-white">
                  <th className="py-2.5 px-4 border-r border-orange-600/60">timestamp</th>
                  <th className="py-2.5 px-4 border-r border-orange-600/60 text-right">temperature_c</th>
                  <th className="py-2.5 px-4 border-r border-orange-600/60 text-right">humidity_pct</th>
                  <th className="py-2.5 px-4 border-r border-orange-600/60 text-right">ammonia_ppm</th>
                  <th className="py-2.5 px-4 text-right">sound_db</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono text-xs">
                {filteredEnvironmentReadings
                  .slice((currentPage - 1) * pageSize, currentPage * pageSize)
                  .map((row, idx) => (
                    <tr
                      key={`${row.timestamp}_${idx}`}
                      className={idx % 2 === 0 ? 'bg-white hover:bg-orange-50/40' : 'bg-slate-50/60 hover:bg-orange-50/40'}
                    >
                      <td className="py-2 px-4 border-r border-slate-200 text-slate-800">{row.timestamp}</td>
                      <td className="py-2 px-4 border-r border-slate-200 text-right font-semibold text-orange-700">
                        {row.temperature_c.toFixed(1)}
                      </td>
                      <td className="py-2 px-4 border-r border-slate-200 text-right font-semibold text-blue-700">
                        {row.humidity_pct.toFixed(1)}
                      </td>
                      <td className="py-2 px-4 border-r border-slate-200 text-right font-semibold text-emerald-700">
                        {row.ammonia_ppm.toFixed(3)}
                      </td>
                      <td className="py-2 px-4 text-right text-slate-800">{row.sound_db.toFixed(1)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination Controls ────────────────────────────────────────── */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>
              Showing {currentTotal > 0 ? (currentPage - 1) * pageSize + 1 : 0} to{' '}
              {Math.min(currentPage * pageSize, currentTotal)} of <strong>{currentTotal}</strong> rows
            </span>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-1">
              <span>Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white p-1 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
              title="Previous Page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 font-mono text-xs text-slate-700">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white p-1 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
              title="Next Page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
