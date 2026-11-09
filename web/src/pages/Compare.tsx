import { Link, useSearchParams } from 'react-router';
import { ArrowLeftRight, ArrowRight } from 'lucide-react';
import { useApi, type CompareResult, type WorkflowDetail } from '../api.ts';
import { ChangeChips } from '../components/changes.tsx';
import { DiffView } from '../components/DiffView.tsx';
import { Button, Card, ErrorBox, PageHeader, PageLoader, inputCls } from '../components/ui.tsx';
import { cx, describeSummary, formatDate, versionTitle } from '../util.ts';
import { message, t } from '../i18n.tsx';

export function Compare() {
  const [params, setParams] = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const cmp = useApi<CompareResult>(to ? `/compare?to=${to}${from ? `&from=${from}` : ''}` : null);
  const workflowId = params.get('workflow') ?? cmp.data?.to.workflow_id;
  const wf = useApi<WorkflowDetail>(workflowId ? `/workflows/${workflowId}` : null);

  const set = (k: 'from' | 'to', v: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    setParams(p, { replace: true });
  };

  if (!to) return <ErrorBox>{t('compare.missing')}</ErrorBox>;
  if (cmp.error) return <ErrorBox>{cmp.error}</ErrorBox>;
  if (!cmp.data) return <PageLoader />;
  const { diff } = cmp.data;
  const versions = wf.data?.versions ?? [];

  const Picker = ({ which, value }: { which: 'from' | 'to'; value?: number }) => (
    <select className={cx(inputCls, 'font-mono text-[13px]')} value={value ?? ''} onChange={(e) => set(which, e.target.value)}>
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          v{v.number} · {formatDate(v.created_at, true)} · {message(v.message) || versionTitle(v)}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader
        eyebrow={<Link to={`/workflows/${cmp.data.to.workflow_id}`} className="hover:text-text">{cmp.data.to.workflow_name}</Link>}
        title={t('compare.title')}
        subtitle={<span className="flex items-center gap-2">{describeSummary(diff.summary)} <ChangeChips s={diff.summary} /></span>}
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
          <div className="flex-1">
            <div className="mb-2 flex items-center gap-2 text-[13px] text-muted"><span className="size-1.5 rounded-full bg-del" />{t('compare.base')}</div>
            <Picker which="from" value={cmp.data.from?.id} />
          </div>
          <Button
            variant="ghost"
            className="self-center md:mt-7"
            title={t('compare.swap')}
            icon={<ArrowLeftRight className="size-4" />}
            onClick={() => {
              if (!from) return;
              const p = new URLSearchParams(params);
              p.set('from', to);
              p.set('to', from);
              setParams(p, { replace: true });
            }}
          />
          <div className="flex-1">
            <div className="mb-2 flex items-center gap-2 text-[13px] text-muted"><span className="size-1.5 rounded-full bg-add" />{t('compare.compared')}</div>
            <Picker which="to" value={cmp.data.to.id} />
          </div>
        </div>
        {cmp.data.from && cmp.data.from.number > cmp.data.to.number && (
          <div className="mt-3 text-xs text-mod">
            {t('compare.reversed')}
          </div>
        )}
      </Card>

      {cmp.data.from?.id === cmp.data.to.id ? (
        <div className="rounded-lg border border-line px-4 py-10 text-center text-sm text-muted">
          {t('compare.same')} <ArrowRight className="inline size-4 rtl:rotate-180" /> {t('compare.pickAnother')}
        </div>
      ) : (
        <DiffView from={cmp.data.from?.snapshot ?? null} to={cmp.data.to.snapshot} diff={diff} />
      )}
    </>
  );
}
