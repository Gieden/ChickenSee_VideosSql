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
  const selectedDbMeta = databases.find(
    (d) => d.storagePath === targetFile || d.pathname === targetFile || d.localPath === targetFile,
  ) || {
    url: '',
    pathname: 'sensors.sqlite',
    storagePath: targetFile,
    size: 0,
    uploadedAt: new Date().toISOString(),
  };

  try {
    const content = await downloadStorageFile(selectedDbMeta.storagePath);
    const db = await openDatabaseFromBytes(await content.arrayBuffer());
    const tables = getDatabaseTables(db);

    // 1. Calculate sensor averages & summary metadata
    const averages = calculateSensorAverages(db, hourRange);

    // 2. Query downsampled telemetry points for the dynamic chart
    const chartPoints = queryDownsampledSensorData(db, 150, hourRange);
    const hourOptions = hourRange ? null : querySensorHourOptions(db, timeZone);

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
