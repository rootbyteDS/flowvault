import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { ExecutionHistory as History } from '../../../../shared/executions.ts';
import { useApi, type Instance } from '../../api.ts';
import { executionHeatmap, executionLevel, normalizeExecutionPreferences, type ExecutionMetric, type ExecutionPreferences, type RateThresholds } from '../../execution-history.ts';
import { DAY_MS, HEATMAP_PERIODS, isHeatmapPeriod, type HeatmapPeriod } from '../../heatmap.ts';
import { intlLocale, t, type MessageKey } from '../../i18n.tsx';
import { cx, formatNumber, timeAgo } from '../../util.ts';
import { Button, Card, ErrorBox, Field, Spinner } from '../ui.tsx';

import { WidgetHeader, type WidgetControls } from './WidgetHeader.tsx';
import { RateColorSettings } from './RateColorSettings.tsx';

const STORAGE_KEY = 'fv:execution-history';
function storedPreferences(): ExecutionPreferences {
  try { return normalizeExecutionPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')); }
  catch { return normalizeExecutionPreferences(null); }
}

const selectClass = 'h-9 w-full min-w-0 max-w-full rounded-lg border border-line-2 bg-sidebar px-2 text-xs text-text outline-none focus:border-accent';
const colors = ['bg-emerald-500', 'bg-yellow-400', 'bg-amber-500', 'bg-orange-500', 'bg-red-500'];
const date = (value: number) => new Date(value).toLocaleDateString(intlLocale(), { timeZone: 'UTC' });
function rate(value: number | null) {
  if (value === null) return '–';
  // A small but real error rate must never round down to a reassuring "0 %".
  const tiny = value > 0 && value < 0.001;
  return `${tiny ? '<' : ''}${formatNumber(tiny ? 0.001 : value, { style: 'percent', maximumFractionDigits: 1 })}`;
}
function rateLegend(thresholds: RateThresholds) {
  const percent = (value: number) => formatNumber(value / 100, { style: 'percent', maximumFractionDigits: 2 });
  return [thresholds[0] === 0 ? percent(0) : `≤${percent(thresholds[0])}`,
    ...thresholds.slice(1).map((limit, i) => `>${formatNumber(thresholds[i], { maximumFractionDigits: 2 })}–${percent(limit)}`), `>${percent(thresholds[3])}`];
}
const periodLabel = (p: HeatmapPeriod) => p === 'auto' ? t('dashboard.heatmap.auto') : p === '4w'
  ? t('dashboard.heatmap.weeks') : t('dashboard.heatmap.months', { count: Number.parseInt(p) });

export function ExecutionHistoryWidget({ instances, ...controls }: WidgetControls & { instances: Instance[] }) {
  const [preferences, setPreferences] = useState(storedPreferences);
  const selected = instances.some((i) => String(i.id) === preferences.instance) ? preferences.instance : 'all';
  function change(next: Partial<ExecutionPreferences>) {
    const value = { ...preferences, instance: selected, ...next };
    setPreferences(value);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {}
  }
  return <Card className="p-5">
    <WidgetHeader id="executions" {...controls} className="mb-4" settings={<>
      <Field label={t('dashboard.executions.instance')}>
        <select className={selectClass} aria-label={t('dashboard.executions.instance')} value={selected} onChange={(e) => change({ instance: e.target.value })}>
          <option value="all">{t('dashboard.executions.allInstances')}</option>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </Field>
      <Field label={t('dashboard.executions.period')}>
        <select className={selectClass} aria-label={t('dashboard.executions.period')} value={preferences.period} onChange={(e) => {
          if (isHeatmapPeriod(e.target.value)) change({ period: e.target.value });
        }}>
          {HEATMAP_PERIODS.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
        </select>
      </Field>
      <Field label={t('dashboard.executions.metric')}>
        <select className={selectClass} aria-label={t('dashboard.executions.metric')} value={preferences.metric} onChange={(e) => change({ metric: e.target.value === 'count' ? 'count' : 'rate' })}>
          <option value="rate">{t('dashboard.executions.rate')}</option>
          <option value="count">{t('dashboard.executions.count')}</option>
        </select>
      </Field>
      {preferences.metric === 'rate'
        ? <RateColorSettings thresholds={preferences.rateThresholds} onChange={(rateThresholds) => change({ rateThresholds })} />
        : <p className="text-xs text-dim">{t('dashboard.executions.countLimitsHint')}</p>}
    </>}>
      <p className="mt-1 text-xs text-dim">
        {selected === 'all' ? t('dashboard.executions.allInstances') : instances.find((i) => String(i.id) === selected)?.name}
        {' · '}{t(preferences.metric === 'rate' ? 'dashboard.executions.rate' : 'dashboard.executions.count')}
      </p>
    </WidgetHeader>
    {/* Remount on scope changes: never label stale results from another instance as current. */}
    <HistoryData key={selected} selected={selected} instances={instances} period={preferences.period} metric={preferences.metric} thresholds={preferences.rateThresholds} />
  </Card>;
}

function HistoryData({ selected, instances, period, metric, thresholds }: { selected: string; instances: Instance[]; period: HeatmapPeriod; metric: ExecutionMetric; thresholds: RateThresholds }) {
  const result = useApi<History>(`/health/executions/history${selected === 'all' ? '' : `?instance=${selected}`}`, {
    poll: (d) => d.settings.enabled ? Math.max(30_000, d.settings.pollMinutes * 60_000) : 60_000,
  });
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [focusDay, setFocusDay] = useState<number | null>(null);
  const cells = useRef(new Map<number, HTMLDivElement>());
  const id = useId();
  const error = result.error && <div className="mb-4 space-y-2">
    <ErrorBox>{result.error}</ErrorBox>
    <Button size="sm" onClick={() => void result.reload()}>{t('dashboard.executions.retry')}</Button>
  </div>;
  if (!result.data) return <>{error || <div className="flex justify-center py-8"><Spinner /></div>}</>;
  const data = result.data;
  const now = Date.now(), today = Math.floor(now / DAY_MS);
  const chart = executionHeatmap(data, period, today);
  const inScope = instances.filter((i) => selected === 'all' || String(i.id) === selected);
  const states = new Map(data.instances.map((i) => [i.instanceId, i]));
  const names = (test: (i: Instance) => boolean) => inScope.filter(test).map((i) => i.name).join(', ');
  const errors = names((i) => states.get(i.id)?.ok === false);
  const pending = names((i) => i.enabled && !states.get(i.id)?.lastSuccessAt);
  const stale = names((i) => {
    const at = states.get(i.id)?.lastSuccessAt;
    return i.enabled && !!at && now - at > Math.max(2 * data.settings.pollMinutes, data.settings.pollMinutes + 2) * 60_000;
  });
  const incomplete = names((i) => !!states.get(i.id)?.incomplete);
  const paused = names((i) => !i.enabled);
  const successes = inScope.flatMap((i) => states.get(i.id)?.lastSuccessAt ? [states.get(i.id)!.lastSuccessAt!] : []);
  const firstDay = chart.grid.flat().find((c) => !c.outside)?.day ?? today;
  const focused = focusDay !== null && focusDay >= firstDay && focusDay <= today ? focusDay : today;
  const active = chart.grid.flat().find((c) => c.day === activeDay && !c.outside);

  function cellDescription(c: typeof chart.grid[number][number]) {
    const total = c.success + c.failed;
    if (!total && !c.canceled) return t(c.before ? 'dashboard.executions.outsideData' : 'dashboard.executions.noRuns', { date: date(c.day * DAY_MS) });
    return t('dashboard.executions.tip', { date: date(c.day * DAY_MS), total: formatNumber(total), success: formatNumber(c.success),
      failed: formatNumber(c.failed), rate: rate(total ? c.failed / total : null), canceled: formatNumber(c.canceled) });
  }
  function navigate(event: KeyboardEvent, day: number) {
    const offset: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    const next = event.key === 'Home' ? firstDay : event.key === 'End' ? today : event.key in offset ? day + offset[event.key] : null;
    if (next === null) return;
    event.preventDefault();
    const bounded = Math.max(firstDay, Math.min(today, next));
    setFocusDay(bounded);
    cells.current.get(bounded)?.focus();
  }
  const warning = (key: MessageKey, value: string) => value && <p className="text-xs text-amber-400">{t(key, { names: value })}</p>;
  return <>
    {error}
    <div className="mb-4 space-y-1">
      <p className="text-xs text-dim">{t('dashboard.executions.window', { period: periodLabel(chart.period) })}</p>
      <p className="text-sm">{t('dashboard.executions.summary', { total: formatNumber(chart.total), failed: formatNumber(chart.failed), rate: rate(chart.rate) })}</p>
      <p className="text-xs text-dim">{t('dashboard.executions.canceled', { count: formatNumber(chart.canceled) })}</p>
    </div>
    <div className="mb-4 space-y-1" role="status">
      {!data.settings.enabled && <p className="text-xs text-amber-400">{t('dashboard.executions.disabled')}</p>}
      {data.settings.enabled && warning('dashboard.executions.paused', paused)}
      {data.settings.enabled && warning('dashboard.executions.pending', pending)}
      {warning('dashboard.executions.failedPoll', errors)}
      {data.settings.enabled && warning('dashboard.executions.stale', stale)}
      {warning('dashboard.executions.incomplete', incomplete)}
    </div>
    {data.days.length === 0 ? <p className="py-6 text-center text-sm text-muted">{t('dashboard.executions.noData')}</p> : <>
      <div className="overflow-x-auto pb-1" role="group" aria-label={t('dashboard.executions.keyboard')}>
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${chart.weeks}, minmax(0, 1fr))`, minWidth: chart.weeks * 9, maxWidth: chart.weeks * (chart.weeks <= 14 ? 27 : 17) - 3 }}>
          {chart.grid.map((col, w) => <div key={`label${w}`} className="h-4 overflow-visible font-mono text-[11px] whitespace-nowrap text-dim">
            {(w === 0 || new Date(col[0].day * DAY_MS).getUTCMonth() !== new Date(chart.grid[w - 1][0].day * DAY_MS).getUTCMonth()) && w < chart.weeks - 2
              ? new Date(col[0].day * DAY_MS).toLocaleDateString(intlLocale(), { month: 'short', timeZone: 'UTC' }) : ''}
          </div>)}
          {chart.grid.map((col, w) => <div key={w} className="grid gap-[3px]">
            {col.map((c) => {
              const level = executionLevel(c, metric, thresholds);
              const description = c.outside ? undefined : cellDescription(c);
              return <div key={c.day} id={`${id}-${c.day}`} ref={(el) => { if (el) cells.current.set(c.day, el); else cells.current.delete(c.day); }}
                role={c.outside ? undefined : 'img'} aria-label={description} title={description}
                tabIndex={c.outside ? undefined : c.day === focused ? 0 : -1}
                onKeyDown={(e) => navigate(e, c.day)} onFocus={() => { setFocusDay(c.day); setActiveDay(c.day); }}
                onMouseEnter={() => { if (!c.outside) setActiveDay(c.day); }} onTouchStart={() => { if (!c.outside) setActiveDay(c.day); }}
                className={cx('aspect-square w-full rounded-[3px] outline-none focus:ring-2 focus:ring-text', c.outside ? 'bg-transparent'
                  : level < 0 ? cx('border border-line-2 bg-panel-3', c.before && 'border-dashed') : colors[level],
                !c.outside && c.day === today && 'ring-1 ring-text/40')}
              />;
            })}
          </div>)}
        </div>
      </div>
      <p className="mt-3 min-h-8 text-xs text-muted" aria-live="polite">{active ? cellDescription(active) : t('dashboard.executions.hover')}</p>
    </>}
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-dim" aria-label={t(metric === 'rate' ? 'dashboard.executions.rate' : 'dashboard.executions.count')}>
      <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-[2px] border border-line-2 bg-panel-3" />{t('dashboard.executions.neutral')}</span>
      {(metric === 'rate' ? rateLegend(thresholds) : ['0', '1–5', '6–20', '21–100', '>100']).map((label, i) => (
        <span key={label} className="inline-flex items-center gap-1"><span className={cx('size-2.5 rounded-[2px]', colors[i])} />{label}</span>
      ))}
    </div>
    <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs leading-5 text-dim">
      {data.availableFrom !== null && data.availableTo !== null && <p>{t('dashboard.executions.range', { from: date(data.availableFrom), to: date(data.availableTo) })}</p>}
      {successes.length > 0 && <p>{t('dashboard.executions.lastSuccess', { when: timeAgo(Math.min(...successes)) })}</p>}
      <p>{t('dashboard.executions.retention', { lookback: data.settings.lookbackDays, retention: data.settings.retentionDays })}</p>
      <p>{t(data.settings.includeManual ? 'dashboard.executions.manualOn' : 'dashboard.executions.manualOff')}</p>
      <Link to="/settings#fehlerquote" className="text-muted hover:text-text">{t('dashboard.executions.settings')}</Link>
    </div>
  </>;
}
