'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Download,
  FileCode,
  FolderArchive,
  HardDrive,
  KeyRound,
  Loader2,
  Lock,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  WEEKDAY_LETTERS,
  addDays,
  buildMonthGrid,
  enumerateDates,
  formatLongDay,
  monthKey,
  monthLabelFromKey,
  shiftMonthKey,
  todayIso,
} from '@/lib/date-range';
import { DEFAULT_SAMPLE_INTERVALS } from '@/lib/default-telemetry';

type ArchiveScope = '1d' | '7d' | '30d' | 'all';

interface ArchiveFileEntry {
  archiveId: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  scope: ArchiveScope;
  scopeLabel: string;
  referenceDate: string;
  startDate: string;
  endDate: string;
  dates: string[];
  createdAt: string;
  createdBy: string;
  metricsRowCount: number;
  birdTrackRowCount: number;
  sensorSessionCount: number;
  behaviorIntervalCount: number;
  status: 'archived' | 'restored';
  restoredAt?: string | null;
  restoredBy?: string | null;
}

interface AttachedSqlPreview {
  file: File;
  fileName: string;
  sizeBytes: number;
  sqlContent: string;
  detectedDates: string[];
  scopeLabel: string;
  dateRangeLabel: string;
  statementCount: number;
  isValidDateStamped: boolean;
  validationMessage: string;
}

