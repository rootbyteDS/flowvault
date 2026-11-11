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

export interface WidgetProps { overview: Overview; instances: Instance[] }
export type WidgetSection = 'status' | 'metrics' | 'main' | 'side';
interface WidgetDefinition {
  id: WidgetId;
  label: MessageKey;
  hint?: MessageKey;
  section: WidgetSection;
  Component: ComponentType<WidgetProps>;
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return <Card className="px-5 py-4">
    <div className="text-[13px] text-muted">{label}</div>
    <div className="mt-2 text-[28px] leading-none font-medium [font-stretch:92%]">{value}</div>
    <div className="mt-2 text-xs text-dim">{sub}</div>
  </Card>;
}

function InstanceCount({ overview: o, instances }: WidgetProps) {
  return <Stat label={t('dashboard.stats.instances')} value={o.stats.instances} sub={t('dashboard.stats.reachable', { reachable: instances.filter((i) => i.last_sync_ok).length, total: instances.length })} />;
}
function WorkflowCount({ overview: o }: WidgetProps) {
  return <Stat label={t('dashboard.stats.workflows')} value={o.stats.workflows} sub={t('dashboard.stats.active', { count: o.stats.active })} />;
}
function VersionCount({ overview: o }: WidgetProps) {
  return <Stat label={t('dashboard.stats.versions')} value={o.stats.versions} sub={t('dashboard.stats.versionsWeek', { count: o.stats.versions_7d })} />;
}
function Storage({ overview: o }: WidgetProps) {
  return <Stat label={t('dashboard.stats.storage')} value={formatBytes(o.stats.storage_bytes)} sub={t('dashboard.stats.storageFor', { count: o.stats.versions })} />;
}
function History({ overview: o }: WidgetProps) {
  return <Heatmap days={o.days} firstBackup={o.stats.first_backup} />;
}
function Activity({ overview: o }: WidgetProps) {
  return <Card>
    <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
      <h2 className="text-sm font-medium">{t('dashboard.recent')}</h2>
      <Link to="/activity" className="text-[13px] text-muted transition-colors hover:text-text">{t('dashboard.showAll')}</Link>
    </div>
    <div className="divide-y divide-line">
      {o.activity.map((a) => <ActivityRow key={a.id} a={a} />)}
      {o.activity.length === 0 && <div className="px-4 py-12 text-center text-sm text-muted">{t('dashboard.noChanges')}</div>}
    </div>
  </Card>;
}
function Instances({ instances }: WidgetProps) {
  return <Card>
    <div className="border-b border-line px-4 py-3">
      <h2 className="text-sm font-medium">{t('nav.instancesHeading')}</h2>
    </div>
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
  { id: 'health', label: 'dashboard.customize.health', hint: 'dashboard.customize.healthHint', section: 'status', Component: AlertsCard },
  { id: 'instanceCount', label: 'dashboard.customize.instanceCount', section: 'metrics', Component: InstanceCount },
  { id: 'workflowCount', label: 'dashboard.customize.workflowCount', section: 'metrics', Component: WorkflowCount },
  { id: 'versionCount', label: 'dashboard.customize.versionCount', section: 'metrics', Component: VersionCount },
  { id: 'storage', label: 'dashboard.customize.storage', section: 'metrics', Component: Storage },
  { id: 'history', label: 'dashboard.customize.history', section: 'main', Component: History },
  { id: 'executions', label: 'dashboard.customize.executions', section: 'main', Component: ExecutionHistoryWidget },
  { id: 'activity', label: 'dashboard.customize.activity', section: 'main', Component: Activity },
  { id: 'instances', label: 'dashboard.customize.instances', section: 'side', Component: Instances },
];
