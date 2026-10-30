 import jwt from 'jsonwebtoken';

export default async function run(page, ui) {
  const results = {};
  const base = 'http://localhost:3111';

  // Forge a *real* staff token signed with the same secret the server uses.
  const token = jwt.sign(
    { sub: 'staff.juan', username: 'staff.juan', name: 'Juan Staff', role: 'staff' },
    'test-jwt-secret-1234567890',
    { expiresIn: '1h' },
  );

  await page.context().addCookies([{
    name: 'chickensee_auth_session',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
  }]);

  // Staff CAN open the dashboard
  const response = await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  results.dashboardStatus = response ? response.status() : null;
  results.url = page.url();

  await page.waitForTimeout(4000);
  results.headerText = await page.evaluate(() => document.body.innerText.slice(0, 200));
  results.navTabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('nav button')).map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim()),
  );
  results.staffTabVisible = await page.getByRole('button', { name: /Staff Accounts/i }).isVisible().catch(() => false);

  // Staff is blocked from admin-only routes/APIs
  results.adminPage = await page.request.get(`${base}/admin`, { maxRedirects: 0 }).then((r) => r.status()).catch(() => 'err');
  results.adminPageUrl = await page.evaluate(async () => {
    const r = await fetch('/admin', { redirect: 'manual' });
    return { status: r.status, type: r.type };
  });
  results.adminApi = await page.evaluate(async () => {
    const r = await fetch('/api/admin/accounts');
    const t = await r.text();
    return { status: r.status, body: t.slice(0, 120) };
  });

  // Session identity as seen by the app
  results.session = await page.evaluate(async () => (await fetch('/api/auth')).json());

  return results;
}
