// Verify what the deployed Vercel site actually serves vs. what the local code would serve.
const BASE = 'https://chicken-see-videos-sql-git-main-giedens-projects.vercel.app';
const login = await fetch(`${BASE}/api/auth`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin@gmail.com', password: '@admin_123' }),
});
console.log('login:', login.status);
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const res = await fetch(`${BASE}/api/database`, { headers: { cookie } });
const text = await res.text();
console.log('db api status:', res.status);
try {
  const data = JSON.parse(text);
  console.log('databases count:', (data.databases || []).length);
  for (const d of data.databases || []) {
    console.log(' -', d.storagePath, d.size, 'label:', d.sessionLabel || '(none)');
  }
} catch {
  console.log('non-JSON response (first 400 chars):', text.slice(0, 400));
}
