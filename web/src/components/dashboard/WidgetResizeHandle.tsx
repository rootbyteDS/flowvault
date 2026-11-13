import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { ArrowDownRight, RotateCcw } from 'lucide-react';
import { defaultWidgetSize, resizeWidget, type WidgetId, type WidgetSize } from '../../../../shared/dashboard.ts';
import { t } from '../../i18n.tsx';
import { WIDGET_TITLES } from '../../widget-titles.ts';

interface Resize {
  pointer: number; x: number; y: number; lastX: number; lastY: number; scrollY: number; columnWidth: number;
  height: number; size: WidgetSize; handle: HTMLButtonElement;
}

export function WidgetResizeHandle({ id, size, content, grid, disabled, onChange, onAnnounce, instructions }: {
  id: WidgetId; size: WidgetSize; content: RefObject<HTMLDivElement | null>; grid: RefObject<HTMLDivElement | null>;
  disabled: boolean; onChange: (size: WidgetSize) => void; onAnnounce: (text: string) => void; instructions: string;
}) {
  const resize = useRef<Resize | null>(null);
  const [active, setActive] = useState(false);
  const name = t(WIDGET_TITLES[id]);
  const summary = (value: WidgetSize) => t('dashboard.arrange.sizeSummary', { columns: value.columns,
    height: value.height === null ? t('dashboard.arrange.autoHeight') : `${value.height} px` });
  function announce(value: WidgetSize) { onAnnounce(`${name}: ${summary(value)}`); }
  function sizeAtPointer(current: Resize) {
    return resizeWidget(current.size, current.lastX - current.x, current.lastY - current.y + window.scrollY - current.scrollY,
      current.columnWidth, current.height);
  }
  useEffect(() => {
    if (!active) return;
    let frame: number;
    const tick = () => {
      const current = resize.current;
      if (!current) return;
      if (Math.abs(current.lastY - current.y) >= 8) {
        const before = window.scrollY;
        const speed = current.lastY < 64 ? -8 : current.lastY > window.innerHeight - 64 ? 8 : 0;
        if (speed) window.scrollBy({ top: speed, behavior: 'instant' });
        if (window.scrollY !== before) onChange(sizeAtPointer(current));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  function release() {
    const current = resize.current;
    resize.current = null;
    setActive(false);
    if (current?.handle.hasPointerCapture(current.pointer)) current.handle.releasePointerCapture(current.pointer);
    return current;
  }
  useEffect(() => { if (disabled) release(); }, [disabled]);
  useEffect(() => () => {
    const current = resize.current;
    resize.current = null;
    if (current?.handle.hasPointerCapture(current.pointer)) current.handle.releasePointerCapture(current.pointer);
  }, []);
  function cancel() { const current = release(); if (current) onChange(current.size); }
  function start(event: PointerEvent<HTMLButtonElement>) {
    if (disabled || !event.isPrimary || event.button !== 0 || !content.current || !grid.current) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const gap = Number.parseFloat(getComputedStyle(grid.current).columnGap) || 0;
    resize.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, scrollY: window.scrollY,
      columnWidth: Math.max(1, (grid.current.getBoundingClientRect().width + gap) / 12),
      height: content.current.getBoundingClientRect().height, size: { ...size }, handle: event.currentTarget };
    setActive(true);
  }
  function update(event: PointerEvent<HTMLButtonElement>, finish = false) {
    const current = resize.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.lastX = event.clientX; current.lastY = event.clientY;
    const next = sizeAtPointer(current);
    if (finish) release();
    onChange(next);
    if (finish) announce(next);
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') { cancel(); return; }
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0;
    if (!dx && !dy && event.key !== 'Home') return;
    event.preventDefault();
    const next = event.key === 'Home' ? defaultWidgetSize(id)
      : resizeWidget(size, dx, dy, 1, content.current?.getBoundingClientRect().height ?? 240);
    onChange(next); announce(next);
  }
  const buttonClass = 'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel-3 hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30';
  return <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
    <span className="mr-auto text-[11px] text-dim">{summary(size)}</span>
    {size.height !== null && <button type="button" disabled={disabled} className="rounded px-1 text-xs text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      onClick={() => { const next = { ...size, height: null }; onChange(next); announce(next); }}>{t('dashboard.arrange.autoHeight')}</button>}
    <button type="button" disabled={disabled} className={buttonClass} title={t('dashboard.arrange.resetSize', { name })}
      aria-label={t('dashboard.arrange.resetSize', { name })} onClick={() => { const next = defaultWidgetSize(id); onChange(next); announce(next); }}><RotateCcw className="size-4" /></button>
    <button type="button" disabled={disabled} className={`${buttonClass} touch-none cursor-nwse-resize select-none`}
      title={t('dashboard.arrange.resize', { name })} aria-label={t('dashboard.arrange.resize', { name })} aria-describedby={instructions}
      onPointerDown={start} onPointerMove={(e) => update(e)} onPointerUp={(e) => update(e, true)}
      onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={keyboard}>
      <ArrowDownRight className="size-5" />
    </button>
  </div>;
}
