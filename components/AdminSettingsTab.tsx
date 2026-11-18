'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Calendar,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileCode,
  FolderArchive,
  HardDrive,
  Loader2,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { addDays } from '@/lib/date-range';

type ArchiveScope = '1d' | '7d' | '30d';

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
  const [activeDates, setActiveDates] = useState<string[]>([]);
  const [archiveFiles, setArchiveFiles] = useState<ArchiveFileEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [referenceDate, setReferenceDate] = useState<string>('2026-11-17');
  const [autoDownloadSql, setAutoDownloadSql] = useState<boolean>(true);
  const [archivingScope, setArchivingScope] = useState<ArchiveScope | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Attachable SQL file state for restore
  const [attachedPreview, setAttachedPreview] = useState<AttachedSqlPreview | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [restoringFile, setRestoringFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const scopePreviews = useMemo(() => {
    const ref = referenceDate || '2026-11-17';
    const start7 = addDays(ref, -6);
    const start30 = addDays(ref, -29);
    return {
      '1d': {
        scope: '1d' as ArchiveScope,
        title: 'Delete Entire Day (1 Day)',
        badge: '1 Day Archive',
        rangeText: ref,
        fileName: `chickensee_archive_1day_${ref}.sql`,
        description:
          'Moves the selected full day out of active portal charts and logs into a date-stamped SQL backup file inside Archive/.',
      },
      '7d': {
        scope: '7d' as ArchiveScope,
        title: 'Delete Entire 7 Days',
        badge: '7 Days Archive',
        rangeText: `${start7} → ${ref}`,
        fileName: `chickensee_archive_7days_${start7}_to_${ref}.sql`,
        description:
          'Archives a full 7-day window ending on the reference date into a single clean SQL file inside Archive/.',
      },
      '30d': {
        scope: '30d' as ArchiveScope,
        title: 'Delete Entire 30 Days',
        badge: '30 Days Archive',
        rangeText: `${start30} → ${ref}`,
        fileName: `chickensee_archive_30days_${start30}_to_${ref}.sql`,
        description:
          'Archives a full 30-day window ending on the reference date into a date-stamped SQL file inside Archive/.',
      },
    };
  }, [referenceDate]);

  async function handleArchiveByScope(scope: ArchiveScope) {
    const preview = scopePreviews[scope];
    const confirmed = window.confirm(
      `Archive and delete ${preview.title.toLowerCase()} (${preview.rangeText})?\n\n` +
        `This will NOT permanently wipe the data. The system will generate:\n` +
        `Archive/${preview.fileName}\n\n` +
        `You can restore it anytime from the Archive folder or by attaching the .sql file.`,
    );
    if (!confirmed) return;

    try {
      setArchivingScope(scope);
      setActionError(null);
      setActionNotice(null);

      const res = await fetch('/api/admin/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, referenceDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const createdFile: ArchiveFileEntry | undefined = data.archive;
      setActionNotice(
        `Archived ${preview.rangeText} into Archive/${createdFile?.fileName || preview.fileName}. Data can be restored anytime.`,
      );

      if (autoDownloadSql && createdFile?.fileName) {
        const dlUrl = `/api/admin/archive/download?file=${encodeURIComponent(createdFile.fileName)}`;
        const link = document.createElement('a');
        link.href = dlUrl;
        link.download = createdFile.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Calendar className="h-4 w-4 text-orange-600" />
              <span>Reference Date:</span>
              <input
                type="date"
                value={referenceDate}
                onChange={(e) => setReferenceDate(e.target.value)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-900 outline-none transition focus:border-orange-500 focus:bg-white"
              />
            </label>
          </div>
        </div>

        {/* Active Date Quick Chips */}
        {activeDates.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-400 mr-1">
              Quick select active date:
            </span>
            {activeDates.slice(0, 12).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setReferenceDate(d)}
                className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium transition ${
                  referenceDate === d
                    ? 'border-orange-500 bg-orange-50 text-orange-700 font-bold'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-orange-300 hover:bg-white'
                }`}
              >
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

        {/* 3 Deletion Scope Cards */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {(['1d', '7d', '30d'] as const).map((scopeKey) => {
            const card = scopePreviews[scopeKey];
            const isBusy = archivingScope === scopeKey;

            return (
              <div
                key={scopeKey}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition hover:border-orange-200 hover:bg-white hover:shadow-xs"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-bold text-orange-800">
                      <Clock className="h-3 w-3" />
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

                  <div className="mt-3 rounded-lg border border-slate-200/80 bg-white p-2.5">
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
                  onClick={() => handleArchiveByScope(scopeKey)}
                  disabled={archivingScope !== null}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-3.5 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-orange-700 disabled:opacity-50"
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Generating SQL &amp; Archiving…</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>
                        {scopeKey === '1d'
                          ? 'Delete & Archive Entire Day'
                          : scopeKey === '7d'
                            ? 'Delete & Archive 7 Days'
                            : 'Delete & Archive 30 Days'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

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
    </div>
  );
}
