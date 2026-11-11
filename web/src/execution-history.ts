import type { ExecutionDay, ExecutionHistory } from '../../shared/executions.ts';
import { heatmapData, isHeatmapPeriod, type HeatmapPeriod } from './heatmap.ts';

export type ExecutionMetric = 'rate' | 'count';
export type RateThresholds = readonly [number, number, number]; // upper bounds in percent
export const DEFAULT_RATE_THRESHOLDS: RateThresholds = [1, 5, 20];

export function isRateThresholds(value: unknown): value is RateThresholds {
  return Array.isArray(value) && value.length === 3 && value.every((n, i) =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0.01 && n <= 99.99 &&
    Math.round(n * 100) / 100 === n && (i === 0 || n > value[i - 1]));
}

export interface ExecutionPreferences {
  period: HeatmapPeriod;
  metric: ExecutionMetric;
  instance: string;
  rateThresholds: RateThresholds;
}

/** Keep existing preferences when upgrading; reject corrupt color scales. */
export function normalizeExecutionPreferences(value: unknown): ExecutionPreferences {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    period: isHeatmapPeriod(stored.period) ? stored.period : 'auto',
    metric: stored.metric === 'count' ? 'count' : 'rate',
    instance: typeof stored.instance === 'string' && /^[1-9]\d*$/.test(stored.instance) && Number.isSafeInteger(Number(stored.instance)) ? stored.instance : 'all',
    rateThresholds: isRateThresholds(stored.rateThresholds) ? [...stored.rateThresholds] : [...DEFAULT_RATE_THRESHOLDS],
  };
}

export function executionHeatmap(history: ExecutionHistory, choice: HeatmapPeriod, today: number) {
  const base = heatmapData(history.days.map((d) => ({ day: d.day, n: d.success + d.failed + d.canceled })), history.availableFrom, choice, today);
  const days = new Map(history.days.map((d) => [d.day, d]));
  let success = 0, failed = 0, canceled = 0;
  const grid = base.grid.map((col) => col.map((cell) => {
    const counts = (!cell.outside && days.get(cell.day)) || { success: 0, failed: 0, canceled: 0 };
    success += counts.success; failed += counts.failed; canceled += counts.canceled;
    return { ...cell, ...counts };
  }));
  const total = success + failed;
  return { grid, weeks: base.weeks, period: base.period, success, failed, canceled, total, rate: total ? failed / total : null };
}

/** Configurable percent bands; count bands remain fixed and independent. */
export function executionLevel(day: Pick<ExecutionDay, 'success' | 'failed'>, metric: ExecutionMetric, thresholds: RateThresholds = DEFAULT_RATE_THRESHOLDS): number {
  const total = day.success + day.failed;
  if (!total) return -1;
  if (!day.failed) return 0;
  const bounds = isRateThresholds(thresholds) ? thresholds : DEFAULT_RATE_THRESHOLDS;
  // Compare integer basis points to avoid rounding a day into the next band.
  const value = metric === 'rate' ? day.failed * 10000 : day.failed;
  const [low, medium, high] = metric === 'rate' ? bounds.map((n) => Math.round(n * 100) * total) : [5, 20, 100];
  return value <= low ? 1 : value <= medium ? 2 : value <= high ? 3 : 4;
}
