import fs from 'fs';
import os from 'os';
import path from 'path';
import initSqlJs from 'sql.js';
import { createClient } from '@supabase/supabase-js';
import { addDays, enumerateDates, normalizeIsoDate, todayIso } from '@/lib/date-range';
import { DEFAULT_SAMPLE_INTERVALS } from '@/lib/default-telemetry';

export type ArchiveScope = '1d' | '7d' | '30d' | 'all';

export interface ArchiveMetadata {
  archiveId: string;
  fileName: string;
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

export interface ArchiveFileEntry extends ArchiveMetadata {
  filePath: string;
  sizeBytes: number;
}

interface ArchiveManifest {
  version: number;
  archivedDates: string[];
  archives: Record<string, ArchiveMetadata>;
}

const ARCHIVE_FOLDER_NAME = 'Archive';
const MANIFEST_FILE_NAME = '.archive-manifest.json';
const META_PREFIX = '--CHICKENSEE_ARCHIVE_META:';
const PAYLOAD_PREFIX = '--CHICKENSEE_ARCHIVE_PAYLOAD:';

// In-memory cache for serverless environments
let cachedManifest: ArchiveManifest | null = null;

function getSupabaseArchiveBucket() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'chickensee-sync';
  if (!url || !serviceRoleKey) return null;
  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client.storage.from(bucketName);
}

export function getArchiveDir(): string {
  // On Vercel serverless (/var/task is read-only), use /tmp/Archive
  if (!process.env.VERCEL) {
    try {
      const localDir = path.join(process.cwd(), ARCHIVE_FOLDER_NAME);
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      return localDir;
    } catch {
      // Fallback to os.tmpdir()/Archive if cwd is read-only
    }
  }
  const tmpDir = path.join(os.tmpdir(), ARCHIVE_FOLDER_NAME);
  try {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  } catch {
    // ignore
  }
  return tmpDir;
}

function getManifestPath(): string {
  return path.join(getArchiveDir(), MANIFEST_FILE_NAME);
}

export function clearManifestCache(): void {
  cachedManifest = null;
}

export function readArchiveManifest(): ArchiveManifest {
  const manifestPath = getManifestPath();
  try {
    if (fs.existsSync(manifestPath)) {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<ArchiveManifest>;
      const archives = parsed.archives && typeof parsed.archives === 'object' ? parsed.archives : {};

      // If an archive is marked 'restored', ensure its dates are excluded from archivedDates
      let hasRestoredAll = false;
      const restoredDates = new Set<string>();
      for (const arch of Object.values(archives)) {
        if (arch && typeof arch === 'object' && arch.status === 'restored') {
          if (arch.scope === 'all' || /all_data/i.test(arch.fileName || '')) {
            hasRestoredAll = true;
            break;
          }
          if (Array.isArray(arch.dates)) {
            for (const d of arch.dates) restoredDates.add(String(d).slice(0, 10));
          }
          if (arch.startDate && arch.endDate && arch.startDate <= arch.endDate) {
            for (const d of enumerateDates(arch.startDate, arch.endDate)) {
              restoredDates.add(d);
            }
          }
        }
      }

      const rawDates = Array.isArray(parsed.archivedDates) ? parsed.archivedDates : [];
      const cleanDates = hasRestoredAll
        ? []
        : rawDates
            .map((d) => String(d).slice(0, 10))
            .filter((d) => Boolean(d) && !restoredDates.has(d));

      const result: ArchiveManifest = {
        version: 1,
        archivedDates: Array.from(new Set(cleanDates)).sort(),
        archives,
      };
      cachedManifest = result;
      return result;
    }
  } catch (err) {
    console.warn('Could not read archive manifest, using cached or fresh manifest:', err);
  }
  if (cachedManifest) {
    return cachedManifest;
  }
  return {
    version: 1,
    archivedDates: [],
    archives: {},
  };
}

export async function syncManifestFromCloud(): Promise<ArchiveManifest> {
  const bucket = getSupabaseArchiveBucket();
  if (bucket) {
    try {
      const { data, error } = await bucket.download(`${ARCHIVE_FOLDER_NAME}/${MANIFEST_FILE_NAME}`);
      if (!error && data) {
        const raw = await data.text();
        const remote = JSON.parse(raw) as Partial<ArchiveManifest>;
        const archives = remote.archives && typeof remote.archives === 'object' ? remote.archives : {};

        // Reconcile: If any archive has status 'restored', strip its dates from archivedDates
        let hasRestoredAll = false;
        const restoredDates = new Set<string>();
        for (const arch of Object.values(archives)) {
          if (arch && typeof arch === 'object' && arch.status === 'restored') {
            if (arch.scope === 'all' || /all_data/i.test(arch.fileName || '')) {
              hasRestoredAll = true;
              break;
            }
            if (Array.isArray(arch.dates)) {
              for (const d of arch.dates) restoredDates.add(String(d).slice(0, 10));
            }
            if (arch.startDate && arch.endDate && arch.startDate <= arch.endDate) {
              for (const d of enumerateDates(arch.startDate, arch.endDate)) {
                restoredDates.add(d);
              }
            }
          }
        }

        const rawDates = Array.isArray(remote.archivedDates) ? remote.archivedDates : [];
        const cleanDates = hasRestoredAll
          ? []
          : rawDates
              .map((d) => String(d).slice(0, 10))
              .filter((d) => Boolean(d) && !restoredDates.has(d));

        const result: ArchiveManifest = {
          version: 1,
          archivedDates: Array.from(new Set(cleanDates)).sort(),
          archives,
        };
        cachedManifest = result;
        try {
          fs.writeFileSync(getManifestPath(), JSON.stringify(result, null, 2), 'utf-8');
        } catch {}

        // If stale dates belonging to restored archives were purged, heal remote cloud manifest immediately
        if (cleanDates.length !== rawDates.length || (hasRestoredAll && rawDates.length > 0)) {
          try {
            await bucket.upload(`${ARCHIVE_FOLDER_NAME}/${MANIFEST_FILE_NAME}`, JSON.stringify(result, null, 2), {
              contentType: 'application/json',
              upsert: true,
            });
          } catch {}
        }

        return result;
      }
    } catch {
      // ignore cloud fetch error
    }
  }
  return readArchiveManifest();
}

