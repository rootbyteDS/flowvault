import { Link, useSearchParams } from 'react-router';
import { ArrowLeftRight, ArrowRight } from 'lucide-react';
import { describeSummary } from '../../../shared/diff.ts';
import { useApi, type CompareResult, type WorkflowDetail } from '../api.ts';
import { ChangeChips } from '../components/changes.tsx';
import { DiffView } from '../components/DiffView.tsx';
import { Button, Card, ErrorBox, PageHeader, PageLoader, inputCls } from '../components/ui.tsx';
import { cx, formatDate, versionTitle } from '../util.ts';

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

  if (!to) return <ErrorBox>Keine Version zum Vergleichen angegeben</ErrorBox>;
  if (cmp.error) return <ErrorBox>{cmp.error}</ErrorBox>;
  if (!cmp.data) return <PageLoader />;
  const { diff } = cmp.data;
  const versions = wf.data?.versions ?? [];

  const Picker = ({ which, value }: { which: 'from' | 'to'; value?: number }) => (
    <select className={cx(inputCls, 'font-mono text-[13px]')} value={value ?? ''} onChange={(e) => set(which, e.target.value)}>
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          v{v.number} · {formatDate(v.created_at, true)} · {v.message || versionTitle(v)}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader
        eyebrow={<Link to={`/workflows/${cmp.data.to.workflow_id}`} className="hover:text-text">{cmp.data.to.workflow_name}</Link>}
        title="Versionen vergleichen"
        subtitle={<span className="flex items-center gap-2">{describeSummary(diff.summary)} <ChangeChips s={diff.summary} /></span>}
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
          <div className="flex-1">
            <div className="mb-2 flex items-center gap-2 text-[13px] text-muted"><span className="size-1.5 rounded-full bg-del" />Basis</div>
            <Picker which="from" value={cmp.data.from?.id} />
          </div>
          <Button
            variant="ghost"
            className="self-center md:mt-7"
            title="Tauschen"
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
            <div className="mb-2 flex items-center gap-2 text-[13px] text-muted"><span className="size-1.5 rounded-full bg-add" />Vergleich</div>
            <Picker which="to" value={cmp.data.to.id} />
          </div>
        </div>
        {cmp.data.from && cmp.data.from.number > cmp.data.to.number && (
          <div className="mt-3 text-xs text-mod">
            Die Basis ist neuer als der Vergleich, Änderungen erscheinen deshalb rückwärts
          </div>
        )}
      </Card>

      {cmp.data.from?.id === cmp.data.to.id ? (
        <div className="rounded-lg border border-line px-4 py-10 text-center text-sm text-muted">
          Beide Seiten zeigen dieselbe Version. <ArrowRight className="inline size-4" /> Wähle oben eine andere.
        </div>
      ) : (
        <DiffView from={cmp.data.from?.snapshot ?? null} to={cmp.data.to.snapshot} diff={diff} />
      )}
    </>
  );
}
