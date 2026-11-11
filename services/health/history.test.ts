import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { ExecutionPage, SlimExecution } from '../../shared/executions.ts';
import { createExecutionHistoryRouter, executionHistory } from './history.ts';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvault-history-'));
const previousDir = process.env.HEALTH_DATA_DIR;
process.env.HEALTH_DATA_DIR = directory;
// Reproduce an existing database, including an old poll_state row.
const old = new DatabaseSync(path.join(directory, 'health.db'));
old.exec(`CREATE TABLE poll_state (instance_id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
  last_poll_at INTEGER, ok INTEGER, error TEXT, error_seq INTEGER NOT NULL DEFAULT 0);
  INSERT INTO poll_state (instance_id, name, last_poll_at, ok) VALUES (99, 'Legacy', 1234, 1);`);
old.close();
const { db, getSettings, saveSettings } = await import('./db.ts');
const migrated = db.prepare('SELECT * FROM poll_state WHERE instance_id = 99').get();
const { core } = await import('./core.ts');
const { pollInstance } = await import('./poller.ts');

const DAY = 864e5;
const MIDNIGHT = Date.parse('2026-11-11T00:00:00Z');
const NOW = MIDNIGHT + 12 * 3600_000;
let seq = 1;
function insert(instance: number, status: string, started = MIDNIGHT, mode = 'trigger') {
  db.prepare(`INSERT INTO executions (instance_id,id,seq,workflow_n8n_id,status,mode,started_at,error_message)
    VALUES (?,?,?,?,?,?,?,?)`).run(instance, String(seq), seq++, 'workflow', status, mode, started, 'not for the dashboard');
}
function slim(id: number): SlimExecution {
  return { id: String(id), workflowId: 'workflow', status: 'success', mode: 'trigger', startedAt: new Date(NOW).toISOString(),
    stoppedAt: new Date(NOW).toISOString(), workflowVersionId: null, errorNode: null, errorMessage: null };
}

