import { useState } from 'react';
import { useNavigate } from 'react-router';
import { LayoutDashboard, Plus, RefreshCw, Server, SlidersHorizontal } from 'lucide-react';
import { defaultDashboardLayout, type DashboardLayout } from '../../../shared/dashboard.ts';
import { api, useApi, type Instance, type Overview } from '../api.ts';
import { CustomizeDashboard } from '../components/dashboard/CustomizeDashboard.tsx';
import { DASHBOARD_WIDGETS, type WidgetSection } from '../components/dashboard/widgets.tsx';
import { InstanceForm } from '../components/InstanceForm.tsx';
import { Button, Card, EmptyState, ErrorBox, PageHeader, PageLoader, useToast } from '../components/ui.tsx';
import { cx, timeAgo } from '../util.ts';
import { t } from '../i18n.tsx';

export function Dashboard() {
  const toast = useToast();
  const nav = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const layout = useApi<DashboardLayout>('/dashboard/layout');
  const instances = useApi<Instance[]>('/instances', { poll: (d) => (d.some((i) => i.syncing) ? 2000 : false) });
  const overview = useApi<Overview>('/overview', { poll: () => (instances.data?.some((i) => i.syncing) ? 2500 : 30000) });

  async function syncAll() {
    setSyncing(true);
    try {
      const r = await api<{ ok: boolean; count: number }>('/sync-all', { method: 'POST' });
      toast(r.ok ? t('dashboard.synced', { count: r.count }) : t('dashboard.syncFailed'), r.ok ? 'ok' : 'error');
    } finally {
      setSyncing(false);
      overview.reload();
      instances.reload();
    }
  }

  if ((overview.loading && !overview.data) || (instances.loading && !instances.data) || (layout.loading && !layout.data)) return <PageLoader />;
  if (overview.error) return <ErrorBox>{overview.error}</ErrorBox>;
  if (instances.error && !instances.data) return <ErrorBox>{instances.error}</ErrorBox>;
  const o = overview.data!;
  const list = instances.data ?? [];

  if (list.length === 0) {
    return (
      <>
        <PageHeader title={t('nav.overview')} />
        <Card>
          <EmptyState
            icon={<Server className="size-6" />}
            title={t('dashboard.emptyTitle')}
            action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setShowForm(true)}>{t('dashboard.emptyAction')}</Button>}
          >
            {t('dashboard.emptyText')}
          </EmptyState>
        </Card>
        <InstanceForm open={showForm} onClose={() => setShowForm(false)} onSaved={(i) => nav(`/instances/${i.id}`)} />
      </>
    );
  }

  const settings = layout.data ?? defaultDashboardLayout();
  const visible = DASHBOARD_WIDGETS.filter((widget) => settings.widgets[widget.id].visible);
  const section = (name: WidgetSection) => visible.filter((widget) => widget.section === name);
  const renderSection = (name: WidgetSection) => section(name).map(({ id, Component }) => <Component key={id} overview={o} instances={list} />);
  const metricCount = section('metrics').length;
  const hasMain = section('main').length > 0;
  const hasSide = section('side').length > 0;
  const customizeButton = <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setCustomizing(true)} disabled={!layout.data}>{t('dashboard.customize.title')}</Button>;

  return (
    <>
      <PageHeader
        title={t('nav.overview')}
        subtitle={o.stats.last_sync ? t('dashboard.lastBackup', { when: timeAgo(o.stats.last_sync) }) : t('dashboard.noBackup')}
        actions={
          <>
            {customizeButton}
            <Button icon={<Plus className="size-4" />} onClick={() => setShowForm(true)}>{t('dashboard.addInstance')}</Button>
            <Button variant="primary" icon={<RefreshCw className={cx('size-4', syncing && 'animate-spin')} />} onClick={syncAll} disabled={syncing}>
              {t('dashboard.syncAll')}
            </Button>
          </>
        }
      />

      {layout.error && <div className="mb-6 space-y-3">
        <ErrorBox>{layout.error}</ErrorBox>
        <Button size="sm" onClick={() => void layout.reload()}>{t('dashboard.customize.retry')}</Button>
      </div>}
      {renderSection('status')}

      {metricCount > 0 && <div className={cx('grid gap-4', metricCount === 1 ? 'grid-cols-1' : metricCount === 2 ? 'grid-cols-2' : metricCount === 3 ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2 lg:grid-cols-4')}>
        {renderSection('metrics')}
      </div>}

      {(hasMain || hasSide) && <div className={cx('grid gap-6', metricCount > 0 && 'mt-6', hasMain && hasSide && 'xl:grid-cols-3')}>
        {hasMain && <div className={cx('min-w-0 space-y-6', hasSide && 'xl:col-span-2')}>{renderSection('main')}</div>}
        {hasSide && <div className="min-w-0 space-y-6">{renderSection('side')}</div>}
      </div>}

      {visible.length === 0 && <Card>
        <EmptyState icon={<LayoutDashboard className="size-6" />} title={t('dashboard.customize.emptyTitle')} action={customizeButton}>
          {t('dashboard.customize.emptyText')}
        </EmptyState>
      </Card>}

      {customizing && layout.data && <CustomizeDashboard layout={layout.data} onClose={() => setCustomizing(false)} onSaved={(saved) => {
        layout.setData(saved);
        setCustomizing(false);
        toast(t('dashboard.customize.saved'));
      }} />}

      <InstanceForm open={showForm} onClose={() => setShowForm(false)} onSaved={() => { instances.reload(); overview.reload(); }} />
    </>
  );
}
