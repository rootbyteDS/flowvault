/** Stable widget IDs are independent of translated titles and React components. */
export const WIDGET_IDS = ['health', 'instanceCount', 'workflowCount', 'versionCount', 'storage', 'history', 'activity', 'instances'] as const;
export type WidgetId = typeof WIDGET_IDS[number];
export interface DashboardLayout {
  version: 1;
  widgets: Record<WidgetId, { visible: boolean }>;
}

export function defaultDashboardLayout(): DashboardLayout {
  return { version: 1, widgets: Object.fromEntries(WIDGET_IDS.map((id) => [id, { visible: true }])) as DashboardLayout['widgets'] };
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Stored layouts may predate new widgets. New widgets start with their defaults. */
export function normalizeDashboardLayout(value: unknown): DashboardLayout {
  const layout = defaultDashboardLayout();
  if (!object(value) || value.version !== 1 || !object(value.widgets)) return layout;
  for (const id of WIDGET_IDS) {
    const widget = value.widgets[id];
    if (object(widget) && typeof widget.visible === 'boolean') layout.widgets[id].visible = widget.visible;
  }
  return layout;
}

/** Writes must be well formed; missing IDs are allowed for older clients. */
export function isDashboardLayoutInput(value: unknown): boolean {
  if (!object(value) || value.version !== 1 || !object(value.widgets)) return false;
  if (Object.keys(value).some((key) => key !== 'version' && key !== 'widgets')) return false;
  return Object.entries(value.widgets).every(([id, widget]) =>
    WIDGET_IDS.some((known) => known === id) && object(widget) &&
    typeof widget.visible === 'boolean' && Object.keys(widget).every((key) => key === 'visible'));
}
