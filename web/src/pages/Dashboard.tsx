import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { GripVertical, LayoutDashboard, Plus, RefreshCw, Server, SlidersHorizontal } from 'lucide-react';
import { defaultDashboardLayout, type DashboardLayout, type WidgetId, type WidgetSizes } from '../../../shared/dashboard.ts';
import { api, useApi, type Instance, type Overview } from '../api.ts';
import { CustomizeDashboard } from '../components/dashboard/CustomizeDashboard.tsx';
import { DashboardGrid } from '../components/dashboard/DashboardGrid.tsx';
import { InstanceForm } from '../components/InstanceForm.tsx';
import { Button, Card, EmptyState, ErrorBox, PageHeader, PageLoader, useToast } from '../components/ui.tsx';
import { cx, timeAgo } from '../util.ts';
import { t } from '../i18n.tsx';
import { WIDGET_TITLES } from '../widget-titles.ts';

export function Dashboard() {
  const toast = useToast();
  const nav = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [hiding, setHiding] = useState(false);
  const hideInFlight = useRef(false);
  const [draftOrder, setDraftOrder] = useState<WidgetId[] | null>(null);
  const [draftSizes, setDraftSizes] = useState<WidgetSizes | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string>();
  const orderInFlight = useRef(false);
  const layout = useApi<DashboardLayout>('/dashboard/layout');
  const instances = useApi<Instance[]>('/instances', { poll: (d) => (d.some((i) => i.syncing) ? 2000 : false) });
  const overview = useApi<Overview>('/overview', { poll: () => (instances.data?.some((i) => i.syncing) ? 2500 : 30000) });

  async function hideWidget(id: WidgetId) {
    if (!layout.data || hideInFlight.current || draftOrder !== null) return;
    hideInFlight.current = true;
    setHiding(true);
    try {
      const saved = await api<DashboardLayout>(`/dashboard/layout/widgets/${id}`, { method: 'PATCH', body: { visible: false } });
      layout.setData(saved);
      toast(t('dashboard.widget.hidden', { name: t(WIDGET_TITLES[id]) }));
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      hideInFlight.current = false;
      setHiding(false);
    }
  }

  async function saveOrder() {
    if (!draftOrder || !draftSizes || orderInFlight.current) return;
    orderInFlight.current = true;
    setSavingOrder(true);
    setOrderError(undefined);
    try {
      const saved = await api<DashboardLayout>('/dashboard/layout/geometry', { method: 'PATCH', body: { order: draftOrder, sizes: draftSizes } });
      layout.setData(saved);
      setDraftOrder(null);
      setDraftSizes(null);
      toast(t('dashboard.arrange.saved'));
    } catch (error) {
      setOrderError((error as Error).message);
    } finally {
      orderInFlight.current = false;
      setSavingOrder(false);
    }
  }

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
  const arranging = draftOrder !== null;
  const visible = settings.order.filter((id) => settings.widgets[id].visible);
  const customizeButton = <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setCustomizing(true)} disabled={!layout.data || hiding || arranging}>{t('dashboard.customize.title')}</Button>;

  return (
    <>
      <PageHeader
        title={t('nav.overview')}
        subtitle={o.stats.last_sync ? t('dashboard.lastBackup', { when: timeAgo(o.stats.last_sync) }) : t('dashboard.noBackup')}
        actions={
          <>
            {customizeButton}
            <Button icon={<GripVertical className="size-4" />} disabled={!layout.data || hiding || arranging || visible.length === 0}
              onClick={() => { setDraftOrder([...settings.order]); setDraftSizes(structuredClone(settings.sizes)); setOrderError(undefined); }}>{t('dashboard.arrange.title')}</Button>
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
      {arranging && <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">{t('dashboard.arrange.title')}</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={savingOrder} onClick={() => { const defaults = defaultDashboardLayout(); setDraftOrder(defaults.order); setDraftSizes(defaults.sizes); }}>{t('dashboard.arrange.reset')}</Button>
            <Button size="sm" disabled={savingOrder} onClick={() => { setDraftOrder(null); setDraftSizes(null); setOrderError(undefined); }}>{t('common.cancel')}</Button>
            <Button size="sm" variant="primary" loading={savingOrder} onClick={() => void saveOrder()}>{t('common.save')}</Button>
          </div>
        </div>
        {orderError && <div className="mt-3"><ErrorBox>{orderError}</ErrorBox></div>}
      </Card>}

      <DashboardGrid layout={settings} order={draftOrder ?? settings.order} sizes={draftSizes ?? settings.sizes} overview={o} instances={list}
        onHide={(id) => void hideWidget(id)} hideDisabled={!layout.data || hiding || customizing}
        onReorder={arranging ? (order) => { if (!orderInFlight.current) setDraftOrder(order); } : undefined}
        onResize={arranging ? (id, size) => { if (!orderInFlight.current) setDraftSizes((current) => ({ ...(current ?? settings.sizes), [id]: size })); } : undefined}
        disabled={savingOrder} />

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
