/**
 * FlowVault Health – verknüpft Versionen mit n8n-Ausführungen:
 * Fehlerquote pro Version, scheiternde Nodes, Warnung mit Rollback-Vorschlag.
 *
 * Eigenständiger Dienst mit eigener Datenbank. Spricht nur mit dem Core
 * (interne API, Token-geschützt), nie direkt mit n8n oder dem Browser.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { db, getSettings, saveSettings } from './db.ts';
import { CoreError, internalToken } from './core.ts';
import { listAlerts, refreshOpenAlerts, workflowHealth } from './evaluate.ts';
import { pollAll, startScheduler } from './poller.ts';
import type { HealthStatus } from '../../shared/executions.ts';
import crypto from 'node:crypto';
import { HttpError, requestT, t } from '../../shared/i18n/server.ts';
import { renderError } from '../../shared/i18n/index.ts';
import { createExecutionHistoryRouter } from './history.ts';

const PORT = Number(process.env.HEALTH_PORT ?? 4100);
const HOST = process.env.HEALTH_HOST ?? '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Für Docker-Healthchecks, ohne Token
app.get('/healthz', (_req, res) => res.json({ ok: true }));

function sameToken(given: unknown) {
  if (typeof given !== 'string') return false;
  let expected: string;
  try {
    expected = internalToken();
  } catch {
    return false;
  }
  const h = (s: string) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

app.use('/v1', (req, res, next) => {
  if (sameToken(req.headers['x-internal-token'])) return next();
  res.status(401).json({ error: requestT(req)('errors.http.internalToken') });
});

const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, 'errors.http.invalidId');
  return n;
};

app.get('/v1/status', (_req, res) => {
  const instances = db
    .prepare(
      `SELECT p.instance_id, p.name, p.last_poll_at, p.ok, p.error,
              (SELECT COUNT(*) FROM executions e WHERE e.instance_id = p.instance_id) AS executions
         FROM poll_state p ORDER BY p.name COLLATE NOCASE`,
    )
    .all() as { instance_id: number; name: string; last_poll_at: number | null; ok: number | null; error: string | null; executions: number }[];
  const open = db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE status = 'open'").get() as { n: number };
  const out: HealthStatus = {
    settings: getSettings(),
    instances: instances.map((i) => ({
      instanceId: i.instance_id,
      name: i.name,
      lastPollAt: i.last_poll_at,
      ok: i.ok === null ? null : !!i.ok,
      error: i.error,
      executions: i.executions,
    })),
    openAlerts: open.n,
  };
  res.json(out);
});

app.get('/v1/settings', (_req, res) => res.json(getSettings()));
app.use('/v1', createExecutionHistoryRouter(db, getSettings));

app.put('/v1/settings', (req, res) => {
  const s = saveSettings(req.body ?? {});
  res.json(s);
});

app.post('/v1/poll', async (_req, res) => {
  await pollAll(true);
  res.json({ ok: true });
});

app.get('/v1/workflows/:id', async (req, res) => {
  res.json(await workflowHealth(num(req.params.id)));
});

app.get('/v1/alerts', async (req, res) => {
  const status = String(req.query.status ?? 'open');
  if (!['open', 'dismissed', 'resolved', 'all'].includes(status)) throw new HttpError(400, 'errors.http.invalidStatus');
  if (status === 'open' || status === 'all') await refreshOpenAlerts();
  res.json(listAlerts(status));
});

app.post('/v1/alerts/:id/dismiss', (req, res) => {
  db.prepare("UPDATE alerts SET status = 'dismissed', updated_at = ? WHERE id = ?").run(Date.now(), num(req.params.id));
  res.json({ ok: true });
});

app.use((req, res) => {
  res.status(404).json({ error: requestT(req)('errors.http.unknownEndpoint') });
});

app.use((err: Error & { status?: number }, req: Request, res: Response, _next: NextFunction) => {
  // Fehler aus dem Core (z. B. Workflow nicht gefunden) mit passendem Status durchreichen
  const status = err instanceof CoreError ? (err.status === 404 ? 404 : 502) : (err.status || 500);
  if (status >= 500) console.error(err);
  const tr = requestT(req);
  res.status(status).json({ error: status >= 500 && !(err instanceof CoreError) ? tr('errors.http.internal') : renderError(err, tr) });
});

app.listen(PORT, HOST, (err?: Error) => {
  if (err) {
    console.error(`  ${t('log.healthCannotListen', { address: `${HOST}:${PORT}`, reason: err.message })}`);
    process.exit(1);
  }
  console.log(`  ${t('log.healthListening', { url: `http://${HOST}:${PORT}` })}`);
  startScheduler();
});

// Vom Core gestartet: mit ihm zusammen beenden, auch wenn er hart abgeschossen wurde
if (process.send) process.on('disconnect', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
