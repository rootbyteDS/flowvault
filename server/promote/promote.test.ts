import assert from 'node:assert/strict';
import { after, beforeEach, test, mock } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import type { N8nWorkflow } from '../n8n.ts';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvault-promote-'));
process.env.DATA_DIR = directory;
const { db } = await import('../db.ts');
const { encrypt } = await import('../crypto.ts');
const { getInstance, recordWorkflow, loadSnapshot, restoreVersion } = await import('../sync.ts');
const { N8nClient } = await import('../n8n.ts');
const { listPairs, savePair, chooseWorkflow, workflowChoices } = await import('./pairs.ts');
const { targetWorkflowFor, listMappings, upsertMapping } = await import('./mappings.ts');
const { buildPlan } = await import('./plan.ts');
const { promoteWorkflows } = await import('./promote.ts');
const { getTranslator } = await import('../../shared/i18n/index.ts');
const tr = getTranslator('de');
let sourceId: number, targetId: number;
let writes: string[];
let remote: Map<string, N8nWorkflow>;
let nextId: number;
const wf = (id: string, name = id, over: Partial<N8nWorkflow> = {}): N8nWorkflow => ({ id, name, active: false, nodes: [], connections: {}, settings: {}, ...over });
const rowId = (instance: number, id: string) => (db.prepare('SELECT id FROM workflows WHERE instance_id=? AND n8n_id=?').get(instance, id) as { id: number }).id;
function seed(instance: number, flow: N8nWorkflow) {
  recordWorkflow(getInstance(instance)!, flow);
  if (instance === targetId) remote.set(String(flow.id), structuredClone(flow));
  return rowId(instance, String(flow.id));
}
function review(ids: number[]) { return buildPlan(sourceId, targetId, ids, tr); }
function run(ids: number[], fingerprint = review(ids).fingerprint) {
  return promoteWorkflows(sourceId, targetId, ids.map((workflowId) => ({ workflowId })), tr, fingerprint);
}
beforeEach(() => {
  mock.restoreAll();
  db.exec('DELETE FROM instances');
  const insert = db.prepare('INSERT INTO instances (name,base_url,api_key_enc,created_at) VALUES (?,?,?,?)');
  sourceId = Number(insert.run('Development','http://source.test',encrypt('source-key'),Date.now()).lastInsertRowid);
  targetId = Number(insert.run('Production','http://target.test',encrypt('target-key'),Date.now()).lastInsertRowid);
  writes = []; remote = new Map(); nextId = 0;
  mock.method(N8nClient.prototype, 'getWorkflow', async (id: string) => {
    const value = remote.get(id);
    if (!value) throw new Error('remote workflow missing');
    return structuredClone(value);
  });
  mock.method(N8nClient.prototype, 'createWorkflow', async (body: N8nWorkflow) => {
    const id = `new-${++nextId}`;
    writes.push(`create:${body.name}`);
    const value = wf(id, body.name, structuredClone(body)); value.id = id; value.active = false;
    remote.set(id, value); return structuredClone(value);
  });
  mock.method(N8nClient.prototype, 'updateWorkflow', async (id: string, body: N8nWorkflow) => {
    writes.push(`update:${id}`);
    const value = { ...remote.get(id)!, ...structuredClone(body), id }; remote.set(id, value); return value;
  });
});
after(() => { mock.restoreAll(); db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('no implicit instance pair; setup and workflow choices are directional and persistent', async () => {
  const id = seed(sourceId, wf('s'));
  assert.deepEqual(listPairs(), []);
  await assert.rejects(run([id]), /Instanzpaar/);
  savePair(sourceId, targetId); chooseWorkflow(sourceId, targetId, 's', null);
  assert.equal(listPairs().length, 1);
  assert.equal(review([id]).blockers.length, 0);
  assert.equal(buildPlan(targetId, sourceId, [], tr).blockers.some((m) => m.includes('Instanzpaar')), true);
  assert.equal(workflowChoices(sourceId, targetId).sources[0]!.decision, 'create');
  assert.equal(writes.length, 0);
});

test('same IDs and names never authorize overwrites; explicit mapping wins over an ID collision', async () => {
  const id = seed(sourceId, wf('collision','Same name'));
  seed(targetId, wf('collision','Same name')); seed(targetId, wf('chosen','Different name'));
  savePair(sourceId, targetId);
  assert.equal(targetWorkflowFor(sourceId, targetId, 'collision','Same name'), null);
  assert.ok(review([id]).blockers.length);
  chooseWorkflow(sourceId, targetId, 'collision','chosen');
  assert.equal(targetWorkflowFor(sourceId, targetId, 'collision','Same name')!.row.n8n_id, 'chosen');
  const result = await run([id]);
  assert.equal(result[0]!.error, null);
  assert.deepEqual(writes, ['update:chosen']);
});

test('duplicate targets and stale mappings are rejected instead of falling back to names', () => {
  const a = seed(sourceId, wf('a','Same')); seed(sourceId, wf('b'));
  seed(targetId, wf('t','Same')); seed(targetId, wf('other','Same'));
  savePair(sourceId, targetId); chooseWorkflow(sourceId, targetId, 'a','t');
  assert.throws(() => chooseWorkflow(sourceId, targetId, 'b','t'));
  db.prepare("UPDATE workflows SET deleted_at=1 WHERE instance_id=? AND n8n_id='t'").run(targetId);
  assert.equal(targetWorkflowFor(sourceId, targetId, 'a','Same'), null);
  assert.ok(review([a]).blockers.some((s) => s.includes('fehlt')));
});

test('missing credentials and tables block the entire batch before any write, including copies', async () => {
  const a = seed(sourceId, wf('a')); const b = seed(sourceId, wf('b','b', { nodes: [{ name: 'Data', type: 'dataTable', parameters: { dataTableId: { __rl: true, value: 'table-src', mode: 'list' } }, credentials: { slackApi: { id: 'cred-src', name: 'Slack Dev' } } }] }));
  savePair(sourceId, targetId); chooseWorkflow(sourceId, targetId, 'a',null); chooseWorkflow(sourceId, targetId, 'b',null);
  assert.equal(review([a,b]).blockers.length, 2);
  await assert.rejects(run([a,b]));
  const version = (db.prepare('SELECT id FROM versions WHERE workflow_id=?').get(b) as { id: number }).id;
  await assert.rejects(restoreVersion(version, { mode: 'copy', targetInstanceId: targetId }));
  assert.deepEqual(writes, []);
});

test('confirmed new dependencies are included and created first; locator IDs are rewritten; retries update', async () => {
  const parent = seed(sourceId, wf('parent', 'Parent', { nodes: [{ name: 'Call', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { __rl: true, value: 'child', mode: 'list' }, workflowInputs: { value: { text: '={{ $json.text }}' } } } }] }));
  const child = seed(sourceId, wf('child','Child'));
  savePair(sourceId, targetId); chooseWorkflow(sourceId, targetId, 'parent',null); chooseWorkflow(sourceId, targetId, 'child',null);
  const plan = review([parent]);
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.items.map((i) => i.workflowId), [child, parent]);
  assert.equal(plan.items[0]!.dependency, true);
  const results = await run([parent]);
  assert.ok(results.every((r) => r.error === null));
  assert.deepEqual(writes, ['create:Child','create:Parent']);
  assert.equal(((remote.get('new-2')!.nodes[0]!.parameters!.workflowId) as { value: string }).value, 'new-1');
  assert.equal(listMappings(sourceId, targetId).filter((m) => m.kind === 'workflow').length, 2);
  writes.length = 0;
  await run([parent]); assert.deepEqual(writes, ['update:new-2']);
});

