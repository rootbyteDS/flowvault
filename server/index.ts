import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.ts';
import { encrypt, decrypt } from './crypto.ts';
import { N8nClient, normalizeBaseUrl } from './n8n.ts';
import { announceSetupCode, requireAuth } from './auth.ts';
import { createAuthRouter } from './auth-router.ts';
import { createDashboardRouter } from './dashboard.ts';
import { buildInfo } from './version.ts';
import { updates } from './updates.ts';
import {
  clientFor, getInstance, isSyncing, loadSnapshot, recordWorkflow, restoreVersion, startScheduler, syncInstance, type InstanceRow,
} from './sync.ts';
import { diffWorkflows } from '../shared/diff.ts';
import {
  backfill, generateForVersion, listModels, publicAiConfig, resumeQueue, saveAiConfig, wouldMoveStoredKey,
} from './ai.ts';
import { healthProxy, internalRouter } from './internal.ts';
import { startHealthService } from './services.ts';
import { promoteRouter } from './promote/router.ts';
import { HttpError, languageWarning, requestT, t } from '../shared/i18n/server.ts';
import { renderError, type Translator } from '../shared/i18n/index.ts';

const parseAi = (v: unknown) => (v ? JSON.parse(String(v)) : null);

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, 'errors.http.invalidId');
  return n;
};
/** Ganzzahl aus Query/Body, auf [min, max] begrenzt. */
const intParam = (v: unknown, def: number, min: number, max: number) => {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, 'errors.http.invalidNumber');
  return Math.max(min, Math.min(max, n));
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', TRUST_PROXY ? 1 : false);

// ───────────────────────── Security-Header ─────────────────────────

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self' data:", // Vite bettet kleine Font-Dateien als data:-URL ein
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// ───────────────────────── CSRF-Schutz ─────────────────────────
// Schreibende Requests nur von der eigenen Seite. Sec-Fetch-Site setzt der Browser selbst und
// unterscheidet – anders als SameSite-Cookies – auch Nachbar-Subdomains (n8n.firma.de → flowvault.firma.de).
// Zusätzlich muss der Body JSON sein: Das dürfen fremde Seiten nur nach einem CORS-Preflight, den FlowVault nie erlaubt.

