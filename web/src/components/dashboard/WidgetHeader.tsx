import { useId, useRef, useState, type ReactNode } from 'react';
import { Settings, X } from 'lucide-react';
import type { WidgetId } from '../../../../shared/dashboard.ts';
import { t } from '../../i18n.tsx';
import { WIDGET_TITLES } from '../../widget-titles.ts';
import { cx } from '../../util.ts';

export interface WidgetControls {
  onHide?: () => void;
  hideDisabled?: boolean;
}

export function WidgetHeader({ id, onHide, hideDisabled, settings, children, aside, className, compact = false }: WidgetControls & {
  id: WidgetId;
  settings?: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const gear = useRef<HTMLButtonElement>(null);
  const title = t(WIDGET_TITLES[id]);
  const settingsLabel = t('dashboard.widget.settings', { name: title });
  const hideLabel = t('dashboard.widget.hide', { name: title });
  const buttonClass = 'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-dim transition-colors hover:bg-panel-3 hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-40';
  return <div className={className}>
    <div className="flex items-start justify-between gap-2">
      <h2 className={cx('min-w-0 self-center break-words', compact ? 'text-[13px] text-muted' : 'text-sm font-medium')}>{title}</h2>
      <div className="flex shrink-0 items-center gap-1">
        {aside}
        {settings && <button type="button" ref={gear} className={buttonClass} title={settingsLabel} aria-label={settingsLabel}
          aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
          <Settings className="size-4" />
        </button>}
        {onHide && <button type="button" className={buttonClass} title={hideLabel} aria-label={hideLabel} disabled={hideDisabled} onClick={onHide}>
          <X className="size-4" />
        </button>}
      </div>
    </div>
    {children}
    {settings && open && <div id={panelId} role="group" aria-label={settingsLabel} className="mt-3 space-y-3 rounded-lg border border-line-2 bg-panel-2 p-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); gear.current?.focus(); }
      }}>
      {settings}
      <p className="text-xs text-dim">{t('dashboard.widget.settingsHint')}</p>
    </div>}
  </div>;
}
