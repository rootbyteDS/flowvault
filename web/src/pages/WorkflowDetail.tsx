import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  Check, Copy, Download, Loader2, PenLine, ExternalLink, GitCompare, MessageSquare, Pencil, RefreshCw, RotateCcw, Trash2, X,
} from 'lucide-react';
import { describeSummary, stableStringify } from '../../../shared/diff.ts';
import { api, useApi, type AiSettings, type CompareResult, type FailingNode, type VersionHealth, type WorkflowDetail as WD, type WorkflowHealth } from '../api.ts';
import { AlertBanner, HealthPill, VersionHealthPanel } from '../components/health.tsx';
import { ChangeChips } from '../components/changes.tsx';
import { DiffView } from '../components/DiffView.tsx';
import { RestoreModal } from '../components/RestoreModal.tsx';
import { WorkflowCanvas, canvasFromSnapshot } from '../components/WorkflowCanvas.tsx';
import { nodeVisual } from '../components/changes.tsx';
import { Button, Card, ErrorBox, Modal, PageHeader, PageLoader, Status, Tabs, inputCls, useToast } from '../components/ui.tsx';
import { cx, formatBytes, formatDate, n8nWorkflowUrl, shortType, timeAgo, versionTitle } from '../util.ts';

type Tab = 'changes' | 'canvas' | 'json';

