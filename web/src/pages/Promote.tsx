import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, CircleCheck, CircleX, FileDiff, Layers, Plus, RefreshCw,
  Trash2, Upload,
} from 'lucide-react';
import {
  api, useApi, mappingKindLabel,
  type Instance, type DriftRow, type MappingKind, type MappingRow, type MappingSuggestion,
  type PromoteDiff, type PromoteOutcome, type PromoteOverview,
} from '../api.ts';
import { ChangeChips } from '../components/changes.tsx';
import { DiffView } from '../components/DiffView.tsx';
import {
  Badge, Button, Card, EmptyState, ErrorBox, Field, Modal, PageHeader, PageLoader, Segmented, Tabs, inputCls, useToast,
} from '../components/ui.tsx';
import { cx, timeAgo } from '../util.ts';
import { message, rich, t, type MessageKey } from '../i18n.tsx';

type Filter = 'drifted' | 'only-source' | 'only-target' | 'in-sync' | 'all';

const STATUS: Record<DriftRow['status'], { label: MessageKey; tone: 'add' | 'mod' | 'info' | 'neutral' }> = {
  drifted: { label: 'promote.status.drifted', tone: 'mod' },
  'in-sync': { label: 'promote.status.inSync', tone: 'add' },
  'only-source': { label: 'promote.status.onlySource', tone: 'info' },
  'only-target': { label: 'promote.status.onlyTarget', tone: 'neutral' },
};

export function Promote() {
  const [params, setParams] = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const instances = useApi<Instance[]>('/instances');

  // Erstes Paar vorbelegen: die ersten beiden Instanzen
  useEffect(() => {
    if ((from || to) || !instances.data || instances.data.length < 2) return;
    const p = new URLSearchParams(params);
    p.set('from', String(instances.data[0]!.id));
    p.set('to', String(instances.data[1]!.id));
    setParams(p, { replace: true });
  }, [instances.data, from, to, params, setParams]);

  const ready = !!from && !!to && from !== to;
  const ov = useApi<PromoteOverview>(ready ? `/promote/${from}/${to}` : null);
  const [tab, setTab] = useState<'drift' | 'mappings'>('drift');
  const [filter, setFilter] = useState<Filter>('drifted');

  const swap = () => {
    if (!from || !to) return;
    const p = new URLSearchParams(params);
    p.set('from', to);
    p.set('to', from);
    setParams(p, { replace: true });
  };

  const rows = useMemo(() => {
    if (!ov.data) return [];
    return filter === 'all' ? ov.data.drift.rows : ov.data.drift.rows.filter((r) => r.status === filter);
  }, [ov.data, filter]);
  const allRows = ov.data?.drift.rows ?? [];

  if (instances.loading && !instances.data) return <PageLoader />;
  if (instances.error) return <ErrorBox>{instances.error}</ErrorBox>;
  if ((instances.data?.length ?? 0) < 2) {
    return (
      <>
        <PageHeader title={t('nav.environments')} subtitle={t('promote.subtitleShort')} />
        <Card>
          <EmptyState icon={<Layers className="size-6" />} title={t('promote.needTwoTitle')}>
            {t('promote.needTwoText')}
            <div className="mt-6"><Link to="/instances" className="text-sm text-accent-hi hover:underline">{t('promote.connectLink')}</Link></div>
          </EmptyState>
        </Card>
      </>
    );
  }
  if (ov.error) return <ErrorBox>{ov.error}</ErrorBox>;
  if (!ov.data) return <PageLoader />;

  return (
    <>
      <PageHeader
        title={t('nav.environments')}
        subtitle={t('promote.subtitle')}
      />

      {/* Instanz-Paar */}
      <Card className="mb-6 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <PairSelect label={t('promote.source')} which="from" value={from} instances={instances.data!} />
          <Button
            variant="ghost"
            className="self-center"
            title={t('promote.swapTitle')}
            icon={<ArrowLeftRight className="size-4" />}
            onClick={swap}
          />
          <PairSelect label={t('promote.target')} which="to" value={to} instances={instances.data!} />
        </div>
      </Card>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'drift', label: <span className="flex items-center gap-2">{t('promote.tabDrift')} {ov.data.drift.counts.drifted > 0 && <Badge tone="mod">{ov.data.drift.counts.drifted}</Badge>}</span> },
          { value: 'mappings', label: <span className="flex items-center gap-2">{t('promote.tabMappings')} <Badge>{ov.data.mappings.length}</Badge></span> },
        ]}
      />

      <div className="mt-6">
        {tab === 'drift' ? (
          <DriftTab data={ov.data} rows={rows} filter={filter} setFilter={setFilter} reload={ov.reload} setData={ov.setData} />
        ) : (
          <MappingsTab data={ov.data} setData={ov.setData} />
        )}
      </div>
    </>
  );
}

