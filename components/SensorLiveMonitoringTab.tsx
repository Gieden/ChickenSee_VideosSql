'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Activity,
  Radio,
  RefreshCw,
  Thermometer,
  Droplets,
  Wind,
  Gauge,
  AlertTriangle,
  Clock,
  Download,
  Filter,
  Search,
  Sliders,
  ShieldCheck,
  AlertCircle,
  Copy,
  Check,
  Zap,
  Database,
  ArrowUpRight,
} from 'lucide-react';
import {
  getSupabaseSensorClient,
  SUPABASE_SENSOR_URL,
  SUPABASE_SENSOR_ANON_KEY,
  SensorLogRow,
  EnrichedSensorReading,
  enrichSensorReading,
  computeTelemetrySummary,
} from '@/lib/supabase-sensor';

export default function SensorLiveMonitoringTab() {
  const [readings, setReadings] = useState<EnrichedSensorReading[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [realtimePacketsReceived, setRealtimePacketsReceived] = useState<number>(0);

  // Settings & Filter states
  const [autoRefreshSec, setAutoRefreshSec] = useState<number>(3);
  const [fetchLimit, setFetchLimit] = useState<number>(50);
  const [statusFilter, setStatusFilter] = useState<'all' | 'normal' | 'alert'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [chartMetric, setChartMetric] = useState<'temp_hum' | 'ammonia' | 'sound' | 'thi'>('temp_hum');
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  // Realtime subscription status
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');

  // Chart tooltip hover state
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Fetch readings from Supabase with server route fallback
  const fetchSensorLogs = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) setIsRefreshing(true);

      try {
        // Attempt 1: Fetch via local API route (which has access to SUPABASE_SERVICE_ROLE_KEY if set on Vercel)
        let rows: SensorLogRow[] = [];
        let fetchedOk = false;

        try {
          const apiRes = await fetch(`/api/sensors/live?limit=${fetchLimit}`, { cache: 'no-store' });
          if (apiRes.ok) {
            const json = await apiRes.json();
            if (json.success && Array.isArray(json.data) && json.data.length > 0) {
              rows = json.data as SensorLogRow[];
              fetchedOk = true;
            }
          }
        } catch {
          // ignore API error, proceed to direct client query
        }

        // Attempt 2: Direct client query via Supabase SDK if API didn't return rows
        if (!fetchedOk) {
          const supabase = getSupabaseSensorClient();
          const { data, error: sbError } = await supabase
            .from('sensor_logs')
            .select('id, recorded_at, temperature, humidity, ammonia_ppm, ammonia_raw, sound_db, sound_raw, temp_status, hum_status, ammonia_status, sound_status')
            .order('recorded_at', { ascending: false })
            .limit(fetchLimit);

          if (sbError) {
            throw new Error(sbError.message);
          }
          rows = (data || []) as SensorLogRow[];
        }

        const enriched = rows.map((row) => enrichSensorReading(row));
        setReadings(enriched);
        setLastSyncTime(new Date());
        setError(null);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to query Supabase sensor_logs';
        console.error('Supabase fetch error:', err);
        setError(msg);
      } finally {
        setLoading(false);
        if (isManualRefresh) setIsRefreshing(false);
      }
    },
    [fetchLimit]
  );

  // Set up Realtime WebSockets
  useEffect(() => {
    setRealtimeStatus('connecting');
    fetchSensorLogs();

    const supabase = getSupabaseSensorClient();

    // Channel subscription for Postgres changes + Broadcast telemetry
    const channel = supabase
      .channel('sensor_logs_realtime_stream')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sensor_logs',
        },
        (payload) => {
          const newRow = payload.new as SensorLogRow;
          if (newRow && newRow.recorded_at) {
            const enriched = enrichSensorReading(newRow);
            setReadings((prev) => {
              // Avoid duplicate IDs if already present
              const filtered = prev.filter((r) => r.id !== enriched.id);
              return [enriched, ...filtered.slice(0, fetchLimit - 1)];
            });
            setLastSyncTime(new Date());
            setRealtimePacketsReceived((c) => c + 1);
          }
        }
      )
      .on('broadcast', { event: 'telemetry' }, (payload) => {
        const newRow = payload.payload as SensorLogRow;
        if (newRow && newRow.recorded_at) {
          const enriched = enrichSensorReading(newRow);
          setReadings((prev) => [enriched, ...prev.slice(0, fetchLimit - 1)]);
          setLastSyncTime(new Date());
          setRealtimePacketsReceived((c) => c + 1);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setRealtimeStatus('disconnected');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchSensorLogs, fetchLimit]);

  // Periodic polling synchronization
  useEffect(() => {
    if (autoRefreshSec <= 0) return;

    const timer = setInterval(() => {
      fetchSensorLogs();
    }, autoRefreshSec * 1000);

    return () => clearInterval(timer);
  }, [fetchSensorLogs, autoRefreshSec]);

  // Telemetry summary derived from real readings
  const summary = useMemo(() => computeTelemetrySummary(readings), [readings]);

  // Filtered readings for table display
  const filteredReadings = useMemo(() => {
    return readings.filter((r) => {
      if (statusFilter === 'normal') {
        if (r.heatStressLevel !== 'Normal') return false;
        if (r.ammonia_ppm !== null && r.ammonia_ppm > 10) return false;
      } else if (statusFilter === 'alert') {
        const isHeatAlert = r.heatStressLevel === 'Severe' || r.heatStressLevel === 'Emergency';
        const isNh3Alert = r.ammonia_ppm !== null && r.ammonia_ppm > 15;
        const isSoundAlert = r.sound_db !== null && r.sound_db > 70;
        if (!isHeatAlert && !isNh3Alert && !isSoundAlert) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTime = r.formattedTime.toLowerCase().includes(q) || r.relativeTime.toLowerCase().includes(q);
        const matchTemp = r.temperature !== null && String(r.temperature).includes(q);
        const matchHum = r.humidity !== null && String(r.humidity).includes(q);
        const matchNh3 = r.ammonia_ppm !== null && String(r.ammonia_ppm).includes(q);
        const matchStress = r.heatStressLevel.toLowerCase().includes(q);
        if (!matchTime && !matchTemp && !matchHum && !matchNh3 && !matchStress) return false;
      }
      return true;
    });
  }, [readings, statusFilter, searchQuery]);

  // Export CSV of real telemetry
  const handleExportCsv = () => {
    if (readings.length === 0) return;
    const headers = [
      'ID',
      'Recorded_At',
      'Temperature_C',
      'Humidity_Pct',
      'Ammonia_PPM',
      'Ammonia_Raw',
      'Sound_DB',
      'Sound_Raw',
      'THI',
      'Heat_Stress_Level',
      'Temp_Status',
      'Hum_Status',
      'Ammonia_Status',
      'Sound_Status',
    ];
    const rows = readings.map((r) => [
      r.id,
      r.recorded_at,
      r.temperature ?? '',
      r.humidity ?? '',
      r.ammonia_ppm ?? '',
      r.ammonia_raw ?? '',
      r.sound_db ?? '',
      r.sound_raw ?? '',
      r.thi ?? '',
      r.heatStressLevel,
      r.temp_status ?? '',
      r.hum_status ?? '',
      r.ammonia_status ?? '',
      r.sound_status ?? '',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `chickensee_realtime_sensors_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyPublishableKey = () => {
    navigator.clipboard.writeText(SUPABASE_SENSOR_ANON_KEY);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const copyRlsSql = () => {
    const sql = `CREATE POLICY "Allow public read on sensor_logs" ON public.sensor_logs FOR SELECT TO public, anon USING (true);\nALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_logs;`;
    navigator.clipboard.writeText(sql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  // SVG Chart points computation
  const chartData = useMemo(() => {
    const reversed = [...readings].reverse();
    if (reversed.length < 2) return null;

    const width = 800;
    const height = 220;
    const padX = 40;
    const padY = 24;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;

    const pointsCount = reversed.length;
    const getX = (idx: number) => padX + (idx / (pointsCount - 1)) * innerW;

    const makeYScale = (values: (number | null)[], minOverride?: number, maxOverride?: number) => {
      const valid = values.filter((v): v is number => v !== null && !isNaN(v));
      if (!valid.length) return () => height / 2;
      let minVal = minOverride !== undefined ? minOverride : Math.min(...valid);
      let maxVal = maxOverride !== undefined ? maxOverride : Math.max(...valid);
      if (minVal === maxVal) {
        minVal -= 1;
        maxVal += 1;
      }
      return (val: number | null) => {
        if (val === null || isNaN(val)) return innerH;
        const norm = (val - minVal) / (maxVal - minVal);
        return padY + innerH - norm * innerH;
      };
    };

    const tempVals = reversed.map((r) => r.temperature);
    const humVals = reversed.map((r) => r.humidity);
    const nh3Vals = reversed.map((r) => r.ammonia_ppm);
    const soundVals = reversed.map((r) => r.sound_db);
    const thiVals = reversed.map((r) => r.thi);

    const tempScale = makeYScale(tempVals, 15, 38);
    const humScale = makeYScale(humVals, 30, 95);
    const nh3Scale = makeYScale(nh3Vals, 0, Math.max(25, ...nh3Vals.filter((v): v is number => v !== null)));
    const soundScale = makeYScale(soundVals, 35, 95);
    const thiScale = makeYScale(thiVals, 65, 90);

    const makePolyline = (vals: (number | null)[], scaleFn: (v: number | null) => number) => {
      return vals.map((v, i) => `${getX(i).toFixed(1)},${scaleFn(v).toFixed(1)}`).join(' ');
    };

    const makeAreaPath = (vals: (number | null)[], scaleFn: (v: number | null) => number) => {
      const pts = vals.map((v, i) => `${getX(i).toFixed(1)},${scaleFn(v).toFixed(1)}`);
      const bottom = padY + innerH;
      return `M ${pts[0]} L ${pts.join(' L ')} L ${getX(pointsCount - 1)},${bottom} L ${padX},${bottom} Z`;
    };

    return {
      width,
      height,
      padX,
      padY,
      innerW,
      innerH,
      reversed,
      getX,
      tempPolyline: makePolyline(tempVals, tempScale),
      tempArea: makeAreaPath(tempVals, tempScale),
      humPolyline: makePolyline(humVals, humScale),
      nh3Polyline: makePolyline(nh3Vals, nh3Scale),
      nh3Area: makeAreaPath(nh3Vals, nh3Scale),
      soundPolyline: makePolyline(soundVals, soundScale),
      thiPolyline: makePolyline(thiVals, thiScale),
      thiArea: makeAreaPath(thiVals, thiScale),
    };
  }, [readings]);

  return (
    <div className="space-y-6">
      {/* ── TOP CONTROL & REALTIME CONNECTION HEADER ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-md shadow-orange-500/20">
              <Radio className="h-6 w-6 animate-pulse" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-bold tracking-tight text-slate-900">Sensor Live Monitoring</h2>
                {realtimeStatus === 'connected' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                    </span>
                    Realtime WebSocket Live
                  </span>
                ) : realtimeStatus === 'connecting' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
                    Connecting to WebSocket...
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                    Polling Active ({autoRefreshSec > 0 ? `${autoRefreshSec}s` : 'Manual'})
                  </span>
                )}

                {realtimePacketsReceived > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200">
                    <Zap className="h-3 w-3 text-indigo-600" />
                    {realtimePacketsReceived} live events
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                Streaming environmental telemetry live from Supabase PostgreSQL (<code className="font-mono text-slate-700">aoskfztsusjucgwdhtmc</code>).
              </p>
            </div>
          </div>

          {/* Action buttons & controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Auto refresh dropdown */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-xs font-medium text-slate-600">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <span>Sync:</span>
              <select
                aria-label="Polling interval"
                value={autoRefreshSec}
                onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
                className="bg-transparent font-semibold text-slate-800 outline-none cursor-pointer"
              >
                <option value={2}>Every 2s</option>
                <option value={3}>Every 3s</option>
                <option value={5}>Every 5s</option>
                <option value={10}>Every 10s</option>
                <option value={0}>Manual only</option>
              </select>
            </div>

            {/* Manual Refresh Button */}
            <button
              onClick={() => fetchSensorLogs(true)}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh Now</span>
            </button>

            {/* Supabase Connection details button */}
            <button
              onClick={() => setShowConfigModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Sliders className="h-3.5 w-3.5 text-slate-500" />
              <span>Supabase Details</span>
            </button>

            {/* Export CSV Button */}
            <button
              onClick={handleExportCsv}
              disabled={readings.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>
          </div>
        </div>

        {/* Sync status strip */}
        <div className="mt-4 flex flex-wrap items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-semibold text-slate-700">Backend:</span>
              <span className="text-slate-600">Supabase Cloud</span>
            </span>
            <span>•</span>
            <span className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-700">Table:</span>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-orange-600">public.sensor_logs</code>
            </span>
          </div>
          <div className="mt-2 sm:mt-0 flex items-center gap-2 text-slate-400">
            <span>Last reading received:</span>
            <span className="font-semibold text-slate-700">
              {lastSyncTime ? lastSyncTime.toLocaleTimeString() : 'Waiting for packets...'}
            </span>
            <span>({readings.length} records active)</span>
          </div>
        </div>
      </div>

      {/* Error alert if Supabase returns query failure */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/80 p-4 text-xs text-red-700 shadow-sm">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
          <div className="flex-1">
            <p className="font-semibold">Supabase Telemetry Notice</p>
            <p className="mt-0.5 text-red-600">{error}</p>
          </div>
        </div>
      )}

      {/* ── EMPTY / AWAITING DATA DIAGNOSTIC CARD (Shown when table has 0 rows returned) ── */}
      {!loading && readings.length === 0 && (
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/60 to-orange-50/40 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 border border-amber-200">
              <Radio className="h-6 w-6 animate-pulse" />
            </div>
            <div className="flex-1 text-xs text-slate-700">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  Supabase Live Stream Active — Awaiting Sensor Records
                </h3>
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  Socket Ready
                </span>
              </div>
              <p className="mt-1 text-slate-600 leading-relaxed">
                The dashboard is connected to <code className="bg-white/80 border border-amber-200 px-1.5 py-0.5 rounded font-mono text-orange-700">https://aoskfztsusjucgwdhtmc.supabase.co</code> and actively listening for live inserts on table <code className="bg-white/80 border border-amber-200 px-1.5 py-0.5 rounded font-mono text-orange-700">public.sensor_logs</code>.
              </p>

              {/* RLS troubleshooting tip */}
              <div className="mt-3 rounded-xl border border-amber-300/80 bg-white/90 p-3.5 text-[11px] shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">
                    💡 If your sensors already uploaded rows but they don&apos;t appear here:
                  </span>
                  <button
                    onClick={copyRlsSql}
                    className="flex items-center gap-1 rounded bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-200 transition"
                  >
                    {copiedSql ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedSql ? 'Copied SQL' : 'Copy 1-Click SQL'}
                  </button>
                </div>
                <p className="mt-1 text-slate-600">
                  By default, Supabase enables <strong>Row Level Security (RLS)</strong> which restricts the anon key from viewing rows. Run this once in the{' '}
                  <a
                    href="https://supabase.com/dashboard/project/aoskfztsusjucgwdhtmc/sql"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-orange-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    Supabase SQL Editor <ArrowUpRight className="h-3 w-3" />
                  </a>:
                </p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[10px] text-emerald-400">
{`CREATE POLICY "Allow public read on sensor_logs" ON public.sensor_logs FOR SELECT TO public, anon USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_logs;`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── KEY TELEMETRY METRICS & CARDS ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* TEMPERATURE CARD */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Temperature</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
              <Thermometer className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900">
              {summary.temp.current !== null ? `${summary.temp.current.toFixed(1)}°` : '--'}
            </span>
            <span className="text-sm font-semibold text-slate-500">C</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
            <span>Avg: {summary.temp.avg !== null ? `${summary.temp.avg}°C` : '--'}</span>
            <span>Range: {summary.temp.min ?? '--'} - {summary.temp.max ?? '--'}°C</span>
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 mb-1">
              <span>Optimal: 18 - 26°C</span>
              <span
                className={
                  summary.temp.current === null
                    ? 'text-slate-400'
                    : summary.temp.current >= 18 && summary.temp.current <= 26
                    ? 'text-emerald-600 font-bold'
                    : summary.temp.current < 18
                    ? 'text-blue-600 font-bold'
                    : 'text-amber-600 font-bold'
                }
              >
                {summary.temp.current === null
                  ? 'Awaiting Data'
                  : summary.temp.current >= 18 && summary.temp.current <= 26
                  ? 'Optimal'
                  : summary.temp.current < 18
                  ? 'Cool'
                  : 'Elevated'}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full transition-all duration-500 ${
                  summary.temp.current !== null && summary.temp.current > 28 ? 'bg-rose-500' : 'bg-orange-500'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(10, ((summary.temp.current ?? 20) / 40) * 100))}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* HUMIDITY CARD */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Relative Humidity</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
              <Droplets className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900">
              {summary.humidity.current !== null ? `${summary.humidity.current.toFixed(1)}` : '--'}
            </span>
            <span className="text-sm font-semibold text-slate-500">%RH</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
            <span>Avg: {summary.humidity.avg !== null ? `${summary.humidity.avg}%` : '--'}</span>
            <span>Range: {summary.humidity.min ?? '--'} - {summary.humidity.max ?? '--'}%</span>
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 mb-1">
              <span>Target: 50 - 70%</span>
              <span
                className={
                  summary.humidity.current === null
                    ? 'text-slate-400'
                    : summary.humidity.current >= 50 && summary.humidity.current <= 70
                    ? 'text-emerald-600 font-bold'
                    : 'text-amber-600 font-bold'
                }
              >
                {summary.humidity.current === null
                  ? 'Awaiting Data'
                  : summary.humidity.current >= 50 && summary.humidity.current <= 70
                  ? 'Comfort Zone'
                  : summary.humidity.current < 50
                  ? 'Dry Air'
                  : 'High Moisture'}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full bg-blue-500 transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(10, summary.humidity.current ?? 50))}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* AMMONIA CARD */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ammonia (NH₃)</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
              <Wind className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900">
              {summary.ammonia.current !== null ? `${summary.ammonia.current.toFixed(2)}` : '--'}
            </span>
            <span className="text-sm font-semibold text-slate-500">ppm</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
            <span>Avg: {summary.ammonia.avg !== null ? `${summary.ammonia.avg} ppm` : '--'}</span>
            <span>Peak: {summary.ammonia.max !== null ? `${summary.ammonia.max} ppm` : '--'}</span>
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 mb-1">
              <span>Threshold: &lt; 10 ppm</span>
              <span
                className={
                  summary.ammonia.current === null
                    ? 'text-slate-400'
                    : summary.ammonia.current <= 10
                    ? 'text-emerald-600 font-bold'
                    : summary.ammonia.current <= 20
                    ? 'text-amber-600 font-bold'
                    : 'text-rose-600 font-bold'
                }
              >
                {summary.ammonia.current === null
                  ? 'Awaiting Data'
                  : summary.ammonia.current <= 10
                  ? 'Safe'
                  : summary.ammonia.current <= 20
                  ? 'Moderate Alert'
                  : 'Toxic Level'}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full transition-all duration-500 ${
                  summary.ammonia.current !== null && summary.ammonia.current > 20
                    ? 'bg-rose-500'
                    : summary.ammonia.current !== null && summary.ammonia.current > 10
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(10, ((summary.ammonia.current ?? 5) / 25) * 100))}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* SOUND TELEMETRY CARD */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Acoustics / Sound</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
              <Gauge className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900">
              {summary.sound.current !== null ? `${summary.sound.current.toFixed(1)}` : '--'}
            </span>
            <span className="text-sm font-semibold text-slate-500">dB</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
            <span>Avg: {summary.sound.avg !== null ? `${summary.sound.avg} dB` : '--'}</span>
            <span>Peak: {summary.sound.max !== null ? `${summary.sound.max} dB` : '--'}</span>
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 mb-1">
              <span>Flock Stress Index</span>
              <span
                className={
                  summary.sound.current === null
                    ? 'text-slate-400'
                    : summary.sound.current < 65
                    ? 'text-emerald-600 font-bold'
                    : summary.sound.current < 75
                    ? 'text-amber-600 font-bold'
                    : 'text-rose-600 font-bold'
                }
              >
                {summary.sound.current === null
                  ? 'Awaiting Data'
                  : summary.sound.current < 65
                  ? 'Calm'
                  : summary.sound.current < 75
                  ? 'Active / Alert'
                  : 'Distress / Vocal'}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full bg-indigo-500 transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(10, ((summary.sound.current ?? 50) / 90) * 100))}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* POULTRY HEAT STRESS (THI) CARD */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Poultry Heat Stress</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900">
              {summary.thi.current !== null ? summary.thi.current.toFixed(1) : '--'}
            </span>
            <span className="text-xs font-semibold text-slate-500">THI</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
            <span>Avg THI: {summary.thi.avg !== null ? summary.thi.avg.toFixed(1) : '--'}</span>
          </div>
          <div className="mt-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                summary.thi.heatStressLevel === 'Normal'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : summary.thi.heatStressLevel === 'Moderate'
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : summary.thi.heatStressLevel === 'Severe'
                  ? 'bg-orange-50 text-orange-700 border border-orange-200'
                  : summary.thi.heatStressLevel === 'Emergency'
                  ? 'bg-rose-50 text-rose-700 border border-rose-200 animate-pulse'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {summary.thi.heatStressLevel === 'Normal' ? (
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
              )}
              {summary.thi.heatStressLevel}
            </span>
          </div>
        </div>
      </div>

      {/* ── INTERACTIVE TELEMETRY TREND CHART ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Environmental Telemetry Trends</h3>
            <p className="text-xs text-slate-500">
              Real-time time-series stream across sensor cycles.
            </p>
          </div>

          {/* Metric Selector Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-100 p-1 text-xs font-semibold">
            <button
              onClick={() => setChartMetric('temp_hum')}
              className={`rounded-lg px-3 py-1.5 transition ${
                chartMetric === 'temp_hum' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Temp & Humidity
            </button>
            <button
              onClick={() => setChartMetric('ammonia')}
              className={`rounded-lg px-3 py-1.5 transition ${
                chartMetric === 'ammonia' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Ammonia (NH₃)
            </button>
            <button
              onClick={() => setChartMetric('sound')}
              className={`rounded-lg px-3 py-1.5 transition ${
                chartMetric === 'sound' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sound (dB)
            </button>
            <button
              onClick={() => setChartMetric('thi')}
              className={`rounded-lg px-3 py-1.5 transition ${
                chartMetric === 'thi' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              THI Index
            </button>
          </div>
        </div>

        {/* Chart Viewport */}
        <div className="mt-4 relative">
          {chartData ? (
            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${chartData.width} ${chartData.height}`}
                className="w-full h-56 select-none overflow-visible"
                onMouseLeave={() => setHoverIndex(null)}
              >
                <defs>
                  <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#f97316" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="nh3Gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="thiGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal reference lines */}
                <line
                  x1={chartData.padX}
                  y1={chartData.padY}
                  x2={chartData.width - chartData.padX}
                  y2={chartData.padY}
                  stroke="#e2e8f0"
                  strokeDasharray="4 4"
                />
                <line
                  x1={chartData.padX}
                  y1={chartData.padY + chartData.innerH / 2}
                  x2={chartData.width - chartData.padX}
                  y2={chartData.padY + chartData.innerH / 2}
                  stroke="#e2e8f0"
                  strokeDasharray="4 4"
                />
                <line
                  x1={chartData.padX}
                  y1={chartData.padY + chartData.innerH}
                  x2={chartData.width - chartData.padX}
                  y2={chartData.padY + chartData.innerH}
                  stroke="#cbd5e1"
                />

                {/* Plot: Temp & Humidity */}
                {chartMetric === 'temp_hum' && (
                  <>
                    <path d={chartData.tempArea} fill="url(#tempGradient)" />
                    <polyline
                      fill="none"
                      stroke="#f97316"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={chartData.tempPolyline}
                    />
                    <polyline
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2"
                      strokeDasharray="3 3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={chartData.humPolyline}
                    />
                  </>
                )}

                {/* Plot: Ammonia */}
                {chartMetric === 'ammonia' && (
                  <>
                    <path d={chartData.nh3Area} fill="url(#nh3Gradient)" />
                    <polyline
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={chartData.nh3Polyline}
                    />
                  </>
                )}

                {/* Plot: Sound */}
                {chartMetric === 'sound' && (
                  <polyline
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={chartData.soundPolyline}
                  />
                )}

                {/* Plot: THI */}
                {chartMetric === 'thi' && (
                  <>
                    <path d={chartData.thiArea} fill="url(#thiGradient)" />
                    <polyline
                      fill="none"
                      stroke="#f43f5e"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={chartData.thiPolyline}
                    />
                  </>
                )}

                {/* Interactive hover overlays */}
                {chartData.reversed.map((pt, idx) => {
                  const x = chartData.getX(idx);
                  return (
                    <rect
                      key={pt.id || idx}
                      x={x - 10}
                      y={chartData.padY}
                      width={20}
                      height={chartData.innerH}
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={() => setHoverIndex(idx)}
                    />
                  );
                })}

                {/* Active Hover vertical guide */}
                {hoverIndex !== null && chartData.reversed[hoverIndex] && (
                  <line
                    x1={chartData.getX(hoverIndex)}
                    y1={chartData.padY}
                    x2={chartData.getX(hoverIndex)}
                    y2={chartData.padY + chartData.innerH}
                    stroke="#64748b"
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                  />
                )}
              </svg>

              {/* Chart Legend & Hover details display */}
              <div className="mt-3 flex flex-wrap items-center justify-between text-xs">
                <div className="flex items-center gap-4">
                  {chartMetric === 'temp_hum' && (
                    <>
                      <span className="flex items-center gap-1.5 font-medium text-slate-700">
                        <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
                        Temperature (°C)
                      </span>
                      <span className="flex items-center gap-1.5 font-medium text-slate-700">
                        <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                        Humidity (%RH)
                      </span>
                    </>
                  )}
                  {chartMetric === 'ammonia' && (
                    <span className="flex items-center gap-1.5 font-medium text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      Ammonia (NH₃ ppm)
                    </span>
                  )}
                  {chartMetric === 'sound' && (
                    <span className="flex items-center gap-1.5 font-medium text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
                      Sound Telemetry (dB)
                    </span>
                  )}
                  {chartMetric === 'thi' && (
                    <span className="flex items-center gap-1.5 font-medium text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                      Temperature-Humidity Index (THI)
                    </span>
                  )}
                </div>

                {/* Tooltip snapshot */}
                {hoverIndex !== null && chartData.reversed[hoverIndex] && (
                  <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-[11px] text-slate-800 shadow-sm">
                    <span className="font-semibold text-slate-500">
                      {chartData.reversed[hoverIndex].formattedTime}
                    </span>
                    <span>T: {chartData.reversed[hoverIndex].temperature ?? '--'}°C</span>
                    <span>H: {chartData.reversed[hoverIndex].humidity ?? '--'}%</span>
                    <span>NH₃: {chartData.reversed[hoverIndex].ammonia_ppm ?? '--'} ppm</span>
                    <span>dB: {chartData.reversed[hoverIndex].sound_db ?? '--'}</span>
                    <span className="font-bold text-orange-600">
                      THI: {chartData.reversed[hoverIndex].thi ?? '--'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-44 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 text-center">
              <Activity className="h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">Awaiting Real Telemetry Packets</p>
              <p className="mt-1 text-xs text-slate-400">
                At least 2 realtime readings are required to plot trend curves.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── LIVE TELEMETRY LOGS TABLE ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-orange-500 animate-pulse" />
            <h3 className="font-bold text-slate-900 text-base">Real-time Telemetry Stream Log</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {filteredReadings.length} {filteredReadings.length === 1 ? 'record' : 'records'}
            </span>
          </div>

          {/* Table Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search readings..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-700 outline-none transition focus:border-orange-500"
              />
            </div>

            {/* Status Filter */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
              <Filter className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
              <select
                aria-label="Filter status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'normal' | 'alert')}
                className="bg-transparent font-medium text-slate-800 outline-none cursor-pointer"
              >
                <option value="all">All States</option>
                <option value="normal">Normal / Safe Only</option>
                <option value="alert">Alerts & Elevated</option>
              </select>
            </div>

            {/* Fetch Limit Selector */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
              <span className="mr-1.5 text-slate-400">Limit:</span>
              <select
                aria-label="Records limit"
                value={fetchLimit}
                onChange={(e) => setFetchLimit(Number(e.target.value))}
                className="bg-transparent font-medium text-slate-800 outline-none cursor-pointer"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
              </select>
            </div>
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-x-auto">
          {loading && readings.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-orange-500" />
              <p className="mt-2 text-xs font-medium text-slate-500">Querying Supabase sensor_logs...</p>
            </div>
          ) : filteredReadings.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center p-6 text-center">
              <Radio className="h-9 w-9 text-slate-300 mb-2" />
              <p className="text-sm font-bold text-slate-800">Awaiting incoming sensor telemetry</p>
              <p className="mt-1 max-w-md text-xs text-slate-500">
                Listening on Supabase table <code className="bg-slate-100 px-1 py-0.5 rounded text-orange-600">sensor_logs</code>. New packets will be rendered here automatically in real time.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-3 sm:px-6">Timestamp / Recorded At</th>
                  <th className="px-4 py-3">Temperature</th>
                  <th className="px-4 py-3">Humidity</th>
                  <th className="px-4 py-3">Ammonia (NH₃)</th>
                  <th className="px-4 py-3">Sound Level</th>
                  <th className="px-4 py-3">THI / Heat Stress</th>
                  <th className="px-4 py-3">Status Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredReadings.map((r, i) => (
                  <tr key={r.id || i} className="hover:bg-slate-50/80 transition">
                    <td className="px-4 py-3 sm:px-6 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-800">{r.formattedTime}</span>
                        <span className="text-[11px] text-slate-400">{r.relativeTime}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.temperature !== null ? (
                        <span
                          className={`font-mono font-bold ${
                            r.temperature > 28 ? 'text-rose-600' : 'text-slate-800'
                          }`}
                        >
                          {r.temperature.toFixed(1)} °C
                        </span>
                      ) : (
                        <span className="text-slate-400">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.humidity !== null ? (
                        <span className="font-mono text-slate-700">{r.humidity.toFixed(1)} %</span>
                      ) : (
                        <span className="text-slate-400">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.ammonia_ppm !== null ? (
                        <span
                          className={`font-mono font-semibold ${
                            r.ammonia_ppm > 20
                              ? 'text-rose-600 font-bold'
                              : r.ammonia_ppm > 10
                              ? 'text-amber-600'
                              : 'text-slate-700'
                          }`}
                        >
                          {r.ammonia_ppm.toFixed(2)} ppm
                        </span>
                      ) : (
                        <span className="text-slate-400">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.sound_db !== null ? (
                        <span className="font-mono text-slate-700">{r.sound_db.toFixed(1)} dB</span>
                      ) : (
                        <span className="text-slate-400">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-800">
                          {r.thi !== null ? r.thi.toFixed(1) : '--'}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            r.heatStressLevel === 'Normal'
                              ? 'bg-emerald-50 text-emerald-700'
                              : r.heatStressLevel === 'Moderate'
                              ? 'bg-amber-50 text-amber-700'
                              : r.heatStressLevel === 'Severe'
                              ? 'bg-orange-50 text-orange-700'
                              : r.heatStressLevel === 'Emergency'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {r.heatStressLevel}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            r.temp_status === 1 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                          }`}
                          title={`Temp Status: ${r.temp_status ?? 0}`}
                        >
                          T:{r.temp_status ?? 0}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            r.hum_status === 1 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                          }`}
                          title={`Humidity Status: ${r.hum_status ?? 0}`}
                        >
                          H:{r.hum_status ?? 0}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            r.ammonia_status === 1
                              ? 'bg-emerald-100 text-emerald-800'
                              : r.ammonia_status === 2
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                          title={`Ammonia Status: ${r.ammonia_status ?? 0}`}
                        >
                          NH₃:{r.ammonia_status ?? 0}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── SUPABASE CONFIG & INGEST GUIDE MODAL ── */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-orange-600" />
                <h3 className="font-bold text-slate-900 text-base">Supabase Telemetry Connection</h3>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs text-slate-600">
              <div>
                <label className="font-semibold text-slate-700">Supabase Project URL</label>
                <div className="mt-1 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-slate-800">
                  <span>{SUPABASE_SENSOR_URL}</span>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Supabase Publishable Key</label>
                <div className="mt-1 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-slate-800">
                  <span className="truncate pr-2">{SUPABASE_SENSOR_ANON_KEY}</span>
                  <button
                    onClick={copyPublishableKey}
                    className="flex shrink-0 items-center gap-1 rounded bg-white px-2 py-1 text-[11px] font-sans font-semibold text-slate-700 border border-slate-200 hover:bg-slate-100"
                  >
                    {copiedKey ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedKey ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700">Row Level Security (RLS) Policy Setup</label>
                <p className="mt-0.5 text-slate-500">
                  To allow the client dashboard to read and stream live records, execute this in Supabase SQL editor:
                </p>
                <pre className="mt-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-3 font-mono text-[11px] text-emerald-400">
{`CREATE POLICY "Allow public read on sensor_logs" ON public.sensor_logs FOR SELECT TO public, anon USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_logs;`}
                </pre>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowConfigModal(false)}
                className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-orange-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