test('new cycles and dynamic workflow IDs block, while expressions in normal workflow inputs are allowed', () => {
  const parent = seed(sourceId, wf('a','A', { settings: { errorWorkflow: 'b' } }));
  seed(sourceId, wf('b','B', { settings: { errorWorkflow: 'a' } }));
  savePair(sourceId, targetId); chooseWorkflow(sourceId, targetId, 'a',null); chooseWorkflow(sourceId, targetId, 'b',null);
  assert.ok(review([parent]).blockers.some((m) => m.includes('Zyklisch')));
  const dynamic = seed(sourceId, wf('dynamic','Dynamic', { nodes: [{ name: 'Call', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { value: '={{ $json.workflow }}' } } }] }));
  chooseWorkflow(sourceId, targetId, 'dynamic',null);
  assert.ok(review([dynamic]).blockers.some((m) => m.includes('dynamisch')));
});

test('changed source versions and mapping changes invalidate a reviewed plan', async () => {
  const a = seed(sourceId, wf('a'));
  savePair(sourceId, targetId); chooseWorkflow(sourceId, targetId, 'a',null);
  const plan = review([a]);
  seed(sourceId, wf('a', 'Changed source'));
  await assert.rejects(run([a], plan.fingerprint), /geändert/);
  const second = review([a]);
  upsertMapping(sourceId, targetId, { kind: 'webhookPath', from: 'x', to: 'y' });
  await assert.rejects(run([a], second.fingerprint), /geändert/);
  assert.deepEqual(writes, []);
});

