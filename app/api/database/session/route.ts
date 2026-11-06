import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, verifySessionToken } from '@/lib/auth';
import { downloadStorageFile, listSyncedDatabases } from '@/lib/supabase-storage';
import { openDatabaseFromBytes, getDatabaseTables, queryTableAllRows } from '@/lib/db-viewer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/database/session?file=<storagePath>
 *
 * Returns ALL rows (no pagination) of every table in the requested session
 * database, so the SQLite Data Viewer modal can display the full sensor data
 * contained in that recording session.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const targetFile = new URL(req.url).searchParams.get('file');
  if (!targetFile) {
    return NextResponse.json({ error: 'Missing "file" query parameter' }, { status: 400 });
  }

  const databases = await listSyncedDatabases();
  const selectedDbMeta = databases.find(
    (d) => d.storagePath === targetFile || d.pathname === targetFile,
  );
  if (!selectedDbMeta) {
    return NextResponse.json({ error: `Database not found: ${targetFile}` }, { status: 404 });
  }

  try {
    const content = await downloadStorageFile(selectedDbMeta.storagePath);
    const db = await openDatabaseFromBytes(await content.arrayBuffer());
    const tables = getDatabaseTables(db);

    const tableData: Record<string, { columns: string[]; values: unknown[][]; totalRows: number }> = {};
    for (const t of tables) {
      const result = queryTableAllRows(db, t);
      tableData[t] = {
        columns: result.columns,
        values: result.values as unknown[][],
        totalRows: result.totalRows,
      };
    }

    db.close();

    return NextResponse.json({
      file: selectedDbMeta.storagePath,
      sessionLabel: selectedDbMeta.sessionLabel || null,
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
