import { NextRequest, NextResponse } from 'next/server';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { put } from '@vercel/blob';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function saveLocalResultBuffer(filename: string, buffer: Buffer): void {
  const dirs = [
    '/tmp/results',
    path.join(process.cwd(), 'data', 'results'),
  ];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, filename), buffer);
    } catch {
      // Ignore directory write error
    }
  }
}

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

    if (!ext || !['mp4', 'sqlite', 'db', 'json'].includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type: .${ext}. Only .mp4, .sqlite, .db, and analysis .json files are allowed.` },
        { status: 400 }
      );
    }

    if (filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') {
      return NextResponse.json({ error: 'Filename must not contain a path' }, { status: 400 });
    }

    const folder = ext === 'mp4' ? 'videos' : ext === 'json' ? 'results' : 'databases';
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

    // If it's a JSON file (behavior result or queue status), cache locally first
    if (ext === 'json') {
      saveLocalResultBuffer(filename, buffer);
    }

    const defaultContentType = ext === 'mp4'
      ? 'video/mp4'
      : ext === 'json'
        ? 'application/json'
        : 'application/x-sqlite3';
    const contentType = req.headers.get('content-type') || defaultContentType;

    // Attempt upload to Vercel Blob
    try {
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
    } catch (blobError: any) {
      console.warn(`Vercel Blob put failed for ${filename}:`, blobError.message);

      // If it's a JSON file that was saved to server cache, return 200 with fallback notice
      if (ext === 'json') {
        return NextResponse.json({
          success: true,
          cached: true,
          message: `File cached on server (${blobError.message})`,
          pathname: `results/${filename}`,
        });
      }

      throw blobError;
    }
  } catch (error: any) {
    console.error('Error during file sync to Vercel Blob:', error);
    return NextResponse.json(
      { error: 'Internal Server Error during upload', details: error.message },
      { status: 500 }
    );
  }
}
