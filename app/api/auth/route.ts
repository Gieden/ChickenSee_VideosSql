import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_COOKIE_NAME,
  createSessionToken,
  getSession,
  isMasterAdminUsername,
  verifyMasterAdminPassword,
  type SessionUser,
} from '@/lib/auth';
import { authenticateStaff } from '@/lib/staff-accounts';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = String(body?.username ?? '').trim();
    const password = String(body?.password ?? '');

    // Backward compatibility: a password-only request is treated as the master admin.
    if (!username && password && verifyMasterAdminPassword(password)) {
      return issueSession({
        username: (process.env.DASHBOARD_USERNAME || 'admin').trim() || 'admin',
        name: 'Administrator',
        role: 'admin',
      });
    }

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    }

    let user: SessionUser | null = null;

    if (isMasterAdminUsername(username)) {
      if (verifyMasterAdminPassword(password)) {
        user = {
          username: (process.env.DASHBOARD_USERNAME || 'admin').trim() || 'admin',
          name: 'Administrator',
          role: 'admin',
        };
      }
    } else {
      const staff = await authenticateStaff(username, password);
      if (staff) {
        user = { username: staff.username, name: staff.display_name, role: 'staff' };
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Incorrect username or password' }, { status: 401 });
    }

    return issueSession(user);
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

function issueSession(user: SessionUser) {
  const token = createSessionToken(user);
  const response = NextResponse.json({
    success: true,
    message: 'Authenticated successfully',
    user,
  });

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  return response;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const session = getSession(token);
  if (!session) {
    return NextResponse.json({ authenticated: false, user: null });
  }
  return NextResponse.json({
    authenticated: true,
    user: { username: session.username, name: session.name, role: session.role },
  });
}

export async function DELETE() {
  const response = NextResponse.json({ success: true, message: 'Logged out' });
  response.cookies.delete(AUTH_COOKIE_NAME);
  return response;
}
