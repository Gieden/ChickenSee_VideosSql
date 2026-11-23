'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Database,
  Calendar,
  Clock,
  Activity,
  Thermometer,
  Droplets,
  Wind,
  Radio,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Eye,
  FileCode,
  Video,
  Layers,
  Sparkles,
  TrendingUp,
  BarChart2,
  AlertTriangle,
  CheckCircle2,
  HardDrive,
  Maximize2,
} from 'lucide-react';

interface SensorAverages {
  totalReadings: number;
  avgTemperature: number | null;
  avgHumidity: number | null;
  avgAmmoniaPpm: number | null;
  avgSoundDb: number | null;
  minTemperature: number | null;
  maxTemperature: number | null;
  minHumidity: number | null;
  maxHumidity: number | null;
  minAmmoniaPpm: number | null;
  maxAmmoniaPpm: number | null;
  minSoundDb: number | null;
  maxSoundDb: number | null;
  thi: number | null;
  durationSeconds: number | null;
  frameCount: number | null;
  videoFile: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

interface SensorChartPoint {
  index: number;
  elapsedSeconds: number;
  timestamp: string | null;
  timeLabel: string;
  temperature: number;
  humidity: number;
  ammoniaPpm: number;
  soundDb: number;
  thi: number;
}

interface SensorHourOption {
  key: string;
  startAt: string;
  endAt: string;
  label: string;
  totalReadings: number;
}

interface SessionFileMeta {
  url: string;
  pathname: string;
  storagePath: string;
  size: number;
  uploadedAt: string;
  sessionLabel?: string;
  dateKey?: string;
  dateLabel?: string;
  sessionTime?: string;
  sessionFolder?: string;
  localPath?: string;
  averages: SensorAverages;
}

interface DateGroupedSessions {
  dateKey: string;
  dateLabel: string;
  fileCount: number;
  totalReadings: number;
  files: SessionFileMeta[];
  unifiedFile?: SessionFileMeta;
  isUnified?: boolean;
}

interface DatabaseOverview {
  totalFiles: number;
  totalReadings: number;
  avgTemperature: number | null;
  avgHumidity: number | null;
  avgAmmoniaPpm: number | null;
  avgSoundDb: number | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return '—';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}h ${mins > 0 ? `${mins}m` : '00m'}`.trim();
  }
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs > 0 ? `${secs}s` : ''}`.trim();
}

