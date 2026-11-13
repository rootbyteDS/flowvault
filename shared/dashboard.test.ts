import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WIDGET_IDS, defaultDashboardLayout, defaultWidgetSize, isDashboardLayoutInput, isWidgetOrder, isWidgetSize, moveWidget, normalizeDashboardLayout, normalizeWidgetOrder, resizeWidget } from './dashboard.ts';

test('older visibility-only layouts keep their settings and receive a complete default order', () => {
  const migrated = normalizeDashboardLayout({ version: 1, widgets: { executions: { visible: false } } });
  assert.equal(migrated.widgets.executions.visible, false);
  assert.deepEqual(migrated.order, [...WIDGET_IDS]);
  assert.equal(isDashboardLayoutInput({ version: 1, widgets: { executions: { visible: false } } }), true);
});

test('stored orders recover from retired IDs, duplicates and newly introduced widgets', () => {
  assert.deepEqual(normalizeWidgetOrder(['instances', 'retired', 'instances', 'history']),
    ['instances', 'history', ...WIDGET_IDS.filter((id) => id !== 'instances' && id !== 'history')]);
  assert.deepEqual(normalizeWidgetOrder(null), [...WIDGET_IDS]);
  assert.deepEqual(normalizeDashboardLayout({ version: 1, widgets: {}, order: ['executions'] }).order,
    ['executions', ...WIDGET_IDS.filter((id) => id !== 'executions')]);
});

test('moving a widget works in either direction without losing hidden widgets or changing the saved source', () => {
  const layout = defaultDashboardLayout();
  layout.widgets.history.visible = false;
  const original = [...layout.order];
  const next = moveWidget(layout.order, 'instances', 'instanceCount');
  assert.deepEqual(layout.order, original);
  assert.equal(next[1], 'instances');
  assert.ok(next.includes('history'));
  assert.deepEqual(new Set(next), new Set(WIDGET_IDS));
  const end = moveWidget(next, 'instances', 'activity');
  assert.equal(end.at(-1), 'instances');
  assert.deepEqual(moveWidget(end, 'instances', 'instances'), end);
  assert.deepEqual(moveWidget(end.filter((id) => id !== 'health'), 'health', 'instances'), end.filter((id) => id !== 'health'));
});

test('order writes reject unknown IDs and duplicates; partial orders support older clients', () => {
  assert.equal(isWidgetOrder([]), true);
  assert.equal(isWidgetOrder(['history']), true);
  for (const order of [null, {}, 'history', ['unknown'], ['history', 'history'], ['history', 1], ['__proto__']]) {
    assert.equal(isWidgetOrder(order), false);
    assert.equal(isDashboardLayoutInput({ ...defaultDashboardLayout(), order }), false);
  }
});

test('old layouts receive automatic heights and standard widths while corrupt sizes do not reset the order or visibility', () => {
  const layout = normalizeDashboardLayout({ version: 1, widgets: { history: { visible: false } }, order: ['instances'],
    sizes: { history: { columns: 12, height: 400 }, instances: { columns: 99, height: -1 } } });
  assert.deepEqual(layout.sizes.history, { columns: 12, height: 400 });
  assert.deepEqual(layout.sizes.instances, defaultWidgetSize('instances'));
  assert.equal(layout.widgets.history.visible, false);
  assert.equal(layout.order[0], 'instances');
  assert.equal(layout.sizes.executions.height, null);
  const first = defaultDashboardLayout();
  first.sizes.history.columns = 12;
  assert.equal(defaultDashboardLayout().sizes.history.columns, 6);
});

test('resize snapping respects grid and height limits and leaves automatic height on a horizontal-only drag', () => {
  const initial = { columns: 6, height: null };
  assert.deepEqual(resizeWidget(initial, 100, 0, 50, 280), { columns: 8, height: null });
  assert.deepEqual(resizeWidget(initial, -50, 85, 50, 280), { columns: 5, height: 360 });
  assert.deepEqual(resizeWidget(initial, -10000, -10000, 50, 280), { columns: 3, height: 140 });
  assert.deepEqual(resizeWidget(initial, 10000, 10000, 50, 280), { columns: 12, height: 1600 });
  assert.deepEqual(initial, { columns: 6, height: null });
  assert.deepEqual(resizeWidget({ columns: 8, height: 400 }, 0, -20, 1, 400), { columns: 8, height: 380 });
});

test('invalid widget sizes cannot be written', () => {
  assert.equal(isWidgetSize({ columns: 3, height: null }), true);
  assert.equal(isWidgetSize({ columns: 12, height: 1600 }), true);
  for (const size of [null, {}, { columns: 6 }, { columns: '6', height: null }, { columns: 2, height: 200 },
    { columns: 13, height: 200 }, { columns: 3.5, height: null }, { columns: 6, height: 139 }, { columns: 6, height: 1601 },
    { columns: 6, height: 250.5 }, { columns: 6, height: null, extra: true }]) {
    assert.equal(isWidgetSize(size), false);
    assert.equal(isDashboardLayoutInput({ ...defaultDashboardLayout(), sizes: { history: size } }), false);
  }
});
