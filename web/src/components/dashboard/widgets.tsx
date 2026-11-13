import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router';
import type { WidgetId } from '../../../../shared/dashboard.ts';
import type { Instance, Overview } from '../../api.ts';
import { t, type MessageKey } from '../../i18n.tsx';
import { formatBytes, intervalLabel, timeAgo } from '../../util.ts';
import { ActivityRow } from '../changes.tsx';
import { AlertsCard } from '../health.tsx';
import { Card, StatusDot } from '../ui.tsx';
import { Heatmap } from './Heatmap.tsx';
import { ExecutionHistoryWidget } from './ExecutionHistory.tsx';
import { WidgetHeader, type WidgetControls } from './WidgetHeader.tsx';

export interface WidgetProps extends WidgetControls { overview: Overview; instances: Instance[] }
interface WidgetDefinition {
  id: WidgetId;
  hint?: MessageKey;
  Component: ComponentType<WidgetProps>;
}

function Stat({ id, value, sub, ...controls }: WidgetControls & { id: WidgetId; value: ReactNode; sub: ReactNode }) {
  return <Card className="px-5 py-4">
    <WidgetHeader id={id} compact {...controls} />
    <div className="mt-2 text-[28px] leading-none font-medium [font-stretch:92%]">{value}</div>
    <div className="mt-2 text-xs text-dim">{sub}</div>
  </Card>;
}

function InstanceCount({ overview: o, instances, ...controls }: WidgetProps) {
  return <Stat id="instanceCount" {...controls} value={o.stats.instances} sub={t('dashboard.stats.reachable', { reachable: instances.filter((i) => i.last_sync_ok).length, total: instances.length })} />;
}
function WorkflowCount({ overview: o, ...controls }: WidgetProps) {
  return <Stat id="workflowCount" {...controls} value={o.stats.workflows} sub={t('dashboard.stats.active', { count: o.stats.active })} />;
}
function VersionCount({ overview: o, ...controls }: WidgetProps) {
  return <Stat id="versionCount" {...controls} value={o.stats.versions} sub={t('dashboard.stats.versionsWeek', { count: o.stats.versions_7d })} />;
}
function Storage({ overview: o, ...controls }: WidgetProps) {
  return <Stat id="storage" {...controls} value={formatBytes(o.stats.storage_bytes)} sub={t('dashboard.stats.storageFor', { count: o.stats.versions })} />;
}
function History({ overview: o, ...controls }: WidgetProps) {
  return <Heatmap days={o.days} firstBackup={o.stats.first_backup} {...controls} />;
}
function Activity({ overview: o, ...controls }: WidgetProps) {
  return <Card>
    <WidgetHeader id="activity" {...controls} className="border-b border-line px-4 py-3" aside={
      <Link to="/activity" className="mr-2 text-[13px] text-muted transition-colors hover:text-text">{t('dashboard.showAll')}</Link>
    } />
    <div className="divide-y divide-line">
      {o.activity.map((a) => <ActivityRow key={a.id} a={a} />)}
      {o.activity.length === 0 && <div className="px-4 py-12 text-center text-sm text-muted">{t('dashboard.noChanges')}</div>}
    </div>
  </Card>;
}
function Instances({ instances, ...controls }: WidgetProps) {
  return <Card>
    <WidgetHeader id="instances" {...controls} className="border-b border-line px-4 py-3" />
    <div className="divide-y divide-line">
      {instances.map((i) => (
        <Link key={i.id} to={`/instances/${i.id}`} className="block px-4 py-3 transition-colors hover:bg-panel-2">
          <div className="flex items-center gap-2.5">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: i.color }} />
            <span className="flex-1 truncate text-sm font-medium">{i.name}</span>
            <StatusDot ok={i.last_sync_ok} syncing={i.syncing} />
          </div>
          <div className="mt-1 truncate pl-[18px] text-[13px] text-muted">{i.base_url.replace(/^https?:\/\//, '')}</div>
          <div className="mt-2 flex flex-wrap gap-x-3 pl-[18px] font-mono text-xs text-dim">
            <span>{t('dashboard.workflowCount', { count: i.workflows })}</span>
            <span>{t('dashboard.activeCount', { count: i.active_workflows })}</span>
            <span>{t('dashboard.versionCount', { count: i.versions })}</span>
          </div>
          <div className="mt-1 pl-[18px] text-xs text-dim">
            {i.syncing ? t('ui.syncing') : i.last_sync_ok === false ? <span className="text-del">{t('dashboard.lastSyncFailed')}</span> : t('dashboard.backedUp', { when: timeAgo(i.last_sync_at), interval: intervalLabel(i.sync_interval) })}
          </div>
        </Link>
      ))}
    </div>
  </Card>;
}

/** Add new widgets here and their stable IDs/defaults in shared/dashboard.ts. */
export const DASHBOARD_WIDGETS: readonly WidgetDefinition[] = [
  { id: 'health', hint: 'dashboard.customize.healthHint', Component: AlertsCard },
  { id: 'instanceCount', Component: InstanceCount },
  { id: 'workflowCount', Component: WorkflowCount },
  { id: 'versionCount', Component: VersionCount },
  { id: 'storage', Component: Storage },
  { id: 'history', Component: History },
  { id: 'executions', Component: ExecutionHistoryWidget },
  { id: 'activity', Component: Activity },
  { id: 'instances', Component: Instances },
];