function getTempBadge(temp: number | null) {
  if (temp === null) return null;
  if (temp < 20) return { label: 'Cool', bg: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (temp <= 28) return { label: 'Optimal', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (temp <= 33) return { label: 'Warm', bg: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: 'Heat Alert', bg: 'bg-red-50 text-red-700 border-red-200' };
}

function getHumidityBadge(hum: number | null) {
  if (hum === null) return null;
  if (hum < 45) return { label: 'Dry', bg: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (hum <= 70) return { label: 'Comfortable', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  return { label: 'Humid', bg: 'bg-blue-50 text-blue-700 border-blue-200' };
}

function getAmmoniaBadge(nh3: number | null) {
  if (nh3 === null) return null;
  if (nh3 < 10) return { label: 'Safe', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (nh3 <= 25) return { label: 'Moderate', bg: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { label: 'Danger', bg: 'bg-red-50 text-red-700 border-red-200' };
}

function getSoundBadge(db: number | null) {
  if (db === null) return null;
  if (db < 65) return { label: 'Quiet', bg: 'bg-slate-50 text-slate-700 border-slate-200' };
  if (db <= 80) return { label: 'Normal', bg: 'bg-purple-50 text-purple-700 border-purple-200' };
  return { label: 'Agitated', bg: 'bg-red-50 text-red-700 border-red-200' };
}

export default function SqliteViewerTab() {
  const [groupedDatabases, setGroupedDatabases] = useState<DateGroupedSessions[]>([]);
  const [overview, setOverview] = useState<DatabaseOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDateGroups, setExpandedDateGroups] = useState<Record<string, boolean>>({});

  // Interactive Detail Modal State
  const [selectedSession, setSelectedSession] = useState<SessionFileMeta | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalAverages, setModalAverages] = useState<SensorAverages | null>(null);
  const [modalChartPoints, setModalChartPoints] = useState<SensorChartPoint[]>([]);
  const [modalTables, setModalTables] = useState<Record<string, { columns: string[]; values: unknown[][]; totalRows: number }> | null>(null);
  const [modalHourOptions, setModalHourOptions] = useState<SensorHourOption[]>([]);
  const [modalSelectedHour, setModalSelectedHour] = useState('all');
  const [modalUpdating, setModalUpdating] = useState(false);
  const [modalActiveTable, setModalActiveTable] = useState<string>('sensor_logs');
  const [modalChartMetric, setModalChartMetric] = useState<'temp_hum' | 'ammonia' | 'sound' | 'all'>('temp_hum');
  const [chartHoverIdx, setChartHoverIdx] = useState<number | null>(null);
  const [modalTableSearch, setModalTableSearch] = useState('');
  const [modalTablePage, setModalTablePage] = useState(1);
  const [modalTablePageSize, setModalTablePageSize] = useState(50);
  const detailRequestId = useRef(0);
  const searchRequestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch SQLite files and aggregations from API (supports silent real-time polling)
  const fetchDatabases = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      const res = await fetch(`/api/database?_t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Failed to load databases (HTTP ${res.status})`);
      }
      const data = await res.json();
      setGroupedDatabases(data.groupedByDate || []);
      setOverview(data.overview || null);
    } catch (err: any) {
      console.error('Error fetching SQLite databases:', err);
      if (!silent) {
        setError(err?.message || 'Could not load SQLite sensor files.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDatabases(false);
    // Real-time background polling every 10 seconds while tab is visible
    const timer = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchDatabases(true);
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [fetchDatabases]);

  const loadModalDetails = async (
    file: SessionFileMeta,
    hourOption: SensorHourOption | null = null,
    table?: string,
    offset = 0,
    search = '',
    initial = false,
  ) => {
    const requestId = ++detailRequestId.current;
    if (initial) setModalLoading(true);
    else setModalUpdating(true);
    setModalError(null);
    try {
      const params = new URLSearchParams({ file: file.storagePath });
      if (hourOption) {
        params.set('hourStart', hourOption.startAt);
        params.set('hourEnd', hourOption.endAt);
        params.set('limit', String(modalTablePageSize));
        params.set('offset', String(offset));
        if (table) params.set('table', table);
        if (search) params.set('search', search);
      } else {
        params.set('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
      }

      const res = await fetch(`/api/database/session?${params.toString()}&_t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`Failed to load session details (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (requestId !== detailRequestId.current) return;
      if (data.averages) setModalAverages(data.averages);
      if (data.chartPoints) setModalChartPoints(data.chartPoints);
      if (Array.isArray(data.hourOptions)) setModalHourOptions(data.hourOptions);
      if (data.tables) {
        setModalTables(data.tables);
        if (initial) {
          if (data.tables['sensor_logs']) {
            setModalActiveTable('sensor_logs');
          } else {
            const firstKey = Object.keys(data.tables)[0];
            if (firstKey) setModalActiveTable(firstKey);
          }
        }
      }
    } catch (err: any) {
      if (requestId !== detailRequestId.current) return;
      console.error('Error loading session detail modal:', err);
      setModalError(err?.message || 'Failed to load telemetry details.');
    } finally {
      if (requestId === detailRequestId.current) {
        setModalLoading(false);
        setModalUpdating(false);
      }
    }
  };

  // Open Detail Modal for a specific sensors.sqlite file
  const handleOpenDetailModal = async (file: SessionFileMeta) => {
    if (searchRequestTimer.current) clearTimeout(searchRequestTimer.current);
    setSelectedSession(file);
    setModalAverages(file.averages);
    setModalChartPoints([]);
    setModalTables(null);
    setModalHourOptions([]);
    setModalSelectedHour('all');
    setModalActiveTable('sensor_logs');
    setModalTableSearch('');
    setModalTablePage(1);
    setChartHoverIdx(null);
    await loadModalDetails(file, null, undefined, 0, '', true);
  };

  const handleHourSelection = (hourKey: string) => {
    if (searchRequestTimer.current) clearTimeout(searchRequestTimer.current);
    setModalSelectedHour(hourKey);
    setModalTablePage(1);
    setModalTableSearch('');
    setChartHoverIdx(null);
    if (!selectedSession) return;

    const hourOption = modalHourOptions.find((option) => option.key === hourKey);
    void loadModalDetails(selectedSession, hourOption || null, modalActiveTable, 0);
  };

  const handleModalPageChange = (page: number) => {
    if (searchRequestTimer.current) clearTimeout(searchRequestTimer.current);
    const nextPage = Math.max(1, page);
    setModalTablePage(nextPage);
    if (modalSelectedHour === 'all' || modalActiveTable !== 'sensor_logs' || !selectedSession) return;

    const hourOption = modalHourOptions.find((option) => option.key === modalSelectedHour);
    if (hourOption) {
      void loadModalDetails(
        selectedSession,
        hourOption,
        modalActiveTable,
        (nextPage - 1) * modalTablePageSize,
        modalTableSearch,
      );
    }
  };

  const handleModalSearchChange = (search: string) => {
    setModalTableSearch(search);
    setModalTablePage(1);
    if (searchRequestTimer.current) clearTimeout(searchRequestTimer.current);
    if (modalSelectedHour === 'all' || modalActiveTable !== 'sensor_logs' || !selectedSession) return;

    const hourOption = modalHourOptions.find((option) => option.key === modalSelectedHour);
    if (hourOption) {
      searchRequestTimer.current = setTimeout(() => {
        void loadModalDetails(selectedSession, hourOption, modalActiveTable, 0, search);
      }, 300);
    }
  };

  const handleCloseDetailModal = () => {
    if (searchRequestTimer.current) clearTimeout(searchRequestTimer.current);
    detailRequestId.current += 1;
    setSelectedSession(null);
    setModalLoading(false);
    setModalUpdating(false);
  };

  // Filter date groups by search
  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return groupedDatabases;

    return groupedDatabases
      .map((group) => {
        const matchesDate = group.dateLabel.toLowerCase().includes(q) || group.dateKey.includes(q);
        const matchingFiles = group.files.filter((f) => {
          return (
            matchesDate ||
            f.sessionLabel?.toLowerCase().includes(q) ||
            f.sessionFolder?.toLowerCase().includes(q) ||
            f.sessionTime?.toLowerCase().includes(q) ||
            f.storagePath.toLowerCase().includes(q)
          );
        });

        if (matchesDate) return group;
        if (matchingFiles.length > 0) {
          return {
            ...group,
            fileCount: matchingFiles.length,
            files: matchingFiles,
          };
        }
        return null;
      })
      .filter(Boolean) as DateGroupedSessions[];
  }, [groupedDatabases, searchQuery]);

  // Compute SVG Dynamic Chart data for the detail modal
  const chartData = useMemo(() => {
    const pts = modalChartPoints;
    if (!pts || pts.length === 0) return null;

    const W = 800;
    const H = 220;
    const PX = 45;
    const PY = 25;
    const iW = W - 2 * PX;
    const iH = H - 2 * PY;

    const n = pts.length;
    const gx = (idx: number) => PX + (n > 1 ? (idx / (n - 1)) * iW : iW / 2);

    // Temperature & Humidity
    const tVals = pts.map((p) => p.temperature).filter((v) => !isNaN(v));
    const hVals = pts.map((p) => p.humidity).filter((v) => !isNaN(v));
    const minT = Math.min(20, Math.floor(Math.min(...tVals, 25) - 2));
    const maxT = Math.max(40, Math.ceil(Math.max(...tVals, 35) + 2));
    const gyT = (v: number) => PY + iH - ((v - minT) / (maxT - minT || 1)) * iH;

    const minH = 30;
    const maxH = 90;
    const gyH = (v: number) => PY + iH - ((v - minH) / (maxH - minH || 1)) * iH;

    const tPoly = pts.map((p, i) => `${gx(i)},${gyT(p.temperature)}`).join(' ');
    const tArea = `M ${PX},${PY + iH} ` + pts.map((p, i) => `L ${gx(i)},${gyT(p.temperature)}`).join(' ') + ` L ${PX + iW},${PY + iH} Z`;
    const hPoly = pts.map((p, i) => `${gx(i)},${gyH(p.humidity)}`).join(' ');

    // Ammonia
    const nh3Vals = pts.map((p) => p.ammoniaPpm).filter((v) => !isNaN(v));
    const minNh3 = 0;
    const maxNh3 = Math.max(0.0001, Math.max(...nh3Vals) * 1.25);
    const gyNh3 = (v: number) => PY + iH - ((v - minNh3) / (maxNh3 - minNh3 || 1)) * iH;
    const nh3Poly = pts.map((p, i) => `${gx(i)},${gyNh3(p.ammoniaPpm)}`).join(' ');
    const nh3Area = `M ${PX},${PY + iH} ` + pts.map((p, i) => `L ${gx(i)},${gyNh3(p.ammoniaPpm)}`).join(' ') + ` L ${PX + iW},${PY + iH} Z`;

    // Sound
    const sndVals = pts.map((p) => p.soundDb).filter((v) => !isNaN(v));
    const minSnd = Math.min(50, Math.floor(Math.min(...sndVals, 60) - 5));
    const maxSnd = Math.max(90, Math.ceil(Math.max(...sndVals, 80) + 5));
    const gySnd = (v: number) => PY + iH - ((v - minSnd) / (maxSnd - minSnd || 1)) * iH;
    const sndPoly = pts.map((p, i) => `${gx(i)},${gySnd(p.soundDb)}`).join(' ');
    const sndArea = `M ${PX},${PY + iH} ` + pts.map((p, i) => `L ${gx(i)},${gySnd(p.soundDb)}`).join(' ') + ` L ${PX + iW},${PY + iH} Z`;

    // THI Index
    const thiVals = pts.map((p) => p.thi).filter((v) => !isNaN(v));
    const minThi = Math.min(65, Math.floor(Math.min(...thiVals, 70) - 2));
    const maxThi = Math.max(90, Math.ceil(Math.max(...thiVals, 82) + 2));
    const gyThi = (v: number) => PY + iH - ((v - minThi) / (maxThi - minThi || 1)) * iH;
    const thiPoly = pts.map((p, i) => `${gx(i)},${gyThi(p.thi)}`).join(' ');
    const thiArea = `M ${PX},${PY + iH} ` + pts.map((p, i) => `L ${gx(i)},${gyThi(p.thi)}`).join(' ') + ` L ${PX + iW},${PY + iH} Z`;

    return {
      W,
      H,
      PX,
      PY,
      iW,
      iH,
      gx,
      minT,
      maxT,
      minH,
      maxH,
      minNh3,
      maxNh3,
      minSnd,
      maxSnd,
      minThi,
      maxThi,
      tPoly,
      tArea,
      hPoly,
      nh3Poly,
      nh3Area,
      sndPoly,
      sndArea,
      thiPoly,
      thiArea,
      points: pts,
    };
  }, [modalChartPoints]);

  const renderFileCard = (file: SessionFileMeta, fileIdx: number) => {
    const avg = file.averages;
    const readingCount = avg?.totalReadings || 0;
    return (
      <div
        key={file.storagePath || fileIdx}
        onClick={() => handleOpenDetailModal(file)}
        className="group relative cursor-pointer rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition-all duration-200 hover:border-orange-300 hover:shadow-md hover:shadow-orange-500/5"
      >
        {/* Instance Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-orange-600 px-2 py-0.5 font-mono text-[11px] font-bold text-white shadow-2xs">
                sensors.sqlite
              </span>
              <span className="text-xs font-extrabold text-slate-800">
                {file.sessionTime || file.sessionLabel || `Session ${fileIdx + 1}`}
              </span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                {formatBytes(file.size)}
              </span>
            </div>

            <p className="mt-1 text-[11px] font-mono text-slate-400 truncate" title={file.sessionFolder || file.storagePath}>
              📁 {file.sessionFolder || file.storagePath}
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenDetailModal(file);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700 shadow-2xs transition group-hover:bg-orange-600 group-hover:text-white group-hover:border-orange-600"
          >
            <Eye className="h-3.5 w-3.5" />
            <span>Inspect</span>
          </button>
        </div>

        {/* Calculated Sensor Averages (Dashboard Aggregation) */}
        <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {/* Average Temperature */}
          <div className="rounded-xl bg-amber-50/50 border border-amber-100 p-2.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1">
              <Thermometer className="h-3 w-3" /> Avg Temp
            </span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-base font-extrabold text-slate-900">
                {avg?.avgTemperature !== null ? `${avg.avgTemperature.toFixed(1)}°C` : '—'}
              </span>
              {avg?.minTemperature !== null && (
                <span className="text-[9px] font-mono text-slate-400">
                  {avg.minTemperature}°–{avg.maxTemperature}°
                </span>
              )}
            </div>
          </div>

          {/* Average Humidity */}
          <div className="rounded-xl bg-sky-50/50 border border-sky-100 p-2.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-sky-700 flex items-center gap-1">
              <Droplets className="h-3 w-3" /> Avg Humidity
            </span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-base font-extrabold text-slate-900">
                {avg?.avgHumidity !== null ? `${avg.avgHumidity.toFixed(1)}%` : '—'}
              </span>
              {avg?.minHumidity !== null && (
                <span className="text-[9px] font-mono text-slate-400">
                  {avg.minHumidity}%–{avg.maxHumidity}%
                </span>
              )}
            </div>
          </div>

          {/* Average Ammonia */}
          <div className="rounded-xl bg-emerald-50/50 border border-emerald-100 p-2.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
              <Wind className="h-3 w-3" /> Avg Ammonia
            </span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-sm font-extrabold text-slate-900 font-mono truncate" title={`${avg?.avgAmmoniaPpm} ppm`}>
                {avg?.avgAmmoniaPpm !== null ? `${avg.avgAmmoniaPpm.toFixed(5)}` : '—'}
              </span>
              <span className="text-[9px] font-semibold text-slate-400">ppm</span>
            </div>
          </div>

          {/* Average Sound */}
          <div className="rounded-xl bg-purple-50/50 border border-purple-100 p-2.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-purple-700 flex items-center gap-1">
              <Radio className="h-3 w-3" /> Avg Sound
            </span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-base font-extrabold text-slate-900">
                {avg?.avgSoundDb !== null ? `${avg.avgSoundDb.toFixed(1)} dB` : '—'}
              </span>
              {avg?.minSoundDb !== null && (
                <span className="text-[9px] font-mono text-slate-400">
                  {avg.minSoundDb}–{avg.maxSoundDb}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Card Footer: Metadata & Inspect Prompt */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] text-slate-500 border-t border-slate-100/80">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 font-semibold text-slate-700">
              <Activity className="h-3 w-3 text-orange-500" />
              {readingCount.toLocaleString()} readings
            </span>
            {avg?.durationSeconds && (
              <span className="flex items-center gap-1 text-slate-500">
                <Clock className="h-3 w-3 text-slate-400" />
                {formatDuration(avg.durationSeconds)}
              </span>
            )}
            {avg?.videoFile && (
              <span className="flex items-center gap-1 text-slate-500 truncate max-w-[10rem]">
                <Video className="h-3 w-3 text-slate-400" />
                {avg.videoFile}
              </span>
            )}
          </div>

          <span className="text-xs font-bold text-orange-600 group-hover:translate-x-0.5 transition-transform">
            Inspect Telemetry &amp; Chart →
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* ── MAIN DASHBOARD CONTAINER ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-orange-50/80 via-white to-white px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-md shadow-orange-500/20">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">sensors.sqlite</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live SQLite Bridge
                </span>
                {overview && (
                  <span className="rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
                    {overview.totalFiles} {overview.totalFiles === 1 ? 'file' : 'files'}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Synchronized chicken coop environmental telemetry, organized by calendar date with pre-calculated averages.
              </p>
            </div>
          </div>

          {/* Header Controls: Search + Refresh */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[16rem]">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search date, session, folder..."
                className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-7 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <button
              onClick={() => fetchDatabases(false)}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 shadow-xs transition hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-orange-600' : 'text-slate-500'}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* ── DASHBOARD AGGREGATION BANNER (Main Overview Across Files) ── */}
        {overview && overview.totalFiles > 0 && (
          <div className="border-b border-slate-100 bg-slate-50/70 p-5 sm:px-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-orange-500" />
                Flock Environmental Overview (Calculated Averages)
              </span>
              <span className="text-[11px] text-slate-400 font-medium">
                Aggregated from {overview.totalReadings.toLocaleString()} telemetry readings
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {/* Avg Temperature */}
              <div className="rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50/60 to-white p-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Avg Temperature</span>
                  <Thermometer className="h-4 w-4 text-amber-500" />
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-xl font-extrabold text-slate-900">
                    {overview.avgTemperature !== null ? `${overview.avgTemperature.toFixed(1)}°C` : '—'}
                  </span>
                  {getTempBadge(overview.avgTemperature) && (
                    <span className={`rounded px-1.5 py-0.2 text-[9px] font-bold border ${getTempBadge(overview.avgTemperature)!.bg}`}>
                      {getTempBadge(overview.avgTemperature)!.label}
                    </span>
                  )}
                </div>
              </div>

              {/* Avg Humidity */}
              <div className="rounded-xl border border-sky-200/80 bg-gradient-to-br from-sky-50/60 to-white p-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700">Avg Humidity</span>
                  <Droplets className="h-4 w-4 text-sky-500" />
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-xl font-extrabold text-slate-900">
                    {overview.avgHumidity !== null ? `${overview.avgHumidity.toFixed(1)}%` : '—'}
                  </span>
                  {getHumidityBadge(overview.avgHumidity) && (
                    <span className={`rounded px-1.5 py-0.2 text-[9px] font-bold border ${getHumidityBadge(overview.avgHumidity)!.bg}`}>
                      {getHumidityBadge(overview.avgHumidity)!.label}
                    </span>
                  )}
                </div>
              </div>

              {/* Avg Ammonia */}
              <div className="rounded-xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/60 to-white p-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Avg Ammonia</span>
                  <Wind className="h-4 w-4 text-emerald-500" />
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-lg font-extrabold text-slate-900 font-mono truncate" title={`${overview.avgAmmoniaPpm} ppm`}>
                    {overview.avgAmmoniaPpm !== null ? `${overview.avgAmmoniaPpm.toFixed(5)}` : '—'}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500">ppm</span>
                </div>
              </div>

              {/* Avg Sound */}
              <div className="rounded-xl border border-purple-200/80 bg-gradient-to-br from-purple-50/60 to-white p-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Avg Sound</span>
                  <Radio className="h-4 w-4 text-purple-500" />
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-xl font-extrabold text-slate-900">
                    {overview.avgSoundDb !== null ? `${overview.avgSoundDb.toFixed(1)} dB` : '—'}
                  </span>
                  {getSoundBadge(overview.avgSoundDb) && (
                    <span className={`rounded px-1.5 py-0.2 text-[9px] font-bold border ${getSoundBadge(overview.avgSoundDb)!.bg}`}>
                      {getSoundBadge(overview.avgSoundDb)!.label}
                    </span>
                  )}
                </div>
              </div>

              {/* Total Sensors Files */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">File Instances</span>
                  <Layers className="h-4 w-4 text-orange-500" />
                </div>
                <p className="mt-1 text-xl font-extrabold text-slate-900">
                  {overview.totalFiles} <span className="text-xs font-semibold text-slate-400">sensors.sqlite</span>
                </p>
              </div>

              {/* Total Readings */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Telemetry</span>
                  <Activity className="h-4 w-4 text-emerald-500" />
                </div>
                <p className="mt-1 text-xl font-extrabold text-slate-900">
                  {overview.totalReadings.toLocaleString()} <span className="text-xs font-semibold text-slate-400">rows</span>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── DIRECTORY & DATE-ORGANIZED SENSORS.SQLITE LISTING ── */}
        <div className="p-5 sm:p-6 space-y-8">
          {loading ? (
            <div className="flex h-56 items-center justify-center p-8">
              <div className="flex flex-col items-center gap-3">
                <RefreshCw className="h-7 w-7 animate-spin text-orange-500" />
                <p className="text-xs font-semibold text-slate-500">Reading and aggregating sensors.sqlite files...</p>
              </div>
            </div>
          ) : error ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50/60 p-6 text-sm text-red-700 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Could not load sensor databases</p>
                <p className="text-xs text-red-600 mt-1">{error}</p>
                <button
                  onClick={() => fetchDatabases(false)}
                  className="mt-3 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-red-700"
                >
                  Retry Connection
                </button>
              </div>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <FileCode className="mb-4 h-12 w-12 text-slate-300" />
              <h4 className="text-base font-semibold text-slate-700">No sensors.sqlite files found</h4>
              <p className="mt-1 text-xs text-slate-400 max-w-md">
                {searchQuery
                  ? `No SQLite files match "${searchQuery}". Clear the search query to see all sessions.`
                  : 'Ensure your recordings contain sensors.sqlite in their recording session folders.'}
              </p>
            </div>
          ) : (
            filteredGroups.map((group) => (
              <div key={group.dateKey} className="space-y-3">
                {/* Date Group Heading */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100 text-orange-700 shadow-2xs">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-900 tracking-tight">
                        {group.dateLabel}
                      </h3>
                    </div>
                    <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-bold text-slate-600">
                      {group.fileCount} {group.fileCount === 1 ? 'sensors.sqlite instance' : 'sensors.sqlite instances'}
                    </span>
                  </div>

                  <span className="text-[11px] font-semibold text-slate-400">
                    {group.totalReadings.toLocaleString()} readings generated on this date
                  </span>
                </div>

                {/* Unified Day Card vs Grid of individual instances */}
                {group.unifiedFile ? (
                  <div className="space-y-4">
                    {/* Unified Session Card (Shown as ONE Item with Averaged Sensor Data) */}
                    <div
                      onClick={() => handleOpenDetailModal(group.unifiedFile!)}
                      className="group relative cursor-pointer rounded-2xl border-2 border-orange-200/90 bg-gradient-to-br from-orange-50/30 via-white to-white p-5 shadow-xs transition-all duration-200 hover:border-orange-400 hover:shadow-md hover:shadow-orange-500/10"
                    >
                      {/* Instance Header */}
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-orange-100/80 pb-3.5">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-orange-600 px-2 py-0.5 font-mono text-[11px] font-bold text-white shadow-2xs">
                              sensors.sqlite
                            </span>
                            <span className="text-xs font-extrabold text-slate-900">
                              {group.unifiedFile.sessionTime || '7:00 AM – 5:00 PM'}
                            </span>
                            <span className="rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-800 flex items-center gap-1">
                              <Sparkles className="h-3 w-3 text-emerald-600" />
                              {group.files.length > 1 ? `${group.files.length} Folders Unified (Averaged)` : 'Unified Telemetry'}
                            </span>
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                              {formatBytes(group.unifiedFile.size)}
                            </span>
                          </div>

                          <p className="mt-1 text-[11px] font-mono text-slate-500 truncate" title={group.unifiedFile.sessionFolder || 'Paired recording folders'}>
                            📁 {group.unifiedFile.sessionFolder || 'Paired recording folders'}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDetailModal(group.unifiedFile!);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-orange-300 bg-orange-500 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition group-hover:bg-orange-600 hover:shadow-md"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>{group.files.length > 1 ? 'Inspect Full Day' : 'Inspect'}</span>
                        </button>
                      </div>

                      {/* Calculated Sensor Averages (Dashboard Aggregation) */}
                      <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                        {/* Average Temperature */}
                        <div className="rounded-xl bg-amber-50/70 border border-amber-200/80 p-2.5 shadow-2xs">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1">
                            <Thermometer className="h-3 w-3" /> Avg Temp
                          </span>
                          <div className="mt-1 flex items-baseline justify-between">
                            <span className="text-base font-extrabold text-slate-900">
                              {group.unifiedFile.averages.avgTemperature !== null ? `${group.unifiedFile.averages.avgTemperature.toFixed(1)}°C` : '—'}
                            </span>
                            {group.unifiedFile.averages.minTemperature !== null && (
                              <span className="text-[9px] font-mono text-slate-500">
                                {group.unifiedFile.averages.minTemperature}°–{group.unifiedFile.averages.maxTemperature}°
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Average Humidity */}
                        <div className="rounded-xl bg-sky-50/70 border border-sky-200/80 p-2.5 shadow-2xs">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-sky-700 flex items-center gap-1">
                            <Droplets className="h-3 w-3" /> Avg Humidity
                          </span>
                          <div className="mt-1 flex items-baseline justify-between">
                            <span className="text-base font-extrabold text-slate-900">
                              {group.unifiedFile.averages.avgHumidity !== null ? `${group.unifiedFile.averages.avgHumidity.toFixed(1)}%` : '—'}
                            </span>
                            {group.unifiedFile.averages.minHumidity !== null && (
                              <span className="text-[9px] font-mono text-slate-500">
                                {group.unifiedFile.averages.minHumidity}%–{group.unifiedFile.averages.maxHumidity}%
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Average Ammonia */}
                        <div className="rounded-xl bg-emerald-50/70 border border-emerald-200/80 p-2.5 shadow-2xs">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
                            <Wind className="h-3 w-3" /> Avg Ammonia
                          </span>
                          <div className="mt-1 flex items-baseline justify-between">
                            <span className="text-sm font-extrabold text-slate-900 font-mono truncate" title={`${group.unifiedFile.averages.avgAmmoniaPpm} ppm`}>
                              {group.unifiedFile.averages.avgAmmoniaPpm !== null ? `${group.unifiedFile.averages.avgAmmoniaPpm.toFixed(5)}` : '—'}
                            </span>
                            <span className="text-[9px] font-semibold text-slate-500">ppm</span>
                          </div>
                        </div>

                        {/* Average Sound */}
                        <div className="rounded-xl bg-purple-50/70 border border-purple-200/80 p-2.5 shadow-2xs">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-purple-700 flex items-center gap-1">
                            <Radio className="h-3 w-3" /> Avg Sound
                          </span>
                          <div className="mt-1 flex items-baseline justify-between">
                            <span className="text-base font-extrabold text-slate-900">
                              {group.unifiedFile.averages.avgSoundDb !== null ? `${group.unifiedFile.averages.avgSoundDb.toFixed(1)} dB` : '—'}
                            </span>
                            {group.unifiedFile.averages.minSoundDb !== null && (
                              <span className="text-[9px] font-mono text-slate-500">
                                {group.unifiedFile.averages.minSoundDb}–{group.unifiedFile.averages.maxSoundDb}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Card Footer: Metadata & Inspect Prompt */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] text-slate-500 border-t border-orange-100/70">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="flex items-center gap-1 font-semibold text-slate-700">
                            <Activity className="h-3 w-3 text-emerald-600" />
                            {(group.unifiedFile.averages.totalReadings || 0).toLocaleString()} readings
                          </span>
                          <span className="flex items-center gap-1 text-slate-600">
                            <Clock className="h-3 w-3 text-blue-500" />
                            {formatDuration(group.unifiedFile.averages.durationSeconds)}
                          </span>
                          <span className="flex items-center gap-1 text-slate-600">
                            <Video className="h-3 w-3 text-orange-500" />
                            {group.files.length} paired {group.files.length === 1 ? 'video' : 'videos'} ({group.unifiedFile.sessionTime})
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          {group.files.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedDateGroups((prev) => ({
                                  ...prev,
                                  [group.dateKey]: !prev[group.dateKey],
                                }));
                              }}
                              className="text-xs font-semibold text-orange-600 hover:text-orange-700 underline underline-offset-2"
                            >
                              {expandedDateGroups[group.dateKey] ? `Hide ${group.files.length} hourly folders` : `View ${group.files.length} individual hourly folders`}
                            </button>
                          )}
                          <span className="text-xs font-bold text-orange-600 group-hover:translate-x-0.5 transition-transform">
                            Inspect Telemetry &amp; Chart →
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Optional Expanded Individual Hourly Sessions */}
                    {expandedDateGroups[group.dateKey] && (
                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 pt-2">
                        {group.files.map((file, fileIdx) => renderFileCard(file, fileIdx))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {group.files.map((file, fileIdx) => renderFileCard(file, fileIdx))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── DETAIL MODAL: REAL-TIME TABLE + DYNAMIC CHART ── */}
      {selectedSession && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 backdrop-blur-sm"
          onClick={handleCloseDetailModal}
          role="dialog"
          aria-modal="true"
          aria-label="Sensor Telemetry Inspection Modal"
        >
          <div
            className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-orange-50 via-white to-white px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-600 text-white shadow-sm">
                    <Database className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">
                    sensors.sqlite <span className="text-orange-600">·</span>{' '}
                    {selectedSession.dateLabel || selectedSession.sessionLabel || selectedSession.sessionTime}
                    {selectedSession.sessionFolder?.includes('Folders') || selectedSession.storagePath.includes('unified')
                      ? ' (All Day · Unified)'
                      : ''}
                  </h3>
                  <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600">
                    {formatBytes(selectedSession.size)}
                  </span>
                  {modalAverages?.totalReadings ? (
                    <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                      {modalAverages.totalReadings.toLocaleString()} real-time records
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-slate-500 font-mono">
                  📁 {selectedSession.sessionFolder || selectedSession.storagePath}
                </p>
              </div>

              <button
                onClick={handleCloseDetailModal}
                aria-label="Close"
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shadow-xs"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body: Scrollable area with Chart and Table */}
            <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-100">

              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-3 sm:px-6">
                <div>
                  <label htmlFor="sensor-hour-filter" className="text-xs font-bold text-slate-800">
                    View sensor data by hour
                  </label>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {modalSelectedHour === 'all'
                      ? 'Showing the full paired sensor session.'
                      : 'The chart, summary, and sensor table use only the selected hour.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {modalUpdating && <RefreshCw className="h-3.5 w-3.5 animate-spin text-orange-500" aria-label="Updating sensor data" />}
                  <select
                    id="sensor-hour-filter"
                    value={modalSelectedHour}
                    onChange={(event) => handleHourSelection(event.target.value)}
                    className="min-w-52 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  >
                    <option value="all">
                      {modalHourOptions.length <= 1
                        ? `Recorded session (${modalHourOptions[0]?.label || selectedSession.sessionTime || 'Single video'})`
                        : `All recorded hours (${selectedSession.sessionTime})`}
                    </option>
                    {modalHourOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label} ({option.totalReadings.toLocaleString()} readings)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {modalError && (
                <div role="alert" className="mx-5 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 sm:mx-6">
                  {modalError}
                </div>
              )}
              
              {/* Quick Session Aggregation Pill Bar */}
              {modalAverages && (
                <div className="bg-slate-50/70 px-5 py-3 sm:px-6">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 text-xs">
                    <div className="rounded-lg bg-white border border-slate-200 p-2 shadow-2xs">
                      <span className="text-[10px] font-bold uppercase text-slate-400">Avg Temp</span>
                      <p className="font-extrabold text-slate-900">
                        {modalAverages.avgTemperature !== null ? `${modalAverages.avgTemperature}°C` : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200 p-2 shadow-2xs">
                      <span className="text-[10px] font-bold uppercase text-slate-400">Avg Humidity</span>
                      <p className="font-extrabold text-slate-900">
                        {modalAverages.avgHumidity !== null ? `${modalAverages.avgHumidity}%` : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200 p-2 shadow-2xs">
                      <span className="text-[10px] font-bold uppercase text-slate-400">Avg Ammonia</span>
                      <p className="font-extrabold text-slate-900 font-mono text-[11px] truncate">
                        {modalAverages.avgAmmoniaPpm !== null ? `${modalAverages.avgAmmoniaPpm} ppm` : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200 p-2 shadow-2xs">
                      <span className="text-[10px] font-bold uppercase text-slate-400">Avg Sound</span>
                      <p className="font-extrabold text-slate-900">
                        {modalAverages.avgSoundDb !== null ? `${modalAverages.avgSoundDb} dB` : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white border border-slate-200 p-2 shadow-2xs">
                      <span className="text-[10px] font-bold uppercase text-slate-400">Duration</span>
                      <p className="font-extrabold text-slate-900">
                        {formatDuration(modalAverages.durationSeconds)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── SECTION 1: DYNAMIC CHART/GRAPH (Readings Over Time) ── */}
              <div className="p-5 sm:p-6 bg-white space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-orange-600" />
                    <h4 className="text-sm font-extrabold text-slate-900">
                      Telemetry Timeline Chart (Readings Over Time)
                    </h4>
                  </div>

                  {/* Chart Metric Selectors */}
                  <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-100 p-1 text-xs font-semibold">
                    {[
                      { key: 'temp_hum', label: '🌡️ Temp & Humidity' },
                      { key: 'ammonia', label: '🧪 Ammonia (NH₃)' },
                      { key: 'sound', label: '🔊 Sound (dB)' },
                    ].map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setModalChartMetric(key as any)}
                        className={`rounded-lg px-3 py-1 transition ${
                          modalChartMetric === key
                            ? 'bg-white shadow-xs text-orange-600 font-bold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* SVG Visualizer */}
                {modalLoading && modalChartPoints.length === 0 ? (
                  <div className="flex h-56 items-center justify-center rounded-xl bg-slate-50 border border-slate-100">
                    <RefreshCw className="h-6 w-6 animate-spin text-orange-500" />
                  </div>
                ) : chartData ? (
                  <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50/50 to-white p-4 shadow-2xs">
                    <svg
                      viewBox={`0 0 ${chartData.W} ${chartData.H}`}
                      className="h-56 w-full select-none overflow-visible"
                      onMouseLeave={() => setChartHoverIdx(null)}
                    >
                      <defs>
                        <linearGradient id="modalTempGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f97316" stopOpacity="0.32" />
                          <stop offset="100%" stopColor="#f97316" stopOpacity="0.0" />
                        </linearGradient>
                        <linearGradient id="modalNh3Grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                        </linearGradient>
                        <linearGradient id="modalSndGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.28" />
                          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
                        </linearGradient>
                        <linearGradient id="modalThiGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.32" />
                          <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {/* Horizontal Grid lines */}
                      {[chartData.PY, chartData.PY + chartData.iH / 2, chartData.PY + chartData.iH].map((y, i) => (
                        <line
                          key={i}
                          x1={chartData.PX}
                          y1={y}
                          x2={chartData.W - chartData.PX}
                          y2={y}
                          stroke={i === 2 ? '#cbd5e1' : '#f1f5f9'}
                          strokeDasharray={i === 2 ? undefined : '4 4'}
                        />
                      ))}

                      {/* Metric Plots */}
                      {modalChartMetric === 'temp_hum' && (
                        <>
                          <path d={chartData.tArea} fill="url(#modalTempGrad)" />
                          <polyline fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={chartData.tPoly} />
                          <polyline fill="none" stroke="#0284c7" strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" points={chartData.hPoly} />
                        </>
                      )}

                      {modalChartMetric === 'ammonia' && (
                        <>
                          <path d={chartData.nh3Area} fill="url(#modalNh3Grad)" />
                          <polyline fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={chartData.nh3Poly} />
                        </>
                      )}

                      {modalChartMetric === 'sound' && (
                        <>
                          <path d={chartData.sndArea} fill="url(#modalSndGrad)" />
                          <polyline fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={chartData.sndPoly} />
                        </>
                      )}

                      {/* Interactive hover hit boxes */}
                      {chartData.points.map((pt, idx) => (
                        <rect
                          key={idx}
                          x={chartData.gx(idx) - 8}
                          y={chartData.PY}
                          width={16}
                          height={chartData.iH}
                          fill="transparent"
                          className="cursor-pointer"
                          onMouseEnter={() => setChartHoverIdx(idx)}
                        />
                      ))}

                      {/* Active hover crosshair and tooltip */}
                      {chartHoverIdx !== null && chartData.points[chartHoverIdx] && (() => {
                        const hoverPt = chartData.points[chartHoverIdx];
                        const x = chartData.gx(chartHoverIdx);
                        const isRightHalf = x > chartData.W / 2;
                        const tooltipX = isRightHalf ? x - 150 : x + 15;
                        return (
                          <g>
                            <line
                              x1={x}
                              y1={chartData.PY}
                              x2={x}
                              y2={chartData.PY + chartData.iH}
                              stroke="#64748b"
                              strokeWidth="1.5"
                              strokeDasharray="2 2"
                            />
                            <circle cx={x} cy={chartData.PY + chartData.iH / 2} r="4" fill="#ea580c" stroke="#ffffff" strokeWidth="2" />
                            {/* Floating tooltip */}
                            <foreignObject x={tooltipX} y={chartData.PY + 10} width="140" height="90">
                              <div className="rounded-lg bg-slate-900/90 p-2 text-[10px] text-white shadow-xl backdrop-blur-sm space-y-0.5">
                                <p className="font-bold text-orange-300">⏱️ {hoverPt.timeLabel}</p>
                                <p className="flex justify-between"><span>Temp:</span><span className="font-bold">{hoverPt.temperature}°C</span></p>
                                <p className="flex justify-between"><span>Humidity:</span><span className="font-bold">{hoverPt.humidity}%</span></p>
                                <p className="flex justify-between"><span>NH₃:</span><span className="font-mono font-bold">{hoverPt.ammoniaPpm}</span></p>
                                <p className="flex justify-between"><span>Sound:</span><span className="font-bold">{hoverPt.soundDb} dB</span></p>
                              </div>
                            </foreignObject>
                          </g>
                        );
                      })()}
                    </svg>

                    {/* Chart Legend */}
                    <div className="mt-2 flex flex-wrap items-center justify-between text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                      <div className="flex items-center gap-4">
                        {modalChartMetric === 'temp_hum' && (
                          <>
                            <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-orange-500" /> Temperature (°C)</span>
                            <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 border-b-2 border-dashed border-sky-600" /> Humidity (%)</span>
                          </>
                        )}
                        {modalChartMetric === 'ammonia' && (
                          <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-emerald-500" /> Ammonia NH₃ (ppm)</span>
                        )}
                        {modalChartMetric === 'sound' && (
                          <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-purple-500" /> Sound Intensity (dB)</span>
                        )}
                      </div>

                      <span className="text-[10px] font-medium text-slate-400">
                        {modalChartPoints.length} synchronized sampling intervals
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-36 items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-400">
                    No chart data available for this session.
                  </div>
                )}
              </div>

              {/* ── SECTION 2: UNAVERAGED REAL-TIME SENSOR DATA TABLE ── */}
              <div className="p-5 sm:p-6 bg-white space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Tables:</span>
                    {modalTables && Object.keys(modalTables).map((tbl) => (
                      <button
                        key={tbl}
                        onClick={() => {
                          if (searchRequestTimer.current) clearTimeout(searchRequestTimer.current);
                          setModalActiveTable(tbl);
                          setModalTablePage(1);
                          setModalTableSearch('');
                          if (modalSelectedHour !== 'all' && selectedSession) {
                            const hourOption = modalHourOptions.find((option) => option.key === modalSelectedHour);
                            if (hourOption) {
                              void loadModalDetails(selectedSession, hourOption, tbl, 0);
                            }
                          }
                        }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                          modalActiveTable === tbl
                            ? 'bg-orange-600 text-white shadow-xs'
                            : 'bg-white border border-slate-200 text-slate-700 hover:bg-orange-50'
                        }`}
                      >
                        {tbl === 'sensor_logs' ? '📡 Sensor Telemetry' : tbl === 'recording' ? '🎥 Paired Recording' : tbl}
                        <span className="ml-1.5 rounded-full bg-black/10 px-1.5 py-0.2 text-[9px]">
                          {modalTables[tbl].totalRows.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Table search filter */}
                  <div className="relative min-w-[14rem]">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={modalTableSearch}
                      onChange={(e) => handleModalSearchChange(e.target.value)}
                      placeholder="Search values in table..."
                      className="w-full rounded-xl border border-slate-200 bg-white pl-8 pr-7 py-1.5 text-xs text-slate-800 placeholder-slate-400 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    />
                    {modalTableSearch && (
                      <button
                        type="button"
                        onClick={() => handleModalSearchChange('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Table Rendering */}
                {(() => {
                  const activeTbl = modalTables ? modalTables[modalActiveTable] : null;
                  if (!activeTbl || !activeTbl.columns) {
                    return (
                      <div className="flex h-36 items-center justify-center text-xs text-slate-400">
                        {modalLoading ? 'Loading real-time records...' : 'No records available in this table.'}
                      </div>
                    );
                  }

                  const q = modalTableSearch.trim().toLowerCase();
                  const serverPaged = modalSelectedHour !== 'all' && modalActiveTable === 'sensor_logs';
                  const filtered = q && !serverPaged
                    ? activeTbl.values.filter((r) =>
                        r.some((c) => c !== null && String(c).toLowerCase().includes(q)))
                    : activeTbl.values;

                  // Pagination calculation
                  const totalFiltered = serverPaged ? activeTbl.totalRows : filtered.length;
                  const totalPages = Math.ceil(totalFiltered / modalTablePageSize) || 1;
                  const startIndex = (modalTablePage - 1) * modalTablePageSize;
                  const paginatedRows = serverPaged ? filtered : filtered.slice(startIndex, startIndex + modalTablePageSize);

                  // Columns to highlight
                  const highlightCols = [
                    'elapsed_seconds', 'video_time', 'captured_at', 'recorded_at',
                    'temperature', 'humidity', 'ammonia_ppm', 'sound_db',
                    'started_at', 'ended_at', 'duration_seconds', 'frame_count', 'video_file'
                  ];
                  const orderedColIdxs = activeTbl.columns
                    .map((col, idx) => ({ col: col.toLowerCase(), idx }))
                    .sort((a, b) => {
                      const ai = highlightCols.indexOf(a.col);
                      const bi = highlightCols.indexOf(b.col);
                      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                    })
                    .map(({ idx }) => idx);

                  return (
                    <div className="rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                      <div className="overflow-x-auto max-h-[22rem]">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                            <tr>
                              <th className="px-4 py-2.5 w-12 font-mono text-slate-400">#</th>
                              {orderedColIdxs.map((ci) => (
                                <th key={ci} className="px-4 py-2.5 whitespace-nowrap">
                                  {activeTbl.columns[ci]}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {paginatedRows.length === 0 ? (
                              <tr>
                                <td colSpan={orderedColIdxs.length + 1} className="p-8 text-center text-xs text-slate-400">
                                  No rows matched &ldquo;{modalTableSearch}&rdquo;.
                                </td>
                              </tr>
                            ) : (
                              paginatedRows.map((row, rIdx) => {
                                const rowNum = startIndex + rIdx + 1;
                                return (
                                  <tr key={rIdx} className="hover:bg-orange-50/40 transition-colors">
                                    <td className="px-4 py-2 text-slate-400 font-mono text-[11px]">{rowNum}</td>
                                    {orderedColIdxs.map((ci) => {
                                      const cell = row[ci];
                                      const colName = activeTbl.columns[ci].toLowerCase();
                                      const isNum = typeof cell === 'number';

                                      if (cell === null || cell === undefined) {
                                        return (
                                          <td key={ci} className="px-4 py-2 whitespace-nowrap">
                                            <span className="text-slate-300 italic">null</span>
                                          </td>
                                        );
                                      }

                                      // Pretty formatting for key telemetry fields
                                      if (colName === 'temperature') {
                                        return (
                                          <td key={ci} className="px-4 py-2 whitespace-nowrap">
                                            <span className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200/70 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-800">
                                              <Thermometer className="h-3 w-3 text-amber-600" />
                                              {isNum ? (cell as number).toFixed(1) : String(cell)} °C
                                            </span>
                                          </td>
                                        );
                                      }

                                      if (colName === 'humidity') {
                                        return (
                                          <td key={ci} className="px-4 py-2 whitespace-nowrap">
                                            <span className="inline-flex items-center gap-1 rounded bg-sky-50 border border-sky-200/70 px-2 py-0.5 font-mono text-[11px] font-bold text-sky-800">
                                              <Droplets className="h-3 w-3 text-sky-600" />
                                              {isNum ? (cell as number).toFixed(1) : String(cell)} %
                                            </span>
                                          </td>
                                        );
                                      }

                                      if (colName === 'ammonia_ppm') {
                                        return (
                                          <td key={ci} className="px-4 py-2 whitespace-nowrap">
                                            <span className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200/70 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-800">
                                              <Wind className="h-3 w-3 text-emerald-600" />
                                              {isNum ? (cell as number).toFixed(5) : String(cell)} ppm
                                            </span>
                                          </td>
                                        );
                                      }

                                      if (colName === 'sound_db') {
                                        return (
                                          <td key={ci} className="px-4 py-2 whitespace-nowrap">
                                            <span className="inline-flex items-center gap-1 rounded bg-purple-50 border border-purple-200/70 px-2 py-0.5 font-mono text-[11px] font-bold text-purple-800">
                                              <Radio className="h-3 w-3 text-purple-600" />
                                              {isNum ? (cell as number).toFixed(1) : String(cell)} dB
                                            </span>
                                          </td>
                                        );
                                      }

                                      if (colName === 'elapsed_seconds') {
                                        return (
                                          <td key={ci} className="px-4 py-2 whitespace-nowrap font-mono text-slate-800 font-semibold">
                                            {isNum ? `${(cell as number).toFixed(1)}s` : String(cell)}
                                          </td>
                                        );
                                      }

                                      // Video time formatting (avoid "Invalid Date")
                                      if (colName === 'video_time') {
                                        let vStr = String(cell);
                                        if (isNum) {
                                          const val = cell as number;
                                          const m = Math.floor(val / 60);
                                          const s = Math.floor(val % 60);
                                          vStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
                                        }
                                        return (
                                          <td key={ci} className="px-4 py-2 whitespace-nowrap font-mono text-slate-700">
                                            {vStr}
                                          </td>
                                        );
                                      }

                                      // Captured at / Recorded at timestamp formatting
                                      if (colName.includes('at') || colName.includes('started') || colName.includes('ended')) {
                                        let timeFormatted = String(cell);
                                        try {
                                          const d = new Date(String(cell));
                                          if (!isNaN(d.getTime())) {
                                            timeFormatted = d.toLocaleString();
                                          }
                                        } catch {
                                          // keep raw
                                        }
                                        return (
                                          <td key={ci} className="px-4 py-2 whitespace-nowrap text-slate-700">
                                            <span className="flex items-center gap-1">
                                              <Clock className="h-3 w-3 text-orange-500" />
                                              {timeFormatted}
                                            </span>
                                          </td>
                                        );
                                      }

                                      return (
                                        <td key={ci} className="px-4 py-2 whitespace-nowrap max-w-xs truncate text-slate-700" title={String(cell)}>
                                          {String(cell)}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs">
                        <span className="text-slate-500 font-medium">
                          Showing <span className="font-semibold text-slate-800">{totalFiltered > 0 ? startIndex + 1 : 0}</span> to{' '}
                          <span className="font-semibold text-slate-800">{Math.min(startIndex + modalTablePageSize, totalFiltered)}</span> of{' '}
                          <span className="font-semibold text-slate-800">{totalFiltered.toLocaleString()}</span> records
                        </span>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleModalPageChange(modalTablePage - 1)}
                            disabled={modalTablePage <= 1 || modalUpdating}
                            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-40"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" /> Previous
                          </button>
                          <span className="font-semibold text-slate-700 px-1">
                            Page {modalTablePage} of {totalPages}
                          </span>
                          <button
                            onClick={() => handleModalPageChange(Math.min(totalPages, modalTablePage + 1))}
                            disabled={modalTablePage >= totalPages || modalUpdating}
                            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-40"
                          >
                            Next <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/80 px-5 py-3 sm:px-6">
              <span className="text-xs text-slate-500">
                Interactive SQLite Data Viewer &bull; ChickenSee Analytics Engine
              </span>

              <button
                type="button"
                onClick={handleCloseDetailModal}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-100"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
