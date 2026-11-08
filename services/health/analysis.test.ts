import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, type Exec, type TimelineVersion } from './analysis.ts';

const H = 3600_000;
const T0 = Date.parse('2026-01-01T00:00:00Z');
const ver = (number: number, at: number, n8nVersionId: string | null = null): TimelineVersion => ({
  id: 100 + number,
  number,
  n8nVersionId,
  n8nUpdatedAt: new Date(at).toISOString(),
  createdAt: at + 5 * 60_000, // Sicherung kommt später als das Speichern in n8n
});
const run = (at: number, ok: boolean, node: string | null = null, extra: Partial<Exec> = {}): Exec => ({
  status: ok ? 'success' : 'error',
  mode: 'trigger',
  startedAt: at,
  workflowVersionId: null,
  errorNode: ok ? null : node,
  errorMessage: ok ? null : 'boom',
  ...extra,
});
const runs = (from: number, n: number, failEvery: number, node = 'HTTP Request') =>
  Array.from({ length: n }, (_, i) => run(from + i * 60_000, failEvery ? i % failEvery !== 0 : true, node));

test('ordnet Läufe nach n8n-Speicherzeit zu, nicht nach Sicherungszeit', () => {
  const r = analyze([ver(1, T0), ver(2, T0 + H)], [run(T0 + H + 60_000, false, 'Slack')], { minRuns: 1, thresholdPct: 20, includeManual: false });
  assert.equal(r.versions[0].number, 2);
  assert.equal(r.versions[0].failed, 1);
  assert.equal(r.versions[1].total, 0);
});

test('erkennt gestiegene Fehlerquote und schlägt die stabile Version vor', () => {
  const versions = [ver(13, T0), ver(14, T0 + 10 * H)];
  const execs = [...runs(T0 + 60_000, 20, 0), ...runs(T0 + 10 * H + 60_000, 10, 2)];
  const r = analyze(versions, execs);
  const v14 = r.versions[0];
  assert.equal(v14.number, 14);
  assert.equal(v14.rate, 0.5);
  assert.equal(v14.baseline?.rate, 0);
  assert.equal(v14.regression, true);
  assert.equal(v14.rollback?.number, 13);
  assert.equal(v14.failingNodes[0].name, 'HTTP Request');
  assert.equal(v14.failingNodes[0].isNew, true);
});

test('keine Warnung bei zu wenigen Läufen', () => {
  const r = analyze([ver(1, T0), ver(2, T0 + H)], [...runs(T0, 10, 0), run(T0 + 2 * H, false, 'X'), run(T0 + 3 * H, false, 'X')]);
  assert.equal(r.versions[0].regression, false);
});

test('Testläufe aus dem Editor zählen standardmäßig nicht', () => {
  const r = analyze([ver(1, T0)], [run(T0 + H, false, 'X', { mode: 'manual' }), run(T0 + H, true)]);
  assert.equal(r.versions[0].total, 1);
  assert.equal(r.versions[0].failed, 0);
});

test('workflowVersionId hat Vorrang vor dem Zeitstempel', () => {
  const r = analyze([ver(1, T0, 'a'), ver(2, T0 + H, 'b')], [run(T0 + 2 * H, false, 'X', { workflowVersionId: 'a' })], {
    minRuns: 1,
    thresholdPct: 20,
    includeManual: false,
  });
  assert.equal(r.versions[1].failed, 1);
  assert.equal(r.versions[0].total, 0);
});

test('Läufe vor der ersten Sicherung sind keiner Version zugeordnet', () => {
  const r = analyze([ver(1, T0)], [run(T0 - H, true)]);
  assert.equal(r.unattributed, 1);
});

test('Vergleichsbasis überspringt Versionen ohne Läufe', () => {
  const versions = [ver(1, T0), ver(2, T0 + 5 * H), ver(3, T0 + 5 * H + 60_000)];
  const execs = [...runs(T0 + 60_000, 10, 0), ...runs(T0 + 6 * H, 10, 1)];
  const v3 = analyze(versions, execs).versions[0];
  assert.equal(v3.rate, 1);
  assert.equal(v3.baseline?.fromNumber, 1);
  assert.equal(v3.rollback?.number, 1);
});
