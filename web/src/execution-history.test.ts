import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExecutionHistory } from '../../shared/executions.ts';
import { defaultDashboardLayout, normalizeDashboardLayout } from '../../shared/dashboard.ts';
import { executionHeatmap, executionLevel } from './execution-history.ts';
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