// ───────────────────────── Instanz-Paar ─────────────────────────

function PairSelect({ label, which, value, instances }: { label: string; which: 'from' | 'to'; value: string | null; instances: Instance[] }) {
  const [params, setParams] = useSearchParams();
  return (
    <div className="flex-1">
      <div className="mb-2 text-[13px] text-muted">{label}</div>
      <select
        className={cx(inputCls, 'appearance-none')}
        value={value ?? ''}
        onChange={(e) => {
          const p = new URLSearchParams(params);
          p.set(which, e.target.value);
          setParams(p, { replace: true });
        }}
      >
        {instances.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name} · {t('dashboard.workflowCount', { count: i.workflows })}
          </option>
        ))}
      </select>
    </div>
  );
}

// ───────────────────────── Abweichungen (Drift) ─────────────────────────

function DriftTab({ data, rows, filter, setFilter, reload, setData }: {
  data: PromoteOverview;
  rows: DriftRow[];
  filter: Filter;
  setFilter: (f: Filter) => void;
  reload: () => void;
  setData: (d: PromoteOverview) => void;
}) {
  const c = data.drift.counts;
  const pending = data.drift.rows.filter((r) => r.status === 'drifted' || r.status === 'only-source');
  const [confirm, setConfirm] = useState<DriftRow[] | null>(null);
  const [results, setResults] = useState<PromoteOutcome[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [diffFor, setDiffFor] = useState<DriftRow | null>(null);

  async function promote(rowsToPromote: DriftRow[]) {
    setBusy(true);
    setError(undefined);
    try {
      const ids = rowsToPromote.filter((r) => r.source).map((r) => r.source!.workflowId);
      const r = await api<{ results: PromoteOutcome[]; overview: PromoteOverview }>(`/promote/${data.source.id}/${data.target.id}/promote`, {
        body: { workflowIds: ids },
      });
      setData(r.overview);
      setResults(r.results);
      setConfirm(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const promoteAllRow = pending.length > 1 && (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm text-muted">
        {t('promote.summary', { drifted: c.drifted, onlySource: c.onlySource, inSync: c.inSync })}
      </div>
      <Button size="sm" icon={<Upload className="size-4" />} onClick={() => setConfirm(pending)}>{t('promote.promoteAll')}</Button>
    </div>
  );

  return (
    <>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'drifted', label: t('promote.filter.drifted', { count: c.drifted }) },
          { value: 'only-source', label: t('promote.filter.onlySource', { count: c.onlySource }) },
          { value: 'only-target', label: t('promote.filter.onlyTarget', { count: c.onlyTarget }) },
          { value: 'in-sync', label: t('promote.filter.inSync', { count: c.inSync }) },
          { value: 'all', label: t('promote.filter.all') },
        ]}
      />

      <div className="mt-6 space-y-4">{promoteAllRow}</div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CircleCheck className="size-6" />}
            title={t(filter === 'drifted' ? 'promote.empty.noDrift' : 'promote.empty.nothing')}
            action={<Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => void reload()}>{t('promote.empty.reload')}</Button>}
          >
            {filter === 'drifted'
              ? t('promote.empty.noDriftText', { target: data.target.name, source: data.source.name })
              : t('promote.empty.noneInSelection')}
          </EmptyState>
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {rows.map((row) => (
            <DriftRowView
              key={(row.source ?? row.target)!.workflowId}
              row={row}
              sourceName={data.source.name}
              targetName={data.target.name}
              onDiff={() => setDiffFor(row)}
              onPromote={() => setConfirm([row])}
            />
          ))}
        </Card>
      )}

      {confirm && (
        <ConfirmPromoteModal
          rows={confirm}
          sourceName={data.source.name}
          targetName={data.target.name}
          busy={busy}
          error={error}
          onClose={() => setConfirm(null)}
          onGo={() => void promote(confirm)}
        />
      )}

      {results && <ResultsModal results={results} targetName={data.target.name} onClose={() => setResults(null)} onDone={reload} />}
      {diffFor && <DiffModal row={diffFor} sourceId={data.source.id} targetId={data.target.id} onClose={() => setDiffFor(null)} />}
    </>
  );
}