export function WorkflowDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const wf = useApi<WD>(`/workflows/${id}`, { poll: (d) => (d.versions.some((v) => v.ai_status === 'pending') ? 2000 : false) });
  const ai = useApi<AiSettings>('/ai/settings');
  const [tab, setTab] = useState<Tab>('changes');
  const [restoreTarget, setRestoreTarget] = useState<{ id: number; number: number } | null>(null);
  // Betriebsdaten aus dem Health-Dienst. Läuft er nicht, bleibt die Seite wie bisher.
  const health = useApi<WorkflowHealth>(`/health/workflows/${id}`, { poll: (d) => (d.settings.enabled && !d.lastPollAt ? 5_000 : 60_000) });
  const healthByVersion = useMemo(() => new Map((health.data?.versions ?? []).map((h) => [h.versionId, h])), [health.data]);
  const [refreshing, setRefreshing] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);

  const versions = wf.data?.versions ?? [];
  const selId = Number(params.get('v')) || versions[0]?.id;
  const selIdx = versions.findIndex((v) => v.id === selId);
  const sel = versions[selIdx];
  const prev = versions[selIdx + 1];

  const cmp = useApi<CompareResult>(sel ? `/compare?to=${sel.id}${prev ? `&from=${prev.id}` : ''}` : null);

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await api<{ ok: boolean; changed?: boolean; error?: string }>(`/workflows/${id}/refresh`, { method: 'POST' });
      if (!r.ok) toast(r.error ?? 'Fehler', 'error');
      else toast(r.changed ? 'Neue Version gesichert' : 'Keine Änderungen seit der letzten Sicherung');
      const d = await wf.reload();
      health.reload();
      if (r.changed && d) setParams({ v: String(d.versions[0].id) }, { replace: true });
    } finally {
      setRefreshing(false);
    }
  }

  if (wf.loading && !wf.data) return <PageLoader />;
  if (wf.error) return <ErrorBox>{wf.error}</ErrorBox>;
  const w = wf.data!;
  const selHealth = sel ? healthByVersion.get(sel.id) : undefined;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-[2px]" style={{ background: w.instance_color }} />
            <Link to={`/instances/${w.instance_id}`} className="hover:text-text">{w.instance_name}</Link>
            <span className="text-dim">/</span>
            <span className="font-mono text-xs text-dim">{w.n8n_id}</span>
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {w.name}
            {w.deleted_at ? <Status tone="del">In n8n gelöscht</Status> : w.archived ? <Status tone="neutral">Archiviert</Status> : w.active ? <Status tone="add">Aktiv</Status> : <Status tone="neutral">Inaktiv</Status>}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{w.node_count} Nodes</span>
            <span>{w.version_count} Versionen</span>
            <span>Zuerst gesichert {formatDate(w.first_seen_at)}</span>
            {w.tags.length > 0 && <span className="font-mono text-xs text-dim">{w.tags.map((t) => `#${t}`).join(' ')}</span>}
          </span>
        }
        actions={
          <>
            {!w.deleted_at && (
              <Button variant="ghost" icon={<ExternalLink className="size-4" />} onClick={() => window.open(n8nWorkflowUrl(w.base_url, w.n8n_id), '_blank', 'noopener')}>
                In n8n öffnen
              </Button>
            )}
            {w.deleted_at ? (
              <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setForgetOpen(true)}>Historie löschen</Button>
            ) : (
              <Button icon={<RefreshCw className={cx('size-4', refreshing && 'animate-spin')} />} onClick={refresh} disabled={refreshing}>Jetzt prüfen</Button>
            )}
            {versions.length > 1 && (
              <Button icon={<GitCompare className="size-4" />} onClick={() => nav(`/compare?workflow=${w.id}&from=${versions[versions.length - 1].id}&to=${versions[0].id}`)}>Vergleichen</Button>
            )}
          </>
        }
      />

      {health.data?.alert && (
        <AlertBanner
          alert={health.data.alert}
          settings={health.data.settings}
          onShow={() => { setParams({ v: String(health.data!.alert!.versionId) }, { replace: true }); setTab('changes'); }}
          onRollback={(vid, number) => setRestoreTarget({ id: vid, number })}
          onDismissed={() => health.reload()}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* ───── Versions-Timeline ───── */}
        <Card className="h-fit lg:sticky lg:top-0">
          <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">Verlauf</h2>
            <span className="font-mono text-xs text-dim">{versions.length} Versionen</span>
          </div>
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto py-2">
            {versions.map((v, i) => {
              const active = v.id === selId;
              return (
                <button
                  key={v.id}
                  onClick={() => setParams({ v: String(v.id) }, { replace: true })}
                  className={cx('relative flex w-full gap-3 px-4 py-3 text-left transition-colors', active ? 'bg-panel-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]' : 'hover:bg-panel-2')}
                >
                  <div className="relative flex w-4 shrink-0 justify-center">
                    {i < versions.length - 1 && <span className="absolute top-4 -bottom-7 w-px bg-line-2" />}
                    <span
                      className={cx(
                        'relative z-10 mt-1 size-2.5 rounded-full border-2',
                        active ? 'border-accent bg-accent' : v.summary.restoredFrom ? 'border-add bg-panel' : 'border-dim bg-panel',
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 font-mono text-xs">
                      <span className={active ? 'text-text' : 'text-muted'}>v{v.number}</span>
                      <span className="text-dim">#{v.hash.slice(0, 7)}</span>
                      {i === 0 && !w.deleted_at && <span className="text-accent-hi">aktuell</span>}
                      <span className="ml-auto shrink-0 font-sans text-dim">{timeAgo(v.created_at)}</span>
                    </div>
                    <div className={cx('mt-1 line-clamp-2 text-[13px]', active ? 'text-text' : 'text-muted')}>
                      {v.message || versionTitle(v)}
                    </div>
                    {v.message && <div className="mt-0.5 truncate text-xs text-dim">{versionTitle(v)}</div>}
                    {v.ai_status === 'pending' && <div className="mt-0.5 text-xs text-dim">Text wird erzeugt</div>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"><ChangeChips s={v.summary} /><HealthPill h={healthByVersion.get(v.id)} minRuns={health.data?.settings.minRuns} /></div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* ───── Ausgewählte Version ───── */}
        <div className="min-w-0">
          {sel && (
            <VersionHeader
              key={sel.id}
              v={sel}
              latest={selIdx === 0}
              aiReady={!!ai.data?.configured}
              health={selHealth}
              workflowHealth={health.data}
              healthUnavailable={!!health.error && !health.data}
              workflowActive={!!w.active && !w.deleted_at}
              onRestore={() => setRestoreTarget({ id: sel.id, number: sel.number })}
              onRollback={(vid, number) => setRestoreTarget({ id: vid, number })}
              onSaved={() => wf.reload()}
            />
          )}

          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'changes', label: prev ? `Änderungen zu v${prev.number}` : 'Änderungen' },
              { value: 'canvas', label: 'Workflow' },
              { value: 'json', label: 'JSON' },
            ]}
          />
          <div className="mt-6">
            {cmp.error && <ErrorBox>{cmp.error}</ErrorBox>}
            {!cmp.data || cmp.data.to.id !== sel?.id ? (
              <PageLoader />
            ) : tab === 'changes' ? (
              cmp.data.from ? (
                <DiffView from={cmp.data.from.snapshot} to={cmp.data.to.snapshot} diff={cmp.data.diff} failing={selHealth?.failingNodes} />
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted">Erste gesicherte Version, es gibt noch nichts zum Vergleichen</p>
                  <CanvasInspector result={cmp.data} failing={selHealth?.failingNodes} />
                </div>
              )
            ) : tab === 'canvas' ? (
              <CanvasInspector result={cmp.data} failing={selHealth?.failingNodes} />
            ) : (
              <JsonView result={cmp.data} />
            )}
          </div>
        </div>
      </div>

      {restoreTarget && (
        <RestoreModal
          open
          onClose={() => setRestoreTarget(null)}
          versionId={restoreTarget.id}
          versionNumber={restoreTarget.number}
          workflowName={w.name}
          instanceId={w.instance_id}
          deleted={!!w.deleted_at}
          onDone={async () => {
            const d = await wf.reload();
            health.reload();
            if (d) setParams({ v: String(d.versions[0].id) }, { replace: true });
          }}
        />
      )}
      <Modal
        open={forgetOpen}
        onClose={() => setForgetOpen(false)}
        title="Historie endgültig löschen?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setForgetOpen(false)}>Abbrechen</Button>
            <Button variant="danger" onClick={async () => { await api(`/workflows/${w.id}`, { method: 'DELETE' }); toast('Historie gelöscht'); nav(`/instances/${w.instance_id}`); }}>Löschen</Button>
          </>
        }
      >
        <p className="text-sm text-muted">Alle {w.version_count} gesicherten Versionen von „{w.name}“ werden aus FlowVault entfernt. Lade vorher die letzte Version als JSON herunter, falls du sie noch brauchst.</p>
      </Modal>
    </>
  );
}

function VersionHeader({ v, latest, aiReady, health, workflowHealth, healthUnavailable, workflowActive, onRestore, onRollback, onSaved }: {
  v: WD['versions'][number];
  latest: boolean;
  aiReady: boolean;
  health?: VersionHealth;
  workflowHealth?: WorkflowHealth;
  healthUnavailable: boolean;
  workflowActive: boolean;
  onRestore: () => void;
  onRollback: (versionId: number, number: number) => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState(v.message ?? '');
  const [generating, setGenerating] = useState(false);
  const toast = useToast();
  const pending = generating || v.ai_status === 'pending';

  async function generate() {
    setGenerating(true);
    try {
      await api(`/versions/${v.id}/ai`, { method: 'POST' });
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
      onSaved();
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    await api(`/versions/${v.id}`, { method: 'PATCH', body: { message: msg } });
    setEditing(false);
    toast('Notiz gespeichert');
    onSaved();
  }

  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-col-reverse items-start gap-4 sm:flex-row sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3 font-mono text-xs">
            <span className="text-text">v{v.number}</span>
            <span className="text-dim">#{v.hash.slice(0, 7)}</span>
            {latest && <span className="text-accent-hi">aktuell</span>}
            <ChangeChips s={v.summary} />
          </div>
          <div className="mt-2 text-lg leading-snug font-medium">{versionTitle(v)}</div>
          {v.ai_summary && v.ai_summary.details.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted marker:text-dim">
              {v.ai_summary.details.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-dim">
            <span>Gesichert {formatDate(v.created_at, true)}</span>
            {v.n8n_updated_at && <span>in n8n gespeichert {formatDate(v.n8n_updated_at, true)}</span>}
            <span className="font-mono">{formatBytes(v.size)}</span>
            {v.ai_summary && <span title={describeSummary(v.summary)}>Text von {v.ai_model ?? 'KI'}</span>}
          </div>
          {v.ai_status === 'error' && !pending && <div className="mt-2 text-xs text-del">KI-Text fehlgeschlagen: {v.ai_error}</div>}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" icon={<Download className="size-4" />} onClick={() => (window.location.href = `/api/versions/${v.id}/download`)}>
            Download
          </Button>
          <Button size="sm" variant={latest ? 'secondary' : 'primary'} icon={<RotateCcw className="size-4" />} onClick={onRestore}>
            Wiederherstellen
          </Button>
        </div>
      </div>
      <VersionHealthPanel h={health} wh={workflowHealth} unavailable={healthUnavailable} workflowActive={workflowActive} onRollback={onRollback} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        {editing ? (
          <div className="flex flex-1 gap-2">
            <input className={inputCls} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="z. B. Slack-Benachrichtigung ergänzt" autoFocus onKeyDown={(e) => e.key === 'Enter' && save()} />
            <Button size="md" variant="primary" icon={<Check className="size-4" />} onClick={save} />
            <Button size="md" variant="ghost" icon={<X className="size-4" />} onClick={() => { setEditing(false); setMsg(v.message ?? ''); }} />
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="group flex items-center gap-2 text-sm text-muted transition-colors hover:text-text">
            <MessageSquare className="size-4" />
            {v.message ? <span className="text-text">{v.message}</span> : <span>Notiz hinzufügen</span>}
            <Pencil className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
        {aiReady && !editing && (
          <button onClick={generate} disabled={pending} className="flex items-center gap-2 text-sm text-muted transition-colors hover:text-text disabled:cursor-default disabled:hover:text-muted">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
            {pending ? 'Text wird erzeugt' : v.ai_summary ? 'Text neu erzeugen' : 'Text mit KI erzeugen'}
          </button>
        )}
      </div>
    </Card>
  );
}

function CanvasInspector({ result, failing }: { result: CompareResult; failing?: FailingNode[] }) {
  const snap = result.to.snapshot;
  const canvas = useMemo(() => canvasFromSnapshot(snap), [snap]);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => setSel(null), [snap]);
  const node = canvas.nodes.find((n) => n.key === sel)?.node;
  const v = node ? nodeVisual(node.type) : null;

  const regular = canvas.nodes.filter((n) => n.node.type !== 'n8n-nodes-base.stickyNote');

  return (
    <div className="space-y-4">
      <div className="relative">
        <WorkflowCanvas {...canvas} selected={sel} onSelect={setSel} failing={failing} className="h-[560px]" />
        {node && v && (
          <Card className="absolute top-3 right-3 bottom-3 flex w-[min(360px,calc(100%-24px))] animate-enter flex-col shadow-[0_8px_24px_rgb(0_0_0/0.35)]">
            <div className="flex items-center gap-3 border-b border-line p-4">
              <v.Icon className="size-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{node.name}</div>
                <div className="truncate text-xs text-muted">{shortType(node.type)} · v{node.typeVersion ?? 1}{node.disabled ? ' · deaktiviert' : ''}</div>
              </div>
              <button onClick={() => setSel(null)} className="rounded-md p-1 text-muted hover:bg-panel-3 hover:text-text"><X className="size-4" /></button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11.5px] leading-5 text-text/80">{stableStringify({ parameters: node.parameters, credentials: node.credentials }, 2)}</pre>
          </Card>
        )}
      </div>
      <Card>
        <div className="border-b border-line px-4 py-3 text-sm font-medium">Nodes ({regular.length})</div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3">
          {regular.map((n) => {
            const nv = nodeVisual(n.node.type);
            return (
              <button key={n.key} onClick={() => setSel(n.key)} className={cx('flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-panel-2', sel === n.key && 'bg-panel-3')}>
                <nv.Icon className="size-4 shrink-0 text-dim" />
                <span className={cx('truncate text-[13px]', n.node.disabled && 'text-muted line-through')}>{n.node.name}</span>
                <span className="ml-auto shrink-0 text-xs text-dim">{shortType(n.node.type)}</span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function JsonView({ result }: { result: CompareResult }) {
  const toast = useToast();
  const s = result.to.snapshot;
  const json = useMemo(
    () => JSON.stringify({ name: s.name, nodes: s.nodes, connections: s.connections, settings: s.settings, pinData: s.pinData ?? {}, tags: s.tags }, null, 2),
    [s],
  );
  return (
    <Card className="relative">
      <div className="absolute top-3 right-3 flex gap-2">
        <Button size="sm" icon={<Copy className="size-4" />} onClick={() => { navigator.clipboard.writeText(json); toast('In die Zwischenablage kopiert – in n8n einfach einfügen (⌘V)'); }}>
          Kopieren
        </Button>
      </div>
      <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-[12px] leading-5 text-text/80">{json}</pre>
    </Card>
  );
}
