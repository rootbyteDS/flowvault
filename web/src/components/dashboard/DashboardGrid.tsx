import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { type DashboardLayout, type PositionMap, type PositionMode, type WidgetId, type WidgetPosition, type WidgetPositions, type WidgetSize, type WidgetSizes } from '../../../../shared/dashboard.ts';
import type { Instance, Overview } from '../../api.ts';
import { t } from '../../i18n.tsx';
import { cx } from '../../util.ts';
import { WIDGET_TITLES } from '../../widget-titles.ts';
import { DASHBOARD_WIDGETS } from './widgets.tsx';
import { WidgetResizeHandle } from './WidgetResizeHandle.tsx';
import { orderByPlacement, packDashboard, samePositions, snapshotPositions, snapWidgetPosition } from '../../dashboard-packing.ts';
import { useDashboardPacking } from './useDashboardPacking.ts';

interface Drag {
  id: WidgetId; pointerId: number; x: number; y: number; startX: number; startY: number;
  started: boolean; target: WidgetPosition | null; handle: HTMLButtonElement;
  offsetX: number; offsetY: number; base: PositionMap; mode: PositionMode;
}
const spans: Record<number, string> = { 3: 'col-span-1 xl:col-span-3', 4: 'col-span-2 xl:col-span-4', 5: 'col-span-2 xl:col-span-5',
  6: 'col-span-2 xl:col-span-6', 7: 'col-span-2 xl:col-span-7', 8: 'col-span-2 xl:col-span-8',
  9: 'col-span-2 xl:col-span-9', 10: 'col-span-2 xl:col-span-10', 11: 'col-span-2 xl:col-span-11', 12: 'col-span-2 xl:col-span-12' };

function WidgetCell({ id, size, editing, disabled, grid, instructions, onResize, onAnnounce, toolbar, children, className, style }: {
  id: WidgetId; size: WidgetSize; editing: boolean; disabled: boolean; grid: RefObject<HTMLDivElement | null>;
  instructions: string; onResize: (size: WidgetSize) => void; onAnnounce: (text: string) => void;
  toolbar: ReactNode; children: ReactNode; className: string;
  style?: CSSProperties;
}) {
  const content = useRef<HTMLDivElement>(null);
  return <div data-dashboard-widget={id} style={style} className={cx('relative min-w-0', className,
    '[&:has(>[data-widget-content]:empty)]:hidden')}>
    {toolbar}
    <div ref={content} inert={editing || undefined} data-widget-content className="overflow-auto [&>div]:min-h-full" style={{ height: size.height ?? undefined }}>{children}</div>
    {editing && <WidgetResizeHandle id={id} size={size} content={content} grid={grid} instructions={instructions}
      disabled={disabled} onChange={onResize} onAnnounce={onAnnounce} />}
  </div>;
}