function DriftRowView({ row, sourceName, targetName, onDiff, onPromote }: {
  row: DriftRow;
  sourceName: string;
  targetName: string;
  onDiff: () => void;
  onPromote: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const swap = () => {
    const p = new URLSearchParams(params);
    const f = p.get('from');
    const target = p.get('to');
    if (!f || !target) return;
    p.set('from', target);
    p.set('to', f);
    setParams(p, { replace: true });
  };
  const st = STATUS[row.status];
  const name = row.source?.name ?? row.target!.name;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          <Badge tone={st.tone}>{t(st.label)}</Badge>
          {row.activeDiffers && (
            <span title={t('promote.row.activeDiffersTitle')}>
              <Badge>{t('promote.row.activeDiffers')}</Badge>
            </span>
          )}
          {row.matchedBy === 'mapping' && row.source && row.target && row.source.name !== row.target.name && (
            <span className="text-xs text-dim">{t('promote.row.onTarget', { name: row.target.name })}</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim">
          {row.source && <span>{t('promote.row.sourceInfo', { number: row.source.versionNumber, when: timeAgo(row.source.lastChangeAt) })}</span>}
          {row.target && <span>{t('promote.row.targetInfo', { number: row.target.versionNumber, when: timeAgo(row.target.lastChangeAt) })}</span>}
          {row.missing.length > 0 && (
            <span className="inline-flex items-center gap-1 text-mod">
              <AlertTriangle className="size-3.5" />
              {t('promote.row.unmapped', { count: row.missing.length })}
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        {row.summary && <ChangeChips s={row.summary} />}
        {row.status === 'drifted' && (
          <span className={cx('text-xs', row.ahead === 'source' ? 'text-info' : 'text-mod')}>
            {t('promote.row.newerOn', { name: row.ahead === 'source' ? sourceName : targetName })}
          </span>
        )}
      </div>

      <div className="flex shrink-0 gap-2">
        {(row.status === 'drifted' || row.status === 'only-source') && (
          <>
            <Button size="sm" variant="ghost" icon={<FileDiff className="size-4" />} onClick={onDiff} title={t('promote.row.diffTitle')}>{t('promote.row.diff')}</Button>
            <Button size="sm" variant="primary" icon={<Upload className="size-4" />} onClick={onPromote}>
              {t(row.status === 'drifted' ? 'promote.row.apply' : 'promote.row.create')}
            </Button>
          </>
        )}
        {row.status === 'only-target' && (
          <Button size="sm" variant="ghost" icon={<ArrowLeftRight className="size-4" />} onClick={swap} title={t('promote.row.swapInstances')}>
            {t('promote.row.otherDirection')}
          </Button>
        )}
      </div>
    </div>
  );
}

function ConfirmPromoteModal({ rows, sourceName, targetName, busy, error, onClose, onGo }: {
  rows: DriftRow[];
  sourceName: string;
  targetName: string;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onGo: () => void;
}) {
  const missing = [...new Set(rows.flatMap((r) => r.missing))];
  return (
    <Modal
      open
      onClose={onClose}
      title={t('promote.confirm.title', { count: rows.length, name: rows[0]!.source?.name ?? rows[0]!.target?.name ?? '' })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={onGo}>{t('promote.confirm.go', { target: targetName })}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="text-sm text-muted">
          {rich('promote.confirm.text', { b: (c) => <b className="text-text">{c}</b> }, { source: sourceName, target: targetName })}
        </div>
        {rows.length > 1 && (
          <div className="max-h-48 overflow-y-auto rounded-lg border border-line bg-sidebar px-3 py-2 text-[13px]">
            {rows.map((r) => (
              <div key={(r.source ?? r.target)!.workflowId} className="flex items-center justify-between gap-3 py-0.5">
                <span className="truncate">{r.source!.name}</span>
                <span className="shrink-0 text-xs text-dim">{t(r.target ? 'promote.confirm.overwrite' : 'promote.confirm.createNew')}</span>
              </div>
            ))}
          </div>
        )}
        {missing.length > 0 && (
          <div className="space-y-1 rounded-lg border border-mod/25 bg-mod/8 px-3 py-2 text-xs text-mod">
            <div className="flex items-center gap-1.5 font-medium"><AlertTriangle className="size-3.5" />{t('promote.confirm.unmappedTitle')}</div>
            {missing.slice(0, 5).map((m) => <div key={m} className="truncate">{message(m)}</div>)}
            {missing.length > 5 && <div>{t('promote.confirm.more', { count: missing.length - 5 })}</div>}
          </div>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}

function ResultsModal({ results, targetName, onClose, onDone }: {
  results: PromoteOutcome[];
  targetName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const failed = results.filter((r) => r.error);
  return (
    <Modal
      open
      onClose={onClose}
      title={t('promote.results.title', { count: results.length - failed.length })}
      footer={<Button variant="primary" onClick={() => { onClose(); onDone(); }}>{t('promote.results.done')}</Button>}
    >
      <div className="space-y-2">
        {results.map((r) => (
          <div key={r.sourceWorkflowId} className="rounded-lg border border-line bg-sidebar px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {r.error ? <CircleX className="size-4 text-del" /> : <CircleCheck className="size-4 text-add" />}
              <span className="text-sm font-medium">{r.name}</span>
              <Badge tone="neutral">v{r.version}</Badge>
              <Badge tone={r.error ? 'del' : r.action === 'created' ? 'add' : 'mod'}>
                {r.error ? t('promote.results.failed') : r.action === 'created' ? t('promote.results.createdOn', { target: targetName }) : t('promote.results.updated')}
              </Badge>
              {r.applied.length > 0 && <Badge tone="accent">{t('promote.results.applied', { count: r.applied.length })}</Badge>}
              {r.targetWorkflowId && !r.error && (
                <Link to={`/workflows/${r.targetWorkflowId}`} className="text-xs text-accent-hi hover:underline">{t('promote.results.open')}</Link>
              )}
            </div>
            {(r.error || r.missing.length > 0) && (
              <div className={cx('mt-1.5 text-xs', r.error ? 'text-del' : 'text-mod')}>
                {r.error ?? r.missing.map(message).join(' · ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function DiffModal({ row, sourceId, targetId, onClose }: { row: DriftRow; sourceId: number; targetId: number; onClose: () => void }) {
  const [state, setState] = useState<{ loading: boolean; error?: string; data?: PromoteDiff }>({ loading: true });

  useEffect(() => {
    let alive = true;
    api<PromoteDiff>(`/promote/${sourceId}/${targetId}/diff/${row.source!.workflowId}`)
      .then((data) => alive && setState({ loading: false, data }))
      .catch((e) => alive && setState({ loading: false, error: (e as Error).message }));
    return () => {
      alive = false;
    };
  }, [row, sourceId, targetId]);

  return (
    <Modal open onClose={onClose} title={t('promote.diffModal.title', { name: row.source!.name })} width="max-w-6xl">
      {state.loading && <PageLoader />}
      {state.error && <ErrorBox>{state.error}</ErrorBox>}
      {state.data && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-del" />{t('promote.diffModal.targetNow')}</span>
            <ArrowRight className="size-3.5" />
            <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-add" />{t('promote.diffModal.sourceAfter', { number: state.data.version })}</span>
            {state.data.applied.length > 0 && <Badge tone="accent">{t('promote.results.applied', { count: state.data.applied.length })}</Badge>}
          </div>
          <div className="max-h-[65vh] overflow-y-auto">
            <DiffView from={state.data.from} to={state.data.to} diff={state.data.diff} />
          </div>
        </div>
      )}
    </Modal>
  );
}

// ───────────────────────── Zuordnungen ─────────────────────────

function MappingsTab({ data, setData }: { data: PromoteOverview; setData: (d: PromoteOverview) => void }) {
  const toast = useToast();
  const [suggestions, setSuggestions] = useState<MappingSuggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [showAdd, setShowAdd] = useState(false);

  const kinds: MappingKind[] = ['credential', 'workflow', 'dataTable', 'webhookPath'];
  const byKind = (kind: MappingKind) => data.mappings.filter((m) => m.kind === kind);

  async function loadSuggestions() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ suggestions: MappingSuggestion[] }>(`/promote/${data.source.id}/${data.target.id}/suggestions`);
      setSuggestions(r.suggestions);
      if (!r.suggestions.length) toast(t('promote.mappings.noSuggestions'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveMapping(body: Record<string, unknown>, done: () => void) {
    setError(undefined);
    try {
      const r = await api<PromoteOverview>(`/promote/${data.source.id}/${data.target.id}/mappings`, { method: 'PUT', body });
      setData(r);
      done();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(m: MappingRow) {
    setError(undefined);
    try {
      const r = await api<PromoteOverview>(
        `/promote/${data.source.id}/${data.target.id}/mappings?kind=${encodeURIComponent(m.kind)}&from=${encodeURIComponent(m.from)}`,
        { method: 'DELETE' },
      );
      setData(r);
      toast(t('promote.mappings.removed', { name: m.fromName ?? m.from }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-xl text-sm text-muted">
          {t('promote.mappings.text', { source: data.source.name, target: data.target.name })}
        </div>
        <div className="flex gap-2">
          <Button size="sm" icon={<RefreshCw className={cx('size-4', busy && 'animate-spin')} />} onClick={() => void loadSuggestions()}>{t('promote.mappings.suggestions')}</Button>
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setShowAdd(true)}>{t('promote.mappings.manual')}</Button>
        </div>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {suggestions && suggestions.length > 0 && (
        <Card className="mb-4 divide-y divide-line overflow-hidden">
          <div className="bg-panel-3 px-4 py-2 text-[13px] text-muted">{t('promote.mappings.suggestionsHeader')}</div>
          {suggestions.map((s) => (
            <SuggestionRow key={`${s.kind}:${s.from}`} s={s} onSave={saveMapping} onSaved={() => setSuggestions((list) => (list ? list.filter((x) => !(x.kind === s.kind && x.from === s.from)) : list))} />
          ))}
        </Card>
      )}

      {data.mappings.length === 0 ? (
        <Card>
          <EmptyState icon={<Layers className="size-6" />} title={t('promote.mappings.emptyTitle')}>
            {t('promote.mappings.emptyText')}
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {kinds.map((kind) => {
            const rows = byKind(kind);
            if (!rows.length) return null;
            return (
              <Card key={kind} className="divide-y divide-line overflow-hidden">
                <div className="flex items-center justify-between bg-panel-3 px-4 py-2">
                  <span className="text-[13px] font-medium">{mappingKindLabel(kind)}</span>
                  <Badge>{rows.length}</Badge>
                </div>
                {rows.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {m.fromName ?? m.from}
                      {m.fromName && m.fromName !== m.from && <span className="ml-2 font-mono text-xs text-dim">{m.from}</span>}
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-dim" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {m.kind === 'credential' ? m.toName ?? m.to : m.toName ?? m.to}
                      {m.toName && m.toName !== m.to && <span className="ml-2 font-mono text-xs text-dim">{m.to}</span>}
                    </span>
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} title={t('promote.mappings.removeTitle')} onClick={() => void remove(m)} />
                  </div>
                ))}
              </Card>
            );
          })}
        </div>
      )}

      {showAdd && (
        <AddMappingModal
          data={data}
          onClose={() => setShowAdd(false)}
          onSave={saveMapping}
        />
      )}
    </>
  );
}

function SuggestionRow({ s, onSave, onSaved }: {
  s: MappingSuggestion;
  onSave: (body: Record<string, unknown>, done: () => void) => Promise<void>;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(s.to ?? '');
  const [text, setText] = useState(s.to ?? '');
  const [busy, setBusy] = useState(false);
  const selected = s.candidates.find((c) => c.value === value);
  // Credentials/Sub-Workflows/Data-Tables: Auswahl aus Kandidaten; Webhook-Pfade: freier Text
  const isFree = s.kind === 'webhookPath';
  const to = isFree ? text.trim() : value;
  const toName = isFree ? text.trim() : selected?.name ?? s.toName ?? '';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <Badge tone="neutral">{mappingKindLabel(s.kind)}</Badge>
          <span className="truncate font-medium">{s.fromName ?? s.from}</span>
        </div>
        <div className="mt-0.5 text-xs text-dim">{s.reason}</div>
      </div>
      {isFree ? (
        <input className={cx(inputCls, 'w-56')} placeholder={t('promote.mappings.pathPlaceholder')} value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <select className={cx(inputCls, 'w-56')} value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">{t('promote.mappings.choose')}</option>
          {s.candidates.map((c) => (
            <option key={c.value} value={c.value}>{c.hint ? `${c.label} (${c.hint})` : c.label}</option>
          ))}
        </select>
      )}
      <Button
        size="sm"
        variant="primary"
        loading={busy}
        disabled={!to}
        onClick={async () => {
          setBusy(true);
          await onSave({ kind: s.kind, from: s.from, fromName: s.fromName, to, toName }, onSaved);
          setBusy(false);
        }}
      >
        {t('promote.row.apply')}
      </Button>
    </div>
  );
}

function AddMappingModal({ data, onClose, onSave }: {
  data: PromoteOverview;
  onClose: () => void;
  onSave: (body: Record<string, unknown>, done: () => void) => Promise<void>;
}) {
  const [kind, setKind] = useState<MappingKind>('credential');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [toName, setToName] = useState('');
  const [fromName, setFromName] = useState('');
  const [busy, setBusy] = useState(false);

  const ok = from.trim() && to.trim() && (kind !== 'credential' || toName.trim());
  return (
    <Modal
      open
      onClose={onClose}
      title={t('promote.add.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!ok}
            onClick={async () => {
              setBusy(true);
              await onSave({ kind, from: from.trim(), fromName: fromName.trim() || null, to: to.trim(), toName: toName.trim() || null }, onClose);
              setBusy(false);
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('promote.add.kind')}>
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as MappingKind)}>
            {(['credential', 'workflow', 'webhookPath', 'dataTable'] as MappingKind[]).map((k) => (
              <option key={k} value={k}>{mappingKindLabel(k)}</option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('promote.add.source', { name: data.source.name })} hint={t(kind === 'credential' ? 'promote.add.credHintSource' : 'promote.add.hintSource')}>
            <input className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('promote.add.target', { name: data.target.name })} hint={t(kind === 'credential' ? 'promote.add.credHintTarget' : 'promote.add.hintTarget')}>
            <input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('promote.add.fromName')}>
            <input className={inputCls} value={fromName} onChange={(e) => setFromName(e.target.value)} />
          </Field>
          {kind === 'credential' ? (
            <Field label={t('promote.add.toNameCredential')} info={t('promote.add.toNameCredentialInfo')}>
              <input className={inputCls} value={toName} onChange={(e) => setToName(e.target.value)} />
            </Field>
          ) : (
            <Field label={t('promote.add.toName')}>
              <input className={inputCls} value={toName} onChange={(e) => setToName(e.target.value)} />
            </Field>
          )}
        </div>
        <div className="rounded-lg bg-panel-3 px-3 py-2 text-xs text-muted">
          {rich('promote.add.tip', { b: (c) => <b>{c}</b> })}
        </div>
      </div>
    </Modal>
  );
}
