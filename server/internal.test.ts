/** Interne API: Das Token des MCP-Dienstes darf nur lesen und erreicht keine Workflow-Inhalte und nicht n8n. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvault-internal-'));
const saved = { ...process.env };
const SECRET = 'SNAPSHOT-CANARY-k9f2x7q1';

// Nachgebauter Health-Dienst: merkt sich, was ankommt
const healthCalls: { url: string; method: string; token: unknown }[] = [];
const healthApp = express();
healthApp.use((req, res) => {
  healthCalls.push({ url: req.url, method: req.method, token: req.headers['x-internal-token'] });
  res.json({ ok: true });
});

let healthServer: Server;
let coreServer: Server;
let base: string;

async function listen(app: express.Express) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return server;
}

before(async () => {
  healthServer = await listen(healthApp);
  Object.assign(process.env, {
    DATA_DIR: directory,
    APP_SECRET: 'test-only-internal-key',
    INTERNAL_TOKEN: 'internal-test-token',
    MCP_TOKEN: 'mcp-test-token',
    HEALTH_URL: `http://127.0.0.1:${(healthServer.address() as AddressInfo).port}`,
  });
  const { db } = await import('./db.ts');
  const { internalRouter } = await import('./internal.ts');
  const now = Date.now();
  db.prepare(`INSERT INTO instances (id, name, base_url, api_key_enc, sync_interval, last_sync_at, last_sync_ok, last_sync_error, created_at)
    VALUES (1, 'Prod', 'https://n8n.example.com', 'enc', 15, ?, 0, 'boom', ?)`).run(now, now);
  db.prepare(`INSERT INTO workflows (id, instance_id, n8n_id, name, active, node_count, version_count, first_seen_at, last_seen_at, last_change_at)
    VALUES (10, 1, 'wfA', 'Sync', 1, 3, 1, ?, ?, ?)`).run(now, now, now);
  db.prepare(`INSERT INTO versions (id, workflow_id, number, hash, snapshot, summary, message, ai_summary, created_at)
    VALUES (100, 10, 1, 'h', ?, ?, ?, ?, ?)`).run(Buffer.from(SECRET), JSON.stringify({ note: SECRET }), SECRET, JSON.stringify({ title: SECRET }), now);
  db.prepare("INSERT INTO events (instance_id, workflow_id, version_id, kind, detail, created_at) VALUES (1, 10, 100, 'changed', ?, ?)").run(SECRET, now);
  db.prepare("INSERT INTO events (instance_id, kind, detail, created_at) VALUES (1, 'sync_error', 'boom', ?)").run(now);

  const app = express();
  app.use(express.json());
  app.use('/internal', internalRouter);
  app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  coreServer = await listen(app);
  base = `http://127.0.0.1:${(coreServer.address() as AddressInfo).port}/internal`;
});

after(async () => {
  await Promise.all([coreServer, healthServer].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  fs.rmSync(directory, { recursive: true, force: true });
});

const asMcp = (p: string, init: RequestInit = {}) =>
  fetch(`${base}${p}`, { ...init, headers: { 'X-Internal-Token': 'mcp-test-token', 'Content-Type': 'application/json', ...init.headers } });

test('the MCP token is read-only and limited to metadata paths', async () => {
  assert.equal((await asMcp('/instances')).status, 200);
  assert.equal((await asMcp('/workflows')).status, 200);
  assert.equal((await asMcp('/workflows/10/timeline')).status, 200);
  assert.equal((await asMcp('/activity')).status, 200);
  // Ausführungen holt der Core live bei n8n – das darf der MCP-Dienst nicht auslösen
  assert.equal((await asMcp('/instances/1/executions')).status, 403);
  assert.equal((await asMcp('/instances/1/timeline')).status, 403);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.equal((await asMcp('/instances', { method, body: method === 'DELETE' ? undefined : '{}' })).status, 403, method);
    assert.equal((await asMcp('/health/poll', { method, body: method === 'DELETE' ? undefined : '{}' })).status, 403, method);
  }
  assert.equal((await fetch(`${base}/instances`, { headers: { 'X-Internal-Token': 'wrong' } })).status, 401);
});

test('metadata answers carry no workflow content', async () => {
  const instances = (await (await asMcp('/instances')).json()) as Record<string, unknown>[];
  assert.deepEqual(Object.keys(instances[0]!), ['id', 'name', 'color', 'enabled', 'sync_interval', 'last_sync_at', 'last_sync_ok', 'last_sync_error']);

  const workflowsText = await (await asMcp('/workflows')).text();
  assert.ok(!workflowsText.includes(SECRET));
  assert.deepEqual(Object.keys(JSON.parse(workflowsText)[0]), [
    'id', 'instance_id', 'n8n_id', 'name', 'active', 'archived', 'deleted_at', 'node_count', 'version_count', 'last_change_at',
  ]);
  assert.ok(!(await (await asMcp('/workflows/10/timeline')).text()).includes(SECRET));

  const activityText = await (await asMcp('/activity')).text();
  assert.ok(!activityText.includes(SECRET), 'no commit message, change summary or AI text');
  const activity = JSON.parse(activityText) as { kind: string; detail: string | null }[];
  assert.deepEqual(activity.map((e) => [e.kind, e.detail]), [['sync_error', 'boom'], ['changed', null]]);
});

test('health reads are passed on with the internal token, writes and unknown paths are not', async () => {
  healthCalls.length = 0;
  assert.equal((await asMcp('/health/status')).status, 200);
  assert.equal((await asMcp('/health/alerts?status=all&evil=1')).status, 200);
  assert.equal((await asMcp('/health/executions/failures?hours=24&instances=1,2')).status, 200);
  assert.equal((await asMcp('/health/workflows/10')).status, 200);
  assert.equal((await asMcp('/health/settings')).status, 404);
  assert.equal((await asMcp('/health/poll')).status, 404);
  assert.equal((await asMcp('/health/alerts/1/dismiss')).status, 404);
  assert.deepEqual(healthCalls.map((c) => `${c.method} ${c.url}`), [
    'GET /v1/status',
    'GET /v1/alerts?status=open',
    'GET /v1/executions/failures?hours=24&instances=1%2C2',
    'GET /v1/workflows/10',
  ]);
  assert.ok(healthCalls.every((c) => c.token === 'internal-test-token'));
});

test('the MCP service gets a fixed environment without the app secret or internal token', async () => {
  const { mcpEnv } = await import('./services.ts');
  const env = mcpEnv(4000, { PATH: '/bin', APP_SECRET: 'x', INTERNAL_TOKEN: 'y', ADMIN_PASSWORD: 'z', UPDATE_WEBHOOK_TOKEN: 'w', DEFAULT_LANGUAGE: 'en' });
  assert.deepEqual(Object.keys(env).sort(), ['CORE_URL', 'DEFAULT_LANGUAGE', 'MCP_DATA_DIR', 'MCP_HOST', 'MCP_PORT', 'MCP_TOKEN', 'PATH']);
  assert.equal(env.MCP_TOKEN, 'mcp-test-token');
});
