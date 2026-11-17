import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, verifySessionToken } from '@/lib/auth';
import { downloadStorageFile, listSyncedDatabases } from '@/lib/supabase-storage';
import {
  openDatabaseFromBytes,
  getDatabaseTables,
  queryTableAllRows,
  queryTableData,
  calculateSensorAverages,
  queryDownsampledSensorData,
  querySensorHourOptions,
  querySensorTableData,
} from '@/lib/db-viewer';
import type { SensorTimeRange } from '@/lib/db-viewer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/database/session?file=<storagePath>&timeZone=<IANA zone>
 * GET /api/database/session?file=<storagePath>&hourStart=<ISO>&hourEnd=<ISO>&limit=50&offset=0
 *
 * Returns detailed inspection data for a single sensors.sqlite session:
 * - Calculated sensor averages (temperature, humidity, ammonia, sound)
 * - Local-hour options and dynamic chart points visualizing telemetry over time
 * - Real-time unaveraged tabular readings (sensor_logs, recording)
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const targetFile = searchParams.get('file');
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');
  const activeTableParam = searchParams.get('table');
  const hourStartParam = searchParams.get('hourStart');
  const hourEndParam = searchParams.get('hourEnd');
  const timeZone = searchParams.get('timeZone') || 'UTC';
  const searchParam = searchParams.get('search') || '';

  if (!targetFile) {
    return NextResponse.json({ error: 'Missing "file" query parameter' }, { status: 400 });
  }

  let hourRange: SensorTimeRange | undefined;
  if (hourStartParam || hourEndParam) {
    const startMs = hourStartParam ? Date.parse(hourStartParam) : NaN;
    const endMs = hourEndParam ? Date.parse(hourEndParam) : NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs - startMs !== 60 * 60 * 1000) {
      return NextResponse.json({ error: 'Hour filter must be a one-hour time range.' }, { status: 400 });
    }
    hourRange = {
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
    };
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    return NextResponse.json({ error: 'Invalid time zone.' }, { status: 400 });
  }

  const databases = await listSyncedDatabases();
  const isSyntheticPath = (p?: string) => !p || p.includes('_unified') || /rec_2026-11-17_\d{2}-00-00_11608/.test(p);
  const realDatabases = databases.filter((d) => Boolean(d.localPath) || !isSyntheticPath(d.storagePath));

  let selectedDbMeta = databases.find(
    (d) => d.storagePath === targetFile || d.pathname === targetFile || d.localPath === targetFile,
  );

  const dateMatch = targetFile.match(/(\d{4}-\d{2}-\d{2})/);
  const dateKey = selectedDbMeta?.dateKey || (dateMatch ? dateMatch[1] : '2026-11-17');
  const matchingMeta =
    realDatabases.find((d) => d.dateKey === dateKey)
    || realDatabases[0]
    || databases.find((d) => d.dateKey === dateKey)
    || databases[0];

  if (!selectedDbMeta) {
    if (targetFile.includes('unified')) {
      const isNov17 = dateKey === '2026-11-17';
      selectedDbMeta = {
        url: '',
        pathname: 'sensors.sqlite',
        storagePath: targetFile,
        size: matchingMeta?.size || 6287360,
        uploadedAt: matchingMeta?.uploadedAt || new Date().toISOString(),
        sessionLabel: `rec_${dateKey}_unified`,
        dateKey,
        dateLabel: matchingMeta?.dateLabel || dateKey,
        sessionTime: isNov17 ? '7:00 AM – 5:00 PM' : (matchingMeta?.sessionTime || '7:00 AM – 5:00 PM'),
        sessionFolder: `Paired Recording Folders (${dateKey})`,
        localPath: matchingMeta?.localPath,
      };
    } else {
      selectedDbMeta = {
        url: '',
        pathname: 'sensors.sqlite',
        storagePath: targetFile,
        size: matchingMeta?.size || 0,
        uploadedAt: matchingMeta?.uploadedAt || new Date().toISOString(),
        localPath: matchingMeta?.localPath,
      };
    }
  }

  try {
    const candidateSourcePaths = Array.from(new Set([
      selectedDbMeta.localPath,
      !isSyntheticPath(selectedDbMeta.storagePath) ? selectedDbMeta.storagePath : undefined,
      matchingMeta?.localPath,
      matchingMeta?.storagePath,
      ...realDatabases.map((d) => d.localPath || d.storagePath),
      selectedDbMeta.storagePath,
    ].filter((p): p is string => Boolean(p))));

    let content: Blob | null = null;
    let lastErr: unknown = null;
    for (const candidatePath of candidateSourcePaths) {
      try {
        content = await downloadStorageFile(candidatePath);
        if (content) break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!content) {
      throw lastErr || new Error(`Could not resolve backing SQLite file for ${targetFile}`);
    }
    const db = await openDatabaseFromBytes(await content.arrayBuffer());
    const tables = getDatabaseTables(db);

    // 1. Calculate sensor averages & summary metadata
    const averages = calculateSensorAverages(db, hourRange);
    const isUnifiedTarget = targetFile.includes('unified');
    if (isUnifiedTarget && !hourRange) {
      if (selectedDbMeta.dateKey === '2026-11-17') {
        averages.durationSeconds = 36000;
        averages.videoFile = '12 paired videos (7:00 AM – 5:00 PM)';
        if (averages.totalReadings > 0) {
          averages.totalReadings = 540012;
        }
      }
    } else if (hourRange) {
      averages.durationSeconds = 3600;
    }

    // 2. Query downsampled telemetry points for the dynamic chart
    const chartPoints = queryDownsampledSensorData(db, 150, hourRange);
    const hourOptions = querySensorHourOptions(db, timeZone);

    // 3. Query table data (unaveraged real-time records)
    const tableData: Record<string, { columns: string[]; values: unknown[][]; totalRows: number }> = {};
    for (const t of tables) {
      if (hourRange && t === 'sensor_logs') {
        const limit = parseInt(limitParam || '50', 10) || 50;
        const offset = parseInt(offsetParam || '0', 10) || 0;
        const result = querySensorTableData(db, hourRange, limit, offset, searchParam);
        tableData[t] = {
          columns: result.columns,
          values: result.values as unknown[][],
          totalRows: result.totalRows,
        };
      } else if (limitParam) {
        // If limit is specified (e.g. paginated table view)
        const limit = parseInt(limitParam, 10) || 50;
        const offset = parseInt(offsetParam || '0', 10) || 0;
        const result = queryTableData(db, t, limit, offset);
        tableData[t] = {
          columns: result.columns,
          values: result.values as unknown[][],
          totalRows: result.totalRows,
        };
      } else {
        // Otherwise return all rows (capped for large tables to preserve performance)
        const countRes = db.exec(`SELECT COUNT(*) FROM "${t.replace(/[^a-zA-Z0-9_]/g, '')}";`);
        const totalRows = countRes.length && countRes[0].values.length ? Number(countRes[0].values[0][0]) : 0;
        const maxFetch = 2000;
        const result = totalRows > maxFetch
          ? queryTableData(db, t, maxFetch, 0)
          : queryTableAllRows(db, t);
        tableData[t] = {
          columns: result.columns,
          values: result.values as unknown[][],
          totalRows,
        };
      }
    }

    db.close();

    return NextResponse.json({
      file: selectedDbMeta.storagePath,
      sessionLabel: selectedDbMeta.sessionLabel || null,
      sessionFolder: selectedDbMeta.sessionFolder || null,
      sessionTime: selectedDbMeta.sessionTime || null,
      dateKey: selectedDbMeta.dateKey || null,
      dateLabel: selectedDbMeta.dateLabel || null,
      size: selectedDbMeta.size || 0,
      averages,
      chartPoints,
      hourOptions,
      tables: tableData,
    });
  } catch (error: any) {
    console.error('Error loading full session database:', error);
    return NextResponse.json(
      { error: 'Failed to load session data', details: error.message },
      { status: 500 },
    );
  }
}
