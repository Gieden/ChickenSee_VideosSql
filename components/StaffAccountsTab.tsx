'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';

interface StaffAccount {
  id: string;
  username: string;
  display_name: string;
  role: 'staff' | 'admin';
  created_at: string;
  created_by: string;
}

export default function StaffAccountsTab({ currentUsername }: { currentUsername?: string }) {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<'staff' | 'admin'>('staff');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdNotice, setCreatedNotice] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      setListError(null);
      const res = await fetch('/api/admin/accounts', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        setListError('You do not have permission to manage staff accounts.');
        setAccounts([]);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load staff accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreatedNotice(null);

    if (password !== confirmPassword) {
      setCreateError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setCreateError('Password must be at least 6 characters long.');
      return;
    }

    try {
      setCreating(true);
      const res = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, displayName: displayName.trim(), role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setCreatedNotice(`${role === 'admin' ? 'Admin' : 'Staff'} account "${data.account?.username ?? username}" created.`);
      setUsername('');
      setDisplayName('');
      setPassword('');
      setConfirmPassword('');
      setRole('staff');
      await fetchAccounts();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(account: StaffAccount) {
    if (!window.confirm(`Delete the staff account "${account.username}"? This cannot be undone.`)) return;
    try {
      setBusyId(account.id);
      setRowError(null);
      const res = await fetch(`/api/admin/accounts?id=${encodeURIComponent(account.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await fetchAccounts();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not delete the account.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleResetPassword(id: string) {
    setResetNotice(null);
    setRowError(null);
    try {
      setBusyId(id);
      const res = await fetch('/api/admin/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password: resetPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResetNotice('Password updated.');
      setResetId(null);
      setResetPassword('');
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not update the password.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-orange-600">
              <ShieldCheck className="h-4 w-4" />
              Administrator Only
            </div>
            <h2 className="mt-1 text-lg font-bold text-slate-900">Staff Accounts</h2>
            <p className="mt-1 text-sm text-slate-500">
              Create and manage the staff accounts that can sign in to the ChickenSee Portal.
            </p>
          </div>
          <button
            type="button"
            onClick={fetchAccounts}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {listError && (
          <div className="mx-4 mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 sm:mx-6">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{listError}</span>
          </div>
        )}

        {/* Create form */}
        <form onSubmit={handleCreate} className="grid gap-4 border-b border-slate-100 p-4 sm:grid-cols-2 sm:p-6">
          <div>
            <label htmlFor="staff-username" className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Username
            </label>
            <input
              id="staff-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. staff.juan"
              autoComplete="off"
              spellCheck={false}
              required
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div>
            <label htmlFor="staff-display-name" className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Display Name <span className="normal-case text-slate-400">(optional)</span>
            </label>
            <input
              id="staff-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Juan Dela Cruz"
              autoComplete="off"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div>
            <label htmlFor="staff-password" className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Password
            </label>
            <input
              id="staff-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
              required
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
          </div>
          <div>
            <label htmlFor="staff-password-confirm" className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Confirm Password
            </label>
            <input
              id="staff-password-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-type password"
              autoComplete="new-password"
              required
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
          </div>

          <div>
            <label htmlFor="staff-role" className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              User Role
            </label>
            <select
              id="staff-role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'staff' | 'admin')}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            {createError && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{createError}</span>
              </div>
            )}
            {createdNotice && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{createdNotice}</span>
              </div>
            )}
            <button
              type="submit"
              disabled={creating}
              className="flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-orange-600/20 transition hover:bg-orange-700 active:scale-[0.99] disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {creating ? 'Creating account…' : 'Create Staff Account'}
            </button>
          </div>
        </form>

        {/* Existing accounts */}
        <div className="p-4 sm:p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Users className="h-4 w-4 text-slate-400" />
            <span>Staff accounts</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{accounts.length}</span>
          </div>

          {rowError && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{rowError}</span>
            </div>
          )}
          {resetNotice && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{resetNotice}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading staff accounts…
            </div>
          ) : accounts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
              No staff accounts yet. Use the form above to create one.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Username</th>
                    <th className="px-4 py-3">Display Name</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accounts.map((account) => (
                    <tr key={account.id} className="align-top hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-semibold text-slate-800">{account.username}</td>
                      <td className="px-4 py-3 text-slate-600">{account.display_name}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold border ${
                          account.role === 'admin'
                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}>
                          {account.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {account.created_at ? new Date(account.created_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {resetId === account.id ? (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <input
                              type="password"
                              value={resetPassword}
                              onChange={(e) => setResetPassword(e.target.value)}
                              placeholder="New password"
                              className="w-36 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                            />
                            <button
                              type="button"
                              disabled={busyId === account.id || resetPassword.length < 6}
                              onClick={() => handleResetPassword(account.id)}
                              className="rounded-lg bg-orange-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-700 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setResetId(null);
                                setResetPassword('');
                              }}
                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setResetId(account.id);
                                setResetPassword('');
                                setResetNotice(null);
                                setRowError(null);
                              }}
                              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              Reset
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(account)}
                              disabled={busyId === account.id || account.username === currentUsername}
                              title={account.username === currentUsername ? 'You cannot delete the account you are signed in with.' : 'Delete account'}
                              className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-40"
                            >
                              {busyId === account.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-4 text-xs text-slate-400">
            Accounts are stored in the private Supabase Storage bucket and hashed with a salted SHA-256 digest.
            Only administrators can view this page.
          </p>
        </div>
      </div>
    </div>
  );
}
