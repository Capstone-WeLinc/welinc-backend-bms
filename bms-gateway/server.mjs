import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { LocalAuthIntegration } from './auth-integration.mjs';

const upstreams = {
  booking: process.env.BOOKING_API_URL || 'http://127.0.0.1:3002',
  dispatch: process.env.DISPATCH_API_URL || 'http://127.0.0.1:3003',
  completion: process.env.COMPLETION_API_URL || 'http://127.0.0.1:3004',
  bridge: process.env.PARTNER_BRIDGE_URL || 'http://127.0.0.1:3000',
  analytics: process.env.ANALYTICS_API_URL || 'http://127.0.0.1:3001',
};

// Keep ownership explicit. A catch-all route could silently send a BMS write to
// the old backend after its replacement has become the source of truth.
export function owner(pathname) {
  if (pathname === '/integrations/welinc/bookings' || pathname === '/integrations/wix/bookings') return 'booking';
  if (/^\/integrations\/(welinc|wix)\/(review|notifications)(\/|$)/.test(pathname)) return 'booking';
  if (/^\/bms\/config\/(booking-services|services-offered|protective-materials)(\/|$)/.test(pathname)) return 'booking';
  if (/^\/booking(\/|$)/.test(pathname)) return 'booking';
  if (/^\/approvals(\/|$)/.test(pathname)) return 'booking';
  if (/^\/public\/tracking(\/|$)/.test(pathname)) return 'booking';
  if (/^\/bms\/config\/(vehicle-availability|vehicles|drivers|helpers|garages)(\/|$)/.test(pathname)) return 'dispatch';
  if (/^\/(dispatch|scheduling|job-order)(\/|$)/.test(pathname)) return 'dispatch';
  if (/^\/(post-service|daily-sales|collections)(\/|$)/.test(pathname)) return 'completion';
  if (/^\/reports(\/|$)/.test(pathname)) return 'analytics';
  if (pathname === '/activity-logs' || pathname === '/auth/profile/activity') return 'gateway';
  if (/^\/auth(\/|$)/.test(pathname)) return 'bridge';
  return null;
}

const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'host']);
let authIntegration;

function authClient() {
  authIntegration ??= new LocalAuthIntegration({
    bridgeUrl: upstreams.bridge,
    databaseUrl: process.env.AUTH_DATABASE_URL,
    serviceKey: process.env.BMS_INTERNAL_SERVICE_KEY,
  });
  return authIntegration;
}

async function auditRows(authHeader) {
  const key = process.env.BMS_INTERNAL_SERVICE_KEY;
  if (!key || key.length < 32) return { status: 503 };
  const serviceResults = await Promise.allSettled(['booking', 'dispatch', 'completion'].map(async (name) => {
    const response = await fetch(new URL('/internal/audit', upstreams[name]), {
      headers: { 'x-bms-service-key': key }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`${name} audit unavailable`);
    return response.json();
  }));
  const serviceRows = serviceResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  return authClient().activityLogs(authHeader, serviceRows, key);
}

async function serveAudit(req, res, search) {
  try {
    const source = await auditRows(String(req.headers.authorization || ''));
    if (source.status !== 200) {
      res.writeHead(source.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Activity logs unavailable' }));
      return;
    }
    const params = new URLSearchParams(search);
    // `action` is a "|"-separated list of verbs; a row matches when its action starts with one of them.
    const verbs = String(params.get('action') || '').toLowerCase().split('|').map((verb) => verb.trim()).filter(Boolean);
    const query = String(params.get('search') || '').toLowerCase();
    const role = String(params.get('role') || '').toUpperCase();
    const from = params.get('from') ? new Date(`${params.get('from')}T00:00:00+08:00`).getTime() : -Infinity;
    const to = params.get('to') ? new Date(`${params.get('to')}T23:59:59.999+08:00`).getTime() : Infinity;
    const rows = source.rows.filter((item) => {
      const time = new Date(item.createdAt).getTime();
      return time >= from && time <= to && (!role || String(item.role || '').toUpperCase() === role) && (!verbs.length || verbs.some((verb) => String(item.action).toLowerCase().startsWith(verb))) &&
        (!query || [item.action, item.userName, item.email].some((value) => String(value).toLowerCase().includes(query)));
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const page = Math.max(1, Number(params.get('page')) || 1);
    const pageSize = params.get('pageSize') === 'all' ? rows.length || 1 : Math.min(100, Math.max(1, Number(params.get('pageSize')) || 10));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize }));
  } catch {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Activity logs unavailable' }));
  }
}

async function serveProfileActivity(req, res) {
  const result = await authClient().profileActivity(String(req.headers.authorization || ''));
  res.writeHead(result.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(result.status === 200 ? result.rows : {
    message: result.status === 401 ? 'Unauthorized' : 'Auth activity unavailable',
  }));
}

export function start(port = Number(process.env.PORT || 3005)) {
  return createServer(async (req, res) => {
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(String(req.headers['x-request-id'] || ''))
      ? String(req.headers['x-request-id']) : randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const incoming = new URL(req.url || '/', 'http://localhost');
    if (incoming.pathname === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    const path = incoming.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
    if (path === '/activity-logs') {
      if (req.method === 'GET') await serveAudit(req, res, incoming.search);
      else {
        res.writeHead(405, { 'content-type': 'application/json', allow: 'GET' });
        res.end(JSON.stringify({ message: 'Method not allowed' }));
      }
      return;
    }
    if (path === '/auth/profile/activity' && req.method === 'GET') {
      await serveProfileActivity(req, res);
      return;
    }
    const target = owner(path);
    if (!target) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'No API owner for this route' }));
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const headers = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (!hopHeaders.has(name) && value !== undefined) headers[name] = value;
      }
      headers['x-request-id'] = requestId;
      const url = new URL(path + incoming.search, upstreams[target]);
      const response = await fetch(url, {
        method: req.method,
        headers,
        body: body.length ? body : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
      });
      for (const [name, value] of response.headers) {
        if (!hopHeaders.has(name) && name !== 'content-encoding' && name !== 'content-length') res.setHeader(name, value);
      }
      res.statusCode = response.status;
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: `${target} API unavailable`, requestId }));
    }
  }).listen(port, '127.0.0.1');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const server = start();
  server.once('listening', () => console.log(`BMS gateway listening on ${server.address().port}`));
}