async function writeArchiveManifestAsync(manifest: ArchiveManifest): Promise<void> {
  manifest.archivedDates = Array.from(new Set(manifest.archivedDates)).sort();
  cachedManifest = manifest;
  const jsonStr = JSON.stringify(manifest, null, 2);
  try {
    const manifestPath = getManifestPath();
    fs.writeFileSync(manifestPath, jsonStr, 'utf-8');
  } catch (err) {
    console.warn('Could not write local archive manifest:', err);
  }
  const bucket = getSupabaseArchiveBucket();
  if (bucket) {
    try {
      await bucket.upload(`${ARCHIVE_FOLDER_NAME}/${MANIFEST_FILE_NAME}`, jsonStr, {
        contentType: 'application/json',
        upsert: true,
      });
    } catch (err) {
      console.warn('Could not upload archive manifest to Supabase Storage:', err);
    }
  }
}

/**
 * Returns the set of ISO dates (YYYY-MM-DD) currently archived (soft-deleted).
 */
export function getArchivedDatesSet(): Set<string> {
  const manifest = readArchiveManifest();
  const archives = manifest.archives && typeof manifest.archives === 'object' ? manifest.archives : {};
  const hasRestoredAll = Object.values(archives).some(
    (a) => a && typeof a === 'object' && a.status === 'restored' && (a.scope === 'all' || /all_data/i.test(a.fileName || ''))
  );
  if (hasRestoredAll) {
    return new Set<string>();
  }
  const restoredDates = new Set<string>();
  for (const a of Object.values(archives)) {
    if (a && typeof a === 'object' && a.status === 'restored') {
      if (Array.isArray(a.dates)) {
        for (const d of a.dates) restoredDates.add(String(d).slice(0, 10));
      }
      if (a.startDate && a.endDate && a.startDate <= a.endDate) {
        for (const d of enumerateDates(a.startDate, a.endDate)) {
          restoredDates.add(d);
        }
      }
    }
  }
  return new Set((manifest.archivedDates || []).filter((d) => !restoredDates.has(d)));
}

/**
 * Checks whether a specific YYYY-MM-DD date is currently archived.
 */
export function isDateArchived(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const norm = normalizeIsoDate(dateStr.slice(0, 10));
  if (!norm) return false;
  return getArchivedDatesSet().has(norm);
}

function sqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : 'NULL';
  }
  if (typeof val === 'boolean') {
    return val ? '1' : '0';
  }
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

export function computeScopeDateRange(
  scope: ArchiveScope,
  referenceDateInput?: string | null,
  allActiveDates?: string[],
): {
  referenceDate: string;
  startDate: string;
  endDate: string;
  dates: string[];
  scopeLabel: string;
  scopeSlug: string;
} {
  const ref = (referenceDateInput && normalizeIsoDate(referenceDateInput)) || todayIso();

  if (scope === 'all') {
    const sampleDates = DEFAULT_SAMPLE_INTERVALS.map((i) => i.date);
    const combined = Array.from(
      new Set([...(allActiveDates || []), ...sampleDates].map((d) => normalizeIsoDate(d)).filter((d): d is string => Boolean(d))),
    ).sort();
    const startDate = combined[0] || addDays(ref, -29);
    const endDate = combined[combined.length - 1] || ref;
    const dates = combined.length > 0 ? combined : enumerateDates(startDate, endDate);
    return {
      referenceDate: endDate,
      startDate,
      endDate,
      dates,
      scopeLabel: 'Wipe All Data (Full System Archive)',
      scopeSlug: 'all_data',
    };
  }

  const daysCount = scope === '1d' ? 1 : scope === '7d' ? 7 : 30;
  const startDate = daysCount === 1 ? ref : addDays(ref, -(daysCount - 1));
  const endDate = ref;
  const dates = enumerateDates(startDate, endDate);
  const scopeLabel =
    scope === '1d'
      ? 'Entire Day (1 Day)'
      : scope === '7d'
        ? 'Entire 7 Days'
        : 'Entire 30 Days';
  const scopeSlug =
    scope === '1d'
      ? '1day'
      : scope === '7d'
        ? '7days'
        : '30days';

  return {
    referenceDate: ref,
    startDate,
    endDate,
    dates,
    scopeLabel,
    scopeSlug,
  };
}