interface TrackingObservationRow {
  video: string;
  jobId?: number;
  chunkIndex?: number;
  shortId: 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'R1';
  profileLabel: string;
  detectionId: string;
  dotColor: string;
  windowStart: string;
  windowEnd: string;
  windowDurationS: number;
  validObservationDurationS: number;
  occludedDurationS: number;
  lostDurationS: number;
  validObservationPct: number;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function inspectAttachedSql(file: File, sqlContent: string): AttachedSqlPreview {
  const fileName = file.name;
  const fileDates = fileName.match(/\b(20\d{2}-\d{2}-\d{2})\b/g) || [];
  const metaMatch = sqlContent.match(/^--CHICKENSEE_ARCHIVE_META:(.+)$/m);
  let metaDates: string[] = [];
  let scopeLabel = 'Custom SQL Archive';

  if (metaMatch) {
    try {
      const parsed = JSON.parse(metaMatch[1].trim());
      if (Array.isArray(parsed.dates)) {
        metaDates = parsed.dates.map(String);
      }
      if (parsed.scopeLabel) {
        scopeLabel = String(parsed.scopeLabel);
      }
    } catch {
      // ignore
    }
  } else if (/1day/i.test(fileName)) {
    scopeLabel = 'Entire Day (1 Day)';
  } else if (/7days/i.test(fileName)) {
    scopeLabel = 'Entire 7 Days';
  } else if (/30days/i.test(fileName)) {
    scopeLabel = 'Entire 30 Days';
  }

  const contentDates = sqlContent.match(/\b(20\d{2}-\d{2}-\d{2})\b/g) || [];
  const allDates = Array.from(new Set([...metaDates, ...fileDates, ...contentDates])).sort();
  const hasDateInNameOrHeader = fileDates.length > 0 || metaDates.length > 0;
  const statementCount = (sqlContent.match(/INSERT\s+(OR\s+REPLACE\s+)?INTO\b/gi) || []).length;

  const dateRangeLabel =
    allDates.length === 0
      ? 'No date detected'
      : allDates.length === 1
        ? allDates[0]
        : `${allDates[0]} → ${allDates[allDates.length - 1]} (${allDates.length} days)`;

  const isValidDateStamped = hasDateInNameOrHeader && allDates.length > 0;
  const validationMessage = isValidDateStamped
    ? `Clean date stamp verified (${dateRangeLabel}). Ready to restore.`
    : 'File is missing a YYYY-MM-DD date stamp in its filename or archive header.';

  return {
    file,
    fileName,
    sizeBytes: file.size,
    sqlContent,
    detectedDates: allDates,
    scopeLabel,
    dateRangeLabel,
    statementCount,
    isValidDateStamped,
    validationMessage,
  };
}

export default function AdminSettingsTab({
  currentUsername,
  onDataChanged,
}: {
  currentUsername?: string;
  onDataChanged?: () => void;
}) {
  const [archiveFolder, setArchiveFolder] = useState<string>('Archive');
  const [archivedDates, setArchivedDates] = useState<string[]>([]);
  const [activeDates, setActiveDates] = useState<string[]>(() =>
    DEFAULT_SAMPLE_INTERVALS.map((i) => i.date).slice().reverse(),
  );
  const [archiveFiles, setArchiveFiles] = useState<ArchiveFileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [referenceDate, setReferenceDate] = useState<string>('2026-11-09');
  const [calendarOpen, setCalendarOpen] = useState<boolean>(false);
  const [calendarMonth, setCalendarMonth] = useState<string>(() => '2026-11');
  const calendarPopoverRef = useRef<HTMLDivElement | null>(null);
  const [autoDownloadSql, setAutoDownloadSql] = useState<boolean>(true);
  const [archivingScope, setArchivingScope] = useState<ArchiveScope | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Admin Password Security Confirmation Modal state
  const [pendingConfirmScope, setPendingConfirmScope] = useState<ArchiveScope | null>(null);
  const [confirmAdminPassword, setConfirmAdminPassword] = useState<string>('');
  const [confirmModalError, setConfirmModalError] = useState<string | null>(null);

  // Attachable SQL file state for restore
  const [attachedPreview, setAttachedPreview] = useState<AttachedSqlPreview | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [restoringFile, setRestoringFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Bird Tracking Continuity & Observation Validity Log state (loaded dynamically from /api/admin/tracking-validity)
  const [obsRows, setObsRows] = useState<TrackingObservationRow[]>([]);
  const [obsLoading, setObsLoading] = useState<boolean>(true);
  const [selectedObsVideo, setSelectedObsVideo] = useState<string>('all');
  const [obsIdFormat, setObsIdFormat] = useState<'short' | 'profile' | 'detection'>('short');

  const fetchTrackingValidity = useCallback(async () => {
    try {
      setObsLoading(true);
      const res = await fetch('/api/admin/tracking-validity', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && Array.isArray(data.rows)) {
        setObsRows(data.rows);
        if (data.rows.length > 0 && selectedObsVideo === 'all') {
          setSelectedObsVideo(data.rows[0].video);
        }
      }
    } catch (err) {
      console.error('Failed to load tracking validity metrics:', err);
    } finally {
      setObsLoading(false);
    }
  }, [selectedObsVideo]);

  useEffect(() => {
    fetchTrackingValidity();
  }, [fetchTrackingValidity]);

  const obsVideoOptions = useMemo(
    () => Array.from(new Set(obsRows.map((r) => r.video))),
    [obsRows],
  );

  const filteredObsRows = useMemo(
    () =>
      selectedObsVideo === 'all'
        ? obsRows
        : obsRows.filter((r) => r.video === selectedObsVideo),
    [obsRows, selectedObsVideo],
  );

  const formatChickenId = useCallback(
    (row: TrackingObservationRow) => {
      if (obsIdFormat === 'short') return row.shortId;
      if (obsIdFormat === 'profile') return row.profileLabel;
      return row.detectionId;
    },
    [obsIdFormat],
  );

  const handleExportObservationCsv = useCallback(() => {
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
    const rows = filteredObsRows.map((r) =>
      [
        r.video,
        `"${formatChickenId(r)}"`,
        r.windowStart,
        r.windowEnd,
        r.windowDurationS,
        r.validObservationDurationS,
        r.occludedDurationS,
        r.lostDurationS,
        r.validObservationPct.toFixed(1),
      ].join(','),
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chickensee_observation_validity_${selectedObsVideo === 'all' ? 'all_sessions' : selectedObsVideo}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [filteredObsRows, formatChickenId, selectedObsVideo]);

  const fetchArchiveState = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/admin/archive', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setArchiveFolder(data.archiveFolder || 'Archive');
      setArchivedDates(Array.isArray(data.archivedDates) ? data.archivedDates : []);
      const actDates: string[] = Array.isArray(data.activeDates) ? data.activeDates : [];
      setActiveDates(actDates);
      setArchiveFiles(Array.isArray(data.files) ? data.files : []);
      if (actDates.length > 0 && !actDates.includes(referenceDate)) {
        setReferenceDate(actDates[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load archive settings.');
    } finally {
      setLoading(false);
    }
  }, [referenceDate]);

  useEffect(() => {
    fetchArchiveState();
  }, [fetchArchiveState]);

  useEffect(() => {
    if (referenceDate && referenceDate.length >= 7) {
      setCalendarMonth(referenceDate.slice(0, 7));
    }
  }, [referenceDate]);

  useEffect(() => {
    if (!calendarOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (!calendarPopoverRef.current?.contains(e.target as Node)) {
        setCalendarOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [calendarOpen]);

  const activeDatesSet = useMemo(() => new Set(activeDates), [activeDates]);
  const archivedDatesSet = useMemo(() => new Set(archivedDates), [archivedDates]);

  const referenceDateStatus = useMemo(() => {
    if (activeDatesSet.has(referenceDate)) {
      return {
        state: 'available' as const,
        label: 'Data Available',
        detail: `${referenceDate} has active telemetry & behavior records ready to archive.`,
        badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        dotClass: 'bg-emerald-500',
      };
    }
    if (archivedDatesSet.has(referenceDate)) {
      return {
        state: 'archived' as const,
        label: 'Already Archived to SQL',
        detail: `${referenceDate} is already archived in Archive/ and can be restored below.`,
        badgeClass: 'border-amber-200 bg-amber-50 text-amber-800',
        dotClass: 'bg-amber-500',
      };
    }
    return {
      state: 'empty' as const,
      label: 'No Data on This Day',
      detail: `No telemetry or behavior data was recorded on ${referenceDate}.`,
      badgeClass: 'border-rose-200 bg-rose-50 text-rose-700',
      dotClass: 'bg-rose-500',
    };
  }, [referenceDate, activeDatesSet, archivedDatesSet]);

  const calendarGrid = useMemo(
    () =>
      buildMonthGrid(calendarMonth, {
        hasRecords: (d) => activeDatesSet.has(d) || archivedDatesSet.has(d),
        today: todayIso(),
        minSelectable: null,
        maxSelectable: null,
      }),
    [calendarMonth, activeDatesSet, archivedDatesSet],
  );

  const scopePreviews = useMemo(() => {
    const ref = referenceDate || '2026-11-17';
    const start7 = addDays(ref, -6);
    const start30 = addDays(ref, -29);
    const dates1 = [ref];
    const dates7 = enumerateDates(start7, ref);
    const dates30 = enumerateDates(start30, ref);

    const activeIn1 = dates1.filter((d) => activeDatesSet.has(d));
    const activeIn7 = dates7.filter((d) => activeDatesSet.has(d));
    const activeIn30 = dates30.filter((d) => activeDatesSet.has(d));

    const sortedAllActive = [...activeDates].sort();
    const earliestAll = sortedAllActive[0] || start30;
    const latestAll = sortedAllActive[sortedAllActive.length - 1] || ref;

    return {
      '1d': {
        scope: '1d' as ArchiveScope,
        title: 'Delete Entire Day (1 Day)',
        badge: '1 Day Archive',
        rangeText: ref,
        fileName: `chickensee_archive_1day_${ref}.sql`,
        totalDays: 1,
        availableDaysCount: activeIn1.length,
        availableDatesList: activeIn1,
        description:
          'Moves the selected full day out of active portal charts and logs into a date-stamped SQL backup file inside Archive/.',
      },
      '7d': {
        scope: '7d' as ArchiveScope,
        title: 'Delete Entire 7 Days',
        badge: '7 Days Archive',
        rangeText: `${start7} → ${ref}`,
        fileName: `chickensee_archive_7days_${start7}_to_${ref}.sql`,
        totalDays: 7,
        availableDaysCount: activeIn7.length,
        availableDatesList: activeIn7,
        description:
          'Archives a full 7-day window ending on the reference date into a single clean SQL file inside Archive/.',
      },
      '30d': {
        scope: '30d' as ArchiveScope,
        title: 'Delete Entire 30 Days',
        badge: '30 Days Archive',
        rangeText: `${start30} → ${ref}`,
        fileName: `chickensee_archive_30days_${start30}_to_${ref}.sql`,
        totalDays: 30,
        availableDaysCount: activeIn30.length,
        availableDatesList: activeIn30,
        description:
          'Archives a full 30-day window ending on the reference date into a date-stamped SQL file inside Archive/.',
      },
      'all': {
        scope: 'all' as ArchiveScope,
        title: 'Secured Wipe All Data (Full Archive)',
        badge: 'Full System Wipe + SQL',
        rangeText: sortedAllActive.length > 0 ? `${earliestAll} → ${latestAll}` : 'All Dates',
        fileName: `chickensee_archive_all_data_${earliestAll}_to_${latestAll}.sql`,
        totalDays: Math.max(1, sortedAllActive.length),
        availableDaysCount: sortedAllActive.length,
        availableDatesList: sortedAllActive,
        description:
          'Requires Admin Password confirmation. Wipes all active dates from the portal and exports a complete, restorable full-system SQL snapshot into Archive/.',
      },
    };
  }, [referenceDate, activeDatesSet, activeDates]);

  function openArchivePasswordModal(scope: ArchiveScope) {
    setConfirmAdminPassword('');
    setConfirmModalError(null);
    setPendingConfirmScope(scope);
  }

  async function handleConfirmArchiveWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingConfirmScope) return;
    if (!confirmAdminPassword.trim()) {
      setConfirmModalError('Please enter your administrator password to confirm.');
      return;
    }

    const scope = pendingConfirmScope;
    const preview = scopePreviews[scope];

    try {
      setArchivingScope(scope);
      setConfirmModalError(null);
      setActionError(null);
      setActionNotice(null);

      const res = await fetch('/api/admin/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          referenceDate,
          adminPassword: confirmAdminPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || `HTTP ${res.status}`;
        setConfirmModalError(msg);
        return;
      }

      const createdFile: ArchiveFileEntry | undefined = data.archive;
      setPendingConfirmScope(null);
      setConfirmAdminPassword('');
      setActionNotice(
        scope === 'all'
          ? `Full system data wiped and safely backed up into Archive/${createdFile?.fileName || preview.fileName}. You can restore all data anytime below.`
          : `Archived ${preview.rangeText} into Archive/${createdFile?.fileName || preview.fileName}. Data can be restored anytime.`,
      );

      if (autoDownloadSql && createdFile?.fileName) {
        if (typeof data.sqlContent === 'string' && data.sqlContent.length > 0) {
          const blob = new Blob([data.sqlContent], { type: 'application/sql;charset=utf-8' });
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = createdFile.fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
        } else {
          const dlUrl = `/api/admin/archive/download?file=${encodeURIComponent(createdFile.fileName)}`;
          const link = document.createElement('a');
          link.href = dlUrl;
          link.download = createdFile.fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }

      await fetchArchiveState();
      onDataChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not archive data.');
    } finally {
      setArchivingScope(null);
    }
  }

  async function handleSelectSqlFile(file: File | null) {
    setActionError(null);
    setActionNotice(null);
    if (!file) {
      setAttachedPreview(null);
      return;
    }
    try {
      const text = await file.text();
      const preview = inspectAttachedSql(file, text);
      setAttachedPreview(preview);
    } catch {
      setActionError('Could not read the attached SQL file.');
    }
  }

  async function handleRestoreAttachedSql() {
    if (!attachedPreview) return;
    if (!attachedPreview.isValidDateStamped) {
      setActionError(attachedPreview.validationMessage);
      return;
    }

    try {
      setRestoringFile(attachedPreview.fileName);
      setActionError(null);
      setActionNotice(null);

      const formData = new FormData();
      formData.append('file', attachedPreview.file);

      const res = await fetch('/api/admin/archive/restore', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const restoredCount = Array.isArray(data.restoredDates) ? data.restoredDates.length : 0;
      setActionNotice(
        `Successfully restored ${restoredCount} day${restoredCount === 1 ? '' : 's'} (${attachedPreview.dateRangeLabel}) from "${attachedPreview.fileName}".`,
      );
      setAttachedPreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await fetchArchiveState();
      onDataChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to restore from attached SQL file.');
    } finally {
      setRestoringFile(null);
    }
  }

  async function handleRestoreFromArchiveFolder(entry: ArchiveFileEntry) {
    try {
      setRestoringFile(entry.fileName);
      setActionError(null);
      setActionNotice(null);

      const res = await fetch('/api/admin/archive/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: entry.fileName }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setActionNotice(
        `Restored ${entry.dates.length} day${entry.dates.length === 1 ? '' : 's'} (${entry.startDate}${entry.endDate !== entry.startDate ? ` → ${entry.endDate}` : ''}) from Archive/${entry.fileName}.`,
      );
      await fetchArchiveState();
      onDataChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to restore archive file.');
    } finally {
      setRestoringFile(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-orange-600">
              <ShieldCheck className="h-4 w-4" />
              Administrator Only · Settings
            </div>
            <h2 className="mt-1 text-lg font-bold text-slate-900">
              Data Retention, SQL Archive &amp; Restore Settings
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Delete data for an entire day, 7 days, or 30 days without permanent data loss. Every deletion generates a clean, date-stamped <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-700">.sql</code> backup file in the separated <code className="rounded bg-orange-50 px-1.5 py-0.5 text-xs font-mono font-semibold text-orange-700">Archive/</code> folder for instant restoration.
            </p>
          </div>
          <button
            type="button"
            onClick={fetchArchiveState}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Status Bar */}
        <div className="grid grid-cols-1 gap-3 bg-slate-50/70 px-4 py-3 sm:grid-cols-3 sm:px-6">
          <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5">
            <FolderArchive className="h-4 w-4 shrink-0 text-orange-600" />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Separated Archive Folder
              </div>
              <div className="truncate font-mono text-xs font-semibold text-slate-800" title={archiveFolder}>
                Archive/ ({archiveFiles.length} SQL file{archiveFiles.length === 1 ? '' : 's'})
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5">
            <Database className="h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Active Portal Dates
              </div>
              <div className="text-xs font-semibold text-slate-800">
                {activeDates.length} active day{activeDates.length === 1 ? '' : 's'} visible
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5">
            <Archive className="h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Currently Archived Dates
              </div>
              <div className="text-xs font-semibold text-slate-800">
                {archivedDates.length} day{archivedDates.length === 1 ? '' : 's'} archived to SQL
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Feedback Alerts */}
      {(error || actionError) && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{actionError || error}</span>
        </div>
      )}

      {actionNotice && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* SECTION 1: Delete & Archive Data (1 Day, 7 Days, 30 Days) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              1. Delete &amp; Archive Data to SQL (1 Day · 7 Days · 30 Days)
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Select a reference date below. Deleting a range removes it from active portal views and writes a date-stamped <code className="font-mono">.sql</code> file into <code className="font-mono">Archive/</code>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Live Data Availability Status Pill for Selected Reference Date */}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${referenceDateStatus.badgeClass}`}
              title={referenceDateStatus.detail}
            >
              <span className={`h-2 w-2 rounded-full ${referenceDateStatus.dotClass}`} />
              <span>{referenceDateStatus.label}</span>
            </span>

            {/* Availability-Aware Reference Date Picker Popover */}
            <div ref={calendarPopoverRef} className="relative">
              <button
                type="button"
                onClick={() => setCalendarOpen((prev) => !prev)}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs transition hover:border-orange-400 hover:bg-white"
              >
                <Calendar className="h-4 w-4 text-orange-600" />
                <span>Reference Date:</span>
                <span className="font-mono font-bold text-slate-900">{referenceDate}</span>
                <span
                  className={`h-2 w-2 rounded-full ${referenceDateStatus.dotClass}`}
                  title={referenceDateStatus.label}
                />
              </button>

              {calendarOpen && (
                <div
                  role="dialog"
                  aria-label="Reference Date Availability Calendar"
                  className=" right-0 top-full z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xl sm:absolute"
                >
                  {/* Month Navigation */}
                  <div className="flex items-center justify-between pb-2.5">
                    <button
                      type="button"
                      onClick={() => setCalendarMonth((m) => shiftMonthKey(m, -1))}
                      className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100"
                      aria-label="Previous month"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-xs font-bold text-slate-800">
                      {monthLabelFromKey(calendarMonth)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCalendarMonth((m) => shiftMonthKey(m, 1))}
                      className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100"
                      aria-label="Next month"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Weekday Headers */}
                  <div className="grid grid-cols-7 gap-1 pb-1">
                    {WEEKDAY_LETTERS.map((letter) => (
                      <span
                        key={letter}
                        className="py-1 text-center text-[10px] font-bold text-slate-400"
                      >
                        {letter}
                      </span>
                    ))}
                  </div>

                  {/* Days Grid with Data Availability Indicators */}
                  <div className="grid grid-cols-7 gap-1">
                    {calendarGrid.days.map((day) => {
                      const isSelected = day.date === referenceDate;
                      const hasActive = activeDatesSet.has(day.date);
                      const isArch = archivedDatesSet.has(day.date);

                      let cellClass = 'text-slate-400 hover:bg-slate-100';
                      if (!day.inMonth) {
                        cellClass = 'text-slate-300 opacity-50 hover:bg-slate-50';
                      } else if (isSelected) {
                        cellClass = 'bg-orange-600 text-white font-bold shadow-xs';
                      } else if (hasActive) {
                        cellClass =
                          'bg-emerald-50/90 text-emerald-900 font-bold border border-emerald-200/80 hover:bg-emerald-100';
                      } else if (isArch) {
                        cellClass =
                          'bg-amber-50/90 text-amber-900 font-semibold border border-amber-200/80 hover:bg-amber-100';
                      }

                      const tooltip = hasActive
                        ? `${formatLongDay(day.date)} — Data Available`
                        : isArch
                          ? `${formatLongDay(day.date)} — Archived in SQL`
                          : `${formatLongDay(day.date)} — No Data Recorded`;

                      return (
                        <button
                          key={day.date}
                          type="button"
                          onClick={() => {
                            setReferenceDate(day.date);
                            setCalendarOpen(false);
                          }}
                          title={tooltip}
                          className={`relative flex h-8 flex-col items-center justify-center rounded-lg text-[11px] transition ${cellClass}`}
                        >
                          <span>{day.dayOfMonth}</span>
                          {hasActive && (
                            <span
                              className={`absolute bottom-0.5 h-1.5 w-1.5 rounded-full ${
                                isSelected ? 'bg-white' : 'bg-emerald-500'
                              }`}
                            />
                          )}
                          {!hasActive && isArch && (
                            <span
                              className={`absolute bottom-0.5 h-1.5 w-1.5 rounded-full ${
                                isSelected ? 'bg-white' : 'bg-amber-500'
                              }`}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Availability Legend */}
                  <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5 text-[10px] text-slate-600">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        Has Data ({activeDates.length})
                      </span>
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        Archived ({archivedDates.length})
                      </span>
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <span className="h-2 w-2 rounded-full bg-slate-300" />
                        No Data
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      {activeDates.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setReferenceDate(activeDates[0]);
                            setCalendarOpen(false);
                          }}
                          className="font-semibold text-orange-600 hover:underline"
                        >
                          Jump to latest data ({activeDates[0]})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setCalendarOpen(false)}
                        className="ml-auto rounded px-2 py-0.5 font-semibold text-slate-500 hover:bg-slate-100"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Selected Reference Date Availability Banner */}
        <div
          className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2 text-xs ${referenceDateStatus.badgeClass}`}
        >
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${referenceDateStatus.dotClass}`} />
            <span className="font-bold">{referenceDate}:</span>
            <span>{referenceDateStatus.detail}</span>
          </div>
          {referenceDateStatus.state !== 'available' && activeDates.length > 0 && (
            <button
              type="button"
              onClick={() => setReferenceDate(activeDates[0])}
              className="rounded-lg bg-white/80 px-2.5 py-1 text-[11px] font-bold text-orange-700 shadow-2xs transition hover:bg-white"
            >
              Switch to {activeDates[0]} (Has Data)
            </button>
          )}
        </div>

        {/* Active Date Quick Chips with Data Availability Dots */}
        {activeDates.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-400 mr-1">
              Dates with available data ({activeDates.length}):
            </span>
            {activeDates.slice(0, 14).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setReferenceDate(d)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium transition ${
                  referenceDate === d
                    ? 'border-orange-500 bg-orange-50 text-orange-700 font-bold'
                    : 'border-emerald-200 bg-emerald-50/50 text-emerald-800 hover:border-emerald-400 hover:bg-white'
                }`}
                title={`${d} — Data Available`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {d}
              </button>
            ))}
          </div>
        )}

        {/* Option to also download the generated .sql file */}
        <div className="mt-3 flex items-center gap-2">
          <input
            id="auto-download-sql"
            type="checkbox"
            checked={autoDownloadSql}
            onChange={(e) => setAutoDownloadSql(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-orange-600 focus:ring-orange-500"
          />
          <label htmlFor="auto-download-sql" className="text-xs text-slate-600">
            Also download a copy of the generated <code className="font-mono">.sql</code> file to my computer after archiving
          </label>
        </div>

        {/* 4 Deletion & Secured Wipe Scope Cards (1 Day, 7 Days, 30 Days, Wipe All Data) */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(['1d', '7d', '30d', 'all'] as const).map((scopeKey) => {
            const card = scopePreviews[scopeKey];
            const isBusy = archivingScope === scopeKey;
            const isWipeAll = scopeKey === 'all';

            return (
              <div
                key={scopeKey}
                className={`flex flex-col justify-between rounded-xl border p-4 transition hover:bg-white hover:shadow-xs ${
                  isWipeAll
                    ? 'border-red-200 bg-red-50/30 hover:border-red-300'
                    : 'border-slate-200 bg-slate-50/50 hover:border-orange-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        isWipeAll
                          ? 'bg-red-100 text-red-800'
                          : 'bg-orange-100 text-orange-800'
                      }`}
                    >
                      {isWipeAll ? <Lock className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                      {card.badge}
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-slate-600">
                      {card.rangeText}
                    </span>
                  </div>

                  <h4 className="mt-3 text-sm font-bold text-slate-900">{card.title}</h4>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {card.description}
                  </p>

                  {/* Data Availability Status for this Scope */}
                  <div
                    className={`mt-3 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                      card.availableDaysCount > 0
                        ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800'
                        : 'border-rose-200 bg-rose-50/70 text-rose-700'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          card.availableDaysCount > 0 ? 'bg-emerald-500' : 'bg-rose-500'
                        }`}
                      />
                      <span>
                        {card.availableDaysCount > 0
                          ? isWipeAll
                            ? `All ${card.availableDaysCount} active day${card.availableDaysCount === 1 ? '' : 's'} ready`
                            : `${card.availableDaysCount} of ${card.totalDays} day${card.totalDays === 1 ? '' : 's'} has data`
                          : 'No data available in this range'}
                      </span>
                    </span>
                    <span className="font-mono text-[10px]">
                      {card.availableDaysCount > 0 ? 'Ready' : 'Empty'}
                    </span>
                  </div>

                  <div className="mt-2.5 rounded-lg border border-slate-200/80 bg-white p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Generated SQL File in Archive/
                    </div>
                    <div className="mt-0.5 break-all font-mono text-[11px] font-semibold text-slate-800">
                      Archive/{card.fileName}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openArchivePasswordModal(scopeKey)}
                  disabled={archivingScope !== null || card.availableDaysCount === 0}
                  className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold shadow-xs transition disabled:cursor-not-allowed ${
                    card.availableDaysCount === 0
                      ? 'border border-slate-200 bg-slate-100 text-slate-600'
                      : isWipeAll
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'bg-orange-600 text-white hover:bg-orange-700'
                  }`}
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Generating SQL &amp; Archiving…</span>
                    </>
                  ) : card.availableDaysCount === 0 ? (
                    <span>No Data Available in Range</span>
                  ) : (
                    <>
                      {isWipeAll ? <KeyRound className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                      <span>
                        {scopeKey === '1d'
                          ? 'Delete & Archive Entire Day'
                          : scopeKey === '7d'
                            ? `Delete & Archive 7 Days (${card.availableDaysCount}d)`
                            : scopeKey === '30d'
                              ? `Delete & Archive 30 Days (${card.availableDaysCount}d)`
                              : `Secured Wipe All Data (${card.availableDaysCount}d)`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Admin Password Security Confirmation Modal */}
      {pendingConfirmScope && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          onClick={() => {
            if (!archivingScope) setPendingConfirmScope(null);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-confirm-modal-title"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    pendingConfirmScope === 'all'
                      ? 'bg-red-100 text-red-600'
                      : 'bg-orange-100 text-orange-600'
                  }`}
                >
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h3 id="archive-confirm-modal-title" className="text-base font-bold text-slate-900">
                    {pendingConfirmScope === 'all'
                      ? 'Confirm Secured Wipe All Data'
                      : `Confirm ${scopePreviews[pendingConfirmScope].title}`}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Administrator password verification required
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingConfirmScope(null)}
                disabled={archivingScope !== null}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1.5">
              <div>
                <span className="font-semibold text-slate-800">Target Range:</span>{' '}
                <span className="font-mono font-bold text-slate-900">
                  {scopePreviews[pendingConfirmScope].rangeText}
                </span>{' '}
                ({scopePreviews[pendingConfirmScope].availableDaysCount} active day
                {scopePreviews[pendingConfirmScope].availableDaysCount === 1 ? '' : 's'})
              </div>
              <div>
                <span className="font-semibold text-slate-800">SQL Restore Backup:</span>{' '}
                <span className="break-all font-mono text-[11px] font-semibold text-orange-700">
                  Archive/{scopePreviews[pendingConfirmScope].fileName}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 pt-1">
                This action will not permanently destroy your records — a dated <code className="font-mono">.sql</code> restore file will be saved in <code className="font-mono">Archive/</code> so you can restore it anytime.
              </p>
            </div>

            <form onSubmit={handleConfirmArchiveWithPassword} className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="confirm-admin-password"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-500"
                >
                  Enter Admin Password to Confirm
                </label>
                <input
                  id="confirm-admin-password"
                  type="password"
                  value={confirmAdminPassword}
                  onChange={(e) => setConfirmAdminPassword(e.target.value)}
                  placeholder="Enter your administrator password…"
                  autoFocus
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-orange-500 focus:bg-white focus:ring-2 focus:ring-orange-100"
                />
              </div>

              {confirmModalError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{confirmModalError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingConfirmScope(null)}
                  disabled={archivingScope !== null}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={archivingScope !== null}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-xs transition disabled:opacity-50 ${
                    pendingConfirmScope === 'all'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-orange-600 hover:bg-orange-700'
                  }`}
                >
                  {archivingScope !== null ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Verifying &amp; Archiving…</span>
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5" />
                      <span>
                        {pendingConfirmScope === 'all'
                          ? 'Confirm & Wipe All Data (with SQL Backup)'
                          : 'Confirm & Archive to SQL'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SECTION 2: Attach Dated SQL File to Restore Data */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="border-b border-slate-100 pb-4">
          <h3 className="text-base font-bold text-slate-900">
            2. Attach SQL Archive File to Restore Data
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Attach any date-stamped <code className="font-mono">.sql</code> archive file (for example <code className="font-mono">chickensee_archive_1day_2026-11-17.sql</code> or <code className="font-mono">chickensee_archive_7days_2026-11-11_to_2026-11-17.sql</code>) to restore its data cleanly back into the portal.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Dropzone / File Attachment */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingFile(true);
            }}
            onDragLeave={() => setIsDraggingFile(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingFile(false);
              const file = e.dataTransfer.files?.[0] || null;
              handleSelectSqlFile(file);
            }}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
              isDraggingFile
                ? 'border-orange-500 bg-orange-50/50'
                : 'border-slate-200 bg-slate-50/60 hover:border-orange-300 hover:bg-slate-50'
            }`}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-orange-100 text-orange-600">
              <Paperclip className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-bold text-slate-800">
              Attach a Date-Stamped <code className="font-mono">.sql</code> Backup File
            </p>
            <p className="mt-1 max-w-md text-xs text-slate-500">
              Drag and drop your <code className="font-mono">.sql</code> file from the <code className="font-mono">Archive/</code> folder here, or click below to browse.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".sql,application/sql,text/plain"
              onChange={(e) => handleSelectSqlFile(e.target.files?.[0] || null)}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-orange-300 hover:text-orange-700"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Choose .sql Archive File</span>
            </button>
          </div>

          {/* Attached File Verification & Restore Panel */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            {!attachedPreview ? (
              <div className="flex h-full flex-col items-center justify-center py-8 text-center">
                <FileCode className="h-8 w-8 text-slate-300" />
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  No SQL archive file attached yet
                </p>
                <p className="mt-1 max-w-xs text-[11px] text-slate-400">
                  Once attached, the system verifies the file&apos;s date identifier (<code className="font-mono">YYYY-MM-DD</code>) and scope before restoring.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-orange-600">
                      Attached SQL File
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs font-bold text-slate-900" title={attachedPreview.fileName}>
                      {attachedPreview.fileName}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-md bg-slate-200/70 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                    {formatBytes(attachedPreview.sizeBytes)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                  <div>
                    <span className="block text-[10px] font-semibold uppercase text-slate-400">
                      Detected Date(s)
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-800">
                      {attachedPreview.dateRangeLabel}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-semibold uppercase text-slate-400">
                      Scope &amp; Statements
                    </span>
                    <span className="text-xs font-semibold text-slate-800">
                      {attachedPreview.scopeLabel} ({attachedPreview.statementCount} SQL rows)
                    </span>
                  </div>
                </div>

                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                    attachedPreview.isValidDateStamped
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                >
                  {attachedPreview.isValidDateStamped ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                  )}
                  <span>{attachedPreview.validationMessage}</span>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAttachedPreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={handleRestoreAttachedSql}
                    disabled={!attachedPreview.isValidDateStamped || restoringFile !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {restoringFile === attachedPreview.fileName ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Restoring Data…</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Restore Attached SQL Data</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 3: Separated "Archive" Folder SQL Files Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-4 sm:px-6">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              3. <code className="font-mono text-orange-600">Archive/</code> Folder SQL Backup Repository
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              All SQL backups generated when deleting 1 day, 7 days, or 30 days of data are organized cleanly by date in the <code className="font-mono">Archive/</code> folder.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
            {archiveFiles.length} dated SQL file{archiveFiles.length === 1 ? '' : 's'}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-orange-600" />
            <span>Loading Archive/ folder…</span>
          </div>
        ) : archiveFiles.length === 0 ? (
          <div className="py-10 text-center">
            <FolderArchive className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-600">
              The <code className="font-mono">Archive/</code> folder has no SQL backup files yet.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              When you archive 1 day, 7 days, or 30 days above, the date-stamped <code className="font-mono">.sql</code> file will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-5">Archive SQL File (Dated)</th>
                  <th className="py-3 px-4">Scope</th>
                  <th className="py-3 px-4">Distinguished Date Range</th>
                  <th className="py-3 px-4">Created</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {archiveFiles.map((entry) => {
                  const isRestoringThis = restoringFile === entry.fileName;
                  const dateBadge =
                    entry.startDate === entry.endDate
                      ? entry.startDate
                      : `${entry.startDate} → ${entry.endDate}`;

                  return (
                    <tr key={entry.fileName} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-2">
                          <FileCode className="h-4 w-4 shrink-0 text-orange-600" />
                          <div>
                            <div className="font-mono text-xs font-bold text-slate-900">
                              Archive/{entry.fileName}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {formatBytes(entry.sizeBytes)} · {entry.dates.length} day{entry.dates.length === 1 ? '' : 's'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex rounded-full bg-orange-50 px-2.5 py-0.5 text-[11px] font-semibold text-orange-700 border border-orange-200/70">
                          {entry.scopeLabel}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-800">
                          <Calendar className="h-3 w-3 text-slate-500" />
                          {dateBadge}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-500">
                        <div>{new Date(entry.createdAt).toLocaleString()}</div>
                        <div className="text-[10px] text-slate-400">by {entry.createdBy}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        {entry.status === 'archived' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            Archived (Hidden)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Restored (Active)
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-5 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <a
                            href={`/api/admin/archive/download?file=${encodeURIComponent(entry.fileName)}`}
                            download={entry.fileName}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            title="Download .sql file"
                          >
                            <Download className="h-3.5 w-3.5 text-slate-400" />
                            <span>Download .sql</span>
                          </a>

                          <button
                            type="button"
                            onClick={() => handleRestoreFromArchiveFolder(entry)}
                            disabled={restoringFile !== null}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                            title="Restore data from this SQL archive"
                          >
                            {isRestoringThis ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            <span>Restore</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SECTION 4: Bird Tracking Continuity & Observation Validity Audit (H1..H5, R1) */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-orange-600">
              <ShieldCheck className="h-3.5 w-3.5" />
              Admin Tracking Validation · YOLO26n + ByteTrack
            </div>
            <h3 className="mt-0.5 text-base font-bold text-slate-900">
              4. Bird Tracking Continuity &amp; Observation Validity Log
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Per-bird tracking continuity, occlusion duration, and lost-track duration across video analysis windows using system chicken IDs (<code className="font-mono font-semibold text-slate-700">H1</code>–<code className="font-mono font-semibold text-slate-700">H5</code>, <code className="font-mono font-semibold text-slate-700">R1</code>).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Session Filter */}
            <select
              value={selectedObsVideo}
              onChange={(e) => setSelectedObsVideo(e.target.value)}
              aria-label="Filter by video session"
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:bg-white"
            >
              {obsVideoOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
              <option value="all">All Recorded Sessions ({obsVideoOptions.length})</option>
            </select>

            {/* Chicken ID Display Format */}
            <select
              value={obsIdFormat}
              onChange={(e) => setObsIdFormat(e.target.value as 'short' | 'profile' | 'detection')}
              aria-label="Chicken ID naming format"
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:bg-white"
            >
              <option value="short">ID Format: H1 … R1</option>
              <option value="profile">ID Format: H1 (Yellow) … R1 (Rooster)</option>
              <option value="detection">ID Format: ID1_H1 Yellow … ID6_R1 Rooster</option>
            </select>

            {/* Refresh Tracking Validity */}
            <button
              type="button"
              onClick={fetchTrackingValidity}
              disabled={obsLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${obsLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>

            {/* Export CSV Button */}
            <button
              type="button"
              onClick={handleExportObservationCsv}
              disabled={filteredObsRows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-orange-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3 sm:grid-cols-4 sm:px-6">
          <div className="rounded-xl border border-slate-200/80 bg-white px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Identified Birds
            </div>
            <div className="mt-0.5 text-sm font-extrabold text-slate-900">
              6 Profiles (<span className="font-mono text-xs text-orange-700">H1–H5, R1</span>)
            </div>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-white px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Mean Valid Observation %
            </div>
            <div className="mt-0.5 text-sm font-extrabold text-emerald-700">
              {(
                filteredObsRows.reduce((acc, r) => acc + r.validObservationPct, 0) /
                Math.max(1, filteredObsRows.length)
              ).toFixed(1)}
              %
            </div>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-white px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Mean Occluded Duration
            </div>
            <div className="mt-0.5 font-mono text-sm font-bold text-slate-800">
              {Math.round(
                filteredObsRows.reduce((acc, r) => acc + r.occludedDurationS, 0) /
                  Math.max(1, filteredObsRows.length),
              )}{' '}
              s
            </div>
          </div>
          <div className="rounded-xl border border-slate-200/80 bg-white px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Mean Lost Duration
            </div>
            <div className="mt-0.5 font-mono text-sm font-bold text-slate-800">
              {Math.round(
                filteredObsRows.reduce((acc, r) => acc + r.lostDurationS, 0) /
                  Math.max(1, filteredObsRows.length),
              )}{' '}
              s
            </div>
          </div>
        </div>

        {/* 9-Column Table matching the spreadsheet specification */}
        <div className="overflow-x-auto">
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
              {obsLoading && filteredObsRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center font-sans text-xs text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-orange-600" />
                      Computing per-bird tracking continuity &amp; observation validity from database…
                    </span>
                  </td>
                </tr>
              ) : filteredObsRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center font-sans text-xs text-slate-400">
                    No completed video tracking windows found yet.
                  </td>
                </tr>
              ) : (
                filteredObsRows.map((row, idx) => (
                <tr
                  key={`${row.video}_${row.shortId}_${idx}`}
                  className={idx % 2 === 0 ? 'bg-white hover:bg-orange-50/40' : 'bg-slate-50/60 hover:bg-orange-50/40'}
                >
                  <td className="py-2.5 px-4 border-r border-slate-200 text-slate-800">
                    {row.video}
                  </td>
                  <td className="py-2.5 px-4 border-r border-slate-200 font-bold text-slate-900">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300"
                        style={{ backgroundColor: row.dotColor }}
                      />
                      <span>{formatChickenId(row)}</span>
                      {obsIdFormat === 'short' && (
                        <span className="font-sans text-[10px] font-medium text-slate-400">
                          ({row.profileLabel.replace(/^.*?\(/, '').replace(/\)$/, '')})
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 border-r border-slate-200 text-slate-700">
                    {row.windowStart}
                  </td>
                  <td className="py-2.5 px-4 border-r border-slate-200 text-slate-700">
                    {row.windowEnd}
                  </td>
                  <td className="py-2.5 px-4 border-r border-slate-200 text-right text-slate-900">
                    {row.windowDurationS}
                  </td>
                  <td className="py-2.5 px-4 border-r border-slate-200 text-right font-semibold text-slate-900">
                    {row.validObservationDurationS}
                  </td>
                  <td className="py-2.5 px-4 border-r border-slate-200 text-right text-slate-700">
                    {row.occludedDurationS}
                  </td>
                  <td className="py-2.5 px-4 border-r border-slate-200 text-right text-slate-700">
                    {row.lostDurationS}
                  </td>
                  <td className="py-2.5 px-4 text-right font-bold text-emerald-700">
                    {row.validObservationPct.toFixed(1)}
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
