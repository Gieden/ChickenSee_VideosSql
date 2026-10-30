import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import jwt from 'jsonwebtoken';
import { AUTH_COOKIE_NAME } from './auth-shared';

export { AUTH_COOKIE_NAME };

export type UserRole = 'admin' | 'staff';

export interface SessionUser {
  /** Account identifier: `admin` for the master admin, otherwise the staff username. */
  username: string;
  /** Display name shown in the portal header. */
  name: string;
  role: UserRole;
}

const JWT_SECRET = process.env.JWT_SECRET || 'default-fallback-dev-secret-key-12345';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin';
const DASHBOARD_USERNAME = (process.env.DASHBOARD_USERNAME || 'admin').trim() || 'admin';

/** The single master admin account, configured through environment variables. */
export const MASTER_ADMIN: SessionUser = {
  username: DASHBOARD_USERNAME,
  name: 'Administrator',
  role: 'admin',
};

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Constant-time check of the master admin password from `DASHBOARD_PASSWORD`. */
export function verifyMasterAdminPassword(inputPassword: string): boolean {
  if (!inputPassword || !DASHBOARD_PASSWORD) return false;
  return safeEqual(inputPassword, DASHBOARD_PASSWORD);
}

export function isMasterAdminUsername(username: string | undefined | null): boolean {
  if (!username) return false;
  return username.trim().toLowerCase() === MASTER_ADMIN.username.toLowerCase();
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return `sha256$${salt}$${hash}`;
}

export function verifyPasswordHash(password: string, stored: string | null | undefined): boolean {
  if (!password || !stored) return false;
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const candidate = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return safeEqual(candidate, hash);
}

export function createSessionToken(user: SessionUser): string {
  return jwt.sign({ sub: user.username, username: user.username, name: user.name, role: user.role }, JWT_SECRET, {
    expiresIn: '7d',
  });
}

export interface SessionPayload extends SessionUser {
  exp?: number;
}

/** Verify a session cookie and return its payload, or `null` when invalid/expired. */
export function getSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    const role: UserRole = payload.role === 'staff' ? 'staff' : 'admin';
    const username = String(payload.username || payload.sub || payload.user || '');
    if (!username) return null;
    return {
      username,
      name: String(payload.name || username),
      role,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

/** Boolean session check used by API routes and middleware. */
export function verifySessionToken(token: string | undefined): boolean {
  return getSession(token) !== null;
}

export function isAdmin(session: SessionPayload | null | undefined): boolean {
  return session?.role === 'admin';
}