export function DashboardGrid({ layout, order, sizes, positions: savedPositions, overview, instances, onHide, hideDisabled, onPlace, onResize, disabled = false }: {
  layout: DashboardLayout;
  order: WidgetId[];
  sizes: WidgetSizes;
  positions: WidgetPositions;
  overview: Overview;
  instances: Instance[];
  onHide: (id: WidgetId) => void;
  hideDisabled: boolean;
  onPlace?: (mode: PositionMode, positions: PositionMap, order: WidgetId[]) => void;
  onResize?: (id: WidgetId, size: WidgetSize) => void;
  disabled?: boolean;
}) {
  const editing = !!onPlace;
  const visible = order.filter((id) => layout.widgets[id].visible);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const [target, setTarget] = useState<WidgetPosition | null>(null);
  const [priority, setPriority] = useState<WidgetId | undefined>();
  const [announcement, setAnnouncement] = useState('');
  const drag = useRef<Drag | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const instructions = useId();
  const signature = `${editing}:${visible.map((id) => `${id}:${sizes[id].columns}:${sizes[id].height}`).join('|')}`;
  const measured = useDashboardPacking(grid, visible, signature);
  const mode: PositionMode = measured.columns === 12 ? 'wide' : 'narrow';
  const items = visible.map((id) => ({ id, columns: measured.columns === 12 ? sizes[id].columns : sizes[id].columns === 3 ? 1 : 2,
    height: measured.heights[id] ?? 0 }));
  const manual = dragging && target && drag.current ? { ...drag.current.base, [dragging]: target } : savedPositions[mode];
  const packed = packDashboard(items, measured.width, measured.columns, measured.gap, manual, dragging ?? priority);
  const positions = new Map(packed.items.map((item) => [item.id, item]));
  const model = useRef({ packed, items, measured, mode, savedPositions, order, editing });
  model.current = { packed, items, measured, mode, savedPositions, order, editing };
  const geometryKey = JSON.stringify(packed.items.map((r) => [r.id, r.column, r.top]));
  useLayoutEffect(() => {
    if (!editing || !measured.width || dragging) return;
    const next = snapshotPositions(packed.items, savedPositions[mode]);
    const nextOrder = orderByPlacement(order, packed.items);
    if (!samePositions(next, savedPositions[mode]) || nextOrder.some((id, i) => id !== order[i])) onPlace?.(mode, next, nextOrder);
  }, [editing, dragging, mode, geometryKey, JSON.stringify(savedPositions[mode]), order.join('|')]);

  function dropPosition(current: Drag): WidgetPosition | null {
    const data = model.current;
    const bounds = grid.current?.getBoundingClientRect();
    if (!bounds || current.mode !== data.mode || current.x < bounds.left - 64 || current.x > bounds.right + 64 || current.y < bounds.top - 64) return null;
    const span = data.items.find((item) => item.id === current.id)?.columns ?? data.measured.columns;
    return snapWidgetPosition(current.x - bounds.left - current.offsetX, current.y - bounds.top - current.offsetY,
      data.measured.width, data.measured.columns, span, data.measured.gap);
  }
  function updateTarget(current: Drag) {
    current.target = dropPosition(current);
    setTarget((previous) => previous?.column === current.target?.column && previous?.top === current.target?.top ? previous : current.target);
  }
  function cancelDrag() {
    const current = drag.current;
    drag.current = null;
    setDragging(null); setTarget(null);
    if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
  }
  useEffect(() => { if (drag.current && drag.current.mode !== model.current.mode) cancelDrag(); }, [mode]);
  // Auto-scroll also works when a touch pointer is held still near the viewport edge.
  useEffect(() => {
    if (!dragging) return;
    let frame: number;
    const tick = () => {
      const current = drag.current;
      if (!current?.started) return;
      const speed = current.y < 64 ? -12 : current.y > window.innerHeight - 64 ? 12 : 0;
      if (speed) window.scrollBy({ top: speed, behavior: 'instant' });
      if (preview.current) preview.current.style.transform = `translate(${current.x + 16}px, ${current.y + 16}px)`;
      updateTarget(current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);
  useEffect(() => { if (!editing && !model.current.editing) cancelDrag(); }, [editing]);
  useEffect(() => () => {
    const current = drag.current;
    drag.current = null;
    if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
  }, []);

  function place(id: WidgetId, position: WidgetPosition, base?: PositionMap) {
    if (!onPlace || disabled) return;
    const data = model.current;
    const current = base ?? snapshotPositions(data.packed.items, data.savedPositions[data.mode]);
    const next = packDashboard(data.items, data.measured.width, data.measured.columns, data.measured.gap, { ...current, [id]: position }, id);
    setPriority(id);
    onPlace(data.mode, snapshotPositions(next.items, current), orderByPlacement(data.order, next.items));
    const placed = next.items.find((item) => item.id === id);
    if (placed) setAnnouncement(t('dashboard.arrange.positioned', { name: t(WIDGET_TITLES[id]), column: placed.column + 1, top: placed.top }));
  }
  function start(event: PointerEvent<HTMLButtonElement>, id: WidgetId) {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.closest('[data-dashboard-widget]')!.getBoundingClientRect();
    const data = model.current;
    drag.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      base: snapshotPositions(data.packed.items, data.savedPositions[data.mode]), mode: data.mode, id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, started: false, target: null, handle: event.currentTarget };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.x = event.clientX; current.y = event.clientY;
    if (!current.started && Math.hypot(current.x - current.startX, current.y - current.startY) >= 5) {
      current.started = true;
      setDragging(current.id);
    }
    if (current.started) updateTarget(current);
  }
  function drop(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.x = event.clientX; current.y = event.clientY;
    if (current.started) updateTarget(current);
    const destination = current.target;
    cancelDrag();
    if (current.started && destination) place(current.id, destination, current.base);
  }
  function shift(id: WidgetId, dx: number, dy: number) {
    const data = model.current;
    const current = data.packed.items.find((item) => item.id === id);
    if (current) place(id, { column: Math.max(0, Math.min(data.measured.columns - current.columns, current.column + dx)),
      top: Math.max(0, Math.min(20000, current.top + dy)) });
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, id: WidgetId) {
    if (event.key === 'Escape') { cancelDrag(); return; }
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0;
    if (!dx && !dy && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    if (event.key === 'Home') place(id, { column: 0, top: 0 });
    else if (event.key === 'End') {
      const data = model.current, item = data.items.find((item) => item.id === id);
      if (item) place(id, { column: data.measured.columns - item.columns, top: Math.min(20000, data.packed.height) });
    } else shift(id, dx, dy);
  }
  const buttonClass = 'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel-3 hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-30';
  return <>
    {editing && <p id={instructions} className="mb-4 text-sm text-muted">{t('dashboard.arrange.instructions')}</p>}
    <div ref={grid} className={cx('relative grid grid-cols-2 items-start gap-4 xl:grid-cols-12 xl:gap-6', editing && '[overflow-anchor:none]')}
      style={{ height: measured.width ? packed.height + (editing ? 120 : 0) : undefined }}>
      {visible.map((id) => {
        const { Component } = DASHBOARD_WIDGETS.find((widget) => widget.id === id)!;
        const size = sizes[id];
        const columns = size.columns;
        const title = t(WIDGET_TITLES[id]);
        const position = positions.get(id);
        const width = measured.columns === 12 ? columns : columns === 3 ? 1 : 2;
        return <WidgetCell key={id} id={id} size={size} editing={editing} disabled={disabled} grid={grid} instructions={instructions}
          onResize={(next) => { setPriority(id); onResize?.(id, next); }} onAnnounce={setAnnouncement}
          style={measured.width ? { position: 'absolute', left: position?.left ?? 0, top: position?.top ?? 0,
            width: position?.width ?? (measured.width + measured.gap) / measured.columns * width - measured.gap } : undefined}
          className={cx(!measured.width && spans[columns],
          editing && 'rounded-xl outline outline-1 outline-dashed outline-line-2',
          dragging === id && 'opacity-50 ring-2 ring-accent')}
          toolbar={editing && <div className="absolute inset-x-0 top-0 z-10 flex h-9 items-center gap-1 rounded-t-xl bg-panel-2 px-2">
            <button type="button" className={cx(buttonClass, 'touch-none cursor-grab select-none active:cursor-grabbing')}
              disabled={disabled} aria-label={t('dashboard.arrange.move', { name: title })} aria-describedby={instructions}
              onPointerDown={(e) => start(e, id)} onPointerMove={move} onPointerUp={drop} onPointerCancel={cancelDrag}
              onLostPointerCapture={cancelDrag} onKeyDown={(e) => keyboard(e, id)}>
              <GripVertical className="size-4" />
            </button>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{title}</span>
            <button type="button" className={buttonClass} disabled={disabled || (position?.top ?? 0) <= 0}
              aria-label={t('dashboard.arrange.earlier', { name: title })} onClick={() => shift(id, 0, -20)}><ArrowUp className="size-4" /></button>
            <button type="button" className={buttonClass} disabled={disabled || (position?.top ?? 0) >= 20000}
              aria-label={t('dashboard.arrange.later', { name: title })} onClick={() => shift(id, 0, 20)}><ArrowDown className="size-4" /></button>
          </div>}>
          <Component overview={overview} instances={instances} onHide={() => onHide(id)} hideDisabled={hideDisabled || editing} />
        </WidgetCell>;
      })}
      {dragging && target && positions.get(dragging) && <div data-drop-preview aria-hidden
        className="pointer-events-none absolute z-20 rounded-xl border-2 border-dashed border-accent bg-accent/10"
        style={{ left: positions.get(dragging)!.left, top: positions.get(dragging)!.top,
          width: positions.get(dragging)!.width, height: positions.get(dragging)!.height }} />}
    </div>
    {dragging && <div ref={preview} aria-hidden className="pointer-events-none fixed top-0 left-0 z-50 max-w-60 rounded-lg border border-accent bg-panel px-3 py-2 text-sm text-text shadow-xl"
      style={{ transform: `translate(${(drag.current?.x ?? 0) + 16}px, ${(drag.current?.y ?? 0) + 16}px)` }}>
      {t(WIDGET_TITLES[dragging])}
    </div>}
    <p className="sr-only" aria-live="polite">{announcement}</p>
  </>;
}
