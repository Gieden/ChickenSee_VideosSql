import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, verifySessionToken } from '@/lib/auth';
import { downloadStorageFile, listSyncedDatabases } from '@/lib/supabase-storage';
import { openDatabaseFromBytes, getDatabaseTables, queryTableData } from '@/lib/db-viewer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  const databases = await listSyncedDatabases();

  if (!databases.length) {
    return NextResponse.json({
      databases: [],
      currentFile: null,
      tables: [],
      selectedTable: null,
      queryResult: null,
    });
  }

  // Select specified database or fallback to the latest one.
  // The `file` param can be either a bare pathname (legacy) or a full storagePath
  // (e.g. "databases/rec_2026-10-13/sensors.sqlite") so we match against both.
  const selectedDbMeta = targetFile
    ? databases.find((d) => d.storagePath === targetFile || d.pathname === targetFile) || databases[0]
    : databases[0];

  try {
    const content = await downloadStorageFile(selectedDbMeta.storagePath);
    const db = await openDatabaseFromBytes(await content.arrayBuffer());
    const tables = getDatabaseTables(db);

    // Compute row counts for each table
    const tableCounts: Record<string, number> = {};
    for (const t of tables) {
      try {
        const sanitized = t.replace(/[^a-zA-Z0-9_]/g, '');
        const cRes = db.exec(`SELECT COUNT(*) FROM "${sanitized}";`);
        tableCounts[t] = cRes.length && cRes[0].values.length ? Number(cRes[0].values[0][0]) : 0;
      } catch {
        tableCounts[t] = 0;
      }
    }

    // Default to 'sensor_logs' first so the user sees telemetry data immediately,
    // not just the 1-row metadata in 'recording'
    let defaultTable = tables[0] || null;
    if (tables.includes('sensor_logs')) {
      defaultTable = 'sensor_logs';
    } else if (tables.includes('recording')) {
      defaultTable = 'recording';
    }
    const activeTable = targetTable && tables.includes(targetTable) ? targetTable : defaultTable;

    let queryResult = null;
    if (activeTable) {
      queryResult = queryTableData(db, activeTable, limit, offset);
    }

    // Extract recording metadata summary if available
    let recordingSummary: any = null;
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

    return NextResponse.json({
      databases,
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
  } catch (error: any) {
    console.error('Error querying SQLite database:', error);
    return NextResponse.json(
      { error: 'Failed to inspect SQLite database', details: error.message },
      { status: 500 }
    );
  }
}
