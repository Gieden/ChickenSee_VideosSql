import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { AUTH_COOKIE_NAME, getSession, isAdmin } from '@/lib/auth';
import { listArchiveFilesAsync, readArchiveSqlFileContent, restoreDataFromSql } from '@/lib/data-archive';
import { clearBehaviorResultsCache } from '@/lib/behavior-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = getSession(req.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden: administrators only' }, { status: 403 });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    let fileName = '';
    let sqlContent = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const uploaded = formData.get('file');
      if (!uploaded || typeof uploaded === 'string') {
        return NextResponse.json({ error: 'Please attach a valid .sql archive file.' }, { status: 400 });
      }
      fileName = uploaded.name || '';
      sqlContent = await uploaded.text();
    } else {
      const body = await req.json();
      fileName = String(body?.fileName ?? '').trim();
      sqlContent = typeof body?.sqlContent === 'string' ? body.sqlContent : '';

      // If restoring an existing file from the Archive/ folder by fileName alone
      if (fileName && !sqlContent) {
        const safeName = path.basename(fileName);
        const fetchedContent = await readArchiveSqlFileContent(safeName);
        if (!fetchedContent) {
          return NextResponse.json({ error: `Archive file "${safeName}" not found in Archive folder.` }, { status: 404 });
        }
        fileName = safeName;
        sqlContent = fetchedContent;
      }
    }

    if (!fileName || !sqlContent.trim()) {
      return NextResponse.json(
        { error: 'Both a dated .sql filename and SQL content are required to restore data.' },
        { status: 400 },
      );
    }

    const result = await restoreDataFromSql({
      fileName,
      sqlContent,
      restoredBy: session.username,
    });

    clearBehaviorResultsCache();

    const updated = await listArchiveFilesAsync();

    return NextResponse.json({
      success: true,
      restoredDates: result.restoredDates,
      restoredMetricsRows: result.restoredMetricsRows,
      restoredBirdRows: result.restoredBirdRows,
      archive: result.archive,
      archivedDates: updated.archivedDates,
      files: updated.files,
    });
  } catch (error) {
    console.error('Failed to restore SQL archive:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to restore data from SQL file' },
      { status: 400 },
    );
  }
}
