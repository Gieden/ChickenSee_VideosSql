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
  Cpu,
  AlertTriangle,
  Eye,
  CheckCircle2,
  XCircle,
  X,
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
  processed_at: string;
  bird_count: number;
  total_tracks: number;
  eating_count: number;
  drinking_count: number;
  inactive_count: number;
  inactivity_pct: number;
  feather_pecking_count: number;
  avg_velocity: number;
  temp_avg: number | null;
  humidity_avg: number | null;
  result_file: string;
  detected_video: string | null;
}

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

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-md shadow-indigo-500/20">
              <Server className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white sm:text-lg">ChickenSee Portal</h1>
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

        <div className="mx-auto flex max-w-7xl border-t border-slate-800/50 px-4 sm:px-6">
          <nav className="flex space-x-6">
            <button onClick={() => setActiveTab('videos')} className={`flex items-center gap-2 border-b-2 py-3 text-xs sm:text-sm font-semibold transition ${activeTab === 'videos' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-300'}`}>
              <Video className="h-4 w-4" />
              <span>Synced Videos</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{videos.length}</span>
            </button>
            <button onClick={() => setActiveTab('database')} className={`flex items-center gap-2 border-b-2 py-3 text-xs sm:text-sm font-semibold transition ${activeTab === 'database' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-300'}`}>
              <Database className="h-4 w-4" />
              <span>SQLite Tables</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{databases.length}</span>
            </button>
            <button onClick={() => setActiveTab('results')} className={`flex items-center gap-2 border-b-2 py-3 text-xs sm:text-sm font-semibold transition ${activeTab === 'results' ? 'border-violet-500 text-violet-400' : 'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-300'}`}>
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
          <div className="space-y-6">
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-6">
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={fetchResults} disabled={loadingResults} className="flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-300 transition hover:bg-violet-500/20">
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingResults ? 'animate-spin' : ''}`} />
                    Refresh Results
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">Analysis results uploaded from watched video folders.</p>
              </div>
              {results.length > 0 && (
                <span className="rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-slate-400">
                  <span className="font-semibold text-violet-300">{results.length}</span> jobs loaded
                </span>
              )}
            </div>

            {resultsError && (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
                <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-300">Cannot load uploaded results</p>
                  <p className="mt-1 text-xs text-slate-400">{resultsError}</p>
                </div>
              </div>
            )}

            {loadingResults && (
              <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/30">
                <div className="flex flex-col items-center gap-3">
                  <RefreshCw className="h-6 w-6 animate-spin text-violet-400" />
                  <p className="text-xs text-slate-500">Fetching behavior analysis results...</p>
                </div>
              </div>
            )}

            {!loadingResults && !resultsError && results.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 p-12 text-center">
                <Bird className="mb-4 h-12 w-12 text-slate-600" />
                <h4 className="text-base font-semibold text-slate-300">No behavior results yet</h4>
                <p className="mt-1 text-sm text-slate-500 max-w-md">Results appear once the YOLO26n + ByteTrack analytics pipeline processes video segments on the OptiPlex server.</p>
              </div>
            )}

            {!loadingResults && results.length > 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    { icon: <Bird className="h-5 w-5" />, label: 'Total Birds Tracked', value: results.reduce((a, r) => a + (r.bird_count || 0), 0), color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
                    { icon: <Eye className="h-5 w-5" />, label: 'Eating Events', value: results.reduce((a, r) => a + (r.eating_count || 0), 0), color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
                    { icon: <Activity className="h-5 w-5" />, label: 'Inactive Episodes', value: results.reduce((a, r) => a + (r.inactive_count || 0), 0), color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
                    { icon: <AlertTriangle className="h-5 w-5" />, label: 'Pecking Events', value: results.reduce((a, r) => a + (r.feather_pecking_count || 0), 0), color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
                  ].map((stat) => (
                    <div key={stat.label} className={`flex items-center gap-4 rounded-2xl border ${stat.bg} p-4`}>
                      <div className={stat.color}>{stat.icon}</div>
                      <div>
                        <p className="text-[11px] text-slate-500">{stat.label}</p>
                        <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl overflow-hidden">
                  <div className="border-b border-slate-800 bg-slate-950/50 px-5 py-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-violet-400" />
                      <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">YOLO26n + ByteTrack — Behavior Analysis Jobs</span>
                    </div>
                    <span className="text-[11px] text-slate-500">{results.length} records</span>
                  </div>
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 z-10 bg-slate-950 shadow-sm">
                        <tr>
                          {['Job','Video File','Interval','Processed At','Birds','Eating Bouts','Drinking Bouts','Inactive Birds','Inactive %','Pecking','Avg Vel (px/s)','Temp (C)','Humidity (%)','Result File','Detected Video'].map((h) => (
                            <th key={h} className="border-b border-slate-800 px-4 py-3 font-semibold tracking-wider text-slate-400 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {results.map((r) => (
                          <tr key={r.result_id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-3 font-mono text-slate-500">#{r.job_id}</td>
                            <td className="px-4 py-3 max-w-[180px] truncate text-slate-200" title={r.video_file}>{r.video_file}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-slate-300">{r.interval_label}</td>
                            <td className="px-4 py-3 whitespace-nowrap text-slate-400 font-mono text-[11px]">{r.processed_at ? new Date(r.processed_at).toLocaleString() : '-'}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 text-violet-300 font-semibold">
                                <Bird className="h-3 w-3" />{r.bird_count ?? '-'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center"><span className="inline-flex rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-emerald-300 font-semibold">{r.eating_count ?? '-'}</span></td>
                            <td className="px-4 py-3 text-center"><span className="inline-flex rounded-full bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 text-blue-300 font-semibold">{r.drinking_count ?? '-'}</span></td>
                            <td className="px-4 py-3 text-center"><span className="inline-flex rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-amber-300 font-semibold">{r.inactive_count ?? '-'}</span></td>
                            <td className="px-4 py-3 text-center font-mono text-slate-300">{r.inactivity_pct != null ? `${r.inactivity_pct.toFixed(1)}%` : '-'}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold border ${(r.feather_pecking_count || 0) > 0 ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>{r.feather_pecking_count ?? '-'}</span>
                            </td>
                            <td className="px-4 py-3 text-center font-mono text-slate-300">{r.avg_velocity != null ? r.avg_velocity.toFixed(1) : '-'}</td>
                            <td className="px-4 py-3 text-center font-mono text-slate-300">{r.temp_avg != null ? r.temp_avg.toFixed(1) : '-'}</td>
                            <td className="px-4 py-3 text-center font-mono text-slate-300">{r.humidity_avg != null ? r.humidity_avg.toFixed(1) : '-'}</td>
                            <td className="px-4 py-3 whitespace-nowrap font-mono text-slate-400">{r.result_file}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {r.detected_video ? (
                                <a
                                  href={`/api/video-proxy?pathname=${encodeURIComponent(r.detected_video)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-semibold text-violet-300 hover:text-violet-200"
                                >
                                  Play detected video
                                </a>
                              ) : <span className="text-slate-500">Uploading…</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
