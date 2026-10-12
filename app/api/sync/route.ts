import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

// Disable default body parser if needed, Next.js App Router Request is a ReadableStream by default!
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const syncSecret = req.headers.get('x-sync-secret');
    const expectedSecret = process.env.SYNC_SECRET;

    if (!expectedSecret || syncSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized: Invalid sync secret' }, { status: 401 });
    }

    const rawFilename = req.headers.get('x-filename');
    if (!rawFilename) {
      return NextResponse.json({ error: 'Missing x-filename header' }, { status: 400 });
    }

    const filename = decodeURIComponent(rawFilename);
    const ext = filename.split('.').pop()?.toLowerCase();

    if (!ext || !['mp4', 'sqlite', 'db'].includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type: .${ext}. Only .mp4, .sqlite, and .db are allowed.` },
        { status: 400 }
      );
    }

    if (!req.body) {
      return NextResponse.json({ error: 'Empty file payload' }, { status: 400 });
    }

    // Determine blob folder path
    const folder = ext === 'mp4' ? 'videos' : 'databases';
    const blobPath = `${folder}/${filename}`;
    const contentType = req.headers.get('content-type') || (ext === 'mp4' ? 'video/mp4' : 'application/x-sqlite3');

    // Stream directly into Vercel Blob Storage
    const blob = await put(blobPath, req.body, {
      access: 'public',
      addRandomSuffix: false, // Maintain stable path for overwrites/updates
      contentType,
    });

    return NextResponse.json({
      success: true,
      message: `File synced successfully: ${filename}`,
      pathname: blob.pathname,
      url: blob.url,
      downloadUrl: blob.downloadUrl,
    });
  } catch (error: any) {
    console.error('Error during file sync to Vercel Blob:', error);
    return NextResponse.json(
      { error: 'Internal Server Error during upload', details: error.message },
      { status: 500 }
    );
  }
}
