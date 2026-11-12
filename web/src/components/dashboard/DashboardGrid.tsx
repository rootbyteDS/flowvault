import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { isWidgetId, moveWidget, type DashboardLayout, type WidgetId } from '../../../../shared/dashboard.ts';
import type { Instance, Overview } from '../../api.ts';
import { t } from '../../i18n.tsx';
import { cx } from '../../util.ts';
import { WIDGET_TITLES } from '../../widget-titles.ts';
import { DASHBOARD_WIDGETS } from './widgets.tsx';

interface Drag {
  id: WidgetId; pointerId: number; x: number; y: number; startX: number; startY: number;
  started: boolean; target: WidgetId | null; handle: HTMLButtonElement;
}
const spans = { 3: 'col-span-1 xl:col-span-3', 4: 'col-span-2 xl:col-span-4', 6: 'col-span-2 xl:col-span-6', 8: 'col-span-2 xl:col-span-8', 12: 'col-span-2 xl:col-span-12' };

export function DashboardGrid({ layout, order, overview, instances, onHide, hideDisabled, onReorder, disabled = false }: {
  layout: DashboardLayout;
  order: WidgetId[];
  overview: Overview;
  instances: Instance[];
  onHide: (id: WidgetId) => void;
  hideDisabled: boolean;
  onReorder?: (order: WidgetId[]) => void;
  disabled?: boolean;
}) {
  const editing = !!onReorder;
  const visible = order.filter((id) => layout.widgets[id].visible);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const [target, setTarget] = useState<WidgetId | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const drag = useRef<Drag | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const instructions = useId();

  function updateTarget(current: Drag) {
    const element = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>('[data-dashboard-widget]');
    const id = element && grid.current?.contains(element) ? element.dataset.dashboardWidget : null;
    current.target = isWidgetId(id) ? id : null;
    setTarget(current.target);
  }
  function cancelDrag() {
    const current = drag.current;
    drag.current = null;
    setDragging(null); setTarget(null);
    if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
  }
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
  useEffect(() => { if (!editing) cancelDrag(); }, [editing]);
  useEffect(() => () => {
    const current = drag.current;
    drag.current = null;
    if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
  }, []);

  function reorder(active: WidgetId, destination: WidgetId) {
    if (!onReorder || disabled || active === destination) return;
    const next = moveWidget(order, active, destination);
    onReorder(next);
    setAnnouncement(t('dashboard.arrange.moved', { name: t(WIDGET_TITLES[active]),
      position: next.filter((id) => layout.widgets[id].visible).indexOf(active) + 1, total: visible.length }));
  }
  function start(event: PointerEvent<HTMLButtonElement>, id: WidgetId) {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
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
    if (current.started && destination) reorder(current.id, destination);
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, id: WidgetId) {
    if (event.key === 'Escape') { cancelDrag(); return; }
    const index = visible.indexOf(id);
    const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
      : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? index - 1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? index + 1 : null;
    if (targetIndex === null) return;
    event.preventDefault();
    const destination = visible[targetIndex];
    if (destination) reorder(id, destination);
  }
  const buttonClass = 'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel-3 hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-30';
  return <>
    {editing && <p id={instructions} className="mb-4 text-sm text-muted">{t('dashboard.arrange.instructions')}</p>}
    <div ref={grid} className="grid grid-cols-2 items-start gap-4 xl:grid-cols-12 xl:gap-6">
      {visible.map((id, index) => {
        const { Component, columns } = DASHBOARD_WIDGETS.find((widget) => widget.id === id)!;
        const title = t(WIDGET_TITLES[id]);
        return <div key={id} data-dashboard-widget={id} className={cx('min-w-0 empty:hidden',
          visible.length === 1 ? 'col-span-2 xl:col-span-12' : spans[columns],
          editing && 'rounded-xl border border-dashed border-line-2 p-2',
          dragging === id && 'opacity-50', target === id && dragging !== id && 'ring-2 ring-accent ring-offset-2 ring-offset-panel')}>
          {editing && <div className={cx('mb-2 flex items-center gap-2 rounded-lg bg-panel-2 p-2', columns === 3 && 'flex-wrap')}>
            <button type="button" className={cx(buttonClass, 'touch-none cursor-grab select-none active:cursor-grabbing')}
              disabled={disabled} aria-label={t('dashboard.arrange.move', { name: title })} aria-describedby={instructions}
              onPointerDown={(e) => start(e, id)} onPointerMove={move} onPointerUp={drop} onPointerCancel={cancelDrag}
              onLostPointerCapture={cancelDrag} onKeyDown={(e) => keyboard(e, id)}>
              <GripVertical className="size-4" />
            </button>
            <span className={cx('min-w-0 flex-1 break-words text-xs text-muted', columns === 3 && 'order-first w-full flex-auto')}>{title}</span>
            <button type="button" className={buttonClass} disabled={disabled || index === 0}
              aria-label={t('dashboard.arrange.earlier', { name: title })} onClick={() => reorder(id, visible[index - 1])}><ArrowUp className="size-4" /></button>
            <button type="button" className={buttonClass} disabled={disabled || index === visible.length - 1}
              aria-label={t('dashboard.arrange.later', { name: title })} onClick={() => reorder(id, visible[index + 1])}><ArrowDown className="size-4" /></button>
          </div>}
          <Component overview={overview} instances={instances} onHide={() => onHide(id)} hideDisabled={hideDisabled || editing} />
        </div>;
      })}
    </div>
    {dragging && <div ref={preview} aria-hidden className="pointer-events-none fixed top-0 left-0 z-50 max-w-60 rounded-lg border border-accent bg-panel px-3 py-2 text-sm text-text shadow-xl"
      style={{ transform: `translate(${(drag.current?.x ?? 0) + 16}px, ${(drag.current?.y ?? 0) + 16}px)` }}>
      {t(WIDGET_TITLES[dragging])}
    </div>}
    <p className="sr-only" aria-live="polite">{announcement}</p>
  </>;
}
