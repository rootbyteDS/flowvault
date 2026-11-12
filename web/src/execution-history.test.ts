import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExecutionHistory } from '../../shared/executions.ts';
import { defaultDashboardLayout, normalizeDashboardLayout } from '../../shared/dashboard.ts';
import { DEFAULT_RATE_THRESHOLDS, executionHeatmap, executionLevel, isRateThresholds, normalizeExecutionPreferences } from './execution-history.ts';
import { DAY_MS } from './heatmap.ts';

const today = Date.parse('2026-11-11T00:00:00Z') / DAY_MS;
const history = (days: ExecutionHistory['days']): ExecutionHistory => ({
  days, availableFrom: days.length ? Math.min(...days.map((d) => d.day)) * DAY_MS : null,
  availableTo: days.length ? Math.max(...days.map((d) => d.day)) * DAY_MS : null,
  settings: { enabled: true, pollMinutes: 5, lookbackDays: 14, retentionDays: 30, includeManual: false }, instances: [],
});

test('visible totals and weighted error rate use the selected days, never calendar padding or an average of daily rates', () => {
  const data = history([
    { day: today - 28, success: 0, failed: 500, canceled: 0 },
    { day: today - 27, success: 99, failed: 1, canceled: 2 },
    { day: today, success: 0, failed: 1, canceled: 3 },
    { day: today + 1, success: 0, failed: 500, canceled: 0 },
  ]);
  const chart = executionHeatmap(data, '4w', today);
  assert.equal(chart.total, 101);
  assert.equal(chart.failed, 2);
  assert.equal(chart.canceled, 5);
  assert.equal(chart.rate, 2 / 101);
  assert.ok(chart.grid.flat().filter((c) => c.outside).every((c) => c.failed === 0));
});

test('no data, empty days and cancellations alone stay neutral with no error rate', () => {
  const empty = executionHeatmap(history([]), 'auto', today);
  assert.equal(empty.period, '4w');
  assert.equal(empty.rate, null);
  assert.ok(empty.grid.flat().every((c) => executionLevel(c, 'rate') === -1));
  const canceled = executionHeatmap(history([{ day: today, success: 0, failed: 0, canceled: 10 }]), '4w', today);
  assert.equal(canceled.total, 0);
  assert.equal(canceled.rate, null);
  assert.equal(canceled.canceled, 10);
  assert.equal(executionLevel(canceled.grid.flat().find((c) => c.day === today)!, 'count'), -1);
});

test('fixed color bands distinguish absolute volume from error rate and keep exact boundaries', () => {
  for (const [failed, success, expected] of [[0, 100, 0], [1, 99, 1], [5, 95, 2], [20, 80, 3], [21, 79, 4], [1, 0, 4]]) {
    assert.equal(executionLevel({ success, failed }, 'rate'), expected);
  }
  for (const [failed, expected] of [[0, 0], [1, 1], [5, 1], [6, 2], [20, 2], [21, 3], [100, 3], [101, 4]]) {
    assert.equal(executionLevel({ success: 100, failed }, 'count'), expected);
  }
});

test('automatic history period grows with available runs, and existing dashboard layouts include the new widget', () => {
  const chart = executionHeatmap(history([{ day: today - 50, success: 1, failed: 0, canceled: 0 }]), 'auto', today);
  assert.equal(chart.period, '3m');
  assert.equal(defaultDashboardLayout().widgets.executions.visible, true);
  assert.equal(normalizeDashboardLayout({ version: 1, widgets: { history: { visible: false } } }).widgets.executions.visible, true);
  assert.equal(normalizeDashboardLayout({ version: 1, widgets: { executions: { visible: false } } }).widgets.executions.visible, false);
});

test('custom percent thresholds apply inclusively, including fractional percentage boundaries', () => {
  for (const [failed, expected] of [[0, 0], [2, 1], [3, 2], [10, 2], [11, 3], [40, 3], [41, 4], [100, 4]]) {
    assert.equal(executionLevel({ success: 100 - failed, failed }, 'rate', [0, 2, 10, 40]), expected);
  }
  for (const [failed, expected] of [[7, 1], [8, 2], [29, 2], [30, 3], [99, 3], [100, 4]]) {
    assert.equal(executionLevel({ success: 10000 - failed, failed }, 'rate', [0, 0.07, 0.29, 0.99]), expected);
  }
  assert.equal(executionLevel({ success: 9999, failed: 1 }, 'rate', [0, 0.01, 0.02, 0.03]), 1);
});

test('a green limit of 0.3 percent includes small error rates and the exact boundary', () => {
  for (const [failed, expected] of [[0, 0], [1, 0], [3, 0], [4, 1], [10, 1], [11, 2], [50, 2], [51, 3], [200, 3], [201, 4]]) {
    assert.equal(executionLevel({ success: 1000 - failed, failed }, 'rate', [0.3, 1, 5, 20]), expected);
  }
  assert.equal(executionLevel({ success: 0, failed: 0 }, 'rate', [0.3, 1, 5, 20]), -1);
});

test('threshold validation rejects ambiguous, unordered or unusable color ranges', () => {
  assert.equal(isRateThresholds([0, 0.01, 0.1, 99.99]), true);
  assert.equal(isRateThresholds(DEFAULT_RATE_THRESHOLDS), true);
  for (const invalid of [null, {}, [], [1, 5], [1, 5, 20], [0, 1, 5, 20, 30], [0, '1', 5, 20], [-1, 1, 5, 20],
    [0, 1, 1, 20], [0, 5, 1, 20], [0, 1, 5, 100], [0, 1, 5, 101], [0.001, 1, 5, 20], [0, 1, 5.555, 20], [NaN, 1, 5, 20], [0, 1, 5, Infinity]]) {
    assert.equal(isRateThresholds(invalid), false, String(invalid));
  }
});

test('existing widget preferences migrate and custom thresholds survive storage round trips', () => {
  const old = { period: '6m', metric: 'count', instance: '42' };
  assert.deepEqual(normalizeExecutionPreferences(old), { ...old, rateThresholds: [0, 1, 5, 20] });
  const custom = { ...old, metric: 'rate', rateThresholds: [0.3, 1, 3.5, 12] };
  assert.deepEqual(normalizeExecutionPreferences(JSON.parse(JSON.stringify(custom))), custom);
  assert.deepEqual(normalizeExecutionPreferences({ ...old, rateThresholds: [0.25, 3.5, 12] }), {
    ...old, rateThresholds: [0, 0.25, 3.5, 12],
  });
  for (const invalid of [[1, 1, 20], [0, 10, 20], 'broken', null]) {
    assert.deepEqual(normalizeExecutionPreferences({ ...old, rateThresholds: invalid }), { ...old, rateThresholds: [0, 1, 5, 20] });
  }
  assert.deepEqual(normalizeExecutionPreferences(null), { period: 'auto', metric: 'rate', instance: 'all', rateThresholds: [0, 1, 5, 20] });
  assert.notEqual(normalizeExecutionPreferences(null).rateThresholds, DEFAULT_RATE_THRESHOLDS);
});

test('percentage preferences never recolor count mode, missing runs or error-free days', () => {
  for (const failed of [0, 1, 5, 6, 20, 21, 100, 101]) {
    assert.equal(executionLevel({ success: 100, failed }, 'count', [5, 10, 20, 30]), executionLevel({ success: 100, failed }, 'count'));
  }
  assert.equal(executionLevel({ success: 0, failed: 0 }, 'rate', [0, 10, 20, 30]), -1);
  assert.equal(executionLevel({ success: 1, failed: 0 }, 'rate', [0, 10, 20, 30]), 0);
});