/**
 * Builds a clean, date-stamped SQL filename in the Archive folder:
 * - 1 day:  chickensee_archive_1day_2026-11-17.sql
 * - 7 days: chickensee_archive_7days_2026-11-11_to_2026-11-17.sql
 * - 30 days: chickensee_archive_30days_2026-10-19_to_2026-11-17.sql
 * - all data: chickensee_archive_all_data_2026-07-26_to_2026-11-17.sql
 */
export function buildArchiveSqlFileName(scope: ArchiveScope, startDate: string, endDate: string): string {
  const scopeSlug =
    scope === '1d'
      ? '1day'
      : scope === '7d'
        ? '7days'
        : scope === '30d'
          ? '30days'
          : 'all_data';
  const datePart = scope === '1d' || startDate === endDate
    ? startDate
    : `${startDate}_to_${endDate}`;
  return `chickensee_archive_${scopeSlug}_${datePart}.sql`;
}

/**
 * Validates that an attached SQL file name or content carries a recognizable date (YYYY-MM-DD)
 * so the archive remains clean and unambiguous.
 */
export function extractDateInfoFromSqlFile(fileName: string, sqlContent: string): {
  valid: boolean;
  error?: string;
  meta?: ArchiveMetadata;
  payload?: {
    halfHourMetrics?: { columns: string[]; values: unknown[][] };
    birdTrackMetrics?: { columns: string[]; values: unknown[][] };
  };
  detectedDates: string[];
} {
  const fileDateMatches = fileName.match(/\b(20\d{2}-\d{2}-\d{2})\b/g) || [];

  // 1. Check embedded metadata header line
  const lines = sqlContent.split(/\r?\n/);
  let parsedMeta: ArchiveMetadata | undefined;
  let parsedPayload: {
    halfHourMetrics?: { columns: string[]; values: unknown[][] };
    birdTrackMetrics?: { columns: string[]; values: unknown[][] };
  } | undefined;

  const maxHeaderLines = Math.min(lines.length, 60);
  for (let idx = 0; idx < maxHeaderLines; idx++) {
    const line = lines[idx];
    if (line.startsWith(META_PREFIX)) {
      try {
        parsedMeta = JSON.parse(line.slice(META_PREFIX.length).trim()) as ArchiveMetadata;
      } catch {
        // ignore malformed meta comment
      }
    } else if (line.startsWith(PAYLOAD_PREFIX)) {
      try {
        const b64 = line.slice(PAYLOAD_PREFIX.length).trim();
        const jsonStr = Buffer.from(b64, 'base64').toString('utf-8');
        parsedPayload = JSON.parse(jsonStr);
      } catch {
        // ignore malformed payload
      }
    }
  }

  // 2. Also scan SQL INSERT statements for YYYY-MM-DD dates if needed
  const sqlDateMatches = sqlContent.match(/\b(20\d{2}-\d{2}-\d{2})\b/g) || [];

  const rangeDates: string[] = [];
  const sDate = parsedMeta?.startDate || fileDateMatches[0];
  const eDate = parsedMeta?.endDate || fileDateMatches[fileDateMatches.length - 1];
  if (sDate && eDate && sDate <= eDate) {
    rangeDates.push(...enumerateDates(sDate, eDate));
  }

  const allDates = Array.from(
    new Set([
      ...(parsedMeta?.dates || []),
      ...rangeDates,
      ...fileDateMatches,
      ...sqlDateMatches,
    ].map((d) => normalizeIsoDate(d)).filter((d): d is string => Boolean(d))),
  ).sort();

  const isAllDataArchive = /all_data/i.test(fileName) || parsedMeta?.scope === 'all';

  if (!isAllDataArchive && fileDateMatches.length === 0 && (!parsedMeta || !parsedMeta.dates?.length)) {
    return {
      valid: false,
      error:
        'The attached SQL file must include a valid date (YYYY-MM-DD) in its filename or archive header (e.g. chickensee_archive_1day_2026-11-17.sql) so the system can distinguish it cleanly.',
      detectedDates: [],
    };
  }

  if (!isAllDataArchive && allDates.length === 0) {
    return {
      valid: false,
      error: 'No valid ISO dates (YYYY-MM-DD) were found in the attached SQL archive file.',
      detectedDates: [],
    };
  }

  return {
    valid: true,
    meta: parsedMeta,
    payload: parsedPayload,
    detectedDates: allDates,
  };
}

/**
 * Archives (soft-deletes) data for 1 day, 7 days, or 30 days:
 * 1. Exports all matching rows from analytics/zampen_analytics.db + behavior intervals + sensor sessions into Archive/<dated_file>.sql
 * 2. Deletes those rows from analytics/zampen_analytics.db (recoverable via the .sql file)
 * 3. Marks the dates as archived in Archive/.archive-manifest.json so active views hide them immediately
 */
