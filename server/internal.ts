/**
 * Schnittstelle zwischen Core und Zusatzdiensten (Health-Dienst unter services/health, MCP-Dienst unter services/mcp).
 *
 * 1. `/internal/*` – schmale, nur lesende API für Dienste. Geschützt mit INTERNAL_TOKEN.
 *    API-Keys verlassen den Core nie: Ausführungen holt der Core selbst bei n8n ab und
 *    gibt sie ohne Laufzeitdaten weiter.
 *    Der MCP-Dienst hat ein eigenes Token (MCP_TOKEN) und darf damit nur die lesenden Pfade in
 *    `MCP_PATHS` aufrufen: keine Workflow-Inhalte, kein Abruf bei n8n, keine schreibenden Aufrufe.
 * 2. `/api/health/*` – Weiterleitung aus dem Browser an den Health-Dienst. Login und
 *    CSRF-Schutz prüft vorher der Core wie bei jedem anderen API-Aufruf.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { db, DATA_DIR } from './db.ts';
import { safeEqual } from './crypto.ts';
import { clientFor, getInstance, restoreVersion } from './sync.ts';
import { diagnoseWorkflowFailure } from './diagnose.ts';
import { canonicalRollbackPayload, encryptForDevice, verifyDeviceSignature } from '../shared/mobile-crypto.ts';
import { HttpError, requestT } from '../shared/i18n/server.ts';
import { packError, renderError } from '../shared/i18n/index.ts';

export const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? 4100);
export const HEALTH_URL = (process.env.HEALTH_URL ?? `http://127.0.0.1:${HEALTH_PORT}`).replace(/\/+$/, '');

/** Gemeinsames Geheimnis mit einem Dienst. Ohne Umgebungsvariable (lokale Entwicklung) als Datei in DATA_DIR. */
function loadToken(env: string | undefined, fileName: string): string {
  if (env) return env;
  const file = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('base64url'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}
const TOKEN = loadToken(process.env.INTERNAL_TOKEN, 'internal.token');
export const INTERNAL_TOKEN = TOKEN;
/** Token des MCP-Dienstes: nur lesend und nur für `MCP_PATHS`. */
export const MCP_TOKEN = loadToken(process.env.MCP_TOKEN, 'mcp.token');
if (MCP_TOKEN === TOKEN) throw new Error('MCP_TOKEN must differ from INTERNAL_TOKEN');
/** Token des Notify-Dienstes: Metadaten + Health-Warnungen ausblenden (keine Snapshots, kein n8n). */
export const NOTIFY_TOKEN = loadToken(process.env.NOTIFY_TOKEN, 'notify.token');
if (NOTIFY_TOKEN === TOKEN || NOTIFY_TOKEN === MCP_TOKEN) {
  throw new Error('NOTIFY_TOKEN must differ from INTERNAL_TOKEN and MCP_TOKEN');
}

/** Was der MCP-Dienst lesen darf. Alles andere – vor allem Ausführungen direkt aus n8n – bleibt gesperrt. */
const MCP_PATHS = [
  /^\/instances$/,
  /^\/workflows$/,
  /^\/workflows\/\d+\/timeline$/,
  /^\/activity$/,
  /^\/health\/.+$/,
];

/** Was der Notify-Dienst aufrufen darf: Metadaten, offene Alerts, E2E-Diagnose und kryptografisch signiertes Rollback. */
const NOTIFY_READ_PATHS = [
  /^\/instances$/,
  /^\/workflows$/,
  /^\/workflows\/\d+\/rollback-preview$/,
  /^\/activity$/,
  /^\/health\/alerts$/,
];
const NOTIFY_WRITE_PATHS = [
  /^\/health\/alerts\/\d+\/dismiss$/,
  /^\/actions\/diagnose$/,
  /^\/actions\/rollback$/,
];

function requireToken(req: Request, res: Response, next: NextFunction) {
  const given = req.headers['x-internal-token'];
  if (typeof given === 'string' && safeEqual(given, TOKEN)) return next();
  if (typeof given === 'string' && safeEqual(given, MCP_TOKEN)) {
    if (req.method === 'GET' && MCP_PATHS.some((re) => re.test(req.path))) {
      res.locals.mcp = true;
      return next();
    }
    return void res.status(403).json({ error: requestT(req)('errors.http.readOnlyToken') });
  }
  if (typeof given === 'string' && safeEqual(given, NOTIFY_TOKEN)) {
    if (
      (req.method === 'GET' && NOTIFY_READ_PATHS.some((re) => re.test(req.path))) ||
      (req.method === 'POST' && NOTIFY_WRITE_PATHS.some((re) => re.test(req.path)))
    ) {
      res.locals.notify = true;
      return next();
    }
    return void res.status(403).json({ error: requestT(req)('errors.http.readOnlyToken') });
  }
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
  res.json(
    db.prepare(
      'SELECT id, name, color, enabled, sync_interval, last_sync_at, last_sync_ok, last_sync_error FROM instances ORDER BY id',
    ).all(),
  );
});

