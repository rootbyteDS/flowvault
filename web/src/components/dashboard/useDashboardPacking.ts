import { useLayoutEffect, useState, type RefObject } from 'react';
import type { WidgetId } from '../../../../shared/dashboard.ts';

interface Measurements {
  width: number;
  columns: number;
  gap: number;
  heights: Partial<Record<WidgetId, number>>;
}

/** Observe the complete cards, including edit controls, async data and open settings. */
export function useDashboardPacking(grid: RefObject<HTMLDivElement | null>, ids: WidgetId[], signature: string) {
  const [measured, setMeasured] = useState<Measurements>({ width: 0, columns: 2, gap: 16, heights: {} });
  useLayoutEffect(() => {
    const root = grid.current;
    if (!root) return;
    const cells = [...root.querySelectorAll<HTMLElement>('[data-dashboard-widget]')];
    const measure = () => {
      const style = getComputedStyle(root);
      const width = root.getBoundingClientRect().width;
      if (!width) return;
      const columns = style.gridTemplateColumns.trim().split(/\s+/).length === 12 ? 12 : 2;
      const gap = Number.parseFloat(style.columnGap) || 0;
      const heights = Object.fromEntries(cells.map((cell) => [cell.dataset.dashboardWidget, Math.ceil(cell.getBoundingClientRect().height)]));
      setMeasured((previous) => previous.width === width && previous.columns === columns && previous.gap === gap &&
        ids.every((id) => previous.heights[id] === heights[id]) && Object.keys(previous.heights).length === ids.length
        ? previous : { width, columns, gap, heights });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const cell of cells) observer.observe(cell, { box: 'border-box' });
    measure();
    return () => observer.disconnect();
  }, [signature]);
  return measured;
}
