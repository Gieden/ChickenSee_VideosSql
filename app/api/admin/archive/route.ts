import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';
import { AUTH_COOKIE_NAME, getSession, isAdmin } from '@/lib/auth';
import {
  ArchiveScope,
  archiveDataByScope,
  listArchiveFiles,
} from '@/lib/data-archive';
import { listSyncedDatabases } from '@/lib/supabase-storage';
import { DEFAULT_SAMPLE_INTERVALS } from '@/components/BehaviorResultsTab';
import { normalizeIsoDate } from '@/lib/date-range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireAdmin(req: NextRequest) {
  const session = getSession(req.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!isAdmin(session)) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Forbidden: administrators only' }, { status: 403 }),
    };
  }
  return { session, response: null };
}

export async function GET(req: NextRequest) {
  const { response } = requireAdmin(req);
  if (response) return response;

  try {
    const archiveState = listArchiveFiles();
    const syncedDbs = await listSyncedDatabases({ includeArchived: false });
    const dbDates = syncedDbs.map((d) => d.dateKey).filter((d): d is string => Boolean(d));
    const sampleDates = DEFAULT_SAMPLE_INTERVALS.map((i) => i.date);

    // Also include all dates recorded in analytics/zampen_analytics.db
    const analyticsDates: string[] = [];
    const analyticsDbPath = path.join(process.cwd(), 'analytics', 'zampen_analytics.db');
    if (fs.existsSync(analyticsDbPath)) {
      try {
        const SQL = await initSqlJs();
        const db = new SQL.Database(fs.readFileSync(analyticsDbPath));
        try {
          const res = db.exec('SELECT DISTINCT substr(date_slot, 1, 10) FROM half_hour_metrics ORDER BY date_slot DESC');
          const rows = res?.[0]?.values || [];
          for (const r of rows) {
            const norm = normalizeIsoDate(String(r[0] || ''));
            if (norm) analyticsDates.push(norm);
          }
        } finally {
          db.close();
        }
      } catch {
        // ignore if analytics db cannot be queried
      }
    }

    const archivedSet = new Set(archiveState.archivedDates);

    const activeDates = Array.from(new Set([...dbDates, ...analyticsDates, ...sampleDates]))
      .filter((d) => !archivedSet.has(d))
      .sort()
      .reverse();

    return NextResponse.json({
      success: true,
      archiveFolder: archiveState.archiveFolder,
      archivedDates: archiveState.archivedDates,
      activeDates,
      files: archiveState.files,
    });
  } catch (error) {
    console.error('Failed to list archives:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list archives' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const { session, response } = requireAdmin(req);
  if (response) return response;

  try {
    const body = await req.json();
    const rawScope = String(body?.scope ?? '');
    if (!['1d', '7d', '30d'].includes(rawScope)) {
      return NextResponse.json(
        { error: 'Invalid scope. Must be "1d" (Entire Day), "7d" (Entire 7 Days), or "30d" (Entire 30 Days).' },
        { status: 400 },
      );
    }

    const scope = rawScope as ArchiveScope;
    const referenceDate = body?.referenceDate ? String(body.referenceDate) : null;

    const result = await archiveDataByScope({
      scope,
      referenceDate,
      createdBy: session!.username,
    });

    const updated = listArchiveFiles();

    return NextResponse.json({
      success: true,
      archive: result.archive,
      sqlPreview: result.sqlPreview,
      archivedDates: updated.archivedDates,
      files: updated.files,
    });
  } catch (error) {
    console.error('Failed to archive data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to archive data' },
      { status: 500 },
    );
  }
}
