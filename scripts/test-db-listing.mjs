// Diagnostic: log in and call /api/database to see what the viewer actually receives.
const BASE = process.env.TEST_BASE || 'http://localhost:3000';

const login = await fetch(`${BASE}/api/auth`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin@gmail.com', password: '@admin_123' }),
});
console.log('login status:', login.status);
const setCookie = login.headers.get('set-cookie') || '';
const token = /([^=]+)=[^;]+/.exec(setCookie)?.[1];
const cookie = setCookie.split(';')[0];
console.log('cookie name:', token, 'present:', Boolean(cookie));

const res = await fetch(`${BASE}/api/database`, { headers: { cookie } });
const data = await res.json();
console.log('api status:', res.status);
console.log('databases:', (data.databases || []).map((d) => `${d.storagePath} (${d.size}b) label=${d.sessionLabel || '-'}`));
console.log('currentFile:', data.currentFile);
console.log('tables:', data.tables);
console.log('selectedTable:', data.selectedTable);
if (data.queryResult) {
  console.log('columns:', data.queryResult.columns);
  console.log('totalRows:', data.queryResult.totalRows);
  console.log('sample row:', JSON.stringify(data.queryResult.values[0]));
}
