import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WIDGET_IDS } from '../../shared/dashboard.ts';
import { orderByPlacement, packDashboard, snapshotPositions, snapWidgetPosition, type PackedWidget, type PackingItem } from './dashboard-packing.ts';

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

test('screenshot regression: Workflows stays in the exact free column beside execution history after saving', () => {
  const items: PackingItem[] = [
    { id: 'instanceCount', columns: 3, height: 200 }, { id: 'workflowCount', columns: 3, height: 200 },
    { id: 'versionCount', columns: 3, height: 200 }, { id: 'executions', columns: 6, height: 900 },
  ];
  const base = { instanceCount: { column: 6, top: 0 }, workflowCount: { column: 9, top: 0 },
    versionCount: { column: 0, top: 400 }, executions: { column: 3, top: 400 } };
  const destination = snapWidgetPosition(9 * 102, 407, 1200, 12, 3, 24);
  assert.deepEqual(destination, { column: 9, top: 400 });
  const result = packDashboard(items, 1200, 12, 24, { ...base, workflowCount: destination }, 'workflowCount');
  const workflow = result.items.find((r) => r.id === 'workflowCount')!;
  assert.equal(workflow.column, 9);
  assert.equal(workflow.top, 400);
  assert.equal(result.items.find((r) => r.id === 'executions')!.top, 400);
  const saved = JSON.parse(JSON.stringify(snapshotPositions(result.items)));
  assert.deepEqual(packDashboard(items, 1200, 12, 24, saved), result);
  noOverlap(result.items, 1200, 24);
});

test('overlapping drops keep the moved widget at its target and push the obstruction down', () => {
  const items: PackingItem[] = [{ id: 'executions', columns: 6, height: 900 }, { id: 'workflowCount', columns: 3, height: 200 }];
  const result = packDashboard(items, 1200, 12, 24, { executions: { column: 3, top: 400 }, workflowCount: { column: 3, top: 400 } }, 'workflowCount');
  assert.equal(result.items.find((r) => r.id === 'workflowCount')!.top, 400);
  assert.equal(result.items.find((r) => r.id === 'executions')!.top, 624);
  noOverlap(result.items, 1200, 24);
});

test('snapshot retains hidden coordinates and visual order retains all IDs', () => {
  const layout = packDashboard([{ id: 'instanceCount', columns: 3, height: 200 }, { id: 'workflowCount', columns: 3, height: 200 }],
    1200, 12, 24, { instanceCount: { column: 6, top: 400 }, workflowCount: { column: 9, top: 0 } });
  assert.deepEqual(snapshotPositions(layout.items, { health: { column: 0, top: 1000 } }).health, { column: 0, top: 1000 });
  const order = orderByPlacement([...WIDGET_IDS], layout.items);
  assert.deepEqual(new Set(order), new Set(WIDGET_IDS));
  assert.ok(order.indexOf('workflowCount') < order.indexOf('instanceCount'));
});

test('drop coordinates clamp to the available width and snap vertical movement', () => {
  assert.deepEqual(snapWidgetPosition(-100, -100, 1200, 12, 3, 24), { column: 0, top: 0 });
  assert.deepEqual(snapWidgetPosition(9999, 99999, 1200, 12, 6, 24), { column: 6, top: 20000 });
  assert.deepEqual(snapWidgetPosition(310, 211, 320, 2, 1, 16), { column: 1, top: 220 });
});
