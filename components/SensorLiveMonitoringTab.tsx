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
  ShieldCheck,
  AlertCircle,
  Zap,
  Copy,
  Check,
  ArrowUpRight,
} from 'lucide-react';
import {
  getSupabaseSensorClient,
  SensorLogRow,
  EnrichedSensorReading,
  enrichSensorReading,
  computeTelemetrySummary,
  formatRelativeTime,
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
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  // Realtime subscription status
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');

  // Chart tooltip hover state
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Periodic ticker to keep elapsed time indicators ("10s ago", "Just now") dynamically updated
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, []);

  // Fetch readings — queries server API route first, then direct Supabase client
  const fetchSensorLogs = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) setIsRefreshing(true);

      try {
        let rows: SensorLogRow[] = [];
        let fetchedOk = false;

        // Attempt 1: server-side route
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
          // ignore, fallback to direct query below
        }

        // Attempt 2: direct Supabase SDK (anon key)
        if (!fetchedOk) {
          const supabase = getSupabaseSensorClient();
          const { data, error: sbError } = await supabase
            .from('sensor_logs')
            .select(
              'id, recorded_at, temperature, humidity, ammonia_ppm, ammonia_raw, sound_db, sound_raw, temp_status, hum_status, ammonia_status, sound_status'
            )
            .order('id', { ascending: false })
            .limit(fetchLimit);

          if (sbError) throw new Error(sbError.message);
          rows = (data || []) as SensorLogRow[];
        }

        const enriched = rows.map((r) => enrichSensorReading(r));
        setReadings(enriched);
        setLastSyncTime(new Date());
        setError(null);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to query sensor data';
        setError(msg);
      } finally {
        setLoading(false);
        if (isManualRefresh) setIsRefreshing(false);
      }
    },
    [fetchLimit]
  );

  // ── Auto-start Realtime WebSocket subscription on mount ──
  useEffect(() => {
    setRealtimeStatus('connecting');
    fetchSensorLogs(); // initial load

    const supabase = getSupabaseSensorClient();
    // Unique channel topic prevents channel collision upon React remounts
    const channelTopic = `sensor_logs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const channel = supabase.channel(channelTopic);

    const handleIncomingRow = (row: SensorLogRow) => {
      if (row && (row.id !== undefined || row.recorded_at)) {
        const enriched = enrichSensorReading(row);
        setReadings((prev) => {
          const filtered = prev.filter((r) => r.id !== enriched.id);
          return [enriched, ...filtered.slice(0, fetchLimit - 1)];
        });
        setLastSyncTime(new Date());
        setRealtimePacketsReceived((c) => c + 1);
        setError(null);
      }
    };

    channel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sensor_logs' },
        (payload) => handleIncomingRow(payload.new as SensorLogRow)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sensor_logs' },
        (payload) => handleIncomingRow(payload.new as SensorLogRow)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sensor_logs' },
        (payload) => {
          if (payload.new && Object.keys(payload.new).length > 0) {
            handleIncomingRow(payload.new as SensorLogRow);
          }
        }
      )
      .on('broadcast', { event: 'telemetry' }, (payload) => {
        handleIncomingRow(payload.payload as SensorLogRow);
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
          setError(null);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeStatus('disconnected');
          if (err) console.warn('Supabase Realtime status warning:', status, err);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchSensorLogs, fetchLimit]);

  // Polling fallback — syncs every N seconds alongside Realtime
  useEffect(() => {
    if (autoRefreshSec <= 0) return;
    const timer = setInterval(() => fetchSensorLogs(), autoRefreshSec * 1000);
    return () => clearInterval(timer);
  }, [fetchSensorLogs, autoRefreshSec]);

  const summary = useMemo(() => computeTelemetrySummary(readings), [readings]);

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

  const handleExportCsv = () => {
    if (readings.length === 0) return;
    const headers = [
      'ID','Recorded_At','Temperature_C','Humidity_Pct','Ammonia_PPM',
      'Sound_DB','THI','Heat_Stress_Level','Temp_Status','Hum_Status',
      'Ammonia_Status','Sound_Status',
    ];
    const rows = readings.map((r) => [
      r.id, r.recorded_at, r.temperature ?? '', r.humidity ?? '',
      r.ammonia_ppm ?? '', r.sound_db ?? '', r.thi ?? '',
      r.heatStressLevel, r.temp_status ?? '', r.hum_status ?? '',
      r.ammonia_status ?? '', r.sound_status ?? '',
    ]);
    const csv = 'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csv);
    link.download = `sensor_telemetry_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyRlsSql = () => {
    navigator.clipboard.writeText(
      `CREATE POLICY "Allow public read on sensor_logs" ON public.sensor_logs FOR SELECT TO public, anon USING (true);\nALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_logs;`
    );
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  // SVG Chart computation
  const chartData = useMemo(() => {
    const reversed = [...readings].reverse();
    if (reversed.length < 2) return null;

    const W = 800, H = 220, PX = 40, PY = 24;
    const iW = W - PX * 2, iH = H - PY * 2;
    const N = reversed.length;
    const gx = (i: number) => PX + (i / (N - 1)) * iW;

    const yscale = (vals: (number | null)[], lo?: number, hi?: number) => {
      const valid = vals.filter((v): v is number => v !== null && !isNaN(v));
      if (!valid.length) return () => H / 2;
      let mn = lo ?? Math.min(...valid);
      let mx = hi ?? Math.max(...valid);
      if (mn === mx) { mn -= 1; mx += 1; }
      return (v: number | null) => {
        if (v === null || isNaN(v)) return iH;
        return PY + iH - ((v - mn) / (mx - mn)) * iH;
      };
    };

    const T = reversed.map((r) => r.temperature);
    const Hu = reversed.map((r) => r.humidity);
    const N3 = reversed.map((r) => r.ammonia_ppm);
    const S = reversed.map((r) => r.sound_db);
    const THI = reversed.map((r) => r.thi);

    const ts = yscale(T, 15, 42);
    const hs = yscale(Hu, 30, 95);
    const ns = yscale(N3, 0, Math.max(25, ...(N3.filter((v): v is number => v !== null))));
    const ss = yscale(S, 35, 95);
    const tis = yscale(THI, 65, 90);

    const poly = (vals: (number | null)[], fn: (v: number | null) => number) =>
      vals.map((v, i) => `${gx(i).toFixed(1)},${fn(v).toFixed(1)}`).join(' ');

    const area = (vals: (number | null)[], fn: (v: number | null) => number) => {
      const pts = vals.map((v, i) => `${gx(i).toFixed(1)},${fn(v).toFixed(1)}`);
      const b = PY + iH;
      return `M ${pts[0]} L ${pts.join(' L ')} L ${gx(N - 1)},${b} L ${PX},${b} Z`;
    };

    return {
      W, H, PX, PY, iW, iH, reversed, gx,
      tPoly: poly(T, ts), tArea: area(T, ts),
      hPoly: poly(Hu, hs),
      nPoly: poly(N3, ns), nArea: area(N3, ns),
      sPoly: poly(S, ss),
      tiPoly: poly(THI, tis), tiArea: area(THI, tis),
    };
  }, [readings]);

  // ─────────────────────────── RENDER ───────────────────────────
  return (
    <div className="space-y-6">

      {/* ── HEADER STRIP ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Title & status */}
          <div className="flex items-start gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-md shadow-orange-500/20">
              <Radio className="h-6 w-6 animate-pulse" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-bold tracking-tight text-slate-900">Sensor Live Monitoring</h2>

                {realtimeStatus === 'connected' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    Realtime Stream Active
                  </span>
                )}

                {realtimeStatus === 'connecting' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                    Connecting…
                  </span>
                )}

                {realtimeStatus === 'disconnected' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                    Polling ({autoRefreshSec > 0 ? `${autoRefreshSec}s` : 'Manual'})
                  </span>
                )}

                {realtimePacketsReceived > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                    <Zap className="h-3 w-3" />
                    {realtimePacketsReceived} live events
                  </span>
                )}

                {readings.length > 0 && (
                  (() => {
                    const latestMs = new Date(readings[0].recorded_at).getTime();
                    const isStale = !isNaN(latestMs) && now - latestMs > 5 * 60 * 1000;
                    return isStale ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800" title="Physical sensor hardware has not uploaded a new record recently. The dashboard will automatically update the second a new packet is sent.">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        Hardware Idle ({formatRelativeTime(readings[0].recorded_at)})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        Transmitting Live
                      </span>
                    );
                  })()
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500 sm:text-sm">
                Real-time poultry house environmental telemetry — automatically streams the moment data arrives.
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Poll interval */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-xs font-medium text-slate-600">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              <span>Sync:</span>
              <select
                aria-label="Polling interval"
                value={autoRefreshSec}
                onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
                className="cursor-pointer bg-transparent font-semibold text-slate-800 outline-none"
              >
                <option value={2}>2 s</option>
                <option value={3}>3 s</option>
                <option value={5}>5 s</option>
                <option value={10}>10 s</option>
                <option value={0}>Manual</option>
              </select>
            </div>

            {/* Manual refresh */}
            <button
              onClick={() => fetchSensorLogs(true)}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Export CSV */}
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

        {/* Status strip */}
        <div className="mt-4 flex flex-wrap items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-700">Source:</span>
              <span>Supabase Cloud PostgreSQL</span>
            </span>
            <span>·</span>
            <span className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-700">Table:</span>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-orange-600">
                public.sensor_logs
              </code>
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 sm:mt-0 text-slate-400">
            <span>Sync:</span>
            <span className="font-semibold text-slate-700">
              {lastSyncTime ? lastSyncTime.toLocaleTimeString() : 'Waiting…'}
            </span>
            <span className="text-slate-300">·</span>
            <span>Latest packet:</span>
            <span className="font-semibold text-slate-700">
              {readings.length > 0 ? formatRelativeTime(readings[0].recorded_at) : 'None'}
            </span>
            <span className="text-slate-300">·</span>
            <span>{readings.length} records</span>
          </div>
        </div>
      </div>

      {/* ── ERROR NOTICE ── */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/80 p-4 text-xs text-red-700 shadow-sm">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
          <div>
            <p className="font-semibold">Telemetry query error</p>
            <p className="mt-0.5 text-red-600">{error}</p>
          </div>
        </div>
      )}

      {/* ── AWAITING DATA DIAGNOSTIC ── */}
      {!loading && readings.length === 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-6 shadow-sm">
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-100 text-amber-700">
              <Radio className="h-6 w-6 animate-pulse" />
            </div>
            <div className="flex-1 text-xs text-slate-700">
              <h3 className="text-sm font-bold text-slate-900">
                WebSocket Ready — Awaiting First Sensor Packet
              </h3>
              <p className="mt-1 text-slate-600 leading-relaxed">
                The dashboard is actively listening for live inserts on{' '}
                <code className="rounded border border-amber-200 bg-white/80 px-1.5 py-0.5 font-mono text-orange-700">
                  public.sensor_logs
                </code>. Records will populate automatically the moment your sensor node writes to Supabase.
              </p>

              {/* RLS hint */}
              <div className="mt-3 rounded-xl border border-amber-300/80 bg-white/90 p-3.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">
                    💡 Rows not appearing despite sensor uploads?
                  </span>
                  <button
                    onClick={copyRlsSql}
                    className="flex items-center gap-1 rounded bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-200"
                  >
                    {copiedSql ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedSql ? 'Copied' : 'Copy SQL'}
                  </button>
                </div>
                <p className="mt-1 text-slate-600">
                  Supabase RLS may be blocking reads. Run this once in the{' '}
                  <a
                    href="https://supabase.com/dashboard/project/aoskfztsusjucgwdhtmc/sql"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-semibold text-orange-600 hover:underline"
                  >
                    SQL Editor <ArrowUpRight className="h-3 w-3" />
                  </a>:
                </p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-2.5 font-mono text-[10px] text-emerald-400 leading-relaxed">
{`CREATE POLICY "Allow public read on sensor_logs"
  ON public.sensor_logs FOR SELECT TO public, anon USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_logs;`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── METRIC CARDS ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">

        {/* TEMPERATURE */}
        <MetricCard
          label="Temperature"
          value={summary.temp.current !== null ? `${summary.temp.current.toFixed(1)}°` : '—'}
          unit="C"
          sub={`Avg ${summary.temp.avg ?? '—'}°C · ${summary.temp.min ?? '—'}–${summary.temp.max ?? '—'}°C`}
          bar={Math.min(100, Math.max(10, ((summary.temp.current ?? 20) / 40) * 100))}
          barColor={summary.temp.current !== null && summary.temp.current > 28 ? 'bg-rose-500' : 'bg-orange-500'}
          status={
            summary.temp.current === null ? 'Awaiting Data' :
            summary.temp.current >= 18 && summary.temp.current <= 26 ? 'Optimal' :
            summary.temp.current < 18 ? 'Cool' : 'Elevated'
          }
          statusColor={
            summary.temp.current === null ? 'text-slate-400' :
            summary.temp.current >= 18 && summary.temp.current <= 26 ? 'text-emerald-600 font-bold' :
            summary.temp.current < 18 ? 'text-blue-600 font-bold' : 'text-amber-600 font-bold'
          }
          hint="Optimal: 18–26°C"
          Icon={Thermometer}
          iconBg="bg-orange-100 text-orange-600"
        />

        {/* HUMIDITY */}
        <MetricCard
          label="Relative Humidity"
          value={summary.humidity.current !== null ? `${summary.humidity.current.toFixed(1)}` : '—'}
          unit="%RH"
          sub={`Avg ${summary.humidity.avg ?? '—'}% · ${summary.humidity.min ?? '—'}–${summary.humidity.max ?? '—'}%`}
          bar={Math.min(100, Math.max(10, summary.humidity.current ?? 50))}
          barColor="bg-blue-500"
          status={
            summary.humidity.current === null ? 'Awaiting Data' :
            summary.humidity.current >= 50 && summary.humidity.current <= 70 ? 'Comfort Zone' :
            summary.humidity.current < 50 ? 'Dry Air' : 'High Moisture'
          }
          statusColor={
            summary.humidity.current === null ? 'text-slate-400' :
            summary.humidity.current >= 50 && summary.humidity.current <= 70 ? 'text-emerald-600 font-bold' :
            'text-amber-600 font-bold'
          }
          hint="Target: 50–70%"
          Icon={Droplets}
          iconBg="bg-blue-100 text-blue-600"
        />

        {/* AMMONIA */}
        <MetricCard
          label="Ammonia (NH₃)"
          value={summary.ammonia.current !== null ? `${summary.ammonia.current.toFixed(2)}` : '—'}
          unit="ppm"
          sub={`Avg ${summary.ammonia.avg ?? '—'} ppm · Peak ${summary.ammonia.max ?? '—'} ppm`}
          bar={Math.min(100, Math.max(10, ((summary.ammonia.current ?? 5) / 25) * 100))}
          barColor={
            summary.ammonia.current !== null && summary.ammonia.current > 20 ? 'bg-rose-500' :
            summary.ammonia.current !== null && summary.ammonia.current > 10 ? 'bg-amber-500' : 'bg-emerald-500'
          }
          status={
            summary.ammonia.current === null ? 'Awaiting Data' :
            summary.ammonia.current <= 10 ? 'Safe' :
            summary.ammonia.current <= 20 ? 'Moderate Alert' : 'Toxic Level'
          }
          statusColor={
            summary.ammonia.current === null ? 'text-slate-400' :
            summary.ammonia.current <= 10 ? 'text-emerald-600 font-bold' :
            summary.ammonia.current <= 20 ? 'text-amber-600 font-bold' : 'text-rose-600 font-bold'
          }
          hint="Safe: < 10 ppm"
          Icon={Wind}
          iconBg="bg-emerald-100 text-emerald-600"
        />

        {/* SOUND */}
        <MetricCard
          label="Acoustics / Sound"
          value={summary.sound.current !== null ? `${summary.sound.current.toFixed(1)}` : '—'}
          unit="dB"
          sub={`Avg ${summary.sound.avg ?? '—'} dB · Peak ${summary.sound.max ?? '—'} dB`}
          bar={Math.min(100, Math.max(10, ((summary.sound.current ?? 50) / 90) * 100))}
          barColor="bg-indigo-500"
          status={
            summary.sound.current === null ? 'Awaiting Data' :
            summary.sound.current < 65 ? 'Calm' :
            summary.sound.current < 75 ? 'Active / Alert' : 'Distress / Vocal'
          }
          statusColor={
            summary.sound.current === null ? 'text-slate-400' :
            summary.sound.current < 65 ? 'text-emerald-600 font-bold' :
            summary.sound.current < 75 ? 'text-amber-600 font-bold' : 'text-rose-600 font-bold'
          }
          hint="Flock stress index"
          Icon={Gauge}
          iconBg="bg-indigo-100 text-indigo-600"
        />

        {/* THI */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Poultry Heat Stress</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900">
              {summary.thi.current !== null ? summary.thi.current.toFixed(1) : '—'}
            </span>
            <span className="text-xs font-semibold text-slate-500">THI</span>
          </div>
          <div className="mt-3 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
            Avg THI: {summary.thi.avg !== null ? summary.thi.avg.toFixed(1) : '—'}
          </div>
          <div className="mt-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                summary.thi.heatStressLevel === 'Normal'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : summary.thi.heatStressLevel === 'Moderate'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : summary.thi.heatStressLevel === 'Severe'
                  ? 'bg-orange-50 text-orange-700 border-orange-200'
                  : summary.thi.heatStressLevel === 'Emergency'
                  ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              }`}
            >
              {summary.thi.heatStressLevel === 'Normal'
                ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                : <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
              }
              {summary.thi.heatStressLevel}
            </span>
          </div>
        </div>
      </div>

      {/* ── TREND CHART ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Environmental Telemetry Trends</h3>
            <p className="text-xs text-slate-500">Time-series of real incoming sensor packets.</p>
          </div>
          <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100 p-1 text-xs font-semibold">
            {(['temp_hum', 'ammonia', 'sound', 'thi'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setChartMetric(m)}
                className={`rounded-lg px-3 py-1.5 transition ${
                  chartMetric === m ? 'bg-white shadow-sm text-orange-600' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {m === 'temp_hum' ? 'Temp & Humidity' : m === 'ammonia' ? 'Ammonia (NH₃)' : m === 'sound' ? 'Sound (dB)' : 'THI Index'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {chartData ? (
            <>
              <svg
                viewBox={`0 0 ${chartData.W} ${chartData.H}`}
                className="h-56 w-full select-none overflow-visible"
                onMouseLeave={() => setHoverIndex(null)}
              >
                <defs>
                  {[
                    { id: 'tGrad', color: '#f97316' },
                    { id: 'nGrad', color: '#10b981' },
                    { id: 'tiGrad', color: '#f43f5e' },
                  ].map(({ id, color }) => (
                    <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                      <stop offset="100%" stopColor={color} stopOpacity="0" />
                    </linearGradient>
                  ))}
                </defs>

                {/* Grid */}
                {[chartData.PY, chartData.PY + chartData.iH / 2, chartData.PY + chartData.iH].map((y, i) => (
                  <line
                    key={i}
                    x1={chartData.PX} y1={y}
                    x2={chartData.W - chartData.PX} y2={y}
                    stroke={i === 2 ? '#cbd5e1' : '#e2e8f0'}
                    strokeDasharray={i === 2 ? undefined : '4 4'}
                  />
                ))}

                {/* Plots */}
                {chartMetric === 'temp_hum' && (
                  <>
                    <path d={chartData.tArea} fill="url(#tGrad)" />
                    <polyline fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={chartData.tPoly} />
                    <polyline fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" points={chartData.hPoly} />
                  </>
                )}
                {chartMetric === 'ammonia' && (
                  <>
                    <path d={chartData.nArea} fill="url(#nGrad)" />
                    <polyline fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={chartData.nPoly} />
                  </>
                )}
                {chartMetric === 'sound' && (
                  <polyline fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={chartData.sPoly} />
                )}
                {chartMetric === 'thi' && (
                  <>
                    <path d={chartData.tiArea} fill="url(#tiGrad)" />
                    <polyline fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={chartData.tiPoly} />
                  </>
                )}

                {/* Hover hit-targets */}
                {chartData.reversed.map((pt, idx) => (
                  <rect
                    key={pt.id || idx}
                    x={chartData.gx(idx) - 10} y={chartData.PY}
                    width={20} height={chartData.iH}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoverIndex(idx)}
                  />
                ))}
                {hoverIndex !== null && (
                  <line
                    x1={chartData.gx(hoverIndex)} y1={chartData.PY}
                    x2={chartData.gx(hoverIndex)} y2={chartData.PY + chartData.iH}
                    stroke="#64748b" strokeWidth="1.5" strokeDasharray="2 2"
                  />
                )}
              </svg>

              {/* Legend + tooltip */}
              <div className="mt-3 flex flex-wrap items-center justify-between text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  {chartMetric === 'temp_hum' && (
                    <>
                      <span className="flex items-center gap-1.5 font-medium text-slate-700"><span className="h-2.5 w-2.5 rounded-full bg-orange-500" />Temperature (°C)</span>
                      <span className="flex items-center gap-1.5 font-medium text-slate-700"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" />Humidity (%RH)</span>
                    </>
                  )}
                  {chartMetric === 'ammonia' && <span className="flex items-center gap-1.5 font-medium text-slate-700"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Ammonia NH₃ (ppm)</span>}
                  {chartMetric === 'sound' && <span className="flex items-center gap-1.5 font-medium text-slate-700"><span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />Sound (dB)</span>}
                  {chartMetric === 'thi' && <span className="flex items-center gap-1.5 font-medium text-slate-700"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" />Temperature-Humidity Index</span>}
                </div>

                {hoverIndex !== null && chartData.reversed[hoverIndex] && (
                  <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-[11px] text-slate-800 shadow-sm">
                    <span className="font-semibold text-slate-500">{chartData.reversed[hoverIndex].formattedTime}</span>
                    <span>T: {chartData.reversed[hoverIndex].temperature ?? '—'}°C</span>
                    <span>H: {chartData.reversed[hoverIndex].humidity ?? '—'}%</span>
                    <span>NH₃: {chartData.reversed[hoverIndex].ammonia_ppm ?? '—'} ppm</span>
                    <span>dB: {chartData.reversed[hoverIndex].sound_db ?? '—'}</span>
                    <span className="font-bold text-orange-600">THI: {chartData.reversed[hoverIndex].thi ?? '—'}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-44 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 text-center">
              <Activity className="h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">Awaiting Telemetry</p>
              <p className="mt-1 text-xs text-slate-400">At least 2 readings needed to draw trend curves.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── LOG TABLE ── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Table header */}
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 animate-pulse text-orange-500" />
            <h3 className="text-base font-bold text-slate-900">Live Telemetry Stream Log</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {filteredReadings.length} records
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-700 outline-none transition focus:border-orange-500"
              />
            </div>
            {/* Status filter */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
              <Filter className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
              <select
                aria-label="Filter status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="cursor-pointer bg-transparent font-medium text-slate-800 outline-none"
              >
                <option value="all">All States</option>
                <option value="normal">Normal / Safe</option>
                <option value="alert">Alerts Only</option>
              </select>
            </div>
            {/* Limit */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
              <span className="mr-1.5 text-slate-400">Limit:</span>
              <select
                aria-label="Fetch limit"
                value={fetchLimit}
                onChange={(e) => setFetchLimit(Number(e.target.value))}
                className="cursor-pointer bg-transparent font-medium text-slate-800 outline-none"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
              </select>
            </div>
          </div>
        </div>

        {/* Table body with fixed scrollable container and sticky header */}
        <div className="max-h-[480px] overflow-x-auto overflow-y-auto overscroll-contain">
          {loading && readings.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-orange-500" />
              <p className="mt-2 text-xs font-medium text-slate-500">Connecting to sensor stream…</p>
            </div>
          ) : filteredReadings.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center p-6 text-center">
              <Radio className="mb-2 h-9 w-9 text-slate-300" />
              <p className="text-sm font-bold text-slate-800">Listening for incoming sensor data…</p>
              <p className="mt-1 max-w-md text-xs text-slate-500">
                Packets will appear here automatically as your sensor nodes write to Supabase.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-xs font-semibold text-slate-600">
                <tr>
                  <th className="bg-slate-50 px-4 py-3 sm:px-6">Recorded At</th>
                  <th className="bg-slate-50 px-4 py-3">Temperature</th>
                  <th className="bg-slate-50 px-4 py-3">Humidity</th>
                  <th className="bg-slate-50 px-4 py-3">Ammonia (NH₃)</th>
                  <th className="bg-slate-50 px-4 py-3">Sound</th>
                  <th className="bg-slate-50 px-4 py-3">THI / Heat Stress</th>
                  <th className="bg-slate-50 px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredReadings.map((r, i) => (
                  <tr key={r.id || i} className="transition hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-4 py-3 sm:px-6">
                      <div className="font-semibold text-slate-800">{r.formattedTime}</div>
                      <div className="text-[11px] text-slate-400">{formatRelativeTime(r.recorded_at)}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.temperature !== null
                        ? <span className={`font-mono font-bold ${r.temperature > 28 ? 'text-rose-600' : 'text-slate-800'}`}>{r.temperature.toFixed(1)} °C</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.humidity !== null
                        ? <span className="font-mono text-slate-700">{r.humidity.toFixed(1)} %</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.ammonia_ppm !== null
                        ? <span className={`font-mono font-semibold ${r.ammonia_ppm > 20 ? 'text-rose-600' : r.ammonia_ppm > 10 ? 'text-amber-600' : 'text-slate-700'}`}>{r.ammonia_ppm.toFixed(2)} ppm</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {r.sound_db !== null
                        ? <span className="font-mono text-slate-700">{r.sound_db.toFixed(1)} dB</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-800">{r.thi !== null ? r.thi.toFixed(1) : '—'}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          r.heatStressLevel === 'Normal' ? 'bg-emerald-50 text-emerald-700' :
                          r.heatStressLevel === 'Moderate' ? 'bg-amber-50 text-amber-700' :
                          r.heatStressLevel === 'Severe' ? 'bg-orange-50 text-orange-700' :
                          r.heatStressLevel === 'Emergency' ? 'bg-rose-50 text-rose-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>{r.heatStressLevel}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1">
                        {[
                          { label: 'T', val: r.temp_status },
                          { label: 'H', val: r.hum_status },
                          { label: 'N', val: r.ammonia_status },
                        ].map(({ label, val }) => (
                          <span
                            key={label}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              val === 1 ? 'bg-emerald-100 text-emerald-800' :
                              val === 2 ? 'bg-amber-100 text-amber-800' :
                              'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {label}:{val ?? 0}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Scrollable table footer indicator */}
        {filteredReadings.length > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-5 py-2.5 text-[11px] text-slate-500 sm:px-6">
            <span>
              Showing <strong className="text-slate-700">{filteredReadings.length}</strong> records (buffer limit: {fetchLimit})
            </span>
            <span className="text-slate-400">Scroll container to browse previous readings</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Reusable metric card sub-component ──
function MetricCard({
  label, value, unit, sub, bar, barColor, status, statusColor, hint, Icon, iconBg,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
  bar: number;
  barColor: string;
  status: string;
  statusColor: string;
  hint: string;
  Icon: React.ElementType;
  iconBg: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-extrabold tracking-tight text-slate-900">{value}</span>
        <span className="text-sm font-semibold text-slate-500">{unit}</span>
      </div>
      <div className="mt-3 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">{sub}</div>
      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-slate-400">
          <span>{hint}</span>
          <span className={statusColor}>{status}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full transition-all duration-500 ${barColor}`} style={{ width: `${bar}%` }} />
        </div>
      </div>
    </div>
  );
}
