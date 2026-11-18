import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { AUTH_COOKIE_NAME, getSession, isAdmin } from '@/lib/auth';
import { getArchiveDir } from '@/lib/data-archive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = getSession(req.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden: administrators only' }, { status: 403 });
  }

  const rawFile = req.nextUrl.searchParams.get('file') || '';
  const safeFile = path.basename(rawFile);
  if (!safeFile || !safeFile.toLowerCase().endsWith('.sql')) {
    return NextResponse.json({ error: 'Valid .sql archive filename is required.' }, { status: 400 });
  }

  const archiveDir = getArchiveDir();
  const fullPath = path.join(archiveDir, safeFile);
  if (!fs.existsSync(fullPath)) {
    return NextResponse.json({ error: 'Archive SQL file not found.' }, { status: 404 });
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'application/sql; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFile}"`,
      'Cache-Control': 'no-store',
    },
  });
}
