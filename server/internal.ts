/**
 * Schnittstelle zwischen Core und Zusatzdiensten (derzeit: Health-Dienst unter services/health).
 *
 * 1. `/internal/*` – schmale, nur lesende API für Dienste. Geschützt mit INTERNAL_TOKEN.
 *    API-Keys verlassen den Core nie: Ausführungen holt der Core selbst bei n8n ab und
 *    gibt sie ohne Laufzeitdaten weiter.
 * 2. `/api/health/*` – Weiterleitung aus dem Browser an den Health-Dienst. Login und
 *    CSRF-Schutz prüft vorher der Core wie bei jedem anderen API-Aufruf.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { db, DATA_DIR } from './db.ts';
import { safeEqual } from './crypto.ts';
import { clientFor, getInstance } from './sync.ts';
import { HttpError, requestT } from '../shared/i18n/server.ts';
import { packError } from '../shared/i18n/index.ts';

export const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? 4100);
export const HEALTH_URL = (process.env.HEALTH_URL ?? `http://127.0.0.1:${HEALTH_PORT}`).replace(/\/+$/, '');

/** Gemeinsames Geheimnis mit den Diensten. Ohne INTERNAL_TOKEN (lokale Entwicklung) als Datei in DATA_DIR. */
function loadToken(): string {
  if (process.env.INTERNAL_TOKEN) return process.env.INTERNAL_TOKEN;
  const file = path.join(DATA_DIR, 'internal.token');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('base64url'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}
const TOKEN = loadToken();
export const INTERNAL_TOKEN = TOKEN;

function requireToken(req: Request, res: Response, next: NextFunction) {
  const given = req.headers['x-internal-token'];
  if (typeof given === 'string' && safeEqual(given, TOKEN)) return next();
  res.status(401).json({ error: requestT(req)('errors.http.internalToken') });
}

const id = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, 'errors.http.invalidId');
  return n;
};

interface TimelineRow {
  workflow_id: number;
  instance_id: number;
  n8n_id: string;
  name: string;
  deleted_at: number | null;
  version_id: number;
  number: number;
  n8n_version_id: string | null;
  n8n_updated_at: string | null;
  created_at: number;
}

export interface WorkflowTimeline {
  workflowId: number;
  instanceId: number;
  n8nId: string;
  name: string;
  deleted: boolean;
  versions: { id: number; number: number; n8nVersionId: string | null; n8nUpdatedAt: string | null; createdAt: number }[];
}

function timelines(where: string, param: number): WorkflowTimeline[] {
  const rows = db
    .prepare(
      `SELECT w.id AS workflow_id, w.instance_id, w.n8n_id, w.name, w.deleted_at,
              v.id AS version_id, v.number, v.n8n_version_id, v.n8n_updated_at, v.created_at
         FROM workflows w JOIN versions v ON v.workflow_id = w.id
        WHERE ${where} ORDER BY w.id, v.number`,
    )
    .all(param) as unknown as TimelineRow[];
  const out = new Map<number, WorkflowTimeline>();
  for (const r of rows) {
    let t = out.get(r.workflow_id);
    if (!t) {
      t = { workflowId: r.workflow_id, instanceId: r.instance_id, n8nId: r.n8n_id, name: r.name, deleted: !!r.deleted_at, versions: [] };
      out.set(r.workflow_id, t);
    }
    t.versions.push({ id: r.version_id, number: r.number, n8nVersionId: r.n8n_version_id, n8nUpdatedAt: r.n8n_updated_at, createdAt: r.created_at });
  }
  return [...out.values()];
}

export const internalRouter = express.Router();
internalRouter.use(requireToken);

internalRouter.get('/instances', (_req, res) => {
  res.json(db.prepare('SELECT id, name, color, enabled FROM instances ORDER BY id').all());
});

/** Eine Seite Ausführungen einer Instanz, ohne Laufzeitdaten. */
internalRouter.get('/instances/:id/executions', async (req, res) => {
  const inst = getInstance(id(req.params.id));
  if (!inst) return void res.status(404).json({ error: requestT(req)('errors.instance.notFound') });
  const includeData = req.query.includeData === 'true';
  const status = typeof req.query.status === 'string' && /^[a-z]+$/.test(req.query.status) ? req.query.status : undefined;
  const limit = Math.max(1, Math.min(includeData ? 100 : 250, Number(req.query.limit) || 100));
  try {
    const page = await clientFor(inst).listExecutions({
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit,
      status,
      includeData,
    });
    res.json(page);
  } catch (e) {
    // Der Health-Dienst speichert die Meldung – übersetzbar, damit sie in jeder Sprache lesbar bleibt
    res.status(502).json({ error: packError(e) });
  }
});

/** Versionen mit Zeitpunkten – daraus berechnet der Health-Dienst, welche Version wann lief. */
internalRouter.get('/instances/:id/timeline', (req, res) => {
  res.json(timelines('w.instance_id = ?', id(req.params.id)));
});

internalRouter.get('/workflows/:id/timeline', (req, res) => {
  const t = timelines('w.id = ?', id(req.params.id))[0];
  if (!t) return void res.status(404).json({ error: requestT(req)('errors.workflow.notFound') });
  const inst = getInstance(t.instanceId);
  res.json({ ...t, instanceName: inst?.name ?? '' });
});

internalRouter.use((req, res) => {
  res.status(404).json({ error: requestT(req)('errors.http.unknownInternalEndpoint') });
});

/** Leitet /api/health/* an den Health-Dienst weiter. Muss nach requireAuth eingehängt werden. */
export async function healthProxy(req: Request, res: Response) {
  const target = `${HEALTH_URL}/v1${req.path}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
  const write = req.method !== 'GET' && req.method !== 'HEAD';
  try {
    const r = await fetch(target, {
      method: req.method,
      headers: { 'X-Internal-Token': TOKEN, Accept: 'application/json', 'Accept-Language': String(req.headers['accept-language'] ?? ''), ...(write ? { 'Content-Type': 'application/json' } : {}) },
      body: write ? JSON.stringify(req.body ?? {}) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await r.text();
    res.status(r.status).type('application/json').send(text || '{}');
  } catch {
    res.status(503).json({ error: requestT(req)('errors.http.healthUnavailable'), unavailable: true });
  }
}
