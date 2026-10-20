import { NextRequest, NextResponse } from 'next/server';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { put } from '@vercel/blob';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const syncSecret = req.headers.get('x-sync-secret')?.trim();
    const expectedSecret = process.env.SYNC_SECRET?.trim();

    if (!expectedSecret) {
      return NextResponse.json({ error: 'Server configuration error: SYNC_SECRET is not set in Vercel environment variables' }, { status: 500 });
    }

    if (syncSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized: Invalid sync secret' }, { status: 401 });
    }

    const rawFilename = req.headers.get('x-filename');
    if (!rawFilename) {
      return NextResponse.json({ error: 'Missing x-filename header' }, { status: 400 });
    }

    const filename = decodeURIComponent(rawFilename);
    const ext = filename.split('.').pop()?.toLowerCase();

    if (!ext || !['sqlite', 'db', 'json'].includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type: .${ext}. Only .sqlite, .db, and analysis .json files are allowed.` },
        { status: 400 }
      );
    }

    if (filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') {
      return NextResponse.json({ error: 'Filename must not contain a path' }, { status: 400 });
    }

    const folder = ext === 'json' ? 'results' : 'databases';
    const blobPath = `${folder}/${filename}`;

    // Mode 1: Request an upload token (used for large files like 256MB videos to bypass Vercel 4.5MB limit)
    const isTokenRequest = req.headers.get('x-action') === 'get-upload-token';
    if (isTokenRequest) {
      const clientToken = await generateClientTokenFromReadWriteToken({
        pathname: blobPath,
        validUntil: Date.now() + 3600 * 1000, // 1 hour
      });

      return NextResponse.json({
        success: true,
        blobPath,
        clientToken,
      });
    }

    // Mode 2: Direct streaming body fallback (works for small files < 4.5MB)
    const arrayBuffer = await req.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'Empty file payload' }, { status: 400 });
    }

    const buffer = Buffer.from(arrayBuffer);

    const defaultContentType = ext === 'json' ? 'application/json' : 'application/x-sqlite3';
    const contentType = req.headers.get('content-type') || defaultContentType;

    const blob = await put(blobPath, buffer, {
      access: 'public',
      addRandomSuffix: false,
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
