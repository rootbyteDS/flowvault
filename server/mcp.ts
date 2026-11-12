/**
 * Core-Seite des MCP-Dienstes (services/mcp):
 *
 * 1. `/mcp` – Endpunkt für Agents. Der Core reicht die Anfrage samt `Authorization` an den Dienst weiter,
 *    der das Agent-Token prüft. Fehlversuche bremst der Core je Adresse. Kein Login, kein CORS:
 *    Browser anderer Seiten dürfen keinen `Authorization`-Header mitschicken.
 * 2. `/api/mcp/*` – Verwaltung aus der Oberfläche (Ein/Aus, Tokens). Login und CSRF-Schutz prüft vorher
 *    der Core wie bei jedem anderen API-Aufruf.
 *
 * Status, `Content-Type` und Body gehen unverändert zurück: Clients nach MCP-Stand 2025 bekommen ihre
 * Antwort als `text/event-stream`.
 */
import type { Request, Response } from 'express';
import { MCP_TOKEN } from './internal.ts';
import { addressKey, createLoginThrottle } from './auth.ts';
import { requestT } from '../shared/i18n/server.ts';

export const MCP_PORT = Number(process.env.MCP_PORT ?? 4200);
export const MCP_URL = (process.env.MCP_URL ?? `http://127.0.0.1:${MCP_PORT}`).replace(/\/+$/, '');

/** Tokens sind 256 Bit lang – die Bremse hält nur Lärm und Raten im großen Stil fern. */
const throttle = createLoginThrottle({ limit: 10, globalLimit: 1000 });

const FORWARD_REQUEST = ['authorization', 'content-type', 'accept', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'];
const FORWARD_RESPONSE = ['content-type', 'mcp-protocol-version', 'mcp-session-id', 'www-authenticate', 'allow'];

export function createMcpEndpoint(clientIp: (req: Request) => string) {
  return async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const key = addressKey(clientIp(req));
    const wait = throttle.wait(key);
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      return void res.status(429).json({ error: requestT(req)('errors.auth.throttled', { seconds: wait }) });
    }
    const headers: Record<string, string> = { 'X-Internal-Token': MCP_TOKEN };
    for (const h of FORWARD_REQUEST) if (typeof req.headers[h] === 'string') headers[h] = req.headers[h] as string;
    const hasBody = req.method === 'POST' && req.body !== undefined;
    try {
      const r = await fetch(`${MCP_URL}/mcp`, {
        method: req.method,
        headers,
        body: hasBody ? JSON.stringify(req.body) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(60_000),
      });
      if (r.status === 401) throttle.failed(key);
      else if (r.ok) throttle.succeeded(key);
      for (const h of FORWARD_RESPONSE) {
        const v = r.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      res.status(r.status).send(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.status(503).json({ error: requestT(req)('errors.mcp.unavailable') });
    }
  };
}

/** Leitet /api/mcp/* an die Verwaltung des Dienstes weiter. Muss nach requireAuth eingehängt werden. */
export async function mcpAdminProxy(req: Request, res: Response) {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const write = req.method !== 'GET' && req.method !== 'HEAD';
  try {
    const r = await fetch(`${MCP_URL}/v1/admin${req.path === '/' ? '' : req.path}${query}`, {
      method: req.method,
      headers: {
        'X-Internal-Token': MCP_TOKEN,
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
    res.status(503).json({ error: requestT(req)('errors.mcp.unavailable'), unavailable: true });
  }
}
