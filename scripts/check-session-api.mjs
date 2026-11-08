// Simulate the fixed listSyncedDatabases logic directly against Supabase Storage,
// using the service-role key fetched from the deployed sync endpoint trick is not
// possible — instead verify via the deployed session API (which has the key).
const BASE = 'https://chicken-see-videos-sql-git-main-giedens-projects.vercel.app';
const login = await fetch(`${BASE}/api/auth`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin@gmail.com', password: '@admin_123' }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

// Test the new session modal endpoint against a nested session database
const file = 'databases/rec_2026-11-05_10-09-13_763336/sensors.sqlite';
const res = await fetch(`${BASE}/api/database/session?file=${encodeURIComponent(file)}`, { headers: { cookie } });
const text = await res.text();
console.log('session api status:', res.status);
try {
  const data = JSON.parse(text);
  console.log('file:', data.file);
  console.log('tables:', Object.keys(data.tables || {}));
  for (const [t, d] of Object.entries(data.tables || {})) {
    console.log(` - ${t}: ${d.totalRows} rows, columns: ${(d.columns || []).join(', ')}`);
  }
  const sl = data.tables?.sensor_logs;
  if (sl?.values?.length) console.log('first sensor row:', JSON.stringify(sl.values[0]));
} catch {
  console.log('non-JSON:', text.slice(0, 300));
}