function originMatchesHost(req: Request) {
  try {
    const host = (TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host;
    return new URL(String(req.headers.origin)).host === host;
  } catch {
    return false;
  }
}

app.use('/api', (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const site = req.headers['sec-fetch-site'];
  if (site ? site !== 'same-origin' && site !== 'none' : req.headers.origin !== undefined && !originMatchesHost(req)) {
    throw new HttpError(403, 'errors.http.foreignOrigin');
  }
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'errors.http.contentType');
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

// Interne API für Zusatzdienste (Health-Dienst) – eigenes Token statt Login, siehe internal.ts
app.use('/internal', internalRouter);

// ───────────────────────── Auth ─────────────────────────

let proxyWarned = false;
function clientIp(req: Request) {
  if (!TRUST_PROXY && !proxyWarned && req.headers['x-forwarded-for']) {
    proxyWarned = true;
    console.warn(t('log.proxyWarning'));
  }
  return req.ip ?? 'unknown';
}

app.use('/api/auth', createAuthRouter(clientIp));
app.use('/api', requireAuth);
app.use('/api/dashboard', createDashboardRouter());
app.get('/api/system', (_req, res) => res.json({ ...buildInfo, updates: updates.info() }));

// ───────────────────────── Instanzen ─────────────────────────

function publicInstance(i: InstanceRow, tr: Translator) {
  let keyHint = '';
  try {
    keyHint = '…' + decrypt(i.api_key_enc).slice(-4);
  } catch {
    keyHint = tr('errors.instance.unreadableKey');
  }
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS workflows,
              SUM(CASE WHEN deleted_at IS NULL AND active = 1 THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS deleted,
              COALESCE(SUM(version_count), 0) AS versions
         FROM workflows WHERE instance_id = ? AND (archived = 0 OR ? = 1)`,
    )
    .get(i.id, i.include_archived) as { workflows: number; active: number | null; deleted: number | null; versions: number };
  const { api_key_enc: _omit, ...rest } = i;
  return {
    ...rest,
    enabled: !!i.enabled,
    include_archived: !!i.include_archived,
    last_sync_ok: i.last_sync_ok === null ? null : !!i.last_sync_ok,
    key_hint: keyHint,
    syncing: isSyncing(i.id),
    workflows: counts.workflows - (counts.deleted ?? 0),
    active_workflows: counts.active ?? 0,
    deleted_workflows: counts.deleted ?? 0,
    versions: counts.versions,
  };
}

function instanceInput(body: Record<string, unknown>, partial = false) {
  const name = String(body.name ?? '').trim();
  const base_url = body.base_url ? normalizeBaseUrl(String(body.base_url)) : '';
  if (!partial || body.name !== undefined) if (!name) throw new HttpError(400, 'errors.instance.nameMissing');
  if (!partial || body.base_url !== undefined) {
    try {
      new URL(base_url);
    } catch {
      throw new HttpError(400, 'errors.instance.invalidUrl');
    }
  }
  const interval = Math.max(0, Math.min(1440, Math.round(Number(body.sync_interval ?? 15))));
  const color = /^#[0-9a-f]{6}$/i.test(String(body.color ?? '')) ? String(body.color) : '#ea4b71';
  const include_archived = body.include_archived ? 1 : 0;
  return { name, base_url, interval, color, include_archived };
}

app.get('/api/instances', (req, res) => {
  const rows = db.prepare('SELECT * FROM instances ORDER BY name COLLATE NOCASE').all() as unknown as InstanceRow[];
  const tr = requestT(req);
  res.json(rows.map((r) => publicInstance(r, tr)));
});

app.get('/api/instances/:id', (req, res) => {
  const inst = getInstance(num(req.params.id));
  if (!inst) throw new HttpError(404, 'errors.instance.notFound');
  const runs = db.prepare('SELECT * FROM sync_runs WHERE instance_id = ? ORDER BY id DESC LIMIT 30').all(inst.id);
  res.json({ ...publicInstance(inst, requestT(req)), runs });
});

app.post('/api/instances/test', async (req, res) => {
  const { base_url } = instanceInput({ name: 'x', base_url: req.body?.base_url });
  let key = String(req.body?.api_key ?? '').trim();
  if (!key && req.body?.id) {
    const inst = getInstance(num(req.body.id));
    if (inst) {
      // Der gespeicherte Key geht nur an die gespeicherte Adresse
      if (inst.base_url !== base_url) throw new HttpError(400, 'errors.instance.keyRequired');
      key = decrypt(inst.api_key_enc);
    }
  }
  if (!key) throw new HttpError(400, 'errors.instance.apiKeyMissing');
  try {
    const r = await new N8nClient(base_url, key).test();
    res.json({ ok: true, base_url, workflows: r.workflows });
  } catch (e) {
    res.json({ ok: false, base_url, error: renderError(e, requestT(req)) });
  }
});

app.post('/api/instances', (req, res) => {
  const { name, base_url, interval, color, include_archived } = instanceInput(req.body ?? {});
  const key = String(req.body?.api_key ?? '').trim();
  if (!key) throw new HttpError(400, 'errors.instance.apiKeyMissing');
  const r = db
    .prepare('INSERT INTO instances (name, base_url, api_key_enc, color, sync_interval, include_archived, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(name, base_url, encrypt(key), color, interval, include_archived, Date.now());
  const id = Number(r.lastInsertRowid);
  syncInstance(id, 'manual').catch(() => {});
  res.status(201).json(publicInstance(getInstance(id)!, requestT(req)));
});

app.put('/api/instances/:id', (req, res) => {
  const inst = getInstance(num(req.params.id));
  if (!inst) throw new HttpError(404, 'errors.instance.notFound');
  const { name, base_url, interval, color, include_archived } = instanceInput({ ...inst, ...req.body });
  const key = String(req.body?.api_key ?? '').trim();
  if (!key && base_url !== inst.base_url) throw new HttpError(400, 'errors.instance.keyRequired');
  const enabled = req.body?.enabled === undefined ? inst.enabled : req.body.enabled ? 1 : 0;
  db.prepare('UPDATE instances SET name=?, base_url=?, color=?, sync_interval=?, enabled=?, include_archived=?, api_key_enc=? WHERE id=?').run(
    name, base_url, color, interval, enabled, include_archived, key ? encrypt(key) : inst.api_key_enc, inst.id,
  );
  // Gerade eingeschaltet: archivierte Workflows gleich sichern statt erst beim nächsten Intervall
  if (include_archived && !inst.include_archived) syncInstance(inst.id, 'manual').catch(() => {});
  res.json(publicInstance(getInstance(inst.id)!, requestT(req)));
});

app.delete('/api/instances/:id', (req, res) => {
  db.prepare('DELETE FROM instances WHERE id = ?').run(num(req.params.id));
  res.json({ ok: true });
});

app.post('/api/instances/:id/sync', async (req, res) => {
  const id = num(req.params.id);
  if (!getInstance(id)) throw new HttpError(404, 'errors.instance.notFound');
  try {
    const r = await syncInstance(id, 'manual');
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(502).json({ ok: false, error: renderError(e, requestT(req)) });
  }
});

app.post('/api/sync-all', async (_req, res) => {
  const ids = db.prepare('SELECT id FROM instances WHERE enabled = 1').all() as { id: number }[];
  const results = await Promise.allSettled(ids.map(({ id }) => syncInstance(id, 'manual')));
  res.json({ ok: results.every((r) => r.status === 'fulfilled'), count: ids.length });
});

// ───────────────────────── Übersicht & Aktivität ─────────────────────────

const ACTIVITY_SQL = `
  SELECT e.id, e.kind, e.detail, e.created_at,
         i.id AS instance_id, i.name AS instance_name, i.color AS instance_color,
         w.id AS workflow_id, w.name AS workflow_name,
         v.id AS version_id, v.number AS version_number, v.summary, v.message, v.ai_summary
    FROM events e
    LEFT JOIN instances i ON i.id = e.instance_id
    LEFT JOIN workflows w ON w.id = e.workflow_id
    LEFT JOIN versions v  ON v.id = e.version_id`;

function mapActivity(rows: Record<string, unknown>[]) {
  return rows.map((r) => ({ ...r, summary: r.summary ? JSON.parse(String(r.summary)) : null, ai_summary: parseAi(r.ai_summary) }));
}

app.get('/api/overview', (_req, res) => {
  const stats = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM instances) AS instances,
              (SELECT COUNT(*) FROM workflows w JOIN instances i ON i.id = w.instance_id
                WHERE w.deleted_at IS NULL AND (w.archived = 0 OR i.include_archived = 1)) AS workflows,
              (SELECT COUNT(*) FROM workflows WHERE deleted_at IS NULL AND active = 1) AS active,
              (SELECT COUNT(*) FROM versions) AS versions,
              (SELECT COUNT(*) FROM versions WHERE created_at > ?) AS versions_7d,
              (SELECT MAX(last_sync_at) FROM instances) AS last_sync,
              (SELECT MIN(created_at) FROM versions) AS first_backup,
              (SELECT COALESCE(SUM(LENGTH(snapshot)), 0) FROM versions) AS storage_bytes`,
    )
    .get(Date.now() - 7 * 864e5);

  // UTC-Tageswerte für alle auswählbaren Heatmap-Zeiträume (bis zu 12 Monate).
  const days = db
    .prepare(
      `SELECT CAST((created_at / 86400000) AS INTEGER) AS day, COUNT(*) AS n FROM versions
        WHERE created_at > ? GROUP BY day`,
    )
    .all(Date.now() - 372 * 864e5);

  const activity = db.prepare(`${ACTIVITY_SQL} ORDER BY e.id DESC LIMIT 25`).all() as Record<string, unknown>[];
  res.json({ stats, days, activity: mapActivity(activity) });
});

app.get('/api/activity', (req, res) => {
  const limit = intParam(req.query.limit, 50, 1, 200);
  const before = req.query.before ? num(req.query.before) : Number.MAX_SAFE_INTEGER;
  const params: (number | string)[] = [before];
  let where = 'WHERE e.id < ?';
  if (req.query.instance) {
    where += ' AND e.instance_id = ?';
    params.push(num(req.query.instance));
  }
  params.push(limit);
  const rows = db.prepare(`${ACTIVITY_SQL} ${where} ORDER BY e.id DESC LIMIT ?`).all(...params) as Record<string, unknown>[];
  res.json(mapActivity(rows));
});

// ───────────────────────── Workflows & Versionen ─────────────────────────

app.get('/api/workflows', (req, res) => {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (req.query.instance) {
    where.push('w.instance_id = ?');
    params.push(num(req.query.instance));
  }
  if (req.query.q) {
    where.push('(w.name LIKE ? OR w.tags LIKE ? OR w.n8n_id = ?)');
    const q = `%${String(req.query.q)}%`;
    params.push(q, q, String(req.query.q));
  }
  const status = String(req.query.status ?? 'present');
  // Archivierte nur zeigen, wenn die Instanz sie sichert – oder ausdrücklich danach gefragt wird
  const notHiddenArchived = '(w.archived = 0 OR i.include_archived = 1)';
  if (status === 'present') where.push(`w.deleted_at IS NULL AND ${notHiddenArchived}`);
  if (status === 'active') where.push('w.deleted_at IS NULL AND w.active = 1');
  if (status === 'inactive') where.push(`w.deleted_at IS NULL AND w.active = 0 AND ${notHiddenArchived}`);
  if (status === 'archived') where.push('w.deleted_at IS NULL AND w.archived = 1');
  if (status === 'deleted') where.push('w.deleted_at IS NOT NULL');

  const rows = db
    .prepare(
      `SELECT w.*, i.name AS instance_name, i.color AS instance_color, i.base_url,
              (SELECT summary FROM versions v WHERE v.workflow_id = w.id ORDER BY number DESC LIMIT 1) AS last_summary
         FROM workflows w JOIN instances i ON i.id = w.instance_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY w.last_change_at DESC LIMIT 2000`,
    )
    .all(...params) as Record<string, unknown>[];
  res.json(
    rows.map((r) => ({
      ...r,
      active: !!r.active,
      archived: !!r.archived,
      tags: JSON.parse(String(r.tags)),
      last_summary: r.last_summary ? JSON.parse(String(r.last_summary)) : null,
    })),
  );
});

app.get('/api/workflows/:id', (req, res) => {
  const w = db
    .prepare(
      `SELECT w.*, i.name AS instance_name, i.color AS instance_color, i.base_url
         FROM workflows w JOIN instances i ON i.id = w.instance_id WHERE w.id = ?`,
    )
    .get(num(req.params.id)) as Record<string, unknown> | undefined;
  if (!w) throw new HttpError(404, 'errors.workflow.notFound');
  const versions = db
    .prepare(
      `SELECT id, number, hash, summary, message, n8n_version_id, n8n_updated_at, created_at, LENGTH(snapshot) AS size,
              ai_summary, ai_status, ai_error, ai_model
         FROM versions WHERE workflow_id = ? ORDER BY number DESC`,
    )
    .all(w.id as number) as Record<string, unknown>[];
  res.json({
    ...w,
    active: !!w.active,
    archived: !!w.archived,
    tags: JSON.parse(String(w.tags)),
    versions: versions.map((v) => ({ ...v, summary: JSON.parse(String(v.summary)), ai_summary: parseAi(v.ai_summary) })),
  });
});

app.delete('/api/workflows/:id', (req, res) => {
  db.prepare('DELETE FROM workflows WHERE id = ?').run(num(req.params.id));
  res.json({ ok: true });
});

function versionMeta(id: number) {
  const v = db
    .prepare(
      `SELECT v.id, v.workflow_id, v.number, v.hash, v.summary, v.message, v.n8n_version_id, v.n8n_updated_at, v.created_at,
              v.ai_summary, v.ai_status, v.ai_error, v.ai_model,
              w.name AS workflow_name, w.instance_id, w.n8n_id
         FROM versions v JOIN workflows w ON w.id = v.workflow_id WHERE v.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!v) throw new HttpError(404, 'errors.version.notFound');
  return { ...v, summary: JSON.parse(String(v.summary)), ai_summary: parseAi(v.ai_summary) } as unknown as Record<string, unknown> & {
    id: number; workflow_id: number; number: number;
  };
}

app.get('/api/versions/:id', (req, res) => {
  const v = versionMeta(num(req.params.id));
  res.json({ ...v, snapshot: loadSnapshot(v.id) });
});

app.patch('/api/versions/:id', (req, res) => {
  const msg = String(req.body?.message ?? '').trim().slice(0, 500);
  db.prepare('UPDATE versions SET message = ? WHERE id = ?').run(msg || null, num(req.params.id));
  res.json({ ok: true });
});

app.get('/api/versions/:id/download', (req, res) => {
  const v = versionMeta(num(req.params.id));
  const s = loadSnapshot(v.id)!;
  const out = {
    name: s.name,
    nodes: s.nodes,
    connections: s.connections,
    settings: s.settings,
    pinData: s.pinData ?? {},
    tags: s.tags.map((name) => ({ name })),
    meta: { flowvault: { workflowId: s.n8nId, version: v.number, savedAt: new Date(Number(v.created_at)).toISOString() } },
  };
  const file = `${s.name.replace(/[^\w\-äöüÄÖÜß ]+/g, '_').trim() || 'workflow'}_v${v.number}.json`;
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file)}`);
  res.type('application/json').send(JSON.stringify(out, null, 2));
});

