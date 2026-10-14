import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, verifySessionToken } from '@/lib/auth';
import { list } from '@vercel/blob';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Video Proxy Route
 * Proxies Vercel Blob video streams so the browser receives proper
 * Content-Type, Content-Length, Accept-Ranges, and Range headers needed
 * for HTML5 <video> seeking and playback to work correctly.
 */
export async function GET(req: NextRequest) {
  // Auth check
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const pathname = searchParams.get('pathname');

  if (!pathname) {
    return NextResponse.json({ error: 'Missing pathname parameter' }, { status: 400 });
  }

  try {
    // Lookup the blob URL by pathname
    const { blobs } = await list({ prefix: 'videos/' });
    const blob = blobs.find(
      (b) =>
        b.pathname === `videos/${pathname}` || b.pathname.endsWith(`/${pathname}`)
    );

    if (!blob) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Forward the Range header from the browser request (critical for video seeking)
    const rangeHeader = req.headers.get('range');
    const fetchHeaders: HeadersInit = {};
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader;
    }

    const upstream = await fetch(blob.url, { headers: fetchHeaders });

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', 'video/mp4');
    responseHeaders.set('Accept-Ranges', 'bytes');
    responseHeaders.set('Cache-Control', 'public, max-age=3600');

    // Forward Content-Length and Content-Range if present
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    if (contentLength) responseHeaders.set('Content-Length', contentLength);
    if (contentRange) responseHeaders.set('Content-Range', contentRange);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error('[video-proxy] Error:', error);
    return NextResponse.json({ error: 'Proxy error', details: error.message }, { status: 500 });
  }
}
