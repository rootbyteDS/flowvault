import type { PositionMap, WidgetId, WidgetPosition } from '../../shared/dashboard.ts';

export interface PackingItem { id: WidgetId; columns: number; height: number }
export interface PackedWidget extends PackingItem { column: number; left: number; top: number; width: number }

/** Place each widget in the first free space, independently of other widgets' heights. */
export function packDashboard(items: readonly PackingItem[], width: number, columns: number, gap: number, positions: PositionMap = {}, priority?: WidgetId) {
  const placed: PackedWidget[] = [];
  if (width <= 0 || columns <= 0) return { items: placed, height: 0 };
  const unit = (width + gap) / columns;
  const overlaps = (column: number, span: number, top: number, height: number) => placed.filter((r) =>
    column < r.column + r.columns && column + span > r.column && top < r.top + r.height + gap && top + height + gap > r.top);
  const pinned = items.filter((item) => item.height > 0 && positions[item.id]);
  if (priority) pinned.sort((a, b) => Number(b.id === priority) - Number(a.id === priority));
  for (const item of pinned) {
    const span = Math.max(1, Math.min(columns, item.columns));
    const height = Math.ceil(item.height);
    const column = Math.max(0, Math.min(columns - span, positions[item.id]!.column));
    let top = positions[item.id]!.top;
    let hits = overlaps(column, span, top, height);
    while (hits.length) {
      top = Math.max(...hits.map((r) => r.top + r.height + gap));
      hits = overlaps(column, span, top, height);
    }
    placed.push({ ...item, columns: span, height, column, top, left: unit * column, width: unit * span - gap });
  }
  for (const item of items) {
    if (item.height <= 0 || positions[item.id]) continue; // e.g. empty alerts, or already placed manually
    const span = Math.max(1, Math.min(columns, item.columns));
    const height = Math.ceil(item.height);
    const tops = [...new Set([0, ...placed.map((r) => r.top + r.height + gap)])].sort((a, b) => a - b);
    search: for (const top of tops) {
      for (let column = 0; column <= columns - span; column++) {
        if (!overlaps(column, span, top, height).length) {
          placed.push({ id: item.id, columns: span, height, column, top, left: unit * column, width: unit * span - gap });
          break search;
        }
      }
    }
  }
  placed.sort((a, b) => items.findIndex((r) => r.id === a.id) - items.findIndex((r) => r.id === b.id));
  return { items: placed, height: Math.max(0, ...placed.map((r) => r.top + r.height)) };
}

export function snapshotPositions(items: readonly PackedWidget[], existing: PositionMap = {}): PositionMap {
  return { ...existing, ...Object.fromEntries(items.map((r) => [r.id, { column: r.column, top: r.top }])) };
}

export function samePositions(a: PositionMap, b: PositionMap): boolean {
  const ids = Object.keys(a) as WidgetId[];
  return ids.length === Object.keys(b).length && ids.every((id) => a[id]?.column === b[id]?.column && a[id]?.top === b[id]?.top);
}

export function snapWidgetPosition(x: number, y: number, width: number, columns: number, span: number, gap: number): WidgetPosition {
  return { column: Math.max(0, Math.min(columns - span, Math.round(x / ((width + gap) / columns)))),
    top: Math.max(0, Math.min(20000, Math.round(y / 20) * 20)) };
}

export function orderByPlacement(order: readonly WidgetId[], items: readonly PackedWidget[]): WidgetId[] {
  const sorted = [...items].sort((a, b) => a.top - b.top || a.column - b.column).map((r) => r.id);
  const present = new Set(sorted);
  let index = 0;
  return order.map((id) => present.has(id) ? sorted[index++] : id);
}
