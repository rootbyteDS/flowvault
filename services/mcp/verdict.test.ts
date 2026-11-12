import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overall, verdict, type InstanceFacts, type Thresholds } from './verdict.ts';

const now = 1_800_000_000_000;
const t: Thresholds = { healthEnabled: true, pollMinutes: 5, minRuns: 5, thresholdPct: 20 };
const ok: InstanceFacts = {
  enabled: true, syncIntervalMin: 15, lastSyncAt: now - 60_000, lastSyncOk: true, pollOk: true, lastPollAt: now - 60_000,
  incomplete: false, openAlerts: 0, runs24h: 100, failed24h: 0,
};
const codes = (f: Partial<InstanceFacts>, th: Thresholds = t) => {
  const v = verdict({ ...ok, ...f }, th, now);
  return [v.level, ...v.reasons.map((r) => r.code)].join(' ');
};

test('each reason on its own', () => {
  assert.equal(codes({}), 'ok');
  assert.equal(codes({ enabled: false, lastSyncOk: false, openAlerts: 3 }), 'disabled');
  assert.equal(codes({ lastSyncOk: false }), 'critical sync_failed');
  assert.equal(codes({ lastSyncAt: null, lastSyncOk: null }), 'warning never_synced');
  assert.equal(codes({ lastSyncAt: now - 46 * 60_000 }), 'warning sync_overdue');
  assert.equal(codes({ lastSyncAt: now - 44 * 60_000 }), 'ok');
  assert.equal(codes({ syncIntervalMin: 0, lastSyncAt: now - 9e9 }), 'ok', 'manual sync is never overdue');
  assert.equal(codes({ lastPollAt: null }, { ...t, healthEnabled: null }), 'warning health_unavailable');
  assert.equal(codes({ lastPollAt: null }, { ...t, healthEnabled: false }), 'warning health_disabled');
  assert.equal(codes({ pollOk: false, lastPollAt: now }), 'critical poll_failed');
  assert.equal(codes({ lastPollAt: now - 16 * 60_000 }), 'warning poll_overdue');
  assert.equal(codes({ lastPollAt: null }), 'warning poll_overdue');
  assert.equal(codes({ incomplete: true }), 'warning history_incomplete');
  assert.equal(codes({ openAlerts: 1 }), 'critical open_alerts');
  assert.equal(codes({ failed24h: 3 }), 'warning failures_24h');
  assert.equal(codes({ failed24h: 20 }), 'critical failure_rate_high');
  assert.equal(codes({ runs24h: 4, failed24h: 4 }), 'warning failures_24h', 'too few runs for a rate');
});

test('combinations keep every reason and take the worst level', () => {
  assert.equal(codes({ openAlerts: 1, incomplete: true }), 'critical history_incomplete open_alerts');
  assert.equal(codes({ lastSyncAt: now - 46 * 60_000, failed24h: 1 }), 'warning sync_overdue failures_24h');
  assert.equal(codes({ lastSyncOk: false, pollOk: false, failed24h: 50 }), 'critical sync_failed poll_failed failure_rate_high');
});

test('overall ignores disabled instances', () => {
  assert.equal(overall([]), 'ok');
  assert.equal(overall(['ok', 'disabled']), 'ok');
  assert.equal(overall(['ok', 'warning', 'disabled']), 'warning');
  assert.equal(overall(['warning', 'critical']), 'critical');
});
