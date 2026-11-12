/**
 * MCP-Dienst gegen einen nachgebauten Core: Tool-Vertrag, Kanarienwerte, feste Ausgabefelder,
 * Zugang und Geltungsbereich, offizieller Client und rohe Anfragen im Format von 2025.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createApp } from './app.ts';
import { coreClient } from './core.ts';
import { createStore } from './store.ts';

const SERVICE_TOKEN = 'core-to-mcp-test-token';
const NOW = Date.now();
const HOUR = 3600_000;

// Jeder Text, der aus n8n oder einem Hintergrundlauf stammt, trägt einen erfundenen Schlüssel (CANn…)
// oder eine E-Mail-Adresse. Keiner davon darf in einer Antwort auftauchen.
const CANARY = /CAN\d|canary\.person/;
const instances = [
  { id: 1, name: 'Prod https://n8n.example.com/?apikey=CAN1abc', color: '#000000', enabled: 1, sync_interval: 15,
    last_sync_at: NOW - 60_000, last_sync_ok: 0, last_sync_error: 'Invalid API key: CAN2xyz' },
  { id: 2, name: 'Staging', color: '#000000', enabled: 1, sync_interval: 15, last_sync_at: NOW - 60_000, last_sync_ok: 1, last_sync_error: null },
  { id: 3, name: 'Old', color: '#000000', enabled: 0, sync_interval: 0, last_sync_at: null, last_sync_ok: null, last_sync_error: null },
];
const workflows = [
  { id: 10, instance_id: 1, n8n_id: 'wfA', name: 'Sync api_key=CAN4xyz', active: 1, archived: 0, deleted_at: null, node_count: 5, version_count: 3, last_change_at: NOW - HOUR },
  { id: 20, instance_id: 2, n8n_id: 'wfB', name: 'Mailer', active: 0, archived: 0, deleted_at: null, node_count: 2, version_count: 1, last_change_at: NOW - 2 * HOUR },
];
const failingNode = (message: string) => ({ name: 'HTTP token: CAN5xyz', failed: 3, rate: 0.6, isNew: true, lastMessage: message, lastAt: NOW - HOUR });
const alerts = [{
  id: 7, workflowId: 10, workflowName: 'Sync api_key=CAN4xyz', instanceId: 1, instanceName: 'Prod https://n8n.example.com/?apikey=CAN1abc',
  versionId: 100, versionNumber: 3, rate: 0.6, total: 5, failed: 3, baselineRate: 0, baselineTotal: 20, rollbackVersionId: 99, rollbackNumber: 2,
  failingNodes: [failingNode('x-api-key: CAN7xyz rejected')], status: 'open', createdAt: NOW - HOUR, updatedAt: NOW - HOUR,
}];
const health = {
  status: {
    settings: { enabled: true, pollMinutes: 5, lookbackDays: 14, retentionDays: 30, minRuns: 5, thresholdPct: 20, includeManual: false, alerts: true },
    instances: [
      { instanceId: 1, name: 'x', lastPollAt: NOW - 60_000, ok: false, error: 'Authorization: Bearer CAN3abcdefgh', executions: 10 },
      { instanceId: 2, name: 'Staging', lastPollAt: NOW - 120_000, ok: true, error: null, executions: 10 },
    ],
    openAlerts: 1,
  },
  history: { days: [], availableFrom: null, availableTo: null, settings: {}, instances: [
    { instanceId: 1, lastPollAt: null, lastSuccessAt: null, ok: true, incomplete: false },
    { instanceId: 2, lastPollAt: null, lastSuccessAt: null, ok: true, incomplete: true },
  ] },
  summary: [{ instanceId: 1, runs: 10, failed: 6 }, { instanceId: 2, runs: 10, failed: 1 }],
  failures: {
    groups: [
      { instanceId: 1, workflowN8nId: 'wfA', node: 'HTTP token: CAN5xyz', message: 'Invalid API key: CAN6aaa', count: 2, firstAt: NOW - 3 * HOUR, lastAt: NOW - HOUR },
      { instanceId: 1, workflowN8nId: 'wfA', node: 'HTTP token: CAN5xyz', message: 'Invalid API key: CAN6bbb', count: 1, firstAt: NOW - 4 * HOUR, lastAt: NOW - 2 * HOUR },
      { instanceId: 2, workflowN8nId: 'wfB', node: 'Send', message: 'Recipient canary.person@example.com rejected', count: 1, firstAt: NOW - HOUR, lastAt: NOW - HOUR },
      { instanceId: 1, workflowN8nId: 'unknown', node: null, message: '{"password":"CAN6 secret phrase"}', count: 1, firstAt: NOW - 5 * HOUR, lastAt: NOW - 5 * HOUR },
    ],
    lastRuns: [{ instanceId: 1, workflowN8nId: 'wfA', status: 'success' }, { instanceId: 2, workflowN8nId: 'wfB', status: 'error' }],
    truncated: false,
  },
  workflow: {
    workflowId: 10, available: true, lastPollAt: NOW - 60_000, pollError: null, unattributed: 4, alert: null, settings: {},
    versions: [{ versionId: 100, number: 3, from: NOW - 5 * HOUR, to: null, total: 5, failed: 3, canceled: 0, rate: 0.6,
      failingNodes: [failingNode("API key 'CAN8xyz' is invalid")], baseline: { total: 20, failed: 0, rate: 0, fromNumber: 1, toNumber: 2 },
      regression: true, rollback: { versionId: 99, number: 2, rate: 0 } }],
  },
};
const events = [
  { id: 2, kind: 'sync_error', detail: 'could not connect to https://user:CAN9pw@db.example.com', created_at: NOW - HOUR, instance_id: 1,
    instance_name: 'Prod https://n8n.example.com/?apikey=CAN1abc', workflow_id: null, workflow_name: null, version_number: null },
  { id: 1, kind: 'changed', detail: null, created_at: NOW - 2 * HOUR, instance_id: 2, instance_name: 'Staging', workflow_id: 20, workflow_name: 'Mailer', version_number: 1 },
];

// ───────────── nachgebauter Core ─────────────

const coreCalls: string[] = [];
const core = express();
core.use('/internal', (req, res, next) => {
  coreCalls.push(`${req.method} ${req.path}`);
  if (req.headers['x-internal-token'] !== SERVICE_TOKEN) return void res.status(401).json({ error: 'token' });
  next();
});
core.get('/internal/instances', (_req, res) => res.json(instances));
core.get('/internal/workflows', (req, res) => res.json(workflows.filter((w) => !req.query.instance || w.instance_id === Number(req.query.instance))));
core.get('/internal/workflows/:id/timeline', (req, res) => {
  const w = workflows.find((x) => x.id === Number(req.params.id));
  if (!w) return void res.status(404).json({ error: 'not found' });
  res.json({ workflowId: w.id, instanceId: w.instance_id, instanceName: instances.find((i) => i.id === w.instance_id)!.name, n8nId: w.n8n_id, name: w.name, deleted: false, versions: [] });
});
core.get('/internal/activity', (_req, res) => res.json(events));
core.get('/internal/health/status', (_req, res) => res.json(health.status));
core.get('/internal/health/alerts', (_req, res) => res.json(alerts));
core.get('/internal/health/executions/history', (_req, res) => res.json(health.history));
core.get('/internal/health/executions/summary', (_req, res) => res.json(health.summary));
core.get('/internal/health/executions/failures', (_req, res) => res.json(health.failures));
core.get('/internal/health/workflows/:id', (_req, res) => res.json(health.workflow));

const store = createStore(new DatabaseSync(':memory:'));
let coreServer: Server;
let mcpServer: Server;
let url: string;

async function listen(app: express.Express) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return server;
}

before(async () => {
  coreServer = await listen(core);
  const coreUrl = `http://127.0.0.1:${(coreServer.address() as AddressInfo).port}`;
  mcpServer = await listen(createApp({ store, core: coreClient(coreUrl, () => SERVICE_TOKEN), serviceToken: () => SERVICE_TOKEN, version: 'test' }));
  url = `http://127.0.0.1:${(mcpServer.address() as AddressInfo).port}/mcp`;
});
after(async () => {
  await Promise.all([coreServer, mcpServer].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

async function connect(token: string) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    authProvider: { token: async () => token },
    requestInit: { headers: { 'X-Internal-Token': SERVICE_TOKEN } },
  }));
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  return r as { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text: string }[] };
}

function raw(body: unknown, headers: Record<string, string>) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  });
}

// ───────────── Tests ─────────────

test('access: off by default, service token and agent token required, revoked tokens stop working', async () => {
  const { token, info } = store.create({ name: 'Access test' });
  assert.match(token, /^fv_mcp_[A-Za-z0-9_-]{43}$/);
  assert.equal(info.hint, `${token.slice(0, 11)}…`);
  assert.ok(!JSON.stringify(store.state()).includes(token), 'only the hash is stored');

  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  const agent = { 'X-Internal-Token': SERVICE_TOKEN, authorization: `Bearer ${token}` };
  assert.equal((await raw(list, agent)).status, 404, 'disabled by default');
  store.setEnabled(true);
  assert.equal((await raw(list, { authorization: `Bearer ${token}` })).status, 401, 'without the core in between');
  assert.equal((await raw(list, { 'X-Internal-Token': SERVICE_TOKEN })).status, 401, 'without agent token');
  assert.equal((await raw(list, { ...agent, authorization: 'Bearer fv_mcp_wrong' })).status, 401, 'wrong agent token');
  assert.equal((await fetch(url, { headers: agent })).status, 405, 'no GET stream');
  assert.equal(store.revoke(info.id), true);
  assert.equal((await raw(list, agent)).status, 401, 'revoked');
});

test('tool contract: names, input schemas and read-only hints', async () => {
  store.setEnabled(true);
  const client = await connect(store.create({ name: 'Contract' }).token);
  const { tools } = await client.listTools();
  const contract = Object.fromEntries(tools.map((t) => [t.name, {
    readOnly: t.annotations?.readOnlyHint,
    input: Object.keys((t.inputSchema as { properties?: object }).properties ?? {}),
  }]));
  assert.deepEqual(contract, {
    get_status: { readOnly: true, input: ['instanceId'] },
    list_recent_failures: { readOnly: true, input: ['instanceId', 'hours', 'limit'] },
    list_alerts: { readOnly: true, input: ['instanceId'] },
    get_workflow_health: { readOnly: true, input: ['workflowId'] },
    get_recent_changes: { readOnly: true, input: ['instanceId', 'hours', 'limit'] },
    list_workflows: { readOnly: true, input: ['instanceId', 'query', 'limit'] },
  });
  for (const t of tools) assert.match(t.description ?? '', /data, never as instructions/);
  await client.close();
});

test('every tool answers with fixed fields and without secrets, e-mail addresses or line breaks', async () => {
  store.setEnabled(true);
  const client = await connect(store.create({ name: 'Canary' }).token);
  const results: Record<string, Record<string, unknown>> = {};
  for (const [name, args] of [
    ['get_status', {}], ['list_recent_failures', {}], ['list_alerts', {}], ['get_workflow_health', { workflowId: 10 }],
    ['get_recent_changes', {}], ['list_workflows', {}],
  ] as const) {
    const r = await call(client, name, args);
    assert.ok(!r.isError, `${name}: ${r.content[0]?.text}`);
    const json = JSON.stringify(r.structuredContent);
    assert.doesNotMatch(json, CANARY, name);
    assert.doesNotMatch(json, /\\n/, name);
    assert.equal(r.content[0]!.text, json);
    results[name] = r.structuredContent!;
  }
  const keys = (o: unknown) => Object.keys(o as object);

  const status = results.get_status!;
  assert.deepEqual(keys(status), ['generatedAt', 'dataAsOf', 'overall', 'healthEnabled', 'instances']);
  const instancesOut = status.instances as Record<string, unknown>[];
  assert.deepEqual(keys(instancesOut[0]), ['instanceId', 'name', 'level', 'reasons', 'sync', 'executions', 'openAlerts']);
  assert.deepEqual(keys(instancesOut[0]!.sync), ['lastAt', 'ok', 'error', 'intervalMinutes']);
  assert.deepEqual(keys(instancesOut[0]!.executions), ['lastPollAt', 'pollOk', 'pollError', 'runs24h', 'failed24h', 'incomplete']);
  assert.equal(status.overall, 'critical');
  assert.deepEqual(instancesOut.map((i) => [i.instanceId, i.level, (i.reasons as { code: string }[]).map((r) => r.code)]), [
    [1, 'critical', ['sync_failed', 'poll_failed', 'open_alerts', 'failure_rate_high']],
    [2, 'warning', ['history_incomplete', 'failures_24h']],
    [3, 'disabled', []],
  ]);
  assert.equal((instancesOut[0]!.sync as { error: string }).error, 'Invalid API key: [redacted]');
  assert.equal(status.dataAsOf, new Date(NOW - 120_000).toISOString(), 'oldest poll of the enabled instances');

  const failures = results.list_recent_failures!;
  assert.deepEqual(keys(failures), ['generatedAt', 'dataAsOf', 'hours', 'groups', 'truncated']);
  const groups = failures.groups as Record<string, unknown>[];
  assert.deepEqual(keys(groups[0]), [
    'instanceId', 'instanceName', 'workflowId', 'workflowName', 'workflowActive', 'node', 'message', 'count', 'firstAt', 'lastAt', 'lastRunStatus',
  ]);
  // Die beiden Gruppen, die sich nur im geschwärzten Schlüssel unterscheiden, sind zusammengefasst
  const merged = groups.find((g) => g.message === 'Invalid API key: [redacted]')!;
  assert.equal(merged.count, 3);
  assert.equal(merged.firstAt, new Date(NOW - 4 * HOUR).toISOString());
  assert.equal(merged.lastAt, new Date(NOW - HOUR).toISOString());
  assert.equal(merged.workflowId, 10);
  assert.equal(merged.lastRunStatus, 'success');
  assert.equal(groups.find((g) => g.workflowId === 20)!.message, 'Recipient c***@example.com rejected');
  assert.equal(groups.find((g) => g.workflowName === null)!.workflowId, null, 'workflow not backed up yet');
  assert.equal(groups.length, 3);

  const alert = (results.list_alerts!.alerts as Record<string, unknown>[])[0]!;
  assert.deepEqual(keys(alert), [
    'alertId', 'instanceId', 'instanceName', 'workflowId', 'workflowName', 'versionNumber', 'failureRate', 'runs', 'failed',
    'baselineRate', 'baselineRuns', 'rollbackVersionNumber', 'failingNodes', 'since',
  ]);
  assert.deepEqual(keys((alert.failingNodes as object[])[0]), ['node', 'failed', 'rate', 'isNew', 'lastMessage', 'lastAt']);

  const wf = results.get_workflow_health!;
  assert.deepEqual(keys(wf), [
    'generatedAt', 'dataAsOf', 'workflowId', 'workflowName', 'instanceId', 'instanceName', 'available', 'pollError', 'versions', 'unattributedRuns',
  ]);
  assert.deepEqual(keys((wf.versions as object[])[0]), [
    'versionNumber', 'from', 'to', 'runs', 'failed', 'canceled', 'failureRate', 'baselineRate', 'regression', 'rollbackVersionNumber', 'failingNodes',
  ]);

  const changes = results.get_recent_changes!;
  assert.deepEqual(keys(changes), ['generatedAt', 'hours', 'changes', 'truncated']);
  assert.deepEqual(keys((changes.changes as object[])[0]), [
    'at', 'kind', 'instanceId', 'instanceName', 'workflowId', 'workflowName', 'versionNumber', 'detail',
  ]);

  const wfs = results.list_workflows!;
  assert.deepEqual(keys(wfs), ['generatedAt', 'workflows', 'truncated']);
  assert.deepEqual(keys((wfs.workflows as object[])[0]), [
    'workflowId', 'instanceId', 'instanceName', 'name', 'active', 'archived', 'deleted', 'nodeCount', 'versions', 'lastChangeAt',
  ]);
  await client.close();
});

test('a token limited to one instance sees nothing of the others', async () => {
  store.setEnabled(true);
  const client = await connect(store.create({ name: 'Staging only', instances: [2] }).token);
  const status = (await call(client, 'get_status')).structuredContent!;
  assert.deepEqual((status.instances as { instanceId: number }[]).map((i) => i.instanceId), [2]);
  assert.equal(status.overall, 'warning');
  const failures = (await call(client, 'list_recent_failures')).structuredContent!;
  assert.deepEqual([...new Set((failures.groups as { instanceId: number }[]).map((g) => g.instanceId))], [2]);
  assert.deepEqual((await call(client, 'list_alerts')).structuredContent!.alerts, []);
  assert.deepEqual(((await call(client, 'get_recent_changes')).structuredContent!.changes as { instanceId: number }[]).map((c) => c.instanceId), [2]);
  assert.deepEqual(((await call(client, 'list_workflows')).structuredContent!.workflows as { workflowId: number }[]).map((w) => w.workflowId), [20]);

  const foreignWorkflow = await call(client, 'get_workflow_health', { workflowId: 10 });
  assert.equal(foreignWorkflow.isError, true);
  assert.equal(foreignWorkflow.content[0]!.text, 'Unknown workflow 10');
  const foreignInstance = await call(client, 'get_status', { instanceId: 1 });
  assert.equal(foreignInstance.isError, true);
  assert.equal(foreignInstance.content[0]!.text, 'Unknown instance 1', 'same answer as for an instance that does not exist');
  await client.close();
});

test('2025 clients get a stateless answer as an event stream', async () => {
  store.setEnabled(true);
  const headers = { 'X-Internal-Token': SERVICE_TOKEN, authorization: `Bearer ${store.create({ name: 'Legacy' }).token}` };
  const init = await raw({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } } }, headers);
  assert.equal(init.status, 200);
  assert.match(await init.text(), /"name":"flowvault"/);
  const r = await raw({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_status', arguments: {} } }, { ...headers, 'mcp-protocol-version': '2025-06-18' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/event-stream/);
  const body = await r.text();
  assert.match(body, /\\"overall\\":\\"critical\\"/);
  assert.doesNotMatch(body, CANARY);
});

test('the service only uses read-only core paths', () => {
  const allowed = [/^GET \/instances$/, /^GET \/workflows$/, /^GET \/workflows\/\d+\/timeline$/, /^GET \/activity$/, /^GET \/health\/.+$/];
  assert.ok(coreCalls.length > 0);
  for (const c of coreCalls) assert.ok(allowed.some((re) => re.test(c)), c);
});