export async function archiveDataByScope(params: {
  scope: ArchiveScope;
  referenceDate?: string | null;
  allActiveDates?: string[];
  createdBy: string;
}): Promise<{
  archive: ArchiveFileEntry;
  sqlPreview: string;
  sqlContent: string;
}> {
  const { scope, referenceDate, allActiveDates, createdBy } = params;
  const range = computeScopeDateRange(scope, referenceDate, allActiveDates);
  const archiveDir = getArchiveDir();
  const fileName = buildArchiveSqlFileName(scope, range.startDate, range.endDate);
  const filePath = path.join(archiveDir, fileName);
  const createdAt = new Date().toISOString();
  const archiveId = `arch_${range.scopeSlug}_${range.startDate}_${range.endDate}`;

  const dateSet = new Set(range.dates);

  // Extract matching rows from analytics/zampen_analytics.db if present
  const dbPath = path.join(process.cwd(), 'analytics', 'zampen_analytics.db');
  let halfHourCols: string[] = [];
  let halfHourRows: unknown[][] = [];
  let birdTrackCols: string[] = [];
  let birdTrackRows: unknown[][] = [];

  if (fs.existsSync(dbPath)) {
    try {
      const SQL = await initSqlJs();
      const buf = fs.readFileSync(dbPath);
      const db = new SQL.Database(buf);

      try {
        if (scope === 'all') {
          const hmRes = db.exec(`SELECT * FROM half_hour_metrics ORDER BY id ASC`);
          if (hmRes.length > 0) {
            halfHourCols = hmRes[0].columns;
            halfHourRows = hmRes[0].values;
          }
          const btRes = db.exec(`SELECT * FROM bird_track_metrics ORDER BY id ASC`);
          if (btRes.length > 0) {
            birdTrackCols = btRes[0].columns;
            birdTrackRows = btRes[0].values;
          }
          db.run(`DELETE FROM bird_track_metrics`);
          db.run(`DELETE FROM half_hour_metrics`);
          const exported = db.export();
          try { fs.writeFileSync(dbPath, Buffer.from(exported)); } catch {}
          try { fs.writeFileSync(path.join(os.tmpdir(), 'zampen_analytics.db'), Buffer.from(exported)); } catch {}
        } else {
          const quotedDates = range.dates.map((d) => `'${d.replace(/'/g, "''")}'`).join(', ');
          if (quotedDates.length > 0) {
            const hmRes = db.exec(`SELECT * FROM half_hour_metrics WHERE substr(date_slot, 1, 10) IN (${quotedDates}) ORDER BY id ASC`);
            if (hmRes.length > 0) {
              halfHourCols = hmRes[0].columns;
              halfHourRows = hmRes[0].values;
            }

            const chunkIds = halfHourRows
              .map((r) => Number(r[0]))
              .filter((n) => Number.isFinite(n));

            if (chunkIds.length > 0) {
              const btRes = db.exec(
                `SELECT * FROM bird_track_metrics WHERE chunk_metric_id IN (${chunkIds.join(', ')}) ORDER BY id ASC`,
              );
              if (btRes.length > 0) {
                birdTrackCols = btRes[0].columns;
                birdTrackRows = btRes[0].values;
              }

              // Remove archived rows from active SQLite db (they are preserved in the .sql archive)
              db.run(`DELETE FROM bird_track_metrics WHERE chunk_metric_id IN (${chunkIds.join(', ')})`);
              db.run(`DELETE FROM half_hour_metrics WHERE id IN (${chunkIds.join(', ')})`);
              const exported = db.export();
              try { fs.writeFileSync(dbPath, Buffer.from(exported)); } catch {}
              try { fs.writeFileSync(path.join(os.tmpdir(), 'zampen_analytics.db'), Buffer.from(exported)); } catch {}
            }
          }
        }
      } finally {
        db.close();
      }
    } catch (err) {
      console.warn('Warning while archiving zampen_analytics.db rows:', err);
    }
  }

  // Also gather matching sample/offline intervals so 1d/7d/30d archive always includes behavior & telemetry SQL records
  const matchingSampleIntervals = DEFAULT_SAMPLE_INTERVALS.filter((item) => dateSet.has(item.date));

  const metadata: ArchiveMetadata = {
    archiveId,
    fileName,
    scope,
    scopeLabel: range.scopeLabel,
    referenceDate: range.referenceDate,
    startDate: range.startDate,
    endDate: range.endDate,
    dates: range.dates,
    createdAt,
    createdBy,
    metricsRowCount: halfHourRows.length,
    birdTrackRowCount: birdTrackRows.length,
    sensorSessionCount: range.dates.length,
    behaviorIntervalCount: Math.max(halfHourRows.length, matchingSampleIntervals.length),
    status: 'archived',
    restoredAt: null,
    restoredBy: null,
  };

  const payloadObj = {
    halfHourMetrics: { columns: halfHourCols, values: halfHourRows },
    birdTrackMetrics: { columns: birdTrackCols, values: birdTrackRows },
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payloadObj), 'utf-8').toString('base64');

  // Construct clean, standard SQL backup script
  const sqlLines: string[] = [
    '-- ============================================================================',
    '-- CHICKENSEE PORTAL - DATA ARCHIVE & RESTORE SQL BACKUP',
    `-- File Name      : ${fileName}`,
    `-- Archive Scope  : ${range.scopeLabel}`,
    `-- Date Range     : ${range.startDate} to ${range.endDate} (${range.dates.length} day${range.dates.length === 1 ? '' : 's'})`,
    `-- Archived Dates : ${range.dates.join(', ')}`,
    `-- Created At     : ${createdAt}`,
    `-- Created By     : ${createdBy}`,
    `${META_PREFIX}${JSON.stringify(metadata)}`,
    `${PAYLOAD_PREFIX}${payloadBase64}`,
    '-- ============================================================================',
    '',
    'BEGIN TRANSACTION;',
    '',
    '-- 1. Archive Manifest & Retention Registry',
    'CREATE TABLE IF NOT EXISTS chickensee_archive_registry (',
    '  archive_id TEXT PRIMARY KEY,',
    '  file_name TEXT NOT NULL,',
    '  scope TEXT NOT NULL,',
    '  start_date TEXT NOT NULL,',
    '  end_date TEXT NOT NULL,',
    '  archived_dates_json TEXT NOT NULL,',
    '  created_at TEXT NOT NULL,',
    '  created_by TEXT NOT NULL',
    ');',
    `INSERT OR REPLACE INTO chickensee_archive_registry (archive_id, file_name, scope, start_date, end_date, archived_dates_json, created_at, created_by) VALUES (${sqlLiteral(archiveId)}, ${sqlLiteral(fileName)}, ${sqlLiteral(scope)}, ${sqlLiteral(range.startDate)}, ${sqlLiteral(range.endDate)}, ${sqlLiteral(JSON.stringify(range.dates))}, ${sqlLiteral(createdAt)}, ${sqlLiteral(createdBy)});`,
    '',
  ];

  // 2. Half-hour environmental & flock metrics SQL statements
  if (halfHourCols.length > 0 && halfHourRows.length > 0) {
    sqlLines.push(`-- 2. Half-Hour Telemetry & Flock Metrics (${halfHourRows.length} rows)`);
    const colList = halfHourCols.map((c) => `"${c}"`).join(', ');
    for (const row of halfHourRows) {
      const vals = row.map(sqlLiteral).join(', ');
      sqlLines.push(`INSERT OR REPLACE INTO half_hour_metrics (${colList}) VALUES (${vals});`);
    }
    sqlLines.push('');
  }

  // 3. Per-bird behavior track metrics SQL statements
  if (birdTrackCols.length > 0 && birdTrackRows.length > 0) {
    sqlLines.push(`-- 3. Per-Bird Track Behavior Metrics (${birdTrackRows.length} rows)`);
    const colList = birdTrackCols.map((c) => `"${c}"`).join(', ');
    for (const row of birdTrackRows) {
      const vals = row.map(sqlLiteral).join(', ');
      sqlLines.push(`INSERT OR REPLACE INTO bird_track_metrics (${colList}) VALUES (${vals});`);
    }
    sqlLines.push('');
  }

  // 4. Daily Behavior & Environmental Correlation Summary Snapshot
  sqlLines.push('-- 4. Daily Behavior & Environmental Correlation Snapshot');
  sqlLines.push('CREATE TABLE IF NOT EXISTS archived_daily_summaries (');
  sqlLines.push('  date_key TEXT NOT NULL,');
  sqlLines.push('  interval_label TEXT NOT NULL,');
  sqlLines.push('  temp_c REAL,');
  sqlLines.push('  humidity_pct REAL,');
  sqlLines.push('  ammonia_ppm REAL,');
  sqlLines.push('  sound_db REAL,');
  sqlLines.push('  thi REAL,');
  sqlLines.push('  heat_stress TEXT,');
  sqlLines.push('  behaviors_json TEXT,');
  sqlLines.push('  PRIMARY KEY (date_key, interval_label)');
  sqlLines.push(');');

  for (const sample of matchingSampleIntervals) {
    sqlLines.push(
      `INSERT OR REPLACE INTO archived_daily_summaries (date_key, interval_label, temp_c, humidity_pct, ammonia_ppm, sound_db, thi, heat_stress, behaviors_json) VALUES (${sqlLiteral(sample.date)}, ${sqlLiteral(sample.intervalLabel)}, ${sqlLiteral(sample.tempC)}, ${sqlLiteral(sample.humidityPct)}, ${sqlLiteral(sample.ammoniaPpm)}, ${sqlLiteral(sample.soundDb)}, ${sqlLiteral(sample.thi)}, ${sqlLiteral(sample.heatStress)}, ${sqlLiteral(JSON.stringify(sample.behaviorsByBird))});`,
    );
  }

  for (const d of range.dates) {
    if (!matchingSampleIntervals.some((s) => s.date === d)) {
      sqlLines.push(
        `INSERT OR REPLACE INTO archived_daily_summaries (date_key, interval_label, temp_c, humidity_pct, ammonia_ppm, sound_db, thi, heat_stress, behaviors_json) VALUES (${sqlLiteral(d)}, ${sqlLiteral(d)}, NULL, NULL, NULL, NULL, NULL, 'Normal', '{}');`,
      );
    }
  }

  sqlLines.push('');
  sqlLines.push('COMMIT;');
  sqlLines.push('-- END OF CHICKENSEE ARCHIVE SQL');

  const sqlContent = sqlLines.join('\n');
  let sizeBytes = Buffer.byteLength(sqlContent, 'utf-8');
  try {
    fs.writeFileSync(filePath, sqlContent, 'utf-8');
    sizeBytes = fs.statSync(filePath).size;
  } catch (err) {
    console.warn('Could not write SQL archive to local filesystem, persisting to cloud:', err);
  }

  // Also upload SQL archive to Supabase Storage Archive/ folder
  const bucket = getSupabaseArchiveBucket();
  if (bucket) {
    try {
      await bucket.upload(`${ARCHIVE_FOLDER_NAME}/${fileName}`, sqlContent, {
        contentType: 'application/sql',
        upsert: true,
      });
    } catch (err) {
      console.warn('Could not upload SQL archive to Supabase Storage:', err);
    }
  }

  // Update manifest in Archive/.archive-manifest.json (local + cloud)
  const manifest = await syncManifestFromCloud();
  const updatedDates = new Set(manifest.archivedDates);
  for (const d of range.dates) {
    updatedDates.add(d);
  }
  manifest.archivedDates = Array.from(updatedDates).sort();
  manifest.archives[fileName] = metadata;
  await writeArchiveManifestAsync(manifest);

  return {
    archive: {
      ...metadata,
      filePath,
      sizeBytes,
    },
    sqlPreview: sqlLines.slice(0, 28).join('\n'),
    sqlContent,
  };
}