const app = express();
app.use('/v1', createExecutionHistoryRouter(db, getSettings));
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.status ?? 500).json({ error: err.message });
});
const server = app.listen(0, '127.0.0.1');
let base: string;
before(async () => {
  if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/executions/history`;
});
beforeEach(() => {
  db.exec('DELETE FROM executions; DELETE FROM poll_state; DELETE FROM settings; DELETE FROM alerts;');
  seq = 1;
  mock.method(Date, 'now', () => NOW);
});
afterEach(() => mock.restoreAll());
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
  if (previousDir === undefined) delete process.env.HEALTH_DATA_DIR; else process.env.HEALTH_DATA_DIR = previousDir;
});

test('existing poll state migrates without inventing successful collection timestamps', () => {
  assert.equal(migrated?.name, 'Legacy');
  assert.equal(migrated?.last_poll_at, 1234);
  assert.equal(migrated?.last_success_at, null);
  assert.equal(migrated?.incomplete_until, null);
});

test('UTC daily totals count errors and crashes, exclude unfinished/manual runs, and separate cancellations', () => {
  insert(1, 'success', MIDNIGHT - 1);
  for (const status of ['success', 'error', 'crashed', 'canceled', 'running', 'waiting', 'new', 'unknown']) insert(1, status);
  insert(1, 'error', MIDNIGHT, 'manual');
  const result = executionHistory(db, getSettings());
  assert.deepEqual(result.days.map((d) => ({ ...d })), [
    { day: Math.floor(MIDNIGHT / DAY) - 1, success: 1, failed: 0, canceled: 0 },
    { day: Math.floor(MIDNIGHT / DAY), success: 1, failed: 2, canceled: 1 },
  ]);
  assert.equal(result.availableFrom, MIDNIGHT - 1);
  assert.equal(result.availableTo, MIDNIGHT);
  saveSettings({ includeManual: true });
  assert.equal(executionHistory(db, getSettings()).days[1].failed, 3);
});

test('instance selection and retention apply to counts and range even when collection is disabled', () => {
  insert(1, 'success', NOW - 31 * DAY);
  insert(1, 'error', NOW - 30 * DAY);
  insert(1, 'error', NOW + 1);
  insert(2, 'success', NOW - DAY);
  saveSettings({ enabled: false });
  const one = executionHistory(db, getSettings(), 1);
  assert.equal(one.days.length, 1);
  assert.equal(one.days[0].failed, 1);
  assert.equal(one.availableFrom, NOW - 30 * DAY);
  assert.equal(one.availableTo, NOW - 30 * DAY);
  assert.equal(one.settings.enabled, false);
  assert.equal(executionHistory(db, getSettings(), 2).days[0].success, 1);
  assert.deepEqual(executionHistory(db, getSettings(), 999).days, []);
  assert.equal(executionHistory(db, getSettings(), 999).availableFrom, null);
});

test('history endpoint returns aggregates only, validates instance IDs and performs no collector requests', async () => {
  insert(1, 'error'); insert(2, 'success');
  const requests = mock.method(core, 'executions', async () => { throw new Error('must not request n8n'); });
  const response = await fetch(`${base}?instance=1`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.days.length, 1);
  assert.equal(body.days[0].failed, 1);
  assert.equal(body.days[0].success, 0);
  assert.equal(JSON.stringify(body).includes('not for the dashboard'), false);
  assert.equal(requests.mock.callCount(), 0);
  for (const query of ['instance=0', 'instance=-1', 'instance=1.5', 'instance=abc', 'instance=1&instance=2', 'instance=9007199254740992']) {
    assert.equal((await fetch(`${base}?${query}`)).status, 400);
  }
});

test('failed polls preserve last successful collection and incomplete history warnings survive later success', async () => {
  let fail = false, run = 100;
  mock.method(core, 'executions', async (): Promise<ExecutionPage> => {
    if (fail) throw new Error('offline');
    return { data: [slim(++run)], nextCursor: null };
  });
  mock.method(core, 'instanceTimeline', async () => []);
  await pollInstance({ id: 1, name: 'Test', enabled: 1 });
  assert.equal(executionHistory(db, getSettings()).instances[0].lastSuccessAt, NOW);
  fail = true;
  mock.method(console, 'warn', () => {});
  await pollInstance({ id: 1, name: 'Test', enabled: 1 });
  const state = executionHistory(db, getSettings()).instances[0];
  assert.equal(state.ok, false);
  assert.equal(state.lastSuccessAt, NOW);
  assert.equal(state.incomplete, true);
  fail = false;
  await pollInstance({ id: 1, name: 'Test', enabled: 1 });
  assert.equal(executionHistory(db, getSettings()).instances[0].ok, true);
  assert.equal(executionHistory(db, getSettings()).instances[0].incomplete, true);
  assert.equal(executionHistory(db, getSettings(), 1, NOW + 31 * DAY).instances[0].incomplete, false);
});

test('page limits flag incomplete counts; reaching a known ID without exhausting the limit does not', async () => {
  let pages = 0;
  const requests = mock.method(core, 'executions', async (_id: number, query: Parameters<typeof core.executions>[1]): Promise<ExecutionPage> => query.status
    ? { data: [], nextCursor: null }
    : { data: [slim(1000 - pages++)], nextCursor: 'more' });
  mock.method(core, 'instanceTimeline', async () => []);
  await pollInstance({ id: 1, name: 'Busy', enabled: 1 });
  assert.equal(pages, 40);
  assert.equal(executionHistory(db, getSettings()).instances[0].incomplete, true);
  requests.mock.restore();
  db.exec('DELETE FROM poll_state;');
  mock.method(core, 'executions', async (): Promise<ExecutionPage> => ({ data: [slim(1000)], nextCursor: 'more' }));
  await pollInstance({ id: 1, name: 'Busy', enabled: 1 });
  assert.equal(executionHistory(db, getSettings()).instances[0].incomplete, false);
});
