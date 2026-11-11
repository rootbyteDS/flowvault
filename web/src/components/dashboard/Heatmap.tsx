import { useState } from 'react';
import type { Overview } from '../../api.ts';
import { Card, Field } from '../ui.tsx';
import { cx } from '../../util.ts';
import { intlLocale, t } from '../../i18n.tsx';
import { DAY_MS, HEATMAP_PERIODS, heatmapData, isHeatmapPeriod, type HeatmapPeriod } from '../../heatmap.ts';

import { WidgetHeader, type WidgetControls } from './WidgetHeader.tsx';

const monthName = (month: number) => new Date(Date.UTC(2000, month, 1)).toLocaleDateString(intlLocale(), { month: 'short', timeZone: 'UTC' });

const PERIOD_STORAGE_KEY = 'fv:dashboard-period';

function storedPeriod(): HeatmapPeriod {
  try {
    const saved = localStorage.getItem(PERIOD_STORAGE_KEY);
    if (isHeatmapPeriod(saved)) return saved;
  } catch {}
  return 'auto';
}

export function Heatmap({ days, firstBackup, ...controls }: WidgetControls & { days: Overview['days']; firstBackup: number | null }) {
  const [choice, setChoice] = useState(storedPeriod);
  const today = Math.floor(Date.now() / DAY_MS);
  const { period, grid, weeks, total, max } = heatmapData(days, firstBackup, choice, today);
  const periodLabel = (p: HeatmapPeriod) => p === 'auto' ? t('dashboard.heatmap.auto')
    : p === '4w' ? t('dashboard.heatmap.weeks') : t('dashboard.heatmap.months', { count: Number.parseInt(p) });
  const dateLabel = (day: number) => new Date(day * DAY_MS).toLocaleDateString(intlLocale(), { timeZone: 'UTC' });

  function changePeriod(value: string) {
    if (!isHeatmapPeriod(value)) return;
    setChoice(value);
    try { localStorage.setItem(PERIOD_STORAGE_KEY, value); } catch {}
  }

  const level = (n: number) => {
    if (n < 0) return 'bg-panel-3 border border-dashed border-line-2';
    if (n === 0) return 'bg-panel-3 border border-line-2';
    const r = n / Math.max(max, 4);
    return r > 0.75 ? 'bg-accent' : r > 0.5 ? 'bg-accent/75' : r > 0.25 ? 'bg-accent/50' : 'bg-accent/30';
  };
  const monthOf = (day: number) => new Date(day * 864e5).getUTCMonth();

  return (
    <Card className="p-5">
      <WidgetHeader id="history" {...controls} className="mb-4"
        aside={<span className="mr-2 font-mono text-xs text-dim">{t('dashboard.heatmap.versions', { count: total })}</span>}
        settings={<Field label={t('dashboard.heatmap.period')}>
          <select aria-label={t('dashboard.heatmap.period')} value={choice} onChange={(e) => changePeriod(e.target.value)}
            className="h-9 w-full rounded-lg border border-line-2 bg-sidebar px-2 text-sm text-text outline-none focus:border-accent">
            {HEATMAP_PERIODS.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
          </select>
        </Field>}
      >
        <p className="mt-1 text-xs text-dim">{t('dashboard.heatmap.title', { period: periodLabel(period) })}</p>
        {firstBackup !== null && <p className="mt-1 text-xs text-dim">{t('dashboard.heatmap.since', { date: new Date(firstBackup).toLocaleDateString(intlLocale(), { timeZone: 'UTC' }) })}</p>}
      </WidgetHeader>
      {firstBackup === null ? (
        <p className="py-8 text-center text-sm text-muted">{t('dashboard.heatmap.empty')}</p>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`, minWidth: weeks * 9, maxWidth: weeks * (weeks <= 14 ? 27 : 17) - 3 }}>
            {grid.map((col, i) => (
              <div key={`m${i}`} className="h-4 overflow-visible font-mono text-[11px] whitespace-nowrap text-dim">
                {(i === 0 || monthOf(col[0].day) !== monthOf(grid[i - 1][0].day)) && i < weeks - 2 ? monthName(monthOf(col[0].day)) : ''}
              </div>
            ))}
            {grid.map((col, i) => (
              <div key={i} className="grid gap-[3px]">
                {col.map((c) => (
                  <div
                    key={c.day}
                    className={cx('aspect-square w-full rounded-[3px]', c.outside ? 'bg-transparent' : level(c.n), c.day === today && 'ring-1 ring-text/40')}
                    title={c.outside ? '' : c.before ? t('dashboard.heatmap.before', { date: dateLabel(c.day) }) : t('dashboard.heatmap.tip', { date: dateLabel(c.day), count: c.n })}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-4 flex items-center justify-end gap-1 text-xs text-dim">
        {t('dashboard.heatmap.less')}
        {[level(0), 'bg-accent/30', 'bg-accent/50', 'bg-accent/75', 'bg-accent'].map((c) => (
          <span key={c} className={cx('size-2.5 rounded-[2px]', c)} />
        ))}
        {t('dashboard.heatmap.more')}
      </div>
    </Card>
  );
}