test('remote changes are backed up and block all writes before overwriting', async () => {
  const a = seed(sourceId, wf('a')); const target = seed(targetId, wf('t'));
  savePair(sourceId, targetId); chooseWorkflow(sourceId, targetId, 'a','t');
  const plan = review([a]);
  remote.set('t',wf('t','Changed in n8n'));
  await assert.rejects(run([a], plan.fingerprint), /geändert/);
  assert.deepEqual(writes, []);
  const v = db.prepare('SELECT id FROM versions WHERE workflow_id=? ORDER BY number DESC LIMIT 1').get(target) as { id: number };
  assert.equal(loadSnapshot(v.id)!.name,'Changed in n8n');
});

test('failed dependencies stop remaining writes; created target IDs survive verification failures', async () => {
  const parent = seed(sourceId, wf('p','Parent', { settings: { errorWorkflow: 'c' } })); seed(sourceId, wf('c','Child'));
  savePair(sourceId, targetId); chooseWorkflow(sourceId, targetId, 'p',null); chooseWorkflow(sourceId, targetId, 'c',null);
  mock.method(N8nClient.prototype, 'getWorkflow', async () => { throw new Error('read failed'); });
  const result = await run([parent]);
  assert.ok(result.every((r) => r.error));
  assert.deepEqual(writes, ['create:Child']);
  assert.equal(targetWorkflowFor(sourceId, targetId, 'c','Child')!.row.n8n_id, 'new-1');
  assert.equal(result[0]!.targetN8nId, 'new-1');
});

