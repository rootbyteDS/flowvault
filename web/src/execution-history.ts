import type { ExecutionDay, ExecutionHistory } from '../../shared/executions.ts';
import { heatmapData, type HeatmapPeriod } from './heatmap.ts';

export type ExecutionMetric = 'rate' | 'count';

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

/** Stable bands, never scaled to the busiest day in the selected period. */
export function executionLevel(day: Pick<ExecutionDay, 'success' | 'failed'>, metric: ExecutionMetric): number {
  const total = day.success + day.failed;
  if (!total) return -1;
  if (!day.failed) return 0;
  const value = metric === 'rate' ? day.failed / total : day.failed;
  const [low, medium, high] = metric === 'rate' ? [0.01, 0.05, 0.2] : [5, 20, 100];
  return value <= low ? 1 : value <= medium ? 2 : value <= high ? 3 : 4;
}