app.get('/api/compare', (req, res) => {
  const to = versionMeta(num(req.query.to));
  const from = req.query.from ? versionMeta(num(req.query.from)) : null;
  const toSnap = loadSnapshot(to.id)!;
  const fromSnap = from ? loadSnapshot(from.id)! : null;
  res.json({
    from: from ? { ...from, snapshot: fromSnap } : null,
    to: { ...to, snapshot: toSnap },
    diff: diffWorkflows(fromSnap, toSnap),
  });
});

app.post('/api/versions/:id/restore', async (req, res) => {
  // Kein Standardwert: Überschreiben in n8n muss ausdrücklich angefordert werden
  const mode = req.body?.mode;
  if (mode !== 'overwrite' && mode !== 'copy') throw new HttpError(400, 'errors.restore.modeInvalid');
  try {
    const r = await restoreVersion(num(req.params.id), {
      mode,
      targetInstanceId: req.body?.targetInstanceId ? num(req.body.targetInstanceId) : undefined,
      name: req.body?.name,
    });
    const wf = db.prepare('SELECT id FROM workflows WHERE instance_id = ? AND n8n_id = ?').get(r.instanceId, r.n8nId) as
      | { id: number }
      | undefined;
    res.json({ ok: true, workflowId: wf?.id, mapped: r.mapped ?? 0 });
  } catch (e) {
    throw new HttpError(502, { raw: renderError(e, requestT(req)) });
  }
});

