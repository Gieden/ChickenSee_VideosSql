import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, verifySessionToken } from '@/lib/auth';
import { downloadStorageFile, listSyncedDatabases, SyncedFileMeta } from '@/lib/supabase-storage';
import {
  openDatabaseFromBytes,
  getDatabaseTables,
  queryTableData,
  calculateSensorAverages,
  SensorAverages,
} from '@/lib/db-viewer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// In-memory cache for sensor averages so repeated listing is instant
const averagesCache = new Map<string, { averages: SensorAverages; size: number }>();

export interface DateGroupedSensors {
  dateKey: string;
  dateLabel: string;
  fileCount: number;
  totalReadings: number;
  files: Array<SyncedFileMeta & { averages: SensorAverages }>;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const targetFile = searchParams.get('file');
  const targetTable = searchParams.get('table');
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  // 1. Directory/File Filtering: Only sensors.sqlite files
  const rawDatabases = await listSyncedDatabases();
  const databases = rawDatabases.filter((d) => d.pathname.toLowerCase() === 'sensors.sqlite');

  if (!databases.length) {
    return NextResponse.json({
      databases: [],
      groupedByDate: [],
      overview: {
        totalFiles: 0,
        totalReadings: 0,
        avgTemperature: null,
        avgHumidity: null,
        avgAmmoniaPpm: null,
        avgSoundDb: null,
      },
      currentFile: null,
      tables: [],
      selectedTable: null,
      queryResult: null,
    });
  }

  // 2. Dashboard Aggregation: Calculate average values for each sensors.sqlite file
  const enrichedFiles: Array<SyncedFileMeta & { averages: SensorAverages }> = [];
  for (const dbMeta of databases) {
    const cacheKey = `${dbMeta.storagePath}:${dbMeta.size}`;
    let avg = averagesCache.get(cacheKey)?.averages;

    if (!avg) {
      try {
        const content = await downloadStorageFile(dbMeta.storagePath);
        const db = await openDatabaseFromBytes(await content.arrayBuffer());
        avg = calculateSensorAverages(db);
        db.close();
        averagesCache.set(cacheKey, { averages: avg, size: dbMeta.size });
      } catch {
        avg = {
          totalReadings: 0,
          avgTemperature: null,
          avgHumidity: null,
          avgAmmoniaPpm: null,
          avgSoundDb: null,
          minTemperature: null,
          maxTemperature: null,
          minHumidity: null,
          maxHumidity: null,
          minAmmoniaPpm: null,
          maxAmmoniaPpm: null,
          minSoundDb: null,
          maxSoundDb: null,
          thi: null,
          durationSeconds: null,
          frameCount: null,
          videoFile: null,
          startedAt: null,
          endedAt: null,
        };
      }
    }

    enrichedFiles.push({
      ...dbMeta,
      averages: avg,
    });
  }

  // 3. Organize by date: Multiple sensors.sqlite files grouped under a single date
  const groupsMap = new Map<string, { dateKey: string; dateLabel: string; files: Array<SyncedFileMeta & { averages: SensorAverages }> }>();
  for (const file of enrichedFiles) {
    const key = file.dateKey || 'unknown';
    const label = file.dateLabel || 'Unspecified Date';
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        dateKey: key,
        dateLabel: label,
        files: [],
      });
    }
    groupsMap.get(key)!.files.push(file);
  }

  const groupedByDate: DateGroupedSensors[] = Array.from(groupsMap.values()).map((g) => ({
    dateKey: g.dateKey,
    dateLabel: g.dateLabel,
    fileCount: g.files.length,
    totalReadings: g.files.reduce((sum, f) => sum + (f.averages?.totalReadings || 0), 0),
    files: g.files,
  }));

  // Sort groups descending by dateKey
  groupedByDate.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  // Compute overall global averages across all listed files
  let sumReadings = 0;
  let weightedTemp = 0;
  let weightedHum = 0;
  let weightedNh3 = 0;
  let weightedSnd = 0;

  for (const f of enrichedFiles) {
    const count = f.averages?.totalReadings || 0;
    if (count > 0 && f.averages.avgTemperature !== null) {
      sumReadings += count;
      weightedTemp += f.averages.avgTemperature * count;
      weightedHum += (f.averages.avgHumidity || 0) * count;
      weightedNh3 += (f.averages.avgAmmoniaPpm || 0) * count;
      weightedSnd += (f.averages.avgSoundDb || 0) * count;
    }
  }

  const overview = {
    totalFiles: enrichedFiles.length,
    totalReadings: sumReadings,
    avgTemperature: sumReadings > 0 ? Number((weightedTemp / sumReadings).toFixed(1)) : null,
    avgHumidity: sumReadings > 0 ? Number((weightedHum / sumReadings).toFixed(1)) : null,
    avgAmmoniaPpm: sumReadings > 0 ? Number((weightedNh3 / sumReadings).toFixed(5)) : null,
    avgSoundDb: sumReadings > 0 ? Number((weightedSnd / sumReadings).toFixed(1)) : null,
  };

  // 4. Select active database for fallback/legacy raw query preview
  const selectedDbMeta = targetFile
    ? databases.find((d) => d.storagePath === targetFile || d.pathname === targetFile) || databases[0]
    : databases[0];

  let tables: string[] = [];
  const tableCounts: Record<string, number> = {};
  let queryResult = null;
  let recordingSummary: any = null;
  let activeTable = targetTable || null;

  try {
    const content = await downloadStorageFile(selectedDbMeta.storagePath);
    const db = await openDatabaseFromBytes(await content.arrayBuffer());
    tables = getDatabaseTables(db);

    for (const t of tables) {
      try {
        const sanitized = t.replace(/[^a-zA-Z0-9_]/g, '');
        const cRes = db.exec(`SELECT COUNT(*) FROM "${sanitized}";`);
        tableCounts[t] = cRes.length && cRes[0].values.length ? Number(cRes[0].values[0][0]) : 0;
      } catch {
        tableCounts[t] = 0;
      }
    }

    let defaultTable = tables[0] || null;
    if (tables.includes('sensor_logs')) {
      defaultTable = 'sensor_logs';
    } else if (tables.includes('recording')) {
      defaultTable = 'recording';
    }
    activeTable = targetTable && tables.includes(targetTable) ? targetTable : defaultTable;

    if (activeTable) {
      queryResult = queryTableData(db, activeTable, limit, offset);
    }

    if (tables.includes('recording')) {
      try {
        const recRes = db.exec('SELECT video_file, started_at, ended_at, frame_count, duration_seconds FROM recording LIMIT 1;');
        if (recRes.length && recRes[0].values.length) {
          const row = recRes[0].values[0];
          recordingSummary = {
            videoFile: String(row[0] || 'video.mp4'),
            startedAt: row[1] ? String(row[1]) : null,
            endedAt: row[2] ? String(row[2]) : null,
            frameCount: typeof row[3] === 'number' ? row[3] : Number(row[3]) || null,
            durationSeconds: typeof row[4] === 'number' ? row[4] : Number(row[4]) || null,
          };
        }
      } catch {
        // ignore
      }
    }

    db.close();
  } catch (err: any) {
    console.warn('[API WARN] Could not query active table rows:', err?.message);
  }

  return NextResponse.json({
    databases: enrichedFiles,
    groupedByDate,
    overview,
    currentFile: selectedDbMeta.storagePath,
    tables,
    tableCounts,
    selectedTable: activeTable,
    recordingSummary,
    queryResult,
    pagination: {
      limit,
      offset,
    },
  });
}
