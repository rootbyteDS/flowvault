import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search, Workflow } from 'lucide-react';
import { useApi, type Instance, type WorkflowListItem } from '../api.ts';
import { WorkflowTable } from '../components/WorkflowTable.tsx';
import { Card, EmptyState, ErrorBox, PageHeader, PageLoader, Segmented, inputCls } from '../components/ui.tsx';
import { cx } from '../util.ts';
import { t } from '../i18n.tsx';

type Status = 'present' | 'active' | 'inactive' | 'archived' | 'deleted' | 'all';

export function Workflows() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const status = (params.get('status') as Status) ?? 'present';
  const instance = params.get('instance') ?? '';

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(timer);
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
      <PageHeader title={t('nav.workflows')} subtitle={t('workflows.subtitle')} />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-dim" />
            <input className={cx(inputCls, 'pl-9')} placeholder={t('workflows.search')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <select className={cx(inputCls, 'w-auto')} value={instance} onChange={(e) => update('instance', e.target.value)}>
            <option value="">{t('workflows.allInstances')}</option>
            {instances.data?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <Segmented<Status>
            value={status}
            onChange={(v) => update('status', v === 'present' ? '' : v)}
            options={[
              { value: 'present', label: t('workflows.status.present') },
              { value: 'active', label: t('workflows.status.active') },
              { value: 'inactive', label: t('workflows.status.inactive') },
              { value: 'archived', label: t('workflows.status.archived') },
              { value: 'deleted', label: t('workflows.status.deleted') },
              { value: 'all', label: t('workflows.status.all') },
            ]}
          />
        </div>
        {error ? <div className="p-4"><ErrorBox>{error}</ErrorBox></div> : loading && !data ? <PageLoader /> : data!.length ? (
          <>
            <WorkflowTable items={data!} />
            <div className="border-t border-line px-4 py-2.5 text-xs text-muted">{t('workflows.count', { count: data!.length })}</div>
          </>
        ) : (
          <EmptyState icon={<Workflow className="size-6" />} title={t('workflows.empty')}>
            {debounced ? t('workflows.noMatch') : t('workflows.connectHint')}
          </EmptyState>
        )}
      </Card>
    </>
  );
}
