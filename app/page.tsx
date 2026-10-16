'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Video,
  Database,
  RefreshCw,
  LogOut,
  Play,
  Download,
  Calendar,
  HardDrive,
  ChevronLeft,
  ChevronRight,
  Server,
  FileCode,
  Clock,
  Radio,
  Trash2,
  BarChart2,
  Activity,
  Bird,
  Droplets,
  AlertTriangle,
  Eye,
  X,
  Thermometer,
  Wind,
  Gauge,
  Search,
} from 'lucide-react';

interface SyncedFileMeta {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
}

interface QueryResult {
  columns: string[];
  values: any[][];
  totalRows: number;
}

interface BehaviorResult {
  result_id: string;
  job_id: number;
  video_file: string;
  interval_label: string;
  chunk_start: string;
  chunk_end: string;
  processed_at: string;
  bird_count: number;
  avg_birds_in_frame: number;
  eating_count: number;
  feeding_time_s: number;
  reduced_eating_events: number;
  reduced_eating_index_pct: number | null;
  drinking_count: number;
  drinking_time_s: number;
  inactive_count: number;
  inactivity_pct: number;
  inactivity_time_s: number;
  feather_pecking_count: number;
  agitation_score: number;
  avg_velocity: number;
  temp_avg: number | null;
  temp_min: number | null;
  temp_max: number | null;
  humidity_avg: number | null;
  humidity_min: number | null;
  humidity_max: number | null;
  ammonia_avg: number | null;
  ammonia_max: number | null;
  lux_avg: number | null;
  thi_avg: number | null;
  sound_avg_db: number | null;
  heat_stress_level: string;
  sensor_data_available: boolean;
  bird_records: BirdBehaviorRecord[];
  result_file: string;
  detected_video: string | null;
}

interface BirdBehaviorRecord {
  track_id: number;
  bird_label: string;
  bird_type: string;
  feeding_s: number;
  feeding_bouts: number;
  reduced_eating_flag: number;
  drinking_s: number;
  drinking_bouts: number;
  inactivity_s: number;
  is_lethargic: number;
  pecking_aggressor_count: number;
  pecking_victim_count: number;
  avg_velocity_px_s: number;
}

const REPORT_PROFILES = [
  'Flock',
  'Rooster',
  'Hen1 (Green)',
  'Hen2 (White)',
  'Hen3 (Blue)',
  'Hen4 (Yellow)',
  'Hen5 (Pink)',
] as const;

const REPORT_BEHAVIORS = [
  { key: 'feeding', label: 'Feeding bouts' },
  { key: 'drinking', label: 'Drinking bouts' },
  { key: 'inactivity', label: 'Inactivity (%)' },
  { key: 'pecking', label: 'Feather pecking events' },
  { key: 'reducedEating', label: 'Reduced-eating events' },
] as const;

const REPORT_SENSORS = [
  { key: 'temperature', label: 'Temperature', unit: '°C' },
  { key: 'humidity', label: 'Humidity', unit: '%' },
  { key: 'ammonia', label: 'Ammonia', unit: 'ppm' },
  { key: 'thi', label: 'THI', unit: '' },
  { key: 'light', label: 'Light', unit: 'lux' },
  { key: 'sound', label: 'Sound', unit: 'dB' },
] as const;

