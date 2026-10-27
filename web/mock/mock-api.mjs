// Minimal stand-in for the Ticketing API on http://localhost:5080 so the SPA can run without
// the backend (`npm run start:mock`, then `npm start`). Implements only the foundation contract:
// auth (cookie session + XSRF), /me, /me/flags, /me/notifications and the projects list/detail.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_API_PORT ?? 5080);
const ADMIN = {
  id: '0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f',
  email: process.env.TICKETING_BOOTSTRAP_ADMIN_EMAIL ?? 'admin@ticketing.local',
  displayName: 'Ada Admin',
  globalRole: 'Admin',
};
const PASSWORD = process.env.TICKETING_BOOTSTRAP_ADMIN_PASSWORD ?? 'ChangeMe-Admin-2026!';
const PROJECTS = [
  { key: 'PAY', name: 'Payments', visibility: 'Private', myRole: 'Owner', openTicketCount: 42 },
  { key: 'ONB', name: 'Onboarding', visibility: 'Public', myRole: 'Member', openTicketCount: 17 },
  { key: 'CORE', name: 'Core Platform', visibility: 'Public', myRole: null, openTicketCount: 8 },
].map((p, i) => ({ id: `0190f5e2-0000-7000-8000-00000000000${i}`, archivedAt: null, ...p }));
const ANN = {
  id: '0190f5e2-7c1a-7b3e-9d4f-00000000a001',
  email: 'ann@ticketing.local',
  displayName: 'Ann Lee',
  isActive: true,
};
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const notification = (n, kind, summary, minutes, extra = {}) => ({
  id: `0190f5e2-0000-7000-9000-00000000000${n}`,
  kind,
  summary,
  eventCount: 1,
  actor: ANN,
  projectKey: 'PAY',
  ticket: { key: `PAY-${n}`, title: `Payment ticket ${n}`, deleted: false },
  regression: null,
  url: `/tickets/PAY-${n}`,
  createdAt: minutesAgo(minutes),
  updatedAt: minutesAgo(minutes),
  readAt: null,
  ...extra,
});
const NOTIFICATIONS = [
  notification(1, 'StatusChanged', 'changed the status from In progress to Review', 3, {
    eventCount: 3,
  }),
  notification(2, 'Assigned', 'assigned the ticket to you', 50),
  notification(3, 'Deleted', 'deleted the ticket', 60 * 20, {
    ticket: { key: 'PAY-3', title: 'Old refund flow', deleted: true },
  }),
  notification(
    4,
    'RegressionItemAssigned',
    'assigned you PAY-TC-12 in PAY-R-3 (Release 1.5)',
    60 * 30,
    {
      ticket: null,
      regression: { sessionKey: 'PAY-R-3', sessionName: 'Release 1.5', testCaseKey: 'PAY-TC-12' },
      url: '/projects/PAY/regressions/PAY-R-3?item=PAY-TC-12',
    },
  ),
  notification(5, 'Commented', 'commented', 60 * 80, { readAt: minutesAgo(60 * 70) }),
];
const unreadCount = () => NOTIFICATIONS.filter((n) => !n.readAt).length;

const sessions = new Set();

const cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k]) => k),
  );

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};

const problem = (res, status, code, title, errors) =>
  send(
    res,
    status,
    { type: `https://ticketing/errors/${code}`, title, status, code, errors },
    {
      'Content-Type': 'application/problem+json',
    },
  );

const xsrfCookie = () => `XSRF-TOKEN=${randomBytes(16).toString('hex')}; Path=/; SameSite=Lax`;

const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const jar = cookies(req);
  const signedIn = sessions.has(jar.tkt_session);
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET');

  if (path.startsWith('/health')) return send(res, 200, { status: 'Healthy' });
  if (unsafe && req.headers['x-xsrf-token'] !== jar['XSRF-TOKEN']) {
    return problem(res, 400, 'xsrf.invalid', 'The anti-forgery token is missing or invalid.');
  }

  if (path === '/api/v1/auth/csrf')
    return send(res, 204, undefined, { 'Set-Cookie': xsrfCookie() });
  if (path === '/api/v1/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (String(body.email).toLowerCase() !== ADMIN.email || body.password !== PASSWORD) {
      return problem(res, 401, 'auth.invalidCredentials', 'Email or password is incorrect.');
    }
    const session = randomBytes(16).toString('hex');
    sessions.add(session);
    return send(res, 200, ADMIN, {
      'Set-Cookie': [`tkt_session=${session}; Path=/; HttpOnly; SameSite=Lax`, xsrfCookie()],
    });
  }
  if (path === '/api/v1/auth/logout' && req.method === 'POST') {
    sessions.delete(jar.tkt_session);
    return send(res, 204, undefined, {
      'Set-Cookie': ['tkt_session=; Path=/; Max-Age=0', xsrfCookie()],
    });
  }

  if (!signedIn) return problem(res, 401, 'auth.unauthenticated', 'Not signed in.');
  if (path === '/api/v1/me') return send(res, 200, ADMIN);
  if (path === '/api/v1/me/flags') return send(res, 200, { flags: { 'board.swimlanes': 'off' } });
  if (path === '/api/v1/me/notifications/unread-count')
    return send(res, 200, { count: unreadCount() });
  if (path === '/api/v1/me/notifications') {
    const unread = url.searchParams.get('unread') === 'true';
    const items = NOTIFICATIONS.filter((n) => !unread || !n.readAt);
    return send(res, 200, { items, nextCursor: null });
  }
  if (path === '/api/v1/me/notifications/read' && req.method === 'POST') {
    const body = await readBody(req);
    const ids = new Set(body.ids ?? []);
    for (const n of NOTIFICATIONS) {
      if ((body.all || ids.has(n.id)) && !n.readAt) n.readAt = new Date().toISOString();
    }
    return send(res, 200, { unreadCount: unreadCount() });
  }
  if (path === '/api/v1/projects') return send(res, 200, { items: PROJECTS, nextCursor: null });
  const match = path.match(/^\/api\/v1\/projects\/([^/]+)$/);
  if (match) {
    const project = PROJECTS.find((p) => p.key === match[1].toUpperCase());
    if (!project) return problem(res, 404, 'project.notFound', 'Project not found.');
    return send(res, 200, {
      ...project,
      description: null,
      createdAt: '2026-10-01T09:00:00Z',
      members: [],
      rowVersion: 1,
    });
  }
  return problem(res, 404, 'notFound', 'Not found.');
}).listen(PORT, () => console.log(`Mock Ticketing API on http://localhost:${PORT}`));
