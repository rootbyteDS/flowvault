import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WIDGET_IDS } from '../../shared/dashboard.ts';
import { nearestPackedWidget, packDashboard, type PackedWidget, type PackingItem } from './dashboard-packing.ts';

function noOverlap(items: PackedWidget[], width: number, gap: number) {
  for (const [i, a] of items.entries()) {
    assert.ok(a.left >= 0 && a.left + a.width <= width + 1e-8);
    for (const b of items.slice(i + 1)) assert.ok(
      a.column + a.columns <= b.column || b.column + b.columns <= a.column ||
      a.top + a.height + gap <= b.top || b.top + b.height + gap <= a.top,
      `${a.id} overlaps ${b.id}`);
  }
}

test('screenshot regression: Versions fits below Instances beside a tall execution history', () => {
  const layout = packDashboard([
    { id: 'health', columns: 12, height: 60 },
    { id: 'instanceCount', columns: 3, height: 240 },
    { id: 'workflowCount', columns: 3, height: 240 },
    { id: 'executions', columns: 6, height: 1000 },
    { id: 'versionCount', columns: 3, height: 240 },
    { id: 'activity', columns: 8, height: 500 },
    { id: 'storage', columns: 3, height: 240 },
  ], 1200, 12, 24);
  const byId = new Map(layout.items.map((r) => [r.id, r]));
  assert.equal(byId.get('versionCount')!.left, byId.get('instanceCount')!.left);
  assert.equal(byId.get('versionCount')!.top, byId.get('instanceCount')!.top + 240 + 24);
  assert.ok(byId.get('versionCount')!.top + 240 < byId.get('executions')!.top + 1000);
  assert.equal(byId.get('storage')!.top, byId.get('versionCount')!.top);
  noOverlap(layout.items, 1200, 24);
});

test('heights can change independently and empty alert widgets reserve no space', () => {
  const input: PackingItem[] = [
    { id: 'health', columns: 12, height: 0 }, { id: 'instanceCount', columns: 6, height: 200 },
    { id: 'executions', columns: 6, height: 900 }, { id: 'versionCount', columns: 6, height: 140 },
  ];
  const first = packDashboard(input, 1000, 12, 24);
  assert.equal(first.items[0].top, 0);
  assert.equal(first.items.some((r) => r.id === 'health'), false);
  assert.equal(first.items[2].top, 224);
  const taller = packDashboard(input.map((r) => r.id === 'executions' ? { ...r, height: 1600 } : r), 1000, 12, 24);
  assert.equal(taller.items[2].top, 224);
  const changed = packDashboard(input.map((r) => r.id === 'instanceCount' ? { ...r, height: 400 } : r), 1000, 12, 24);
  assert.equal(changed.items[2].top, 424);
  noOverlap(changed.items, 1000, 24);
  assert.equal(input[1].height, 200);
});

test('narrow layouts stay in bounds and full-width cards correctly block both columns', () => {
  const layout = packDashboard([
    { id: 'instanceCount', columns: 1, height: 140 }, { id: 'workflowCount', columns: 1, height: 160 },
    { id: 'executions', columns: 2, height: 600 }, { id: 'versionCount', columns: 1, height: 140 },
  ], 320, 2, 16);
  assert.equal(layout.items[2].top, 176);
  assert.equal(layout.items[3].top, 792);
  noOverlap(layout.items, 320, 16);
});

test('mixed sizes and heights never overlap and placement is deterministic', () => {
  for (let seed = 0; seed < 80; seed++) {
    const input = WIDGET_IDS.map((id, i) => ({ id, columns: 3 + (seed + i * 7) % 10, height: 140 + (seed * 137 + i * 43) % 1500 }));
    const layout = packDashboard(input, 1197.5, 12, 24);
    assert.equal(layout.items.length, input.length);
    assert.deepEqual(packDashboard(input, 1197.5, 12, 24), layout);
    assert.equal(layout.height, Math.max(...layout.items.map((r) => r.top + r.height)));
    noOverlap(layout.items, 1197.5, 24);
  }
});

test('free-space drops resolve to a nearby widget instead of doing nothing', () => {
  const { items } = packDashboard([
    { id: 'instanceCount', columns: 6, height: 200 }, { id: 'executions', columns: 6, height: 900 },
    { id: 'versionCount', columns: 6, height: 140 },
  ], 1000, 12, 24);
  assert.equal(nearestPackedWidget(items, 30, 210, 'executions'), 'instanceCount');
  assert.equal(nearestPackedWidget(items, 30, 260, 'executions'), 'versionCount');
  assert.equal(nearestPackedWidget([], 0, 0, 'executions'), null);
});