// Einzelnen Workflow sofort aus n8n nachladen und ggf. neue Version anlegen
app.post('/api/workflows/:id/refresh', async (req, res) => {
  const w = db.prepare('SELECT instance_id, n8n_id, latest_hash FROM workflows WHERE id = ?').get(num(req.params.id)) as
    | { instance_id: number; n8n_id: string; latest_hash: string }
    | undefined;
  if (!w) throw new HttpError(404, 'errors.workflow.notFound');
  const inst = getInstance(w.instance_id)!;
  try {
    const fresh = await clientFor(inst).getWorkflow(w.n8n_id);
    const r = recordWorkflow(inst, fresh);
    res.json({ ok: true, changed: !!r });
  } catch (e) {
    res.json({ ok: false, error: renderError(e, requestT(req)) });
  }
});

// ───────────────────────── KI-Änderungstexte (Melious) ─────────────────────────

app.get('/api/ai/settings', (_req, res) => {
  res.json(publicAiConfig());
});

app.put('/api/ai/settings', (req, res) => {
  const b = req.body ?? {};
  const base_url = b.base_url === undefined ? undefined : String(b.base_url);
  const api_key = b.api_key ? String(b.api_key) : undefined;
  if (!api_key && wouldMoveStoredKey(base_url)) throw new HttpError(400, 'errors.ai.keyRequired');
  saveAiConfig({
    enabled: b.enabled === undefined ? undefined : !!b.enabled,
    auto: b.auto === undefined ? undefined : !!b.auto,
    base_url,
    model: b.model === undefined ? undefined : String(b.model),
    language: b.language === undefined ? undefined : String(b.language),
    api_key,
  });
  res.json(publicAiConfig());
});

