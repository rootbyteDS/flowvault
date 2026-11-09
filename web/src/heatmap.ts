export const HEATMAP_PERIODS = ['auto', '4w', '3m', '6m', '12m'] as const;
export type HeatmapPeriod = typeof HEATMAP_PERIODS[number];
export type FixedPeriod = Exclude<HeatmapPeriod, 'auto'>;
export const DAY_MS = 864e5;

export function isHeatmapPeriod(value: unknown): value is HeatmapPeriod {
  return HEATMAP_PERIODS.some((period) => period === value);
}

/** UTC days match the API's daily aggregation; month ends are clamped. */
export function periodStart(period: FixedPeriod, today: number): number {
  if (period === '4w') return today - 27;
  const date = new Date(today * DAY_MS);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - Number.parseInt(period));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return Math.floor(date.getTime() / DAY_MS) + 1;
}

export function heatmapData(days: { day: number; n: number }[], firstBackup: number | null, choice: HeatmapPeriod, today: number) {
  const firstDay = firstBackup === null ? null : Math.floor(firstBackup / DAY_MS);
  const period = choice === 'auto'
    ? (['4w', '3m', '6m'] as const).find((p) => firstDay === null || firstDay >= periodStart(p, today)) ?? '12m'
    : choice;
  const start = periodStart(period, today);
  const dow = (new Date(start * DAY_MS).getUTCDay() + 6) % 7;
  const gridStart = start - dow;
  const weeks = Math.ceil((today - gridStart + 1) / 7);
  const map = new Map(days.map((d) => [d.day, d.n]));
  let total = 0, max = 0;
  const grid = Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => {
    const day = gridStart + w * 7 + d;
    const outside = day < start || day > today;
    const before = firstDay === null || day < firstDay;
    const n = outside || before ? -1 : map.get(day) ?? 0;
    if (n > 0) { total += n; max = Math.max(max, n); }
    return { day, n, outside, before };
  }));
  return { period, grid, weeks, total, max };
}
