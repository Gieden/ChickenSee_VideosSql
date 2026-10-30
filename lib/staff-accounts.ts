import { downloadStorageFile, deleteStorageFiles, uploadStorageFile } from './supabase-storage';
import { hashPassword, verifyPasswordHash } from './auth';

/**
 * Staff accounts are persisted as a single JSON document inside the private Supabase
 * Storage bucket. The Next.js app runs on serverless functions (Vercel), so the
 * filesystem is read-only/ephemeral — Storage is the only durable place available.
 */
export const STAFF_ACCOUNTS_STORAGE_PATH = 'auth/staff-accounts.json';

export interface StaffAccount {
  id: string;
  username: string;
  display_name: string;
  role: 'staff' | 'admin';
  password_hash: string;
  created_at: string;
  created_by: string;
}

export type PublicStaffAccount = Omit<StaffAccount, 'password_hash'>;

interface StaffAccountsFile {
  accounts: StaffAccount[];
}

export class StaffAccountError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'StaffAccountError';
  }
}

function toPublic(account: StaffAccount): PublicStaffAccount {
  const { password_hash: _hash, ...rest } = account;
  return rest;
}

async function readAccountsFile(): Promise<StaffAccountsFile> {
  try {
    const blob = await downloadStorageFile(STAFF_ACCOUNTS_STORAGE_PATH);
    const text = await blob.text();
    const parsed = JSON.parse(text) as StaffAccountsFile;
    if (!parsed || !Array.isArray(parsed.accounts)) return { accounts: [] };
    return { accounts: parsed.accounts };
  } catch (error) {
    // Missing object (404) simply means no staff accounts have been created yet.
    const statusCode = (error as { statusCode?: number | null }).statusCode;
    if (statusCode === 404 || (error instanceof Error && /not found/i.test(error.message))) {
      return { accounts: [] };
    }
    // Fall back to an empty list if the bucket/object cannot be read at all.
    return { accounts: [] };
  }
}

async function writeAccountsFile(file: StaffAccountsFile): Promise<void> {
  const body = JSON.stringify({ accounts: file.accounts }, null, 2);
  await uploadStorageFile(STAFF_ACCOUNTS_STORAGE_PATH, body, 'application/json');
}

export async function listStaffAccounts(): Promise<PublicStaffAccount[]> {
  const file = await readAccountsFile();
  return file.accounts
    .map(toPublic)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export interface AuthenticatedStaff extends PublicStaffAccount { }

/** Check a staff username/password pair against the stored accounts. */
export async function authenticateStaff(
  username: string,
  password: string,
): Promise<AuthenticatedStaff | null> {
  const file = await readAccountsFile();
  const normalized = username.trim().toLowerCase();
  const account = file.accounts.find((entry) => entry.username.toLowerCase() === normalized);
  if (!account) return null;
  if (!verifyPasswordHash(password, account.password_hash)) return null;
  return toPublic(account);
}

export interface CreateStaffInput {
  username: string;
  password: string;
  displayName?: string;
  role?: 'staff' | 'admin';
  createdBy: string;
}

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;

export async function createStaffAccount(input: CreateStaffInput): Promise<PublicStaffAccount> {
  const username = (input.username || '').trim();
  const password = input.password || '';
  const displayName = (input.displayName || '').trim() || username;
  const role = input.role === 'admin' ? 'admin' : 'staff';

  if (!USERNAME_PATTERN.test(username)) {
    throw new StaffAccountError(
      'Username must be 3-32 characters and may only contain letters, numbers, dots, underscores or hyphens.',
      400,
    );
  }
  if (password.length < 6) {
    throw new StaffAccountError('Password must be at least 6 characters long.', 400);
  }

  const file = await readAccountsFile();
  const normalized = username.toLowerCase();

  if (file.accounts.some((entry) => entry.username.toLowerCase() === normalized)) {
    throw new StaffAccountError(`An account named "${username}" already exists.`, 409);
  }
  if (normalized === (process.env.DASHBOARD_USERNAME || 'admin').trim().toLowerCase()) {
    throw new StaffAccountError('That username is reserved for the administrator.', 409);
  }

  const account: StaffAccount = {
    id: `staff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    username,
    display_name: displayName,
    role,
    password_hash: hashPassword(password),
    created_at: new Date().toISOString(),
    created_by: input.createdBy,
  };

  file.accounts.push(account);
  await writeAccountsFile(file);
  return toPublic(account);
}

export async function deleteStaffAccount(id: string): Promise<boolean> {
  const file = await readAccountsFile();
  const next = file.accounts.filter((entry) => entry.id !== id);
  if (next.length === file.accounts.length) return false;
  file.accounts = next;
  await writeAccountsFile(file);
  return true;
}

export async function updateStaffPassword(id: string, newPassword: string): Promise<boolean> {
  if (!newPassword || newPassword.length < 6) {
    throw new StaffAccountError('Password must be at least 6 characters long.', 400);
  }
  const file = await readAccountsFile();
  const account = file.accounts.find((entry) => entry.id === id);
  if (!account) return false;
  account.password_hash = hashPassword(newPassword);
  await writeAccountsFile(file);
  return true;
}

/** Remove every staff account (used for tests/maintenance). */
export async function clearStaffAccounts(): Promise<void> {
  await deleteStorageFiles([STAFF_ACCOUNTS_STORAGE_PATH]);
}
