'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { User, Lock, ArrowRight, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';

/* ─── Login-success transition overlay ─────────────────────────────────────── */
function LoginSuccessOverlay({ username }: { username: string }) {
  return (
    <div className="login-success-overlay fixed inset-0 z-[100] flex flex-col items-center justify-center">
      {/* Radial burst background */}
      <div className="login-success-bg absolute inset-0 bg-orange-600" />

      {/* Rings */}
      <div className="login-success-ring1 absolute h-[420px] w-[420px] rounded-full border border-white/10" />
      <div className="login-success-ring2 absolute h-[640px] w-[640px] rounded-full border border-white/10" />
      <div className="login-success-ring3 absolute h-[900px] w-[900px] rounded-full border border-white/10" />

      {/* Content */}
      <div className="login-success-content relative flex flex-col items-center gap-5 text-white">
        {/* Logo circle */}
        <div className="login-success-logo flex h-24 w-24 items-center justify-center rounded-3xl bg-white/15 backdrop-blur-sm ring-4 ring-white/20 shadow-2xl">
          <img src="/favicon.png" alt="ChickenSee" className="h-16 w-16 object-contain drop-shadow-lg" />
        </div>

        {/* Check badge */}
        <div className="login-success-check -mt-2 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-lg">
          <CheckCircle2 className="h-5 w-5 text-orange-600" />
        </div>

        <div className="login-success-text text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/70">Welcome back</p>
          <h2 className="mt-1 text-3xl font-bold tracking-tight">{username || 'Admin'}</h2>
          <p className="mt-2 text-sm text-white/60">Opening ChickenSee Portal…</p>
        </div>
      </div>

      {/* White flash layer that fires at the end */}
      <div className="login-success-flash absolute inset-0 bg-white" />

      <style>{`
        /* Overlay slides up from bottom */
        @keyframes csLoginOverlayIn {
          0%   { clip-path: circle(0% at 50% 110%); }
          100% { clip-path: circle(150% at 50% 50%); }
        }
        .login-success-overlay {
          animation: csLoginOverlayIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .login-success-bg {
          background: radial-gradient(ellipse at 50% 40%, #f97316 0%, #c2410c 100%);
        }

        /* Rings pulse out */
        @keyframes csRing {
          0%   { transform: scale(0); opacity: 0.6; }
          100% { transform: scale(1); opacity: 0; }
        }
        .login-success-ring1 { animation: csRing 1.2s 0.3s ease-out forwards; }
        .login-success-ring2 { animation: csRing 1.4s 0.45s ease-out forwards; }
        .login-success-ring3 { animation: csRing 1.6s 0.55s ease-out forwards; }

        /* Logo pops in */
        @keyframes csLogoIn {
          0%   { transform: scale(0.4) translateY(20px); opacity: 0; }
          70%  { transform: scale(1.08) translateY(0); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        .login-success-logo {
          animation: csLogoIn 0.55s 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        /* Check mark bounces in */
        @keyframes csCheckIn {
          0%   { transform: scale(0) translateY(-4px); opacity: 0; }
          80%  { transform: scale(1.2) translateY(0); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        .login-success-check {
          animation: csCheckIn 0.4s 0.75s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        /* Text fades + slides up */
        @keyframes csTextIn {
          0%   { transform: translateY(16px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        .login-success-text {
          animation: csTextIn 0.45s 0.9s ease-out both;
        }

        /* White flash at 1.4s then disappears – creates the page-transition moment */
        @keyframes csFlash {
          0%   { opacity: 0; }
          50%  { opacity: 1; }
          100% { opacity: 1; }
        }
        .login-success-flash {
          animation: csFlash 0.3s 1.55s ease-in both;
        }
      `}</style>
    </div>
  );
}

/* ─── Login form ────────────────────────────────────────────────────────────── */
function LoginForm() {
  const [username, setUsername]     = useState('');
  const [password, setPassword]     = useState('');
  const [error, setError]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [success, setSuccess]       = useState(false);   // triggers transition
  const [successName, setSuccessName] = useState('');

  const router       = useRouter();
  const searchParams = useSearchParams();
  const redirect     = searchParams.get('redirect') || '/';
  const sessionExpired = searchParams.get('reason') === 'inactivity';

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      // ── Show the success transition, then navigate after it completes ──
      const displayName = data.user?.username || username.trim();
      setSuccessName(displayName);
      setSuccess(true);

      const destination =
        data.user?.role === 'staff' && redirect.startsWith('/admin') ? '/' : redirect;

      // Navigate at 1.85 s — just after the white flash covers the screen
      setTimeout(() => {
        router.push(destination);
        router.refresh();
      }, 1_850);
    } catch (err: any) {
      setError(err.message || 'Incorrect username or password');
      setLoading(false);
    }
  }

  return (
    <>
      {/* Success transition overlay — rendered on top of everything */}
      {success && <LoginSuccessOverlay username={successName} />}

      <div className="w-full max-w-md rounded-2xl border border-orange-100 bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-orange-200/80 bg-white p-1.5 shadow-md shadow-orange-500/10">
            <img src="/favicon.png" alt="ChickenSee Logo" className="h-full w-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">ChickenSee Portal</h1>
          <p className="mt-2 text-sm text-slate-400">
            Optiplex Server Synced Storage &amp; SQLite Viewer
          </p>
        </div>

        {sessionExpired && !error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-50 p-3.5 text-sm text-amber-700">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
            <span>Your session expired due to inactivity. Please sign in again.</span>
          </div>
        )}

        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3.5 text-sm text-red-400">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label htmlFor="login-username" className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Username
            </label>
            <div className="relative mt-2">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username..."
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-slate-900 placeholder-slate-400 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Password
            </label>
            <div className="relative mt-2">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                required
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-slate-900 placeholder-slate-400 outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || success}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 font-semibold text-white shadow-lg shadow-orange-600/20 transition hover:bg-orange-700 active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Verifying...
              </span>
            ) : (
              <>
                <span>Access Dashboard</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 flex items-center justify-center gap-2 border-t border-slate-100 pt-6 text-xs text-slate-500">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span>Protected with HTTP-only session tokens</span>
        </div>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-orange-300/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-orange-200/10 rounded-full blur-3xl" />
      </div>

      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-2xl border border-orange-100 bg-white p-12 text-center shadow-xl">
            <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
            <p className="mt-4 text-xs text-slate-400">Loading portal...</p>
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
