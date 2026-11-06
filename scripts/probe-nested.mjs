// Probe the Supabase Storage bucket listing using the sync API (via Vercel) is not needed —
// instead use the agent's sync secret to confirm which session folders exist.
import dotenv from 'dotenv';
dotenv.config({ path: 'agent/.env' });
const SYNC_URL = process.env.VERCEL_SYNC_URL;
const SYNC_SECRET = process.env.SYNC_SECRET;

// The sync route only issues upload URLs, but its response confirms the naming scheme.
// For listing, we instead check whether the *deployed* code sees folders by calling the
// viewer API with the `file` param pointing at a nested path.
const BASE = 'https://chicken-see-videos-sql-git-main-giedens-projects.vercel.app';
const login = await fetch(`${BASE}/api/auth`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin@gmail.com', password: '@admin_123' }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

const nested = 'databases/rec_2026-11-05_10-09-13_763336/sensors.sqlite';
const res = await fetch(`${BASE}/api/database?file=${encodeURIComponent(nested)}`, { headers: { cookie } });
const data = await res.json().catch(() => null);
if (data) {
  console.log('currentFile:', data.currentFile);
  console.log('tables:', data.tables);
} else {
  console.log('status', res.status, (await res.text()).slice(0, 300));
}
console.log('sync url env:', SYNC_URL ? 'present' : 'missing', '| secret:', SYNC_SECRET ? 'present' : 'missing');