/** Prüft Key/URL und liefert die verfügbaren Modelle. */
app.post('/api/ai/models', async (req, res) => {
  try {
    const models = await listModels({ baseUrl: req.body?.base_url || undefined, apiKey: req.body?.api_key || undefined });
    res.json({ ok: true, models });
  } catch (e) {
    res.json({ ok: false, error: renderError(e, requestT(req)) });
  }
});

app.post('/api/versions/:id/ai', async (req, res) => {
  try {
    const summary = await generateForVersion(num(req.params.id));
    res.json({ ok: true, ai_summary: summary });
  } catch (e) {
    throw new HttpError(502, { raw: renderError(e, requestT(req)) });
  }
});

app.post('/api/ai/backfill', (req, res) => {
  if (!publicAiConfig().configured) throw new HttpError(400, 'errors.ai.keyMissing');
  const count = backfill(intParam(req.body?.limit, 200, 1, 1000));
  res.json({ ok: true, count });
});

// ───────────────────────── Umgebungen (Staging → Prod) ─────────────────────────

app.use('/api/promote', promoteRouter);

// ───────────────────────── Health-Dienst (Fehlerquoten pro Version) ─────────────────────────

app.use('/api/health', healthProxy);

app.use('/api', (_req, _res) => {
  throw new HttpError(404, 'errors.http.unknownEndpoint');
});

// ───────────────────────── Frontend (Produktion) ─────────────────────────

const webDist = path.resolve('dist/web');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((err: Error & { status?: number; type?: string }, req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  // Unerwartete Fehler (z. B. aus SQLite) nur ins Log, nicht an den Browser
  const expose = err instanceof HttpError || status < 500;
  if (!expose) console.error(err);
  const tr = requestT(req);
  res.status(status).json({ error: expose ? renderError(err, tr) || tr('errors.http.generic') : tr('errors.http.internal') });
});

app.listen(PORT, HOST, () => {
  console.log(`\n  ${t('log.listening', { url: `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}` })}\n`);
  const languageIssue = languageWarning();
  if (languageIssue) console.warn(`  ${languageIssue}\n`);
  announceSetupCode();
  startScheduler();
  resumeQueue();
  startHealthService(PORT);
});
