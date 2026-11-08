import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ExternalLink, Pause, Pencil, Play, RefreshCw, Search, Trash2, Workflow } from 'lucide-react';
import { api, useApi, type ActivityItem, type Instance, type SyncRun, type WorkflowListItem } from '../api.ts';
import { ActivityRow } from '../components/changes.tsx';
import { InstanceForm } from '../components/InstanceForm.tsx';
import { WorkflowTable } from '../components/WorkflowTable.tsx';
import { Badge, Button, Card, EmptyState, ErrorBox, Modal, PageHeader, PageLoader, Segmented, StatusDot, Tabs, inputCls, useToast } from '../components/ui.tsx';
import { cx, formatDate, intervalLabel, timeAgo } from '../util.ts';

type Tab = 'workflows' | 'activity' | 'runs';

export function InstanceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const inst = useApi<Instance & { runs: SyncRun[] }>(`/instances/${id}`, { poll: (d) => (d.syncing ? 2000 : false) });
  const [status, setStatus] = useState<'present' | 'active' | 'deleted' | 'all'>('present');
  const workflows = useApi<WorkflowListItem[]>(`/workflows?instance=${id}&status=${status}`);
  const activity = useApi<ActivityItem[]>(`/activity?instance=${id}&limit=50`);
  const [tab, setTab] = useState<Tab>('workflows');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return (workflows.data ?? []).filter((w) => !s || w.name.toLowerCase().includes(s) || w.tags.some((t) => t.toLowerCase().includes(s)));
  }, [workflows.data, q]);

  if (inst.loading && !inst.data) return <PageLoader />;
  if (inst.error) return <ErrorBox>{inst.error}</ErrorBox>;
  const i = inst.data!;

  async function sync() {
    setSyncing(true);
    try {
      const r = await api<{ created: number; changed: number; deleted: number }>(`/instances/${id}/sync`, { method: 'POST' });
      toast(`Gesichert: ${r.created} neu, ${r.changed} geändert, ${r.deleted} gelöscht`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSyncing(false);
      inst.reload();
      workflows.reload();
      activity.reload();
    }
  }

  async function toggleEnabled() {
    await api(`/instances/${id}`, { method: 'PUT', body: { enabled: !i.enabled } });
    toast(i.enabled ? 'Automatische Sicherung pausiert' : 'Automatische Sicherung fortgesetzt');
    inst.reload();
  }

  async function remove() {
    await api(`/instances/${id}`, { method: 'DELETE' });
    toast(`„${i.name}“ und alle gesicherten Versionen wurden entfernt`);
    nav('/instances');
  }

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/instances" className="hover:text-text">Instanzen</Link>}
        title={
          <span className="flex items-center gap-3">
            <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} />
            {i.name}
            {!i.enabled && <Badge>Pausiert</Badge>}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={i.base_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-text">{i.base_url}<ExternalLink className="size-3" /></a>
            <span className="flex items-center gap-1.5"><StatusDot ok={i.last_sync_ok} syncing={i.syncing} />{i.syncing ? 'Sichert …' : `Gesichert ${timeAgo(i.last_sync_at)}`}</span>
            <span>{intervalLabel(i.sync_interval)}</span>
          </span>
        }
        actions={
          <>
            <Button variant="ghost" icon={i.enabled ? <Pause className="size-4" /> : <Play className="size-4" />} onClick={toggleEnabled}>{i.enabled ? 'Pausieren' : 'Fortsetzen'}</Button>
            <Button variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Bearbeiten</Button>
            <Button variant="primary" icon={<RefreshCw className={cx('size-4', (syncing || i.syncing) && 'animate-spin')} />} onClick={sync} disabled={syncing || i.syncing}>Jetzt sichern</Button>
          </>
        }
      />

      {i.last_sync_error && <div className="mb-5"><ErrorBox><b>Letzter Sync fehlgeschlagen:</b> {i.last_sync_error}</ErrorBox></div>}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'workflows', label: <>Workflows <span className="font-mono text-xs text-dim">{i.workflows}</span></> },
          { value: 'activity', label: 'Aktivität' },
          { value: 'runs', label: 'Sync-Protokoll' },
        ]}
      />

      <div className="mt-5">
        {tab === 'workflows' && (
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-dim" />
                <input className={cx(inputCls, 'pl-9')} placeholder="Suchen" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <Segmented
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'present', label: 'Vorhanden' },
                  { value: 'active', label: 'Aktiv' },
                  { value: 'deleted', label: 'Gelöscht' },
                  { value: 'all', label: 'Alle' },
                ]}
              />
            </div>
            {workflows.loading && !workflows.data ? <PageLoader /> : filtered.length ? (
              <WorkflowTable items={filtered} showInstance={false} />
            ) : (
              <EmptyState icon={<Workflow className="size-6" />} title={i.syncing ? 'Erste Sicherung läuft …' : 'Keine Workflows gefunden'} />
            )}
          </Card>
        )}

        {tab === 'activity' && (
          <Card className="divide-y divide-line">
            {activity.data?.map((a) => <ActivityRow key={a.id} a={a} />)}
            {activity.data?.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted">Noch keine Aktivität</div>}
          </Card>
        )}

        {tab === 'runs' && (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-dim">
                  <th className="px-4 py-3 font-normal">Zeitpunkt</th>
                  <th className="px-4 py-3 font-normal">Auslöser</th>
                  <th className="px-4 py-3 font-normal">Ergebnis</th>
                  <th className="px-4 py-3 text-right font-normal">Dauer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {i.runs.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(r.started_at, true)}</td>
                    <td className="px-4 py-2.5 text-muted">{{ manual: 'Manuell', schedule: 'Automatisch', restore: 'Wiederherstellung' }[r.trigger] ?? r.trigger}</td>
                    <td className="px-4 py-2.5">
                      {r.ok === null ? <span className="text-[13px] text-muted">Läuft</span> : r.ok ? (
                        <span className="flex flex-wrap items-center gap-2 text-[13px]">
                          <span className="size-1.5 rounded-full bg-add" />
                          <span className="text-muted">{r.total} Workflows</span>
                          {r.created > 0 && <span className="text-text">{r.created} neu</span>}
                          {r.changed > 0 && <span className="text-mod">{r.changed} geändert</span>}
                          {r.deleted > 0 && <span className="text-del">{r.deleted} gelöscht</span>}
                        </span>
                      ) : (
                        <span className="flex items-center gap-2 text-[13px] text-del"><span className="size-1.5 shrink-0 rounded-full bg-del" /><span className="truncate">{r.error}</span></span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-muted">{r.finished_at ? `${((r.finished_at - r.started_at) / 1000).toFixed(1)}s` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {i.runs.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted">Noch keine Sync-Läufe</div>}
          </Card>
        )}
      </div>

      <div className="mt-10 rounded-xl border border-del/25 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Instanz entfernen</div>
            <div className="text-xs text-muted">Löscht die Verbindung und alle gesicherten Versionen in FlowVault. Deine n8n-Instanz bleibt unberührt.</div>
          </div>
          <Button variant="danger" size="sm" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>Entfernen</Button>
        </div>
      </div>

      <InstanceForm open={editing} instance={i} onClose={() => setEditing(false)} onSaved={() => inst.reload()} />
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Instanz wirklich entfernen?"
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Abbrechen</Button><Button variant="danger" onClick={remove}>Endgültig entfernen</Button></>}
      >
        <p className="text-sm text-muted">
          Alle <b className="text-text">{i.versions} Versionen</b> von <b className="text-text">{i.workflows + i.deleted_workflows} Workflows</b> aus „{i.name}“ werden aus FlowVault gelöscht. Das kann nicht rückgängig gemacht werden.
        </p>
      </Modal>
    </>
  );
}
