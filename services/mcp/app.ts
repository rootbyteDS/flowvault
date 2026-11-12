/**
 * HTTP-Seite des MCP-Dienstes. Als Fabrik, damit Tests ihn ohne festen Port und mit einem
 * nachgebauten Core starten können.
 *
 * - `/mcp` – MCP über HTTP (Spezifikation 2026-07-28, Clients von 2025 zustandslos). Nur über den Core
 *   erreichbar: Der Core schickt sein MCP-Token mit, der Agent sein eigenes `fv_mcp_…`-Token.
 * - `/v1/admin/*` – Verwaltung für die Oberfläche (über den Core, nach Login).
 */
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { HttpError, requestT } from '../../shared/i18n/server.ts';
import { renderError } from '../../shared/i18n/index.ts';
import type { CoreClient } from './core.ts';
import type { Scope, Store } from './store.ts';
import { buildServer } from './tools.ts';

function sameSecret(given: unknown, expected: string) {
  if (typeof given !== 'string' || !expected) return false;
  const h = (s: string) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

export function createApp(opts: { store: Store; core: CoreClient; serviceToken: () => string; version: string }) {
  const { store, core } = opts;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Alles außer /healthz nur mit dem Token, das auch der Core kennt
  app.use((req, res, next) => {
    if (sameSecret(req.headers['x-internal-token'], opts.serviceToken())) return next();
    res.status(401).json({ error: requestT(req)('errors.http.internalToken') });
  });

  // ───────────── Verwaltung ─────────────

  app.get('/v1/admin', (_req, res) => res.json(store.state()));
  app.put('/v1/admin', (req, res) => {
    if (typeof req.body?.enabled === 'boolean') store.setEnabled(req.body.enabled);
    res.json(store.state());
  });
  app.post('/v1/admin/tokens', (req, res) => res.json(store.create(req.body ?? {})));
  app.delete('/v1/admin/tokens/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || !store.revoke(id)) throw new HttpError(404, 'errors.mcp.tokenNotFound');
    res.json({ ok: true });
  });

  // ───────────── MCP ─────────────

  const handler = createMcpHandler((ctx) => buildServer(core, ctx.authInfo?.extra as unknown as Scope, opts.version));

  app.post('/mcp', async (req, res) => {
    if (!store.enabled()) return void res.status(404).json({ error: 'MCP access is disabled in FlowVault settings' });
    const scope = store.authenticate(req.headers.authorization);
    if (!scope) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return void res.status(401).json({ error: 'Missing or invalid FlowVault MCP token' });
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && k !== 'x-internal-token' && k !== 'authorization') headers.set(k, v);
    const r = await handler.fetch(new Request('http://127.0.0.1/mcp', { method: 'POST', headers }), {
      parsedBody: req.body,
      authInfo: { token: '', clientId: scope.name, scopes: ['read'], extra: { ...scope } },
    });
    res.status(r.status);
    r.headers.forEach((v, k) => res.setHeader(k, v));
    res.send(Buffer.from(await r.arrayBuffer()));
  });
  // Kein Server-Push und keine Sitzungen: GET (SSE) und DELETE gibt es nicht
  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
  });

  app.use((req, res) => {
    res.status(404).json({ error: requestT(req)('errors.http.unknownEndpoint') });
  });

  app.use((err: Error & { status?: number; type?: string }, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    const tr = requestT(req);
    res.status(status).json({ error: status >= 500 ? tr('errors.http.internal') : renderError(err, tr) });
  });

  return app;
}
