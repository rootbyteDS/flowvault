import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search, Workflow } from 'lucide-react';
import { useApi, type Instance, type WorkflowListItem } from '../api.ts';
import { WorkflowTable } from '../components/WorkflowTable.tsx';
import { Card, EmptyState, ErrorBox, PageHeader, PageLoader, Segmented, inputCls } from '../components/ui.tsx';
import { cx } from '../util.ts';

type Status = 'present' | 'active' | 'inactive' | 'archived' | 'deleted' | 'all';

export function Workflows() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const status = (params.get('status') as Status) ?? 'present';
  const instance = params.get('instance') ?? '';

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  const update = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const qs = new URLSearchParams({ status, ...(debounced ? { q: debounced } : {}), ...(instance ? { instance } : {}) });
  const { data, error, loading } = useApi<WorkflowListItem[]>(`/workflows?${qs}`);
  const instances = useApi<Instance[]>('/instances');

  return (
    <>
      <PageHeader title="Workflows" subtitle="Gesicherte Workflows aller Instanzen" />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-dim" />
            <input className={cx(inputCls, 'pl-9')} placeholder="Name, Tag oder ID" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <select className={cx(inputCls, 'w-auto')} value={instance} onChange={(e) => update('instance', e.target.value)}>
            <option value="">Alle Instanzen</option>
            {instances.data?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <Segmented<Status>
            value={status}
            onChange={(v) => update('status', v === 'present' ? '' : v)}
            options={[
              { value: 'present', label: 'Vorhanden' },
              { value: 'active', label: 'Aktiv' },
              { value: 'inactive', label: 'Inaktiv' },
              { value: 'archived', label: 'Archiviert' },
              { value: 'deleted', label: 'Gelöscht' },
              { value: 'all', label: 'Alle' },
            ]}
          />
        </div>
        {error ? <div className="p-4"><ErrorBox>{error}</ErrorBox></div> : loading && !data ? <PageLoader /> : data!.length ? (
          <>
            <WorkflowTable items={data!} />
            <div className="border-t border-line px-4 py-2.5 text-xs text-muted">{data!.length} Workflows</div>
          </>
        ) : (
          <EmptyState icon={<Workflow className="size-6" />} title="Keine Workflows gefunden">
            {debounced ? 'Kein Treffer für diesen Suchbegriff' : 'Verbinde eine Instanz, um Workflows zu sichern'}
          </EmptyState>
        )}
      </Card>
    </>
  );
}
