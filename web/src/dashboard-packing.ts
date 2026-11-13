import type { WidgetId } from '../../shared/dashboard.ts';

export interface PackingItem { id: WidgetId; columns: number; height: number }
export interface PackedWidget extends PackingItem { column: number; left: number; top: number; width: number }

/** Place each widget in the first free space, independently of other widgets' heights. */
export function packDashboard(items: readonly PackingItem[], width: number, columns: number, gap: number) {
  const placed: PackedWidget[] = [];
  if (width <= 0 || columns <= 0) return { items: placed, height: 0 };
  const unit = (width + gap) / columns;
  for (const item of items) {
    if (item.height <= 0) continue; // e.g. the alerts widget when there are no alerts
    const span = Math.max(1, Math.min(columns, item.columns));
    const height = Math.ceil(item.height);
    const tops = [...new Set([0, ...placed.map((r) => r.top + r.height + gap)])].sort((a, b) => a - b);
    search: for (const top of tops) {
      for (let column = 0; column <= columns - span; column++) {
        const overlaps = placed.some((r) => column < r.column + r.columns && column + span > r.column &&
          top < r.top + r.height + gap && top + height + gap > r.top);
        if (!overlaps) {
          placed.push({ id: item.id, columns: span, height, column, top, left: unit * column, width: unit * span - gap });
          break search;
        }
      }
    }
  }
  return { items: placed, height: Math.max(0, ...placed.map((r) => r.top + r.height)) };
}

/** Empty areas between cards are valid drop targets too, rather than dead zones. */
export function nearestPackedWidget(items: readonly PackedWidget[], x: number, y: number, exclude: WidgetId): WidgetId | null {
  let best: WidgetId | null = null, distance = Infinity;
  for (const item of items) {
    if (item.id === exclude) continue;
    const dx = Math.max(item.left - x, 0, x - item.left - item.width);
    const dy = Math.max(item.top - y, 0, y - item.top - item.height);
    const next = dx * dx + dy * dy;
    if (next < distance) { best = item.id; distance = next; }
  }
  return best;
}