export default function DashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'videos' | 'database' | 'results'>('videos');

  const [videos, setVideos] = useState<SyncedFileMeta[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<SyncedFileMeta | null>(null);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [databases, setDatabases] = useState<SyncedFileMeta[]>([]);
  const [currentDbFile, setCurrentDbFile] = useState<string | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [loadingDb, setLoadingDb] = useState(true);
  const [pageOffset, setPageOffset] = useState(0);
  const pageSize = 50;

  const [results, setResults] = useState<BehaviorResult[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [selectedReportProfile, setSelectedReportProfile] =
    useState<(typeof REPORT_PROFILES)[number]>('Flock');
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [chartBehavior, setChartBehavior] =
    useState<(typeof REPORT_BEHAVIORS)[number]['key']>('pecking');
  const [chartSensor, setChartSensor] =
    useState<(typeof REPORT_SENSORS)[number]['key']>('ammonia');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);

  // ── Custom Modal State ──
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{
    success: boolean;
    message: string;
    freedMB?: number;
    deletedCount?: number;
  } | null>(null);

  function handleCleanupOldVideos() {
    setShowCleanupConfirm(true);
  }

  async function executeCleanup() {
    setShowCleanupConfirm(false);
    try {
      setIsCleaning(true);
      const res = await fetch('/api/cron/cleanup?days=7', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setCleanupResult({
          success: true,
          message: data.message || `Deleted ${data.deletedFiles?.length ?? 0} video(s).`,
          freedMB: data.freedMB ?? 0,
          deletedCount: data.deletedFiles?.length ?? 0,
        });
        fetchVideos();
      } else {
        setCleanupResult({
          success: false,
          message: data.error || 'Cleanup failed. Please try again.',
        });
      }
    } catch (err: any) {
      setCleanupResult({
        success: false,
        message: err.message || 'Network error during cleanup.',
      });
    } finally {
      setIsCleaning(false);
    }
  }

  async function fetchVideos() {
    try {
      setLoadingVideos(true);
      const res = await fetch('/api/videos');
      if (res.status === 401) { router.push('/login'); return; }
      const data = await res.json();
      const vids: SyncedFileMeta[] = data.videos || [];
      setVideos(vids);
      if (!selectedVideo && vids.length > 0) setSelectedVideo(vids[0]);
    } catch (err) {
      console.error('Failed to fetch videos:', err);
    } finally {
      setLoadingVideos(false);
    }
  }

  async function fetchDatabaseData(file?: string, table?: string, offset: number = 0) {
    try {
      setLoadingDb(true);
      const params = new URLSearchParams();
      if (file) params.set('file', file);
      if (table) params.set('table', table);
      params.set('limit', pageSize.toString());
      params.set('offset', offset.toString());
      const res = await fetch(`/api/database?${params.toString()}`);
      if (res.status === 401) { router.push('/login'); return; }
      const data = await res.json();
      setDatabases(data.databases || []);
      setCurrentDbFile(data.currentFile);
      setTables(data.tables || []);
      setSelectedTable(data.selectedTable);
      setQueryResult(data.queryResult);
      setPageOffset(offset);
    } catch (err) {
      console.error('Failed to fetch database data:', err);
    } finally {
      setLoadingDb(false);
    }
  }

  const fetchResults = useCallback(async () => {
    try {
      setLoadingResults(true);
      setResultsError(null);
      const res = await fetch('/api/results');
      if (res.status === 401) { router.push('/login'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      setResults(Array.isArray(data.results) ? data.results : []);
    } catch (err: any) {
      setResultsError(err.message || 'Could not load uploaded analysis results.');
    } finally {
      setLoadingResults(false);
    }
  }, [router]);

  async function refreshAll() {
    setIsRefreshing(true);
    if (activeTab === 'videos') await fetchVideos();
    else if (activeTab === 'database') await fetchDatabaseData(currentDbFile || undefined, selectedTable || undefined, pageOffset);
    else if (activeTab === 'results') await fetchResults();
    setTimeout(() => setIsRefreshing(false), 400);
  }

  useEffect(() => { fetchVideos(); fetchDatabaseData(); }, []);
  useEffect(() => {
    if (activeTab !== 'results') return;
    fetchResults();
    const refreshTimer = setInterval(() => { fetchResults(); }, 30_000);
    return () => clearInterval(refreshTimer);
  }, [activeTab, fetchResults]);

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/login');
    router.refresh();
  }

  function formatBytes(bytes: number) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function getProxyUrl(video: SyncedFileMeta): string {
    return `/api/video-proxy?pathname=${encodeURIComponent(video.pathname)}`;
  }

  const dateFilteredResults = results.filter((result) => {
    const resultDate = result.chunk_start.slice(0, 10);
    return (!reportStartDate || resultDate >= reportStartDate) &&
      (!reportEndDate || resultDate <= reportEndDate);
  });
  const reportRows = dateFilteredResults.filter((result) =>
    selectedReportProfile === 'Flock' ||
    result.bird_records.some((bird) => bird.bird_label === selectedReportProfile)
  );
  const getProfileBirds = (result: BehaviorResult) =>
    selectedReportProfile === 'Flock'
      ? result.bird_records
      : result.bird_records.filter((bird) => bird.bird_label === selectedReportProfile);

  function getBehaviorValue(
    result: BehaviorResult,
    behavior: (typeof REPORT_BEHAVIORS)[number]['key'],
  ): number {
    if (selectedReportProfile === 'Flock') {
      switch (behavior) {
        case 'feeding': return result.eating_count || 0;
        case 'drinking': return result.drinking_count || 0;
        case 'inactivity': return result.inactivity_pct || 0;
        case 'pecking': return result.feather_pecking_count || 0;
        case 'reducedEating': return result.reduced_eating_events || 0;
      }
    }

    const birds = getProfileBirds(result);
    const durationSeconds = Math.max(
      1,
      (new Date(result.chunk_end).getTime() - new Date(result.chunk_start).getTime()) / 1000,
    );
    switch (behavior) {
      case 'feeding': return birds.reduce((sum, bird) => sum + (bird.feeding_bouts || 0), 0);
      case 'drinking': return birds.reduce((sum, bird) => sum + (bird.drinking_bouts || 0), 0);
      case 'inactivity':
        return birds.length
          ? birds.reduce((sum, bird) => sum + (bird.inactivity_s || 0), 0) /
            (durationSeconds * birds.length) * 100
          : 0;
      case 'pecking':
        return birds.reduce((sum, bird) => sum + (bird.pecking_aggressor_count || 0), 0);
      case 'reducedEating':
        return birds.reduce((sum, bird) => sum + (bird.reduced_eating_flag || 0), 0);
    }
  }

  function getSensorValue(
    result: BehaviorResult,
    sensor: (typeof REPORT_SENSORS)[number]['key'],
  ): number | null {
    if (!result.sensor_data_available) return null;
    switch (sensor) {
      case 'temperature': return result.temp_avg;
      case 'humidity': return result.humidity_avg;
      case 'ammonia': return result.ammonia_avg;
      case 'thi': return result.thi_avg;
      case 'light': return result.lux_avg;
      case 'sound': return result.sound_avg_db;
    }
  }

  function getAverageSensorValue(
    sensor: (typeof REPORT_SENSORS)[number]['key'],
  ): number | null {
    const values = reportRows.flatMap((result) => {
      const value = getSensorValue(result, sensor);
      const duration = Math.max(
        0,
        new Date(result.chunk_end).getTime() - new Date(result.chunk_start).getTime(),
      );
      return value != null && Number.isFinite(value) && duration > 0
        ? [{ value, duration }]
        : [];
    });
    const totalDuration = values.reduce((sum, item) => sum + item.duration, 0);
    return totalDuration
      ? values.reduce((sum, item) => sum + item.value * item.duration, 0) / totalDuration
      : null;
  }

  const sensorAvailabilityCount = reportRows.filter((result) => result.sensor_data_available).length;
  const availableSensorCount = REPORT_SENSORS.filter((sensor) =>
    reportRows.some((result) => getSensorValue(result, sensor.key) != null)
  ).length;
  const uniqueProfileTracks = new Set(
    reportRows.flatMap((result) =>
      getProfileBirds(result).map((bird) => `${result.job_id}:${bird.track_id}`)
    ),
  ).size;
  const latestReportStatus = reportRows.length
    ? !reportRows[0].sensor_data_available
      ? 'Sensor readings unavailable'
      : reportRows[0].heat_stress_level === 'Unavailable'
        ? 'Heat index unavailable'
        : reportRows[0].heat_stress_level
    : 'No matching profile data';
  const latestReportStatusColor = latestReportStatus === 'Normal'
    ? 'text-emerald-600'
    : latestReportStatus.includes('unavailable') || latestReportStatus.includes('No matching')
      ? 'text-slate-500'
      : 'text-orange-700';
  const selectedBehaviorLabel =
    REPORT_BEHAVIORS.find((item) => item.key === chartBehavior)?.label ?? 'Behavior';
  const selectedSensor = REPORT_SENSORS.find((item) => item.key === chartSensor) ?? REPORT_SENSORS[0];
  const chartPoints = reportRows.flatMap((result) => {
    const sensorValue = getSensorValue(result, chartSensor);
    const behaviorValue = getBehaviorValue(result, chartBehavior);
    return sensorValue != null && Number.isFinite(sensorValue) && Number.isFinite(behaviorValue)
      ? [{ x: sensorValue, y: behaviorValue, label: result.interval_label }]
      : [];
  });
  const chartXMin = chartPoints.length ? Math.min(...chartPoints.map((point) => point.x)) : 0;
  const chartXMax = chartPoints.length ? Math.max(...chartPoints.map((point) => point.x)) : 1;
  const chartYMin = chartPoints.length ? Math.min(...chartPoints.map((point) => point.y)) : 0;
  const chartYMax = chartPoints.length ? Math.max(...chartPoints.map((point) => point.y)) : 1;
  const chartXRange = chartXMax - chartXMin || 1;
  const chartYRange = chartYMax - chartYMin || 1;
  const chartCoordinates = chartPoints.map((point) => ({
    ...point,
    cx: 66 + ((point.x - chartXMin) / chartXRange) * 650,
    cy: 244 - ((point.y - chartYMin) / chartYRange) * 190,
  }));
  const chartMeanX = chartPoints.length
    ? chartPoints.reduce((sum, point) => sum + point.x, 0) / chartPoints.length
    : 0;
  const chartMeanY = chartPoints.length
    ? chartPoints.reduce((sum, point) => sum + point.y, 0) / chartPoints.length
    : 0;
  const chartCovariance = chartPoints.reduce(
    (sum, point) => sum + (point.x - chartMeanX) * (point.y - chartMeanY),
    0,
  );
  const chartVarianceX = chartPoints.reduce(
    (sum, point) => sum + (point.x - chartMeanX) ** 2,
    0,
  );
  const chartVarianceY = chartPoints.reduce(
    (sum, point) => sum + (point.y - chartMeanY) ** 2,
    0,
  );
  const correlation = chartPoints.length >= 3 && chartVarianceX > 0 && chartVarianceY > 0
    ? chartCovariance / Math.sqrt(chartVarianceX * chartVarianceY)
    : null;
  const trendSlope = chartVarianceX > 0 ? chartCovariance / chartVarianceX : 0;
  const trendYStart = chartMeanY + trendSlope * (chartXMin - chartMeanX);
  const trendYEnd = chartMeanY + trendSlope * (chartXMax - chartMeanX);
  const trendLine = chartPoints.length >= 3
    ? {
        x1: 66,
        x2: 716,
        y1: 244 - ((trendYStart - chartYMin) / chartYRange) * 190,
        y2: 244 - ((trendYEnd - chartYMin) / chartYRange) * 190,
      }
    : null;

  function exportReportCsv() {
    const headers = [
      'Profile', 'Start', 'End', 'Behavior', 'Baseline', 'Observation',
      'Temperature C', 'Humidity %', 'Sound dB', 'Ammonia ppm', 'THI',
      'Light lux', 'Heat stress level', 'Sensor data available', 'Result file',
    ];
    const csvCell = (value: string | number | null) =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = reportRows.map((result) => {
      const birds = getProfileBirds(result);
      const behavior = selectedReportProfile === 'Flock'
        ? `Feeding ${result.eating_count}; drinking ${result.drinking_count}; inactivity ${result.inactivity_pct}%; pecking ${result.feather_pecking_count}; reduced eating ${result.reduced_eating_events}`
        : `Feeding ${birds.reduce((sum, bird) => sum + bird.feeding_bouts, 0)}; drinking ${birds.reduce((sum, bird) => sum + bird.drinking_bouts, 0)}; ${birds.length} track(s)`;
      const values = [
        selectedReportProfile,
        result.chunk_start,
        result.chunk_end,
        behavior,
        'Not configured',
        result.heat_stress_level === 'Unavailable'
          ? 'Sensor readings unavailable for this interval'
          : `Lethargic birds ${result.inactive_count}; pecking events ${result.feather_pecking_count}`,
        getSensorValue(result, 'temperature'),
        getSensorValue(result, 'humidity'),
        getSensorValue(result, 'sound'),
        getSensorValue(result, 'ammonia'),
        getSensorValue(result, 'thi'),
        getSensorValue(result, 'light'),
        result.heat_stress_level,
        result.sensor_data_available ? 'Yes' : 'No',
        result.result_file,
      ];
      return values.map(csvCell).join(',');
    });
    const csv = [headers.map(csvCell).join(','), ...lines].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `chickensee-report-${selectedReportProfile.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="portal-shell min-h-screen bg-[#f7f8fa] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-orange-600 to-orange-500 shadow-md shadow-orange-500/20">
              <Server className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">ChickenSee Portal</h1>
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Optiplex Live
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">Automated Vercel Blob &amp; SQLite Bridge</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleCleanupOldVideos} disabled={isCleaning} title="Delete synced videos older than 7 days" className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20 hover:text-amber-200">
              <Trash2 className={`h-3.5 w-3.5 ${isCleaning ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Clean &gt;7d</span>
            </button>
            <button onClick={refreshAll} disabled={isRefreshing} className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white">
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button onClick={handleLogout} className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/20 hover:text-red-300">
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>

        <div className="mx-auto flex max-w-7xl border-t border-slate-200 px-4 sm:px-6">
          <nav className="flex space-x-6">
            <button onClick={() => setActiveTab('videos')} className={`flex items-center gap-2 border-b-2 py-3 text-xs sm:text-sm font-semibold transition ${activeTab === 'videos' ? 'border-orange-500 text-orange-700' : 'border-transparent text-slate-500 hover:border-orange-300 hover:text-orange-700'}`}>
              <Video className="h-4 w-4" />
              <span>Synced Videos</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{videos.length}</span>
            </button>
            <button onClick={() => setActiveTab('database')} className={`flex items-center gap-2 border-b-2 py-3 text-xs sm:text-sm font-semibold transition ${activeTab === 'database' ? 'border-orange-500 text-orange-700' : 'border-transparent text-slate-500 hover:border-orange-300 hover:text-orange-700'}`}>
              <Database className="h-4 w-4" />
              <span>SQLite Tables</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{databases.length}</span>
            </button>
            <button onClick={() => setActiveTab('results')} className={`flex items-center gap-2 border-b-2 py-3 text-xs sm:text-sm font-semibold transition ${activeTab === 'results' ? 'border-orange-500 text-orange-700' : 'border-transparent text-slate-500 hover:border-orange-300 hover:text-orange-700'}`}>
              <BarChart2 className="h-4 w-4" />
              <span>Behavior Results</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{results.length}</span>
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">

        {/* VIDEOS TAB */}
        {activeTab === 'videos' && (
          <div className="space-y-6">
            {selectedVideo && (
              <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl backdrop-blur-sm">
                <div className="aspect-video w-full bg-black">
                  <video
                    ref={videoRef}
                    key={selectedVideo.pathname}
                    src={getProxyUrl(selectedVideo)}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-contain"
                    onError={(e) => console.error('Video error:', e)}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-6">
                  <div>
                    <h2 className="text-lg font-bold text-white sm:text-xl">{selectedVideo.pathname}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                      <span className="flex items-center gap-1.5"><HardDrive className="h-3.5 w-3.5 text-slate-500" />{formatBytes(selectedVideo.size)}</span>
                      <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-slate-500" />{new Date(selectedVideo.uploadedAt).toLocaleString()}</span>
                      <span className="flex items-center gap-1.5 text-indigo-400"><Radio className="h-3.5 w-3.5 animate-pulse" />Vercel Blob Stream</span>
                    </div>
                  </div>
                  <a href={selectedVideo.url} download={selectedVideo.pathname} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 hover:text-white">
                    <Download className="h-4 w-4" />
                    <span>Download MP4</span>
                  </a>
                </div>
              </div>
            )}

            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Available Media Files ({videos.length})</h3>
              </div>
              {loadingVideos ? (
                <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/30">
                  <RefreshCw className="h-6 w-6 animate-spin text-indigo-400" />
                </div>
              ) : videos.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 p-12 text-center">
                  <Video className="mb-4 h-12 w-12 text-slate-600" />
                  <h4 className="text-base font-semibold text-slate-300">No MP4 files synchronized yet</h4>
                  <p className="mt-1 text-sm text-slate-500 max-w-md">Videos are analyzed locally first. Only the completed annotated detection video is synchronized here; original uploads are not duplicated.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {videos.map((vid) => {
                    const isCurrent = selectedVideo?.pathname === vid.pathname;
                    return (
                      <div key={vid.pathname} onClick={() => setSelectedVideo(vid)} className={`group relative cursor-pointer overflow-hidden rounded-xl border p-4 transition ${isCurrent ? 'border-indigo-500/80 bg-indigo-950/20 shadow-lg shadow-indigo-500/10' : 'border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900'}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-105 transition">
                            <Play className="h-5 w-5 fill-indigo-400" />
                          </div>
                          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">{formatBytes(vid.size)}</span>
                        </div>
                        <div className="mt-3">
                          <p className="truncate text-sm font-semibold text-slate-100 group-hover:text-indigo-300">{vid.pathname}</p>
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500"><Clock className="h-3 w-3" />{new Date(vid.uploadedAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* DATABASE TAB */}
        {activeTab === 'database' && (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Select Database File</label>
                  <select value={currentDbFile || ''} onChange={(e) => fetchDatabaseData(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-200 outline-none focus:border-indigo-500">
                    {databases.map((db) => (<option key={db.pathname} value={db.pathname}>{db.pathname} ({formatBytes(db.size)})</option>))}
                    {databases.length === 0 && <option value="">No databases synced</option>}
                  </select>
                </div>
                {tables.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Select Table</label>
                    <select value={selectedTable || ''} onChange={(e) => fetchDatabaseData(currentDbFile || undefined, e.target.value, 0)} className="rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-200 outline-none focus:border-indigo-500">
                      {tables.map((t) => (<option key={t} value={t}>{t}</option>))}
                    </select>
                  </div>
                )}
              </div>
              {queryResult && (
                <div className="rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-slate-400">
                  Total Rows: <span className="font-semibold text-white">{queryResult.totalRows}</span>
                </div>
              )}
            </div>

            {loadingDb ? (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/30">
                <RefreshCw className="h-6 w-6 animate-spin text-indigo-400" />
              </div>
            ) : !queryResult || !queryResult.columns.length ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 p-12 text-center">
                <FileCode className="mb-4 h-12 w-12 text-slate-600" />
                <h4 className="text-base font-semibold text-slate-300">No SQLite tables to display</h4>
                <p className="mt-1 text-sm text-slate-500 max-w-md">Place <code className="text-indigo-400">.sqlite</code> or <code className="text-indigo-400">.db</code> files in Optiplex <code className="text-indigo-400">./data</code>. They will be parsed with WebAssembly and displayed here.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl overflow-hidden">
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-950 text-slate-300 shadow-sm">
                      <tr>
                        <th className="border-b border-slate-800 px-4 py-3 font-semibold text-slate-500 w-12">#</th>
                        {queryResult.columns.map((col) => (<th key={col} className="border-b border-slate-800 px-4 py-3 font-semibold tracking-wider text-slate-300 whitespace-nowrap">{col}</th>))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-300">
                      {queryResult.values.length === 0 ? (
                        <tr><td colSpan={queryResult.columns.length + 1} className="px-4 py-8 text-center text-slate-500 italic">Table contains no records</td></tr>
                      ) : (
                        queryResult.values.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-3 text-slate-600 font-mono">{pageOffset + rIdx + 1}</td>
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="px-4 py-3 whitespace-nowrap font-mono max-w-xs truncate" title={cell !== null ? String(cell) : 'NULL'}>
                                {cell === null ? <span className="text-slate-600 italic">null</span> : String(cell)}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/80 px-4 py-3 text-xs sm:px-6">
                  <span className="text-slate-400">
                    Showing <span className="font-semibold text-slate-200">{queryResult.values.length > 0 ? pageOffset + 1 : 0}</span> to <span className="font-semibold text-slate-200">{Math.min(pageOffset + pageSize, queryResult.totalRows)}</span> of <span className="font-semibold text-slate-200">{queryResult.totalRows}</span> rows
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => fetchDatabaseData(currentDbFile || undefined, selectedTable || undefined, Math.max(0, pageOffset - pageSize))} disabled={pageOffset === 0 || loadingDb} className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-40">
                      <ChevronLeft className="h-3.5 w-3.5" /><span>Previous</span>
                    </button>
                    <button onClick={() => fetchDatabaseData(currentDbFile || undefined, selectedTable || undefined, pageOffset + pageSize)} disabled={pageOffset + pageSize >= queryResult.totalRows || loadingDb} className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-40">
                      <span>Next</span><ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* RESULTS TAB */}
        {activeTab === 'results' && (
          <div className="space-y-6 text-slate-800">
            <div className="flex flex-col gap-4 rounded-2xl border border-orange-100 bg-white p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Behavior &amp; Environment Reports</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Review observed flock behavior alongside sensor readings from the same video interval.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  From
                  <input
                    type="date"
                    value={reportStartDate}
                    onChange={(event) => setReportStartDate(event.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                </label>
                <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  To
                  <input
                    type="date"
                    value={reportEndDate}
                    onChange={(event) => setReportEndDate(event.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                </label>
                <button
                  onClick={fetchResults}
                  disabled={loadingResults}
                  className="flex items-center gap-2 rounded-lg border border-orange-600 bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-orange-700 disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingResults ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <button
                  onClick={exportReportCsv}
                  disabled={reportRows.length === 0}
                  className="flex items-center gap-2 rounded-lg bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export report
                </button>
              </div>
            </div>

            {resultsError && (
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Could not load uploaded reports</p>
                  <p className="mt-1 text-xs">{resultsError}</p>
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-orange-100 bg-white p-1 shadow-sm">
              <div className="flex min-w-max gap-1">
                {REPORT_PROFILES.map((profile) => (
                  <button
                    key={profile}
                    onClick={() => setSelectedReportProfile(profile)}
                    className={`rounded-lg px-5 py-3 text-sm font-semibold transition ${
                      selectedReportProfile === profile
                        ? 'bg-orange-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-orange-50 hover:text-orange-800'
                    }`}
                  >
                    {profile === 'Flock' ? 'Whole Flock' : profile}
                  </button>
                ))}
              </div>
            </div>

            {loadingResults && (
              <div className="flex h-40 items-center justify-center rounded-2xl border border-orange-100 bg-white">
                <div className="flex flex-col items-center gap-3 text-slate-500">
                  <RefreshCw className="h-6 w-6 animate-spin text-orange-600" />
                  <p className="text-sm">Loading behavior and sensor reports...</p>
                </div>
              </div>
            )}

            {!loadingResults && !resultsError && results.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-orange-200 bg-white p-12 text-center">
                <Bird className="mb-4 h-12 w-12 text-orange-300" />
                <h3 className="text-lg font-semibold text-slate-800">No reports uploaded yet</h3>
                <p className="mt-2 max-w-lg text-sm text-slate-500">
                  Reports appear after the Optiplex worker analyzes videos and uploads the interval behavior and available sensor readings.
                </p>
              </div>
            )}

            {!loadingResults && !resultsError && results.length > 0 && (
              <>
                <section className="rounded-2xl border border-orange-100 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-700">
                      <Bird className="h-8 w-8" />
                    </div>
                    <div className="min-w-52">
                      <h3 className="text-xl font-bold text-slate-900">
                        {selectedReportProfile === 'Flock' ? 'Flock Report' : selectedReportProfile}
                      </h3>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {selectedReportProfile === 'Flock'
                          ? `${uniqueProfileTracks} tracked birds in selected intervals`
                          : `${uniqueProfileTracks} matching track(s) in selected intervals`}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {reportRows.length} intervals · {sensorAvailabilityCount} with sensor readings · {availableSensorCount} sensor types available
                      </p>
                    </div>
                    <div className="border-t border-slate-100 pt-3 sm:ml-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Latest recorded status</p>
                      <p className={`mt-1 text-lg font-bold ${latestReportStatusColor}`}>
                        {latestReportStatus}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Status summarizes recorded sensor/behavior flags; it is not a diagnosis.
                      </p>
                    </div>
                  </div>
                </section>

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[
                    {
                      label: 'Feeding bouts',
                      value: reportRows.reduce((sum, result) => sum + getBehaviorValue(result, 'feeding'), 0),
                      icon: <Eye className="h-5 w-5" />,
                    },
                    {
                      label: 'Drinking bouts',
                      value: reportRows.reduce((sum, result) => sum + getBehaviorValue(result, 'drinking'), 0),
                      icon: <Droplets className="h-5 w-5" />,
                    },
                    {
                      label: 'Pecking events',
                      value: reportRows.reduce((sum, result) => sum + getBehaviorValue(result, 'pecking'), 0),
                      icon: <Activity className="h-5 w-5" />,
                    },
                    {
                      label: 'Sensor intervals',
                      value: `${sensorAvailabilityCount} / ${reportRows.length}`,
                      icon: <Radio className="h-5 w-5" />,
                    },
                  ].map((stat) => (
                    <div key={stat.label} className="flex items-center gap-3 rounded-xl border border-orange-100 bg-white p-4 shadow-sm">
                      <span className="text-orange-600">{stat.icon}</span>
                      <div>
                        <p className="text-xs text-slate-500">{stat.label}</p>
                        <p className="text-xl font-bold text-slate-900">{stat.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[
                    { label: 'Average temperature', value: getAverageSensorValue('temperature'), unit: '°C', icon: <Thermometer className="h-5 w-5" /> },
                    { label: 'Average humidity', value: getAverageSensorValue('humidity'), unit: '%', icon: <Droplets className="h-5 w-5" /> },
                    { label: 'Average ammonia', value: getAverageSensorValue('ammonia'), unit: 'ppm', icon: <Wind className="h-5 w-5" /> },
                    { label: 'Average THI', value: getAverageSensorValue('thi'), unit: '', icon: <Gauge className="h-5 w-5" /> },
                  ].map((stat) => (
                    <div key={stat.label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <span className="text-slate-500">{stat.icon}</span>
                      <div>
                        <p className="text-xs text-slate-500">{stat.label}</p>
                        <p className="text-lg font-bold text-slate-900">
                          {stat.value == null ? '—' : `${stat.value.toFixed(1)} ${stat.unit}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Behavior and sensor correlation log</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Behavior summaries and sensor averages are paired by the same analysis interval.
                      </p>
                    </div>
                    <span className="rounded-lg bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-800">
                      {reportRows.length} report intervals
                    </span>
                  </div>
                  {!sensorAvailabilityCount && reportRows.length > 0 && (
                    <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-xs leading-5 text-amber-900">
                      Sensor readings are unavailable for these intervals. Empty values are shown as — rather than estimated.
                    </div>
                  )}
                  {reportRows.length > 0 && !reportRows.some((result) => result.sound_avg_db != null) && (
                    <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-xs leading-5 text-amber-900">
                      Sound readings are not present in the uploaded analysis records, so the Sound column is shown as —.
                    </div>
                  )}
                  <div className="max-h-[560px] overflow-auto">
                    <table className="w-full min-w-[1120px] border-collapse text-left text-xs">
                      <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
                        <tr>
                          {['DATE-TIME', 'BEHAVIOR', 'BASELINE', 'OBSERVATION', 'TEMP', 'HUMID', 'SOUND', 'AMMONIA', 'THI', 'STATUS'].map((heading) => (
                            <th key={heading} className="border-b border-slate-200 px-4 py-3 font-semibold tracking-wide">{heading}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reportRows.map((result) => {
                          const birds = getProfileBirds(result);
                          const behaviorSummary = selectedReportProfile === 'Flock'
                            ? `Feed ${result.eating_count} · Drink ${result.drinking_count} · Inactive ${result.inactivity_pct.toFixed(1)}% · Peck ${result.feather_pecking_count}`
                            : `${birds.reduce((sum, bird) => sum + bird.feeding_bouts, 0)} feed · ${birds.reduce((sum, bird) => sum + bird.drinking_bouts, 0)} drink · ${birds.reduce((sum, bird) => sum + bird.pecking_aggressor_count, 0)} peck`;
                          const needsReview =
                            (result.heat_stress_level !== 'Normal' && result.heat_stress_level !== 'Unavailable') ||
                            (selectedReportProfile === 'Flock'
                              ? result.inactive_count > 0 || result.feather_pecking_count > 0 || result.reduced_eating_events > 0
                              : birds.some((bird) => bird.is_lethargic > 0 || bird.pecking_aggressor_count > 0 || bird.reduced_eating_flag > 0));
                          const observation = [
                            result.heat_stress_level !== 'Unavailable'
                              ? `Heat stress: ${result.heat_stress_level}`
                              : result.sensor_data_available
                                ? 'Heat index unavailable'
                                : 'Sensor readings unavailable',
                            selectedReportProfile === 'Flock'
                              ? `${result.bird_count} birds; ${result.inactive_count} lethargy flag(s); ${result.feather_pecking_count} pecking event(s)`
                              : `${birds.length} matching track(s); ${birds.filter((bird) => bird.is_lethargic > 0).length} lethargy flag(s)`,
                          ].join('; ');
                          const displaySensor = (value: number | null, digits = 1) =>
                            value == null || !result.sensor_data_available ? '—' : value.toFixed(digits);
                          return (
                            <tr key={result.result_id} className="hover:bg-orange-50/50">
                              <td className="whitespace-nowrap px-4 py-3.5 font-medium text-slate-700">
                                {new Date(result.chunk_start).toLocaleString()}
                              </td>
                              <td className="px-4 py-3.5 font-semibold text-slate-800">{behaviorSummary}</td>
                              <td className="px-4 py-3.5 text-slate-400">Not configured</td>
                              <td className="max-w-[260px] px-4 py-3.5 text-slate-600">{observation}</td>
                              <td className="px-4 py-3.5 font-mono text-slate-700">{displaySensor(result.temp_avg)}</td>
                              <td className="px-4 py-3.5 font-mono text-slate-700">{displaySensor(result.humidity_avg)}</td>
                              <td className="px-4 py-3.5 font-mono text-slate-500">{displaySensor(result.sound_avg_db)}</td>
                              <td className="px-4 py-3.5 font-mono text-slate-700">{displaySensor(result.ammonia_avg, 2)}</td>
                              <td className="px-4 py-3.5 font-mono text-slate-700">{displaySensor(result.thi_avg, 1)}</td>
                              <td className="px-4 py-3.5">
                                <span className={`rounded-full px-2.5 py-1 font-semibold ${
                                  needsReview
                                    ? 'bg-orange-100 text-orange-800'
                                    : result.sensor_data_available
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {needsReview ? 'Review flags' : result.sensor_data_available ? 'Recorded' : 'Sensors unavailable'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                        {!reportRows.length && (
                          <tr>
                            <td colSpan={10} className="px-6 py-14 text-center">
                              <Search className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                              <p className="font-semibold text-slate-700">No report intervals match these filters</p>
                              <p className="mt-1 text-xs text-slate-500">Try another date range or select a different profile.</p>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Behavior–environment comparison</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Compare recorded behavior counts with sensor readings from matching intervals.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Select behavior
                        <select
                          value={chartBehavior}
                          onChange={(event) => setChartBehavior(event.target.value as typeof chartBehavior)}
                          className="rounded-lg border border-orange-100 bg-white px-3 py-2 text-xs font-semibold normal-case text-slate-800 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                        >
                          {REPORT_BEHAVIORS.map((behavior) => (
                            <option key={behavior.key} value={behavior.key}>{behavior.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Select environmental variable
                        <select
                          value={chartSensor}
                          onChange={(event) => setChartSensor(event.target.value as typeof chartSensor)}
                          className="rounded-lg border border-orange-100 bg-white px-3 py-2 text-xs font-semibold normal-case text-slate-800 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                        >
                          {REPORT_SENSORS.map((sensor) => (
                            <option key={sensor.key} value={sensor.key}>{sensor.label} {sensor.unit && `(${sensor.unit})`}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  {chartPoints.length > 1 ? (
                    <div className="mt-5 rounded-xl border border-slate-100 bg-[#fffdfa] p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2 text-xs text-slate-500">
                        <span>{selectedBehaviorLabel} vs. {selectedSensor.label} ({selectedSensor.unit || 'index'})</span>
                        <span className="rounded-full bg-orange-50 px-2.5 py-1 font-semibold text-orange-800">
                          Pearson r {correlation == null ? '—' : correlation.toFixed(2)} · {chartPoints.length} intervals{chartPoints.length < 3 ? ' (need ≥3)' : ''}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <svg viewBox="0 0 760 300" role="img" aria-label={`${selectedBehaviorLabel} compared with ${selectedSensor.label}`} className="h-[260px] min-w-[600px] w-full">
                          {[0, 1, 2, 3, 4].map((tick) => {
                            const y = 54 + tick * 47.5;
                            return <line key={tick} x1="66" x2="716" y1={y} y2={y} stroke="#e5e7eb" strokeDasharray="3 5" />;
                          })}
                          <line x1="66" x2="716" y1="244" y2="244" stroke="#94a3b8" />
                          <line x1="66" x2="66" y1="54" y2="244" stroke="#94a3b8" />
                          {trendLine && (
                            <line
                              x1={trendLine.x1}
                              x2={trendLine.x2}
                              y1={Math.max(54, Math.min(244, trendLine.y1))}
                              y2={Math.max(54, Math.min(244, trendLine.y2))}
                              stroke="#f97316"
                              strokeWidth="2"
                              strokeDasharray="6 5"
                            />
                          )}
                          {chartCoordinates.map((point) => (
                            <circle key={`${point.label}:${point.x}:${point.y}`} cx={point.cx} cy={point.cy} r="5" fill="#f97316" fillOpacity="0.82" stroke="white" strokeWidth="1.5">
                              <title>{point.label}: {selectedSensor.label} {point.x.toFixed(2)}; {selectedBehaviorLabel} {point.y.toFixed(2)}</title>
                            </circle>
                          ))}
                          <text x="390" y="286" textAnchor="middle" fill="#64748b" fontSize="12">{selectedSensor.label} ({selectedSensor.unit || 'index'})</text>
                          <text transform="translate(18 152) rotate(-90)" textAnchor="middle" fill="#64748b" fontSize="12">{selectedBehaviorLabel}</text>
                          <text x="66" y="263" fill="#64748b" fontSize="10">{chartXMin.toFixed(1)}</text>
                          <text x="716" y="263" textAnchor="end" fill="#64748b" fontSize="10">{chartXMax.toFixed(1)}</text>
                          <text x="58" y="58" textAnchor="end" fill="#64748b" fontSize="10">{chartYMax.toFixed(1)}</text>
                          <text x="58" y="244" textAnchor="end" fill="#64748b" fontSize="10">{chartYMin.toFixed(1)}</text>
                        </svg>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        The dashed line and Pearson r describe association in these intervals only; they do not establish that a sensor condition caused a behavior.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-5 flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-orange-200 bg-orange-50/40 px-5 text-center">
                      <BarChart2 className="mb-2 h-8 w-8 text-orange-300" />
                      <p className="text-sm font-semibold text-slate-700">Not enough paired readings to chart</p>
                      <p className="mt-1 max-w-lg text-xs text-slate-500">
                        At least two intervals with both the selected behavior and sensor measurement are needed. Missing sensor readings are excluded.
                      </p>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
