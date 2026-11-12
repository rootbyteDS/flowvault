import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WIDGET_IDS, defaultDashboardLayout, isDashboardLayoutInput, isWidgetOrder, moveWidget, normalizeDashboardLayout, normalizeWidgetOrder } from './dashboard.ts';

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
