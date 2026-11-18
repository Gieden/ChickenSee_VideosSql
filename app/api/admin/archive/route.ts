import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';
import { AUTH_COOKIE_NAME, getSession, isAdmin, verifyMasterAdminPassword } from '@/lib/auth';
import { authenticateStaff } from '@/lib/staff-accounts';
import {
  ArchiveScope,
  archiveDataByScope,
  listArchiveFilesAsync,
} from '@/lib/data-archive';
import { listSyncedDatabases } from '@/lib/supabase-storage';
import { DEFAULT_SAMPLE_INTERVALS } from '@/lib/default-telemetry';
import { normalizeIsoDate } from '@/lib/date-range';
import { clearBehaviorResultsCache } from '@/lib/behavior-cache';

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

async function discoverActiveDates(archivedSet: Set<string>): Promise<string[]> {
  const syncedDbs = await listSyncedDatabases({ includeArchived: false });
  const dbDates = syncedDbs.map((d) => d.dateKey).filter((d): d is string => Boolean(d));
  const sampleDates = DEFAULT_SAMPLE_INTERVALS.map((i) => i.date);

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

  const queueDates: string[] = [];
  const queueSnapPath = path.join(process.cwd(), 'data', 'results', 'queue_status.json');
  if (fs.existsSync(queueSnapPath)) {
    try {
      const snap = JSON.parse(fs.readFileSync(queueSnapPath, 'utf-8'));
      if (Array.isArray(snap?.items)) {
        for (const item of snap.items) {
          const rawD = String(item?.completed_at || item?.created_at || '').slice(0, 10);
          const norm = normalizeIsoDate(rawD);
          if (norm) queueDates.push(norm);
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(new Set([...dbDates, ...analyticsDates, ...queueDates, ...sampleDates]))
    .filter((d) => !archivedSet.has(d))
    .sort()
    .reverse();
}

export async function GET(req: NextRequest) {
  const { response } = requireAdmin(req);
  if (response) return response;

  try {
    const archiveState = await listArchiveFilesAsync();
    const archivedSet = new Set(archiveState.archivedDates);
    const activeDates = await discoverActiveDates(archivedSet);

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
    if (!['1d', '7d', '30d', 'all'].includes(rawScope)) {
      return NextResponse.json(
        { error: 'Invalid scope. Must be "1d", "7d", "30d", or "all".' },
        { status: 400 },
      );
    }

    const scope = rawScope as ArchiveScope;
    const referenceDate = body?.referenceDate ? String(body.referenceDate) : null;
    const adminPassword = typeof body?.adminPassword === 'string' ? body.adminPassword : '';

    // Verify admin password when wiping all data (or whenever password confirmation is supplied)
    if (scope === 'all' || adminPassword !== '') {
      if (!adminPassword) {
        return NextResponse.json(
          { error: 'Please enter your administrator password to confirm this action.' },
          { status: 403 },
        );
      }
      const isValidMaster = verifyMasterAdminPassword(adminPassword);
      const staffMatch = !isValidMaster
        ? await authenticateStaff(session!.username, adminPassword)
        : null;
      if (!isValidMaster && !staffMatch) {
        return NextResponse.json(
          { error: 'Incorrect administrator password. Data wipe & archive was cancelled.' },
          { status: 403 },
        );
      }
    }

    const archiveState = await listArchiveFilesAsync();
    const activeDates = await discoverActiveDates(new Set(archiveState.archivedDates));

    const result = await archiveDataByScope({
      scope,
      referenceDate,
      allActiveDates: activeDates,
      createdBy: session!.username,
    });

    clearBehaviorResultsCache();

    const updated = await listArchiveFilesAsync();

    // Prevent oversized responses if full archive SQL exceeds 2MB; frontend falls back to /api/admin/archive/download
    const safeSqlContent = result.sqlContent && result.sqlContent.length <= 2 * 1024 * 1024
      ? result.sqlContent
      : '';

    return NextResponse.json({
      success: true,
      archive: result.archive,
      sqlPreview: result.sqlPreview,
      sqlContent: safeSqlContent,
      archivedDates: updated.archivedDates,
      activeDates: await discoverActiveDates(new Set(updated.archivedDates)),
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
