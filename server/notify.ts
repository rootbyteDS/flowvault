/**
 * Core-Seite des Notification-Dienstes (services/notify):
 *
 * 1. `/mobile/v1/*` – Endpunkte für die Android-App (Gerätetoken `fv_app_…`, kein Login-Cookie,
 *    kein CORS, IP-Drossel wie bei `/mcp`, inkl. Streaming-Weiterleitung für SSE `/stream`).
 * 2. `/api/notify/*` – Verwaltung aus der FlowVault-Oberfläche (hinter requireAuth + CSRF).
 * 3. `emitNotify` – fehlertolerante Ereignis-Übergabe an `services/notify/v1/ingest`.
 */
import http from 'node:http';
import type { Request, Response } from 'express';
import { NOTIFY_TOKEN } from './internal.ts';
import { addressKey, createLoginThrottle } from './auth.ts';
import { requestT } from '../shared/i18n/server.ts';
import type { ChangeSummary } from '../shared/diff.ts';
import type { NotifyIngestPayload } from '../shared/notify.ts';

export const NOTIFY_PORT = Number(process.env.NOTIFY_PORT ?? 4300);
export const NOTIFY_URL = (process.env.NOTIFY_URL ?? `http://127.0.0.1:${NOTIFY_PORT}`).replace(/\/+$/, '');

const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const throttle = createLoginThrottle({ limit: 10, globalLimit: 1000 });

const FORWARD_REQ = ['authorization', 'content-type', 'accept', 'accept-language', 'last-event-id'];
const FORWARD_RES = ['content-type', 'www-authenticate', 'allow', 'cache-control'];

function externalOrigin(req: Request): string {
  const proto = TRUST_PROXY && typeof req.headers['x-forwarded-proto'] === 'string'
    ? req.headers['x-forwarded-proto'].split(',')[0]!.trim()
    : req.protocol || 'http';
  const host = (TRUST_PROXY && typeof req.headers['x-forwarded-host'] === 'string'
    ? req.headers['x-forwarded-host'].split(',')[0]!.trim()
    : req.headers.host) || '127.0.0.1:4000';
  return `${proto}://${host}`;
}

/** Streamt GET /mobile/v1/stream (SSE) direkt vom Notify-Dienst ohne Zwischenpufferung. */
function proxySse(req: Request, res: Response, key: string) {
  req.setTimeout(0);
  res.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true, 20_000);
  const target = new URL(`${NOTIFY_URL}/mobile/v1${req.url}`);
  const headers: Record<string, string> = { 'X-Internal-Token': NOTIFY_TOKEN };
  for (const h of FORWARD_REQ) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h] as string;

  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers,
    },
    (up) => {
      const status = up.statusCode ?? 502;
      if (status === 401) throttle.failed(key);
      else if (status >= 200 && status < 300) throttle.succeeded(key);
      res.status(status);
      const ct = up.headers['content-type'];
      if (ct) res.setHeader('Content-Type', ct);
      if (status === 200) {
        res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
      }
      res.socket?.setNoDelay(true);
      res.flushHeaders?.();
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.status(503).json({ error: requestT(req)('errors.notify.unavailable') });
    else res.end();
  });
  req.on('close', () => upstream.destroy());
  upstream.end();
}

export function createMobileEndpoint(clientIp: (req: Request) => string) {
  return async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const key = addressKey(clientIp(req));
    const wait = throttle.wait(key);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      return void res.status(429).json({ error: requestT(req)('errors.auth.throttled', { seconds: wait }) });
    }
    if (req.method === 'GET' && req.path === '/stream') {
      return void proxySse(req, res, key);
    }

    const headers: Record<string, string> = { 'X-Internal-Token': NOTIFY_TOKEN };
    for (const h of FORWARD_REQ) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h] as string;
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined;
    try {
      const r = await fetch(`${NOTIFY_URL}/mobile/v1${req.url}`, {
        method: req.method,
        headers,
        body: hasBody ? JSON.stringify(req.body) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      if (r.status === 401) throttle.failed(key);
      else if (r.ok) throttle.succeeded(key);
      for (const h of FORWARD_RES) {
        const v = r.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      res.status(r.status).send(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.status(503).json({ error: requestT(req)('errors.notify.unavailable') });
    }
  };
}

/** Leitet /api/notify/* an die Verwaltung des Notify-Dienstes weiter. Muss nach requireAuth eingehängt werden. */
export async function notifyAdminProxy(req: Request, res: Response) {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const write = req.method !== 'GET' && req.method !== 'HEAD';
  try {
    const r = await fetch(`${NOTIFY_URL}/v1/admin${req.path === '/' ? '' : req.path}${query}`, {
      method: req.method,
      headers: {
        'X-Internal-Token': NOTIFY_TOKEN,
        'X-FlowVault-Origin': externalOrigin(req),
        Accept: 'application/json',
        'Accept-Language': String(req.headers['accept-language'] ?? ''),
        ...(write ? { 'Content-Type': 'application/json' } : {}),
      },
      body: write ? JSON.stringify(req.body ?? {}) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    res.status(r.status).type('application/json').send((await r.text()) || '{}');
  } catch {
    res.status(503).json({ error: requestT(req)('errors.notify.unavailable'), unavailable: true });
  }
}

/** Übergibt ein Ereignis fehlertolerant (fire-and-forget) an den Notify-Dienst. */
export function emitNotify(payload: NotifyIngestPayload) {
  if (process.env.NOTIFY_DISABLED === '1') return;
  void fetch(`${NOTIFY_URL}/v1/ingest`, {
    method: 'POST',
    headers: { 'X-Internal-Token': NOTIFY_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'manual',
    signal: AbortSignal.timeout(2_000),
  }).catch(() => {});
}

/** Kurzer, sprachneutral-lesbarer Text aus einer ChangeSummary für Messenger-Karten. */
export function describeChangeSummary(s: ChangeSummary): string {
  const parts: string[] = [];
  if (s.activeChanged !== undefined) parts.push(s.activeChanged ? 'Aktiviert' : 'Deaktiviert');
  if (s.nameChanged) parts.push(`Umbenannt: „${s.nameChanged.from}“ → „${s.nameChanged.to}“`);
  if (s.added.length) parts.push(`+${s.added.length} Node${s.added.length === 1 ? '' : 's'} (${s.added.slice(0, 3).join(', ')})`);
  if (s.modified.length) parts.push(`~${s.modified.length} geändert (${s.modified.slice(0, 3).join(', ')})`);
  if (s.removed.length) parts.push(`-${s.removed.length} entfernt (${s.removed.slice(0, 3).join(', ')})`);
  if (s.renamed.length) parts.push(`${s.renamed.length} umbenannt`);
  if (s.connectionsAdded || s.connectionsRemoved) {
    parts.push(`Verbindungen +${s.connectionsAdded}/-${s.connectionsRemoved}`);
  }
  if (s.settingsChanged) parts.push('Einstellungen geändert');
  if (s.tagsChanged) parts.push('Tags geändert');
  if (!parts.length && s.moved.length) parts.push(`Layout angepasst (${s.moved.length} Nodes)`);
  if (!parts.length) parts.push(`${s.nodeCount} Nodes`);
  return parts.join(' · ');
}
