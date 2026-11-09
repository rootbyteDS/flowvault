import { useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus, RefreshCw, Server } from 'lucide-react';
import { api, useApi, type Instance } from '../api.ts';
import { InstanceForm } from '../components/InstanceForm.tsx';
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, PageLoader, StatusDot, useToast } from '../components/ui.tsx';
import { cx, intervalLabel, timeAgo } from '../util.ts';
import { message, rich, t } from '../i18n.tsx';

export function Instances() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Instance[]>('/instances', { poll: (d) => (d.some((i) => i.syncing) ? 2000 : false) });
  const [edit, setEdit] = useState<Instance | null | undefined>(undefined);
  const [syncing, setSyncing] = useState<number>();

  async function sync(i: Instance) {
    setSyncing(i.id);
    try {
      const r = await api<{ ok: boolean; error?: string; created?: number; changed?: number; deleted?: number }>(`/instances/${i.id}/sync`, { method: 'POST' });
      toast(t('instances.syncResult', { name: i.name, created: r.created ?? 0, changed: r.changed ?? 0, deleted: r.deleted ?? 0 }));
    } catch (e) {
      toast(t('instances.syncError', { name: i.name, reason: (e as Error).message }), 'error');
    } finally {
      setSyncing(undefined);
      reload();
    }
  }

  if (loading && !data) return <PageLoader />;
  if (error) return <ErrorBox>{error}</ErrorBox>;

  return (
    <>
      <PageHeader
        title={t('nav.instances')}
        subtitle={t('instances.subtitle')}
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit(null)}>{t('instances.connect')}</Button>}
      />
      {data!.length === 0 ? (
        <Card>
          <EmptyState icon={<Server className="size-6" />} title={t('instances.emptyTitle')} action={<Button variant="primary" onClick={() => setEdit(null)}>{t('instances.connect')}</Button>}>
            {t('instances.emptyText')}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data!.map((i) => (
            <Card key={i.id} className="flex flex-col p-5">
              <div className="flex items-center gap-2.5">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: i.color }} />
                <Link to={`/instances/${i.id}`} className="min-w-0 flex-1 truncate text-base font-medium transition-colors hover:text-accent-hi">{i.name}</Link>
                {!i.enabled && <Badge>{t('instances.paused')}</Badge>}
              </div>
              <a href={i.base_url} target="_blank" rel="noreferrer" className="mt-1 block truncate pl-[18px] text-[13px] text-muted hover:text-text">{i.base_url}</a>

              <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4">
                <div><dt className="text-xs text-dim">{t('instances.stats.workflows')}</dt><dd className="mt-1 text-xl leading-none font-medium">{i.workflows}</dd></div>
                <div><dt className="text-xs text-dim">{t('instances.stats.versions')}</dt><dd className="mt-1 text-xl leading-none font-medium">{i.versions}</dd></div>
                <div><dt className="text-xs text-dim">{t('instances.stats.deleted')}</dt><dd className="mt-1 text-xl leading-none font-medium">{i.deleted_workflows}</dd></div>
              </dl>

              <div className="mt-5 space-y-1 text-[13px]">
                <div className="flex items-center gap-2">
                  <StatusDot ok={i.last_sync_ok} syncing={i.syncing} />
                  {i.syncing ? <span className="text-muted">{t('ui.syncing')}</span> : i.last_sync_ok === false ? <span className="text-del">{t('instances.lastFailed')}</span> : <span className="text-muted">{t('instances.backedUp', { when: timeAgo(i.last_sync_at) })}</span>}
                </div>
                {i.last_sync_error && <div className="line-clamp-2 pl-3.5 text-xs text-del">{message(i.last_sync_error)}</div>}
                <div className="pl-3.5 text-xs text-dim">{rich('instances.intervalKey', { k: (c) => <span className="font-mono">{c}</span> }, { interval: intervalLabel(i.sync_interval), hint: i.key_hint })}</div>
              </div>

              <div className="mt-auto flex gap-2 pt-5">
                <Button size="sm" className="flex-1" icon={<RefreshCw className={cx('size-4', (syncing === i.id || i.syncing) && 'animate-spin')} />} onClick={() => sync(i)} disabled={syncing === i.id || i.syncing}>
                  {t('instances.syncNow')}
                </Button>
                <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit(i)}>{t('instances.edit')}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <InstanceForm open={edit !== undefined} instance={edit ?? undefined} onClose={() => setEdit(undefined)} onSaved={() => reload()} />
    </>
  );
}