test('HTTP endpoints require pair setup and a current reviewed plan; existing mappings use the same validation', async () => {
  const express = (await import('express')).default;
  const { promoteRouter } = await import('./router.ts');
  const { renderError } = await import('../../shared/i18n/index.ts');
  const app = express(); app.use(express.json()); app.use('/promote', promoteRouter);
  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ error: renderError(err, tr) });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/promote`;
  const request = (route: string, method = 'GET', body?: unknown) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', 'Accept-Language': 'de' }, body: body ? JSON.stringify(body) : undefined });
  try {
    const a = seed(sourceId, wf('a')); const prefix = `/${sourceId}/${targetId}`;
    assert.deepEqual(await (await request('/pairs')).json(), []);
    assert.equal((await request(`${prefix}/workflows`, 'PUT', { from: 'a', to: null })).status, 409);
    assert.equal((await request(`${prefix}/pair`, 'PUT')).status, 200);
    const configured = await (await request(prefix)).json();
    assert.equal(configured.configured, true);
    assert.equal(configured.drift.counts.unpaired, 1);
    assert.equal((await request(`${prefix}/workflows`, 'PUT', { from: 'a', to: null })).status, 200);
    assert.equal((await request(`${prefix}/promote`, 'POST', { workflowIds: [a] })).status, 409);
    const plan = await (await request(`${prefix}/plan`, 'POST', { workflowIds: [a] })).json();
    assert.deepEqual(plan.blockers, []);
    assert.equal((await request(`${prefix}/promote`, 'POST', { workflowIds: [a], fingerprint: plan.fingerprint })).status, 200);
    assert.deepEqual(writes, ['create:a']);
    seed(sourceId, wf('b'));
    assert.equal((await request(`${prefix}/mappings`, 'PUT', { kind: 'workflow', from: 'b', to: 'new-1' })).status, 409);
    assert.equal((await request(`${prefix}/mappings`, 'PUT', { kind: 'workflow', from: 'b', to: 'nonexistent' })).status, 409);
  } finally { await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); }
});

test('parallel transfers to the same target are rejected', async () => {
  const a = seed(sourceId, wf('a')); seed(targetId, wf('t'));
  savePair(sourceId, targetId); chooseWorkflow(sourceId, targetId, 'a','t');
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  mock.method(N8nClient.prototype, 'getWorkflow', async (id: string) => { entered(); await wait; return structuredClone(remote.get(id)!); });
  const plan = review([a]);
  const first = run([a], plan.fingerprint);
  await started;
  await assert.rejects(run([a], plan.fingerprint), /läuft bereits/);
  release();
  assert.equal((await first)[0]!.error, null);
  assert.deepEqual(writes, ['update:t']);
});

test('verification detects silently dropped settings and retains the actual target version', async () => {
  const a = seed(sourceId, wf('a','a', { settings: { timezone: 'Europe/Berlin' } }));
  savePair(sourceId, targetId); chooseWorkflow(sourceId, targetId, 'a',null);
  mock.method(N8nClient.prototype, 'createWorkflow', async (body: N8nWorkflow) => {
    writes.push('create'); const value = wf('dropped', body.name, { settings: {}, nodes: body.nodes, connections: body.connections }); remote.set('dropped',value); return value;
  });
  const result = await run([a]);
  assert.match(result[0]!.error!, /entspricht nicht/);
  assert.equal(result[0]!.targetN8nId,'dropped');
  assert.equal(targetWorkflowFor(sourceId,targetId,'a','a')!.row.n8n_id,'dropped');
});

test('cross-instance copies require confirmed valid references and do not replace existing workflow pairing', async () => {
  const a = seed(sourceId, wf('a','A', { settings: { errorWorkflow: 'errors' } }));
  seed(sourceId,wf('errors','Errors')); seed(targetId,wf('target-errors','Errors')); seed(targetId,wf('target-a','A'));
  savePair(sourceId,targetId); chooseWorkflow(sourceId,targetId,'a','target-a'); chooseWorkflow(sourceId,targetId,'errors','target-errors');
  const version = (db.prepare('SELECT id FROM versions WHERE workflow_id=?').get(a) as { id: number }).id;
  const result = await restoreVersion(version,{ mode: 'copy',targetInstanceId: targetId });
  assert.equal(result.n8nId,'new-1');
  assert.equal(remote.get('new-1')!.settings!.errorWorkflow,'target-errors');
  assert.equal(targetWorkflowFor(sourceId,targetId,'a','A')!.row.n8n_id,'target-a');
  db.prepare("UPDATE workflows SET deleted_at=1 WHERE instance_id=? AND n8n_id='target-errors'").run(targetId);
  await assert.rejects(restoreVersion(version,{ mode: 'copy',targetInstanceId: targetId }));
});

test('explicitly selected existing sub-workflows are updated before selected callers', async () => {
  const parent = seed(sourceId, wf('p','Parent', { settings: { errorWorkflow: 'c' } }));
  const child = seed(sourceId, wf('c','Child'));
  seed(targetId,wf('tp','Parent')); seed(targetId,wf('tc','Child'));
  savePair(sourceId,targetId); chooseWorkflow(sourceId,targetId,'p','tp'); chooseWorkflow(sourceId,targetId,'c','tc');
  assert.deepEqual(review([parent]).items.map((i) => i.workflowId), [parent]);
  assert.deepEqual(review([parent,child]).items.map((i) => i.workflowId), [child,parent]);
  const results = await run([parent,child]);
  assert.ok(results.every((r) => !r.error));
  assert.deepEqual(writes,['update:tc','update:tp']);
});
