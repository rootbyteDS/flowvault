import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY_MS, heatmapData, isHeatmapPeriod, periodStart } from './heatmap.ts';

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const today = day('2026-11-09');

test('automatic period grows at history boundaries and stops at twelve months', () => {
  assert.equal(heatmapData([], null, 'auto', today).period, '4w');
  for (const [age, expected] of [[27, '4w'], [28, '3m'], [92, '6m'], [184, '12m'], [800, '12m']] as const) {
    assert.equal(heatmapData([], (today - age) * DAY_MS, 'auto', today).period, expected);
  }
  assert.equal(heatmapData([], today * DAY_MS, '12m', today).period, '12m');
});

test('calendar ranges handle leap years and clamp month ends', () => {
  assert.equal(periodStart('12m', day('2024-02-29')), day('2023-03-01'));
  assert.equal(periodStart('3m', day('2026-05-31')), day('2026-03-01'));
  assert.equal(periodStart('4w', today), today - 27);
});

test('totals exclude padding, future days and days before the first backup', () => {
  const data = heatmapData([
    { day: today - 28, n: 100 }, { day: today - 27, n: 100 },
    { day: today - 2, n: 2 }, { day: today, n: 3 }, { day: today + 1, n: 100 },
  ], (today - 3) * DAY_MS, '4w', today);
  assert.equal(data.total, 5);
  assert.equal(data.max, 3);
  const cells = data.grid.flat();
  assert.equal(new Date(cells[0].day * DAY_MS).getUTCDay(), 1);
  assert.equal(cells.find((c) => c.day === today - 4)?.before, true);
  assert.equal(cells.find((c) => c.day === today - 3)?.n, 0);
  assert.equal(cells.find((c) => c.day === today + 1)?.outside, true);
});

test('a quiet year still displays recorded zero-change days', () => {
  const data = heatmapData([], (today - 800) * DAY_MS, 'auto', today);
  assert.equal(data.period, '12m');
  assert.equal(data.total, 0);
  assert.ok(data.grid.flat().filter((c) => !c.outside).every((c) => !c.before && c.n === 0));
});

test('saved periods must be recognized values', () => {
  assert.ok(isHeatmapPeriod('auto'));
  assert.ok(isHeatmapPeriod('6m'));
  assert.equal(isHeatmapPeriod('30d'), false);
  assert.equal(isHeatmapPeriod(null), false);
});
