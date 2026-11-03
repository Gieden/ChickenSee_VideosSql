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
    const activeTable = targetTable && tables.includes(targetTable) ? targetTable : tables[0] || null;

    let queryResult = null;
    if (activeTable) {
      queryResult = queryTableData(db, activeTable, limit, offset);
    }

    db.close();

    return NextResponse.json({
      databases,
      currentFile: selectedDbMeta.storagePath,
      tables,
      selectedTable: activeTable,
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