/**
 * Restores archived data from an attached or stored .sql archive file:
 * 1. Validates that the file has a clean date identifier
 * 2. Restores half_hour_metrics and bird_track_metrics rows into analytics/zampen_analytics.db
 * 3. Removes the restored dates from Archive/.archive-manifest.json so all tabs display the data again
 * 4. Saves/updates the .sql file in Archive/ and marks its status as 'restored'
 */
export async function restoreDataFromSql(params: {
  fileName: string;
  sqlContent: string;
  restoredBy: string;
}): Promise<{
  restoredDates: string[];
  restoredMetricsRows: number;
  restoredBirdRows: number;
  archive: ArchiveFileEntry;
}> {
  const { fileName, sqlContent, restoredBy } = params;
  const extracted = extractDateInfoFromSqlFile(fileName, sqlContent);
  if (!extracted.valid) {
    throw new Error(extracted.error || 'Invalid SQL archive file.');
  }

  const restoredDates = extracted.detectedDates;
  const archiveDir = getArchiveDir();

  // Ensure a clean date-stamped filename inside Archive/
  const cleanBaseName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const targetFileName = cleanBaseName.toLowerCase().endsWith('.sql')
    ? cleanBaseName
    : `${cleanBaseName}.sql`;
  const targetFilePath = path.join(archiveDir, targetFileName);

  // Save attached SQL file into Archive/ (local + cloud)
  let sizeBytes = Buffer.byteLength(sqlContent, 'utf-8');
  try {
    fs.writeFileSync(targetFilePath, sqlContent, 'utf-8');
    sizeBytes = fs.statSync(targetFilePath).size;
  } catch {}

  const bucket = getSupabaseArchiveBucket();
  if (bucket) {
    try {
      await bucket.upload(`${ARCHIVE_FOLDER_NAME}/${targetFileName}`, sqlContent, {
        contentType: 'application/sql',
        upsert: true,
      });
    } catch {}
  }

  let restoredMetricsRows = 0;
  let restoredBirdRows = 0;

  // Restore SQLite rows into analytics/zampen_analytics.db
  const dbPath = path.join(process.cwd(), 'analytics', 'zampen_analytics.db');
  const tmpDbPath = path.join(os.tmpdir(), 'zampen_analytics.db');
  try {
    const SQL = await initSqlJs();
    let db: any = null;
    if (fs.existsSync(dbPath)) {
      db = new SQL.Database(fs.readFileSync(dbPath));
    } else if (fs.existsSync(tmpDbPath)) {
      db = new SQL.Database(fs.readFileSync(tmpDbPath));
    } else {
      db = new SQL.Database();
    }

    try {
      db.run(`
        CREATE TABLE IF NOT EXISTS half_hour_metrics (
          id INTEGER PRIMARY KEY,
          job_id INTEGER,
          date_slot TEXT,
          hour_slot TEXT,
          chunk_index INTEGER,
          chunk_start TEXT,
          chunk_end TEXT,
          temp_avg_c REAL,
          temp_min_c REAL,
          temp_max_c REAL,
          humidity_avg_pct REAL,
          humidity_min_pct REAL,
          humidity_max_pct REAL,
          ammonia_ppm_avg REAL,
          ammonia_ppm_max REAL,
          lux_avg REAL,
          thi_avg REAL,
          heat_stress_level TEXT,
          unique_birds_tracked INTEGER,
          avg_birds_in_frame REAL,
          flock_mobility_px_s REAL,
          feeding_time_total_s REAL,
          feeding_bouts INTEGER,
          reduced_eating_events INTEGER,
          reduced_eating_index REAL,
          drinking_time_total_s REAL,
          drinking_bouts INTEGER,
          drinking_frequency_per_bird REAL,
          inactivity_time_total_s REAL,
          inactivity_pct REAL,
          lethargic_birds_flagged INTEGER,
          feather_pecking_events INTEGER,
          agitation_score REAL,
          created_at TEXT,
          sensor_data_available INTEGER
        );
        CREATE TABLE IF NOT EXISTS bird_track_metrics (
          id INTEGER PRIMARY KEY,
          chunk_metric_id INTEGER,
          track_id INTEGER,
          bird_label TEXT,
          bird_type TEXT,
          feeding_s REAL,
          feeding_bouts INTEGER,
          reduced_eating_flag INTEGER,
          drinking_s REAL,
          drinking_bouts INTEGER,
          inactivity_s REAL,
          is_lethargic INTEGER,
          pecking_aggressor_count INTEGER,
          pecking_victim_count INTEGER,
          avg_velocity_px_s REAL
        );
      `);

      if (extracted.payload?.halfHourMetrics?.columns?.length && extracted.payload.halfHourMetrics.values?.length) {
        const cols = extracted.payload.halfHourMetrics.columns.map((c) => `"${c}"`).join(', ');
        for (const row of extracted.payload.halfHourMetrics.values) {
          const vals = row.map(sqlLiteral).join(', ');
          db.run(`INSERT OR REPLACE INTO half_hour_metrics (${cols}) VALUES (${vals});`);
          restoredMetricsRows++;
        }
      }
      if (extracted.payload?.birdTrackMetrics?.columns?.length && extracted.payload.birdTrackMetrics.values?.length) {
        const cols = extracted.payload.birdTrackMetrics.columns.map((c) => `"${c}"`).join(', ');
        for (const row of extracted.payload.birdTrackMetrics.values) {
          const vals = row.map(sqlLiteral).join(', ');
          db.run(`INSERT OR REPLACE INTO bird_track_metrics (${cols}) VALUES (${vals});`);
          restoredBirdRows++;
        }
      }

      // Fallback: if no base64 payload comment was present, execute INSERT statements directly
      if (restoredMetricsRows === 0 && restoredBirdRows === 0) {
        const insertLines = sqlContent
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(
            (l) =>
              /^INSERT\s+(OR\s+REPLACE\s+)?INTO\s+(half_hour_metrics|bird_track_metrics)\b/i.test(l),
          );
        for (const stmt of insertLines) {
          try {
            db.run(stmt);
            if (/half_hour_metrics/i.test(stmt)) restoredMetricsRows++;
            if (/bird_track_metrics/i.test(stmt)) restoredBirdRows++;
          } catch {}
        }
      }

      if (restoredMetricsRows > 0 || restoredBirdRows > 0) {
        const exported = db.export();
        try { fs.writeFileSync(dbPath, Buffer.from(exported)); } catch {}
        try { fs.writeFileSync(tmpDbPath, Buffer.from(exported)); } catch {}
      }
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn('Warning while restoring SQL rows into zampen_analytics.db:', err);
  }

  const nowIso = new Date().toISOString();
  const startDate = extracted.meta?.startDate || restoredDates[0];
  const endDate = extracted.meta?.endDate || restoredDates[restoredDates.length - 1];
  const isAllDataArchive =
    extracted.meta?.scope === 'all' ||
    /all_data/i.test(fileName) ||
    /all_data/i.test(targetFileName);

  const scope: ArchiveScope =
    extracted.meta?.scope ||
    (isAllDataArchive ? 'all' : restoredDates.length === 1 ? '1d' : restoredDates.length <= 7 ? '7d' : '30d');
  const scopeLabel =
    extracted.meta?.scopeLabel ||
    (scope === 'all'
      ? 'Wipe All Data (Full System Archive)'
      : scope === '1d'
        ? 'Entire Day (1 Day)'
        : scope === '7d'
          ? 'Entire 7 Days'
          : 'Entire 30 Days');

  // Update manifest: remove restoredDates from archivedDates and mark archive as restored
  const manifest = await syncManifestFromCloud();
  if (isAllDataArchive) {
    manifest.archivedDates = [];
  } else {
    const restoredSet = new Set(restoredDates);
    if (extracted.meta?.dates) {
      for (const d of extracted.meta.dates) restoredSet.add(d);
    }
    if (startDate && endDate && startDate <= endDate) {
      for (const d of enumerateDates(startDate, endDate)) restoredSet.add(d);
    }
    manifest.archivedDates = manifest.archivedDates.filter((d) => !restoredSet.has(d));
  }

  const updatedMeta: ArchiveMetadata = {
    archiveId: extracted.meta?.archiveId || `arch_restored_${startDate}_${endDate}`,
    fileName: targetFileName,
    scope,
    scopeLabel,
    referenceDate: extracted.meta?.referenceDate || endDate,
    startDate,
    endDate,
    dates: restoredDates,
    createdAt: extracted.meta?.createdAt || nowIso,
    createdBy: extracted.meta?.createdBy || restoredBy,
    metricsRowCount: Math.max(extracted.meta?.metricsRowCount || 0, restoredMetricsRows),
    birdTrackRowCount: Math.max(extracted.meta?.birdTrackRowCount || 0, restoredBirdRows),
    sensorSessionCount: extracted.meta?.sensorSessionCount || restoredDates.length,
    behaviorIntervalCount: Math.max(extracted.meta?.behaviorIntervalCount || 0, restoredDates.length),
    status: 'restored',
    restoredAt: nowIso,
    restoredBy,
  };

  manifest.archives[targetFileName] = updatedMeta;
  await writeArchiveManifestAsync(manifest);
  clearManifestCache();

  return {
    restoredDates,
    restoredMetricsRows,
    restoredBirdRows,
    archive: {
      ...updatedMeta,
      filePath: targetFilePath,
      sizeBytes,
    },
  };
}

export async function readArchiveSqlFileContent(fileName: string): Promise<string | null> {
  const safeName = path.basename(fileName);
  const localPath = path.join(getArchiveDir(), safeName);
  if (fs.existsSync(localPath)) {
    try {
      return fs.readFileSync(localPath, 'utf-8');
    } catch {}
  }
  const bucket = getSupabaseArchiveBucket();
  if (bucket) {
    try {
      const { data, error } = await bucket.download(`${ARCHIVE_FOLDER_NAME}/${safeName}`);
      if (!error && data) {
        const text = await data.text();
        try {
          fs.writeFileSync(localPath, text, 'utf-8');
        } catch {}
        return text;
      }
    } catch {}
  }
  return null;
}

/**
 * Lists all .sql archive files in the Archive/ folder (both local and cloud), enriched with date metadata.
 */
export async function listArchiveFilesAsync(): Promise<{
  archiveFolder: string;
  archivedDates: string[];
  files: ArchiveFileEntry[];
}> {
  await syncManifestFromCloud();
  return listArchiveFiles();
}

export function listArchiveFiles(): {
  archiveFolder: string;
  archivedDates: string[];
  files: ArchiveFileEntry[];
} {
  const archiveDir = getArchiveDir();
  const manifest = readArchiveManifest();
  const archivedSet = new Set(manifest.archivedDates);

  let entries: fs.Dirent[] = [];
  try {
    if (fs.existsSync(archiveDir)) {
      entries = fs.readdirSync(archiveDir, { withFileTypes: true });
    }
  } catch {}

  const seenNames = new Set<string>();
  const files: ArchiveFileEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.sql')) continue;
    seenNames.add(entry.name);
    const fullPath = path.join(archiveDir, entry.name);
    let sizeBytes = 0;
    let mtimeIso = new Date().toISOString();
    try {
      const stat = fs.statSync(fullPath);
      sizeBytes = stat.size;
      mtimeIso = stat.mtime.toISOString();
    } catch {}

    let meta = manifest.archives[entry.name];
    if (!meta) {
      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const extracted = extractDateInfoFromSqlFile(entry.name, raw);
        const dates = extracted.detectedDates;
        const startDate = dates[0] || mtimeIso.slice(0, 10);
        const endDate = dates[dates.length - 1] || startDate;
        const scope: ArchiveScope = dates.length <= 1 ? '1d' : dates.length <= 7 ? '7d' : '30d';
        meta = extracted.meta || {
          archiveId: `arch_${entry.name}`,
          fileName: entry.name,
          scope,
          scopeLabel:
            scope === '1d'
              ? 'Entire Day (1 Day)'
              : scope === '7d'
                ? 'Entire 7 Days'
                : 'Entire 30 Days',
          referenceDate: endDate,
          startDate,
          endDate,
          dates: dates.length ? dates : [startDate],
          createdAt: mtimeIso,
          createdBy: 'admin',
          metricsRowCount: 0,
          birdTrackRowCount: 0,
          sensorSessionCount: dates.length || 1,
          behaviorIntervalCount: dates.length || 1,
          status: dates.some((d) => archivedSet.has(d)) ? 'archived' : 'restored',
        };
      } catch {
        continue;
      }
    } else {
      const anyStillArchived = meta.dates.some((d) => archivedSet.has(d));
      meta = {
        ...meta,
        status: anyStillArchived ? 'archived' : 'restored',
      };
    }

    files.push({
      ...meta,
      filePath: `Archive/${entry.name}`,
      sizeBytes,
    });
  }

  // Also include any archives recorded in the manifest from cloud storage that aren't cached on local disk yet
  for (const [fileName, meta] of Object.entries(manifest.archives)) {
    if (seenNames.has(fileName)) continue;
    const anyStillArchived = meta.dates.some((d) => archivedSet.has(d));
    files.push({
      ...meta,
      status: anyStillArchived ? 'archived' : 'restored',
      filePath: `Archive/${fileName}`,
      sizeBytes: 2048,
    });
  }

  files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    archiveFolder: 'Archive',
    archivedDates: manifest.archivedDates,
    files,
  };
}