const intQuery = (v: unknown, def: number, min: number, max: number) => {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, 'errors.http.invalidNumber');
  return Math.max(min, Math.min(max, n));
};

/** Workflows als Metadaten: keine Snapshots, Parameter oder Änderungstexte. */
internalRouter.get('/workflows', (req, res) => {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (req.query.instance) {
    where.push('w.instance_id = ?');
    params.push(id(req.query.instance));
  }
  if (typeof req.query.q === 'string' && req.query.q) {
    where.push("(w.name LIKE ? ESCAPE '\\' OR w.n8n_id = ?)");
    params.push(`%${req.query.q.slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`, req.query.q);
  }
  if (req.query.all !== 'true') where.push('w.deleted_at IS NULL AND (w.archived = 0 OR i.include_archived = 1)');
  const limit = intQuery(req.query.limit, 500, 1, 5000);
  params.push(limit);
  res.json(
    db.prepare(
      `SELECT w.id, w.instance_id, w.n8n_id, w.name, w.active, w.archived, w.deleted_at, w.node_count, w.version_count, w.last_change_at
         FROM workflows w JOIN instances i ON i.id = w.instance_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY w.last_change_at DESC LIMIT ?`,
    ).all(...params),
  );
});

/** Ereignisse ohne Inhalt: kein Änderungstext, keine KI-Zusammenfassung. `detail` nur bei Sync-Fehlern. */
internalRouter.get('/activity', (req, res) => {
  const since = intQuery(req.query.since, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = intQuery(req.query.limit, 100, 1, 500);
  const params: number[] = [since];
  let where = 'e.created_at >= ?';
  if (req.query.instance) {
    where += ' AND e.instance_id = ?';
    params.push(id(req.query.instance));
  }
  params.push(limit);
  res.json(
    db.prepare(
      `SELECT e.id, e.kind, CASE WHEN e.kind = 'sync_error' THEN e.detail END AS detail, e.created_at,
              e.instance_id, i.name AS instance_name, e.workflow_id, w.name AS workflow_name, v.number AS version_number
         FROM events e
         LEFT JOIN instances i ON i.id = e.instance_id
         LEFT JOIN workflows w ON w.id = e.workflow_id
         LEFT JOIN versions v  ON v.id = e.version_id
        WHERE ${where} ORDER BY e.id DESC LIMIT ?`,
    ).all(...params),
  );
});

/** Lesende Health-Endpunkte für den MCP-Dienst. Feste Liste, damit nichts Schreibendes durchrutscht. */
const HEALTH_READS = [/^\/status$/, /^\/alerts$/, /^\/executions\/(?:failures|summary|history)$/, /^\/workflows\/\d+$/];
const HEALTH_QUERY = ['hours', 'limit', 'instances', 'instance'];

internalRouter.get('/health/{*rest}', async (req, res) => {
  const sub = req.path.slice('/health'.length);
  if (!HEALTH_READS.some((re) => re.test(sub))) {
    return void res.status(404).json({ error: requestT(req)('errors.http.unknownInternalEndpoint') });
  }
  const qs = new URLSearchParams();
  for (const k of HEALTH_QUERY) if (typeof req.query[k] === 'string') qs.set(k, req.query[k] as string);
  if (sub === '/alerts') qs.set('status', 'open');
  try {
    const r = await fetch(`${HEALTH_URL}/v1${sub}${qs.size ? `?${qs}` : ''}`, {
      headers: { 'X-Internal-Token': TOKEN, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    res.status(r.status).type('application/json').send((await r.text()) || '{}');
  } catch {
    res.status(503).json({ error: requestT(req)('errors.http.healthUnavailable'), unavailable: true });
  }
});

internalRouter.post('/health/alerts/:id/dismiss', async (req, res) => {
  const alertId = id(req.params.id);
  try {
    const r = await fetch(`${HEALTH_URL}/v1/alerts/${alertId}/dismiss`, {
      method: 'POST',
      headers: { 'X-Internal-Token': TOKEN, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    res.status(r.status).type('application/json').send((await r.text()) || '{}');
  } catch {
    res.status(503).json({ error: requestT(req)('errors.http.healthUnavailable'), unavailable: true });
  }
});

/** Ereignisse vom Health-Dienst an den Notify-Dienst weiterreichen (nur mit INTERNAL_TOKEN). */
internalRouter.post('/notify/ingest', async (req, res) => {
  const notifyUrl = (process.env.NOTIFY_URL ?? `http://127.0.0.1:${Number(process.env.NOTIFY_PORT ?? 4300)}`).replace(/\/+$/, '');
  try {
    const r = await fetch(`${notifyUrl}/v1/ingest`, {
      method: 'POST',
      headers: { 'X-Internal-Token': NOTIFY_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(req.body ?? {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(2_000),
    });
    res.status(r.status).type('application/json').send((await r.text()) || '{}');
  } catch {
    res.status(503).json({ ok: false, unavailable: true });
  }
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

/** Vorschau-Metadaten für ein Rollback aus der Mobile-App (ohne Snapshot-Inhalte). */
internalRouter.get('/workflows/:id/rollback-preview', (req, res) => {
  const workflowId = id(req.params.id);
  const targetVersionId = id(req.query.versionId);
  const wf = db
    .prepare(
      `SELECT w.id, w.instance_id, w.name, w.deleted_at, w.version_count, i.name AS instance_name
         FROM workflows w JOIN instances i ON i.id = w.instance_id WHERE w.id = ?`,
    )
    .get(workflowId) as
    | { id: number; instance_id: number; name: string; deleted_at: number | null; version_count: number; instance_name: string }
    | undefined;
  if (!wf) return void res.status(404).json({ error: requestT(req)('errors.workflow.notFound') });
  if (wf.deleted_at) return void res.status(409).json({ error: requestT(req)('errors.restore.workflowGone') });
  const target = db
    .prepare('SELECT id, number FROM versions WHERE id = ? AND workflow_id = ?')
    .get(targetVersionId, workflowId) as { id: number; number: number } | undefined;
  if (!target) return void res.status(404).json({ error: requestT(req)('errors.version.notFound') });
  res.json({
    instanceId: wf.instance_id,
    instanceName: wf.instance_name,
    workflowId: wf.id,
    workflowName: wf.name,
    currentVersionNumber: wf.version_count,
    targetVersionId: target.id,
    targetVersionNumber: target.number,
  });
});

/**
 * Führt eine Fehler-/Diff-/KI-Diagnose im Core aus.
 * Wenn das Gerät einen öffentlichen ECDH-P-256-Schlüssel hinterlegt hat, wird das Ergebnis
 * bereits im Core Ende-zu-Ende verschlüsselt, sodass `services/notify` keinen Klartext sieht.
 */
internalRouter.post('/actions/diagnose', async (req, res) => {
  const b = req.body ?? {};
  const workflowId = id(b.workflowId);
  const out = await diagnoseWorkflowFailure({
    workflowId,
    versionId: b.versionId ? id(b.versionId) : null,
    rollbackVersionId: b.rollbackVersionId ? id(b.rollbackVersionId) : null,
    errorNode: typeof b.errorNode === 'string' ? b.errorNode : null,
    errorMessage: typeof b.errorMessage === 'string' ? b.errorMessage : null,
    language: typeof b.language === 'string' ? b.language : undefined,
  });
  if (!out) return void res.status(404).json({ error: requestT(req)('errors.workflow.notFound') });
  const encKey = typeof b.encryptionPublicKey === 'string' && b.encryptionPublicKey ? b.encryptionPublicKey : null;
  if (encKey) {
    try {
      const envelope = encryptForDevice(out.diagnosis, encKey);
      return void res.json({ instanceId: out.instanceId, encrypted: true, envelope });
    } catch {
      return void res.status(400).json({ error: requestT(req)('errors.notify.invalidPublicKey') });
    }
  }
  res.json({ instanceId: out.instanceId, encrypted: false, diagnosis: out.diagnosis });
});

/**
 * Führt ein kryptografisch signiertes Rollback aus der Mobile-App durch.
 * Defense-in-Depth: Der Core prüft die ECDSA-Hardware-Signatur des Geräts eigenständig gegen den
 * kanonischen Challenge-Payload, bevor `restoreVersion` in n8n schreibt.
 */
internalRouter.post('/actions/rollback', async (req, res) => {
  const b = req.body ?? {};
  const challengeId = String(b.challengeId ?? '');
  const nonce = String(b.nonce ?? '');
  const deviceId = id(b.deviceId);
  const workflowId = id(b.workflowId);
  const targetVersionId = id(b.targetVersionId);
  const signingPublicKey = String(b.signingPublicKey ?? '');
  const signature = String(b.signature ?? '');

  if (!challengeId || !nonce || !signingPublicKey || !signature) {
    return void res.status(400).json({ error: requestT(req)('errors.notify.signatureInvalid') });
  }
  const canonical = canonicalRollbackPayload({ challengeId, nonce, deviceId, workflowId, targetVersionId });
  if (!verifyDeviceSignature(signingPublicKey, canonical, signature)) {
    return void res.status(403).json({ error: requestT(req)('errors.notify.signatureInvalid') });
  }

  const ver = db
    .prepare('SELECT id, number, workflow_id FROM versions WHERE id = ? AND workflow_id = ?')
    .get(targetVersionId, workflowId) as { id: number; number: number; workflow_id: number } | undefined;
  if (!ver) return void res.status(404).json({ error: requestT(req)('errors.version.notFound') });

  try {
    await restoreVersion(targetVersionId, { mode: 'overwrite' });
    res.json({ ok: true, workflowId, restoredFromNumber: ver.number });
  } catch (e) {
    res.status(502).json({ error: renderError(e, requestT(req)) });
  }
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
