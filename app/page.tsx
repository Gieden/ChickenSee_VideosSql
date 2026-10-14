'use client';

import { useState, useEffect } from 'react';
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
  Table,
  ChevronLeft,
  ChevronRight,
  Layers,
  Server,
  FileCode,
  CheckCircle2,
  Clock,
  Radio,
  Trash2,
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

export default function DashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'videos' | 'database'>('videos');

  // Video State
  const [videos, setVideos] = useState<SyncedFileMeta[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<SyncedFileMeta | null>(null);
  const [loadingVideos, setLoadingVideos] = useState(true);

  // Database State
  const [databases, setDatabases] = useState<SyncedFileMeta[]>([]);
  const [currentDbFile, setCurrentDbFile] = useState<string | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [loadingDb, setLoadingDb] = useState(true);
  const [pageOffset, setPageOffset] = useState(0);
  const pageSize = 50;

  // Auto-refresh timer / indicator
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);

  async function handleCleanupOldVideos() {
    if (
      !confirm(
        'Delete videos older than 7 days from Vercel Blob to free up cloud storage?\n\nSQLite databases, telemetry rows, and behavior metrics will be fully preserved.'
      )
    ) {
      return;
    }
    try {
      setIsCleaning(true);
      const res = await fetch('/api/cron/cleanup?days=7', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(`Cleanup complete!\n${data.message}\nFreed: ${data.freedMB} MB`);
        fetchVideos();
      } else {
        alert(`Cleanup error: ${data.error || 'Failed'}`);
      }
    } catch (err: any) {
      alert(`Cleanup failed: ${err.message}`);
    } finally {
      setIsCleaning(false);
    }
  }

  async function fetchVideos() {
    try {
      setLoadingVideos(true);
      const res = await fetch('/api/videos');
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      const data = await res.json();
      setVideos(data.videos || []);
      if (!selectedVideo && data.videos?.length > 0) {
        setSelectedVideo(data.videos[0]);
      }
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
      if (res.status === 401) {
        router.push('/login');
        return;
      }
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

  async function refreshAll() {
    setIsRefreshing(true);
    if (activeTab === 'videos') {
      await fetchVideos();
    } else {
      await fetchDatabaseData(currentDbFile || undefined, selectedTable || undefined, pageOffset);
    }
    setTimeout(() => setIsRefreshing(false), 400);
  }

  useEffect(() => {
    fetchVideos();
    fetchDatabaseData();
  }, []);

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

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100">
      {/* Top Navigation */}
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
              <p className="text-xs text-slate-400 hidden sm:block">Automated Vercel Blob & SQLite Bridge</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCleanupOldVideos}
              disabled={isCleaning}
              title="Delete synced videos older than 7 days from Vercel Blob to save storage"
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20 hover:text-amber-200"
            >
              <Trash2 className={`h-3.5 w-3.5 ${isCleaning ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Clean &gt;7d</span>
            </button>

            <button
              onClick={refreshAll}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/20 hover:text-red-300"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="mx-auto flex max-w-7xl border-t border-slate-800/50 px-4 sm:px-6">
          <nav className="flex space-x-6">
            <button
              onClick={() => setActiveTab('videos')}
              className={`flex items-center gap-2 border-b-2 py-3 text-xs sm:text-sm font-semibold transition ${
                activeTab === 'videos'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-300'
              }`}
            >
              <Video className="h-4 w-4" />
              <span>Synced Videos</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                {videos.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('database')}
              className={`flex items-center gap-2 border-b-2 py-3 text-xs sm:text-sm font-semibold transition ${
                activeTab === 'database'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-300'
              }`}
            >
              <Database className="h-4 w-4" />
              <span>SQLite Tables</span>
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                {databases.length}
              </span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        {activeTab === 'videos' ? (
          <div className="space-y-6">
            {/* Active Video Player Stage */}
            {selectedVideo && (
              <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl backdrop-blur-sm">
                <div className="aspect-video w-full bg-black">
                  <video
                    key={selectedVideo.url}
                    src={selectedVideo.url}
                    controls
                    autoPlay
                    playsInline
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-6">
                  <div>
                    <h2 className="text-lg font-bold text-white sm:text-xl">
                      {selectedVideo.pathname}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <HardDrive className="h-3.5 w-3.5 text-slate-500" />
                        {formatBytes(selectedVideo.size)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-slate-500" />
                        {new Date(selectedVideo.uploadedAt).toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1.5 text-indigo-400">
                        <Radio className="h-3.5 w-3.5 animate-pulse" />
                        Vercel Blob Stream
                      </span>
                    </div>
                  </div>

                  <a
                    href={selectedVideo.url}
                    download={selectedVideo.pathname}
                    className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 hover:text-white"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download MP4</span>
                  </a>
                </div>
              </div>
            )}

            {/* Video List Grid */}
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                  Available Media Files ({videos.length})
                </h3>
              </div>

              {loadingVideos ? (
                <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/30">
                  <RefreshCw className="h-6 w-6 animate-spin text-indigo-400" />
                </div>
              ) : videos.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 p-12 text-center">
                  <Video className="mb-4 h-12 w-12 text-slate-600" />
                  <h4 className="text-base font-semibold text-slate-300">No MP4 files synchronized yet</h4>
                  <p className="mt-1 text-sm text-slate-500 max-w-md">
                    Drop .mp4 files into the Optiplex <code className="text-indigo-400">./data</code> directory. The watcher will stream them here automatically.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {videos.map((vid) => {
                    const isCurrent = selectedVideo?.pathname === vid.pathname;
                    return (
                      <div
                        key={vid.url}
                        onClick={() => setSelectedVideo(vid)}
                        className={`group relative cursor-pointer overflow-hidden rounded-xl border p-4 transition ${
                          isCurrent
                            ? 'border-indigo-500/80 bg-indigo-950/20 shadow-lg shadow-indigo-500/10'
                            : 'border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-105 transition">
                            <Play className="h-5 w-5 fill-indigo-400" />
                          </div>
                          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                            {formatBytes(vid.size)}
                          </span>
                        </div>

                        <div className="mt-3">
                          <p className="truncate text-sm font-semibold text-slate-100 group-hover:text-indigo-300">
                            {vid.pathname}
                          </p>
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                            <Clock className="h-3 w-3" />
                            {new Date(vid.uploadedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* SQLite Database Section */
          <div className="space-y-6">
            {/* Database & Table Controls Header */}
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="flex flex-wrap items-center gap-4">
                {/* Database Selector */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                    Select Database File
                  </label>
                  <select
                    value={currentDbFile || ''}
                    onChange={(e) => fetchDatabaseData(e.target.value)}
                    className="rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-200 outline-none focus:border-indigo-500"
                  >
                    {databases.map((db) => (
                      <option key={db.pathname} value={db.pathname}>
                        {db.pathname} ({formatBytes(db.size)})
                      </option>
                    ))}
                    {databases.length === 0 && <option value="">No databases synced</option>}
                  </select>
                </div>

                {/* Table Selector */}
                {tables.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Select Table
                    </label>
                    <select
                      value={selectedTable || ''}
                      onChange={(e) => fetchDatabaseData(currentDbFile || undefined, e.target.value, 0)}
                      className="rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-200 outline-none focus:border-indigo-500"
                    >
                      {tables.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {queryResult && (
                <div className="flex items-center gap-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-slate-400">
                    Total Rows: <span className="font-semibold text-white">{queryResult.totalRows}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Table Records Presentation */}
            {loadingDb ? (
              <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/30">
                <RefreshCw className="h-6 w-6 animate-spin text-indigo-400" />
              </div>
            ) : !queryResult || !queryResult.columns.length ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 p-12 text-center">
                <FileCode className="mb-4 h-12 w-12 text-slate-600" />
                <h4 className="text-base font-semibold text-slate-300">No SQLite tables to display</h4>
                <p className="mt-1 text-sm text-slate-500 max-w-md">
                  Place <code className="text-indigo-400">.sqlite</code> or <code className="text-indigo-400">.db</code> files in Optiplex <code className="text-indigo-400">./data</code>. They will be parsed with WebAssembly and displayed here.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl overflow-hidden">
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-950 text-slate-300 shadow-sm">
                      <tr>
                        <th className="border-b border-slate-800 px-4 py-3 font-semibold text-slate-500 w-12">
                          #
                        </th>
                        {queryResult.columns.map((col) => (
                          <th
                            key={col}
                            className="border-b border-slate-800 px-4 py-3 font-semibold tracking-wider text-slate-300 whitespace-nowrap"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 text-slate-300">
                      {queryResult.values.length === 0 ? (
                        <tr>
                          <td
                            colSpan={queryResult.columns.length + 1}
                            className="px-4 py-8 text-center text-slate-500 italic"
                          >
                            Table contains no records
                          </td>
                        </tr>
                      ) : (
                        queryResult.values.map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            className="hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="px-4 py-3 text-slate-600 font-mono">
                              {pageOffset + rIdx + 1}
                            </td>
                            {row.map((cell, cIdx) => (
                              <td
                                key={cIdx}
                                className="px-4 py-3 whitespace-nowrap font-mono max-w-xs truncate"
                                title={cell !== null ? String(cell) : 'NULL'}
                              >
                                {cell === null ? (
                                  <span className="text-slate-600 italic">null</span>
                                ) : (
                                  String(cell)
                                )}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/80 px-4 py-3 text-xs sm:px-6">
                  <span className="text-slate-400">
                    Showing <span className="font-semibold text-slate-200">{queryResult.values.length > 0 ? pageOffset + 1 : 0}</span> to{' '}
                    <span className="font-semibold text-slate-200">{Math.min(pageOffset + pageSize, queryResult.totalRows)}</span> of{' '}
                    <span className="font-semibold text-slate-200">{queryResult.totalRows}</span> rows
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        fetchDatabaseData(
                          currentDbFile || undefined,
                          selectedTable || undefined,
                          Math.max(0, pageOffset - pageSize)
                        )
                      }
                      disabled={pageOffset === 0 || loadingDb}
                      className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      <span>Previous</span>
                    </button>

                    <button
                      onClick={() =>
                        fetchDatabaseData(
                          currentDbFile || undefined,
                          selectedTable || undefined,
                          pageOffset + pageSize
                        )
                      }
                      disabled={pageOffset + pageSize >= queryResult.totalRows || loadingDb}
                      className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-40"
                    >
                      <span>Next</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
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
