import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvault-failures-'));
const previousDir = process.env.HEALTH_DATA_DIR;
process.env.HEALTH_DATA_DIR = directory;
const { db, getSettings, saveSettings } = await import('./db.ts');
const { createFailuresRouter, recentFailures, runSummary } = await import('./failures.ts');

const NOW = Date.parse('2026-11-12T12:00:00Z');
const HOUR = 3600_000;
let seq = 1;
function insert(instance: number, workflow: string, status: string, ago: number, node: string | null = null, message: string | null = null, mode = 'trigger') {
  db.prepare(`INSERT INTO executions (instance_id, id, seq, workflow_n8n_id, status, mode, started_at, error_node, error_message)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(instance, String(seq), seq++, workflow, status, mode, NOW - ago, node, message);
}

beforeEach(() => {
  db.exec('DELETE FROM executions; DELETE FROM settings;');
  seq = 1;
});
after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
  if (previousDir === undefined) delete process.env.HEALTH_DATA_DIR; else process.env.HEALTH_DATA_DIR = previousDir;
});

test('groups failures by workflow, node and message and reports whether the workflow recovered', () => {
  insert(1, 'wfA', 'error', 3 * HOUR, 'HTTP Request', 'boom');
  insert(1, 'wfA', 'error', 2 * HOUR, 'HTTP Request', 'boom');
  insert(1, 'wfA', 'success', 1 * HOUR);
  insert(1, 'wfB', 'crashed', 0.5 * HOUR);
  insert(1, 'wfB', 'error', 0.1 * HOUR, 'Code', 'manual run', 'manual');
  insert(1, 'wfC', 'error', 30 * HOUR, 'Old', 'too old');
  insert(2, 'wfA', 'error', 1 * HOUR, 'Other', 'other instance');

  const r = recentFailures(db, getSettings(), { hours: 24, limit: 20, instances: [1] }, NOW);
  assert.deepEqual(r.groups.map((g) => [g.workflowN8nId, g.node, g.count, g.firstAt, g.lastAt]), [
    ['wfB', null, 1, NOW - 0.5 * HOUR, NOW - 0.5 * HOUR],
    ['wfA', 'HTTP Request', 2, NOW - 3 * HOUR, NOW - 2 * HOUR],
  ]);
  assert.deepEqual(r.lastRuns.map((l) => [l.workflowN8nId, l.status]), [['wfB', 'crashed'], ['wfA', 'success']]);
  assert.equal(r.truncated, false);

  assert.equal(recentFailures(db, getSettings(), { hours: 24, limit: 20, instances: [] }, NOW).groups.length, 3);
  const limited = recentFailures(db, getSettings(), { hours: 24, limit: 1, instances: [1] }, NOW);
  assert.equal(limited.groups.length, 1);
  assert.equal(limited.truncated, true);
});

test('manual runs count only when the setting says so', () => {
  insert(1, 'wfB', 'error', HOUR, 'Code', 'manual run', 'manual');
  assert.equal(recentFailures(db, getSettings(), { hours: 24, limit: 20, instances: [] }, NOW).groups.length, 0);
  saveSettings({ includeManual: true });
  assert.equal(recentFailures(db, getSettings(), { hours: 24, limit: 20, instances: [] }, NOW).groups.length, 1);
});

test('summary counts finished runs and failures per instance', () => {
  insert(1, 'wfA', 'success', HOUR);
  insert(1, 'wfA', 'error', HOUR);
  insert(1, 'wfA', 'crashed', HOUR);
  insert(1, 'wfA', 'running', HOUR);
  insert(1, 'wfA', 'error', 25 * HOUR);
  insert(2, 'wfA', 'canceled', HOUR);
  assert.deepEqual(runSummary(db, getSettings(), { hours: 24, instances: [] }, NOW), [
    { instanceId: 1, runs: 3, failed: 2 },
    { instanceId: 2, runs: 1, failed: 0 },
  ]);
  assert.deepEqual(runSummary(db, getSettings(), { hours: 24, instances: [2] }, NOW), [{ instanceId: 2, runs: 1, failed: 0 }]);
});

test('router validates its parameters', async () => {
  const app = express();
  app.use('/v1', createFailuresRouter(db, getSettings));
  app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/executions`;
  try {
    assert.equal((await fetch(`${base}/failures?instances=1,2&hours=48&limit=5`)).status, 200);
    assert.equal((await fetch(`${base}/failures?instances=1;DROP`)).status, 400);
    assert.equal((await fetch(`${base}/summary?hours=abc`)).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
