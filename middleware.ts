import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME } from './lib/auth-shared';

/**
 * Middleware runs on the Edge runtime, where Node's `jsonwebtoken` (which relies on
 * `crypto`/`Buffer`) cannot be bundled reliably. Sessions are therefore decoded
 * locally with the Web Crypto API instead of importing `lib/auth`, which is used by
 * the Node-runtime route handlers.
 *
 * NOTE: this only decides whether a token is well-formed. Every API route still
 * performs the cryptographic verification with `getSession()` before returning data.
 */
const JWT_SECRET = process.env.JWT_SECRET || 'default-fallback-dev-secret-key-12345';

type MiddlewareSession = { username: string; role: 'admin' | 'staff' };

function base64UrlToString(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Decode (not verify) the session cookie payload. Returns null when unusable/expired. */
function readSessionPayload(token: string | undefined): MiddlewareSession | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const raw = base64UrlToString(parts[1]);
  if (!raw) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return null;

  const username = String(payload.username || payload.sub || payload.user || '');
  if (!username) return null;

  return { username, role: payload.role === 'staff' ? 'staff' : 'admin' };
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static files, favicons, login page, and sync API endpoint
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.') ||
    pathname.startsWith('/icon.') ||
    pathname.startsWith('/apple-touch-icon') ||
    pathname.startsWith('/apple-icon') ||
    pathname.startsWith('/logo.') ||
    /\.(?:png|jpg|jpeg|gif|webp|ico|svg)$/i.test(pathname) ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/detect-sample') ||
    pathname.startsWith('/api/sync') ||
    pathname === '/api/queue' ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/sensors') ||
    pathname.startsWith('/api/auth')
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = readSessionPayload(token);

  // If no valid auth token, redirect to login
  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only areas: staff users are sent back to the dashboard.
  if (pathname.startsWith('/admin') && session.role !== 'admin') {
    return NextResponse.redirect(new URL('/?tab=results', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.png|icon.png|apple-touch-icon.png|logo.png).*)'],
};
