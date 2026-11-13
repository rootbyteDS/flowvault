/** Stable widget IDs are independent of translated titles and React components. */
export const WIDGET_IDS = ['health', 'instanceCount', 'workflowCount', 'versionCount', 'storage', 'history', 'executions', 'activity', 'instances'] as const;
export type WidgetId = typeof WIDGET_IDS[number];
export const isWidgetId = (id: unknown): id is WidgetId => WIDGET_IDS.some((known) => known === id);
export interface WidgetSize { columns: number; height: number | null }
export type WidgetSizes = Record<WidgetId, WidgetSize>;
export interface WidgetPosition { column: number; top: number }
export type PositionMap = Partial<Record<WidgetId, WidgetPosition>>;
export type PositionMode = 'wide' | 'narrow';
export interface WidgetPositions { wide: PositionMap; narrow: PositionMap }
export const MIN_WIDGET_HEIGHT = 140;
export const MAX_WIDGET_HEIGHT = 1600;
const DEFAULT_COLUMNS: Record<WidgetId, number> = { health: 12, instanceCount: 3, workflowCount: 3, versionCount: 3,
  storage: 3, history: 6, executions: 6, activity: 8, instances: 4 };
export const defaultWidgetSize = (id: WidgetId): WidgetSize => ({ columns: DEFAULT_COLUMNS[id], height: null });
export interface DashboardLayout {
  version: 1;
  widgets: Record<WidgetId, { visible: boolean }>;
  order: WidgetId[];
  sizes: WidgetSizes;
  positions: WidgetPositions;
}

export function defaultDashboardLayout(): DashboardLayout {
  return { version: 1, widgets: Object.fromEntries(WIDGET_IDS.map((id) => [id, { visible: true }])) as DashboardLayout['widgets'],
    order: [...WIDGET_IDS], sizes: Object.fromEntries(WIDGET_IDS.map((id) => [id, defaultWidgetSize(id)])) as WidgetSizes,
    positions: { wide: {}, narrow: {} } };
}

/** Unknown/retired IDs are dropped; newly introduced widgets are appended. */
export function normalizeWidgetOrder(value: unknown): WidgetId[] {
  const known = Array.isArray(value) ? value.filter(isWidgetId) : [];
  return [...new Set([...known, ...WIDGET_IDS])];
}

export function isWidgetOrder(value: unknown): value is WidgetId[] {
  return Array.isArray(value) && value.every(isWidgetId) && new Set(value).size === value.length;
}

/** Hidden widgets remain in the full order, so showing one restores its position. */
export function moveWidget(order: readonly WidgetId[], active: WidgetId, target: WidgetId): WidgetId[] {
  const next = [...order];
  const from = next.indexOf(active), to = next.indexOf(target);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1);
  next.splice(to, 0, active);
  return next;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function isWidgetSize(value: unknown): value is WidgetSize {
  return object(value) && Object.keys(value).length === 2 && Number.isInteger(value.columns) &&
    Number(value.columns) >= 3 && Number(value.columns) <= 12 &&
    (value.height === null || (Number.isInteger(value.height) && Number(value.height) >= MIN_WIDGET_HEIGHT && Number(value.height) <= MAX_WIDGET_HEIGHT));
}
export function isWidgetSizes(value: unknown): value is Partial<WidgetSizes> {
  return object(value) && Object.entries(value).every(([id, size]) => isWidgetId(id) && isWidgetSize(size));
}
export function isPositionMap(value: unknown, mode: PositionMode): value is PositionMap {
  return object(value) && Object.entries(value).every(([id, p]) => isWidgetId(id) && object(p) && Object.keys(p).length === 2 &&
    Number.isInteger(p.column) && Number(p.column) >= 0 && Number(p.column) < (mode === 'wide' ? 12 : 2) &&
    Number.isSafeInteger(p.top) && Number(p.top) >= 0 && Number(p.top) <= 1000000);
}
export function isWidgetPositions(value: unknown): value is WidgetPositions {
  return object(value) && Object.keys(value).length === 2 && isPositionMap(value.wide, 'wide') && isPositionMap(value.narrow, 'narrow');
}

/** Snap drag changes to grid columns and 20px heights without mutating the draft. */
export function resizeWidget(size: WidgetSize, dx: number, dy: number, columnWidth: number, renderedHeight: number): WidgetSize {
  return {
    columns: Math.max(3, Math.min(12, Math.round(size.columns + dx / columnWidth))),
    height: Math.abs(dy) < 8 ? size.height : Math.max(MIN_WIDGET_HEIGHT, Math.min(MAX_WIDGET_HEIGHT, Math.round((renderedHeight + dy) / 20) * 20)),
  };
}

/** Stored layouts may predate new widgets. New widgets start with their defaults. */
export function normalizeDashboardLayout(value: unknown): DashboardLayout {
  const layout = defaultDashboardLayout();
  if (!object(value) || value.version !== 1 || !object(value.widgets)) return layout;
  for (const id of WIDGET_IDS) {
    const widget = value.widgets[id];
    if (object(widget) && typeof widget.visible === 'boolean') layout.widgets[id].visible = widget.visible;
  }
  layout.order = normalizeWidgetOrder(value.order);
  if (object(value.sizes)) for (const id of WIDGET_IDS) {
    const size = value.sizes[id];
    if (isWidgetSize(size)) layout.sizes[id] = { ...size };
  }
  if (object(value.positions)) for (const mode of ['wide', 'narrow'] as const) {
    const map = value.positions[mode];
    if (object(map)) for (const id of WIDGET_IDS) {
      const p = map[id];
      if (isPositionMap({ [id]: p }, mode)) layout.positions[mode][id] = { ...(p as WidgetPosition) };
    }
  }
  return layout;
}

/** Writes must be well formed; missing IDs are allowed for older clients. */
export function isDashboardLayoutInput(value: unknown): boolean {
  if (!object(value) || value.version !== 1 || !object(value.widgets)) return false;
  if (Object.keys(value).some((key) => !['version', 'widgets', 'order', 'sizes', 'positions'].includes(key))) return false;
  if (value.order !== undefined && !isWidgetOrder(value.order)) return false;
  if (value.sizes !== undefined && !isWidgetSizes(value.sizes)) return false;
  if (value.positions !== undefined && !isWidgetPositions(value.positions)) return false;
  return Object.entries(value.widgets).every(([id, widget]) =>
    WIDGET_IDS.some((known) => known === id) && object(widget) &&
    typeof widget.visible === 'boolean' && Object.keys(widget).every((key) => key === 'visible'));
}
