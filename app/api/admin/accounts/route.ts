import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, getSession, isAdmin } from '@/lib/auth';
import {
  createStaffAccount,
  deleteStaffAccount,
  listStaffAccounts,
  updateStaffPassword,
  StaffAccountError,
} from '@/lib/staff-accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Resolve the caller and enforce the admin role. */
function requireAdmin(req: NextRequest) {
  const session = getSession(req.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!isAdmin(session)) {
    return { session: null, response: NextResponse.json({ error: 'Forbidden: administrators only' }, { status: 403 }) };
  }
  return { session, response: null };
}

export async function GET(req: NextRequest) {
  const { response } = requireAdmin(req);
  if (response) return response;

  try {
    const accounts = await listStaffAccounts();
    return NextResponse.json({ accounts });
  } catch (error) {
    console.error('Failed to list staff accounts:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list staff accounts' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const { session, response } = requireAdmin(req);
  if (response) return response;

  try {
    const body = await req.json();
    const account = await createStaffAccount({
      username: String(body?.username ?? ''),
      password: String(body?.password ?? ''),
      displayName: body?.displayName ? String(body.displayName) : undefined,
      role: ['staff', 'admin'].includes(String(body?.role ?? '')) ? String(body.role) as 'staff' | 'admin' : undefined,
      createdBy: session!.username,
    });
    return NextResponse.json({ success: true, account }, { status: 201 });
  } catch (error) {
    if (error instanceof StaffAccountError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to create staff account:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create staff account' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const { response } = requireAdmin(req);
  if (response) return response;

  try {
    const body = await req.json();
    const id = String(body?.id ?? '');
    const password = String(body?.password ?? '');
    if (!id) {
      return NextResponse.json({ error: 'Account id is required.' }, { status: 400 });
    }
    const updated = await updateStaffPassword(id, password);
    if (!updated) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof StaffAccountError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Failed to update staff account:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update staff account' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { response } = requireAdmin(req);
  if (response) return response;

  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Account id is required.' }, { status: 400 });
    }
    const removed = await deleteStaffAccount(id);
    if (!removed) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete staff account:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete staff account' },
      { status: 500 },
    );
  }
}
