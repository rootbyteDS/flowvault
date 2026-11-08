import { useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus, RefreshCw, Server } from 'lucide-react';
import { api, useApi, type Instance } from '../api.ts';
import { InstanceForm } from '../components/InstanceForm.tsx';
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, PageLoader, StatusDot, useToast } from '../components/ui.tsx';
import { cx, intervalLabel, timeAgo } from '../util.ts';

export function Instances() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Instance[]>('/instances', { poll: (d) => (d.some((i) => i.syncing) ? 2000 : false) });
  const [edit, setEdit] = useState<Instance | null | undefined>(undefined);
  const [syncing, setSyncing] = useState<number>();

  async function sync(i: Instance) {
    setSyncing(i.id);
    try {
      const r = await api<{ ok: boolean; error?: string; created?: number; changed?: number; deleted?: number }>(`/instances/${i.id}/sync`, { method: 'POST' });
      toast(`${i.name}: ${r.created} neu, ${r.changed} geändert, ${r.deleted} gelöscht`);
    } catch (e) {
      toast(`${i.name}: ${(e as Error).message}`, 'error');
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
        title="Instanzen"
        subtitle="n8n-Server, deren Workflows FlowVault sichert"
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit(null)}>Instanz verbinden</Button>}
      />
      {data!.length === 0 ? (
        <Card>
          <EmptyState icon={<Server className="size-6" />} title="Noch keine Instanz verbunden" action={<Button variant="primary" onClick={() => setEdit(null)}>Instanz verbinden</Button>}>
            Du brauchst die URL deiner n8n-Instanz und einen API-Key
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data!.map((i) => (
            <Card key={i.id} className="flex flex-col p-5">
              <div className="flex items-center gap-2.5">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: i.color }} />
                <Link to={`/instances/${i.id}`} className="min-w-0 flex-1 truncate text-base font-medium transition-colors hover:text-accent-hi">{i.name}</Link>
                {!i.enabled && <Badge>Pausiert</Badge>}
              </div>
              <a href={i.base_url} target="_blank" rel="noreferrer" className="mt-1 block truncate pl-[18px] text-[13px] text-muted hover:text-text">{i.base_url}</a>

              <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4">
                <div><dt className="text-xs text-dim">Workflows</dt><dd className="mt-1 text-xl leading-none font-medium">{i.workflows}</dd></div>
                <div><dt className="text-xs text-dim">Versionen</dt><dd className="mt-1 text-xl leading-none font-medium">{i.versions}</dd></div>
                <div><dt className="text-xs text-dim">Gelöscht</dt><dd className="mt-1 text-xl leading-none font-medium">{i.deleted_workflows}</dd></div>
              </dl>

              <div className="mt-5 space-y-1 text-[13px]">
                <div className="flex items-center gap-2">
                  <StatusDot ok={i.last_sync_ok} syncing={i.syncing} />
                  {i.syncing ? <span className="text-muted">Sichert gerade</span> : i.last_sync_ok === false ? <span className="text-del">Letzter Sync fehlgeschlagen</span> : <span className="text-muted">Gesichert {timeAgo(i.last_sync_at)}</span>}
                </div>
                {i.last_sync_error && <div className="line-clamp-2 pl-3.5 text-xs text-del">{i.last_sync_error}</div>}
                <div className="pl-3.5 text-xs text-dim">{intervalLabel(i.sync_interval)} · API-Key <span className="font-mono">{i.key_hint}</span></div>
              </div>

              <div className="mt-auto flex gap-2 pt-5">
                <Button size="sm" className="flex-1" icon={<RefreshCw className={cx('size-4', (syncing === i.id || i.syncing) && 'animate-spin')} />} onClick={() => sync(i)} disabled={syncing === i.id || i.syncing}>
                  Jetzt sichern
                </Button>
                <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit(i)}>Bearbeiten</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <InstanceForm open={edit !== undefined} instance={edit ?? undefined} onClose={() => setEdit(undefined)} onSaved={() => reload()} />
    </>
  );
}
