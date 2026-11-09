import { useMemo, useState } from 'react';
import { diffLines } from 'diff';
import { ChevronDown, ChevronRight, FileJson, Settings, Tag, Power, Type } from 'lucide-react';
import { hashableContent, stableStringify, type NodeChange, type Snapshot, type WorkflowDiff } from '../../../shared/diff.ts';
import type { FailingNode } from '../../../shared/executions.ts';
import { WorkflowCanvas, canvasFromDiff } from './WorkflowCanvas.tsx';
import { nodeVisual } from './changes.tsx';
import { Card } from './ui.tsx';
import { cx, shortType } from '../util.ts';
import { rich, t } from '../i18n.tsx';

type Row = { kind: 'add' | 'del' | 'ctx'; text: string; a?: number; b?: number } | { kind: 'gap'; count: number; id: number };

export function JsonDiff({ before, after, context = 3, className }: { before: string; after: string; context?: number; className?: string }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const rows = useMemo(() => {
    const parts = diffLines(before, after);
    const flat: Exclude<Row, { kind: 'gap' }>[] = [];
    let a = 1, b = 1;
    for (const p of parts) {
      const lines = p.value.replace(/\n$/, '').split('\n');
      for (const text of lines) {
        if (p.added) flat.push({ kind: 'add', text, b: b++ });
        else if (p.removed) flat.push({ kind: 'del', text, a: a++ });
        else flat.push({ kind: 'ctx', text, a: a++, b: b++ });
      }
    }
    // Unveränderte Blöcke einklappen
    const keep = new Array(flat.length).fill(false);
    flat.forEach((r, i) => {
      if (r.kind !== 'ctx') for (let j = Math.max(0, i - context); j <= Math.min(flat.length - 1, i + context); j++) keep[j] = true;
    });
    const out: (Row & { hidden?: Row[] })[] = [];
    let i = 0, gapId = 0;
    while (i < flat.length) {
      if (keep[i]) {
        out.push(flat[i++]);
        continue;
      }
      const start = i;
      while (i < flat.length && !keep[i]) i++;
      const hidden = flat.slice(start, i);
      out.push({ kind: 'gap', count: hidden.length, id: gapId++, hidden });
    }
    return out;
  }, [before, after, context]);

  const changes = rows.some((r) => r.kind === 'add' || r.kind === 'del');

  return (
    <div className={cx('overflow-auto rounded-lg border border-line bg-bg font-mono text-[12px] leading-[20px]', className)}>
      {!changes && <div className="px-4 py-3 font-sans text-sm text-muted">{t('diff.noDifferences')}</div>}
      {changes && (
        <table className="w-full border-collapse">
          <tbody>
            {rows.flatMap((r, idx) => {
              if (r.kind === 'gap') {
                if (expanded.has(r.id)) {
                  return (r as { hidden: Row[] }).hidden.map((h, j) => <Line key={`${idx}-${j}`} r={h as Exclude<Row, { kind: 'gap' }>} />);
                }
                return [
                  <tr key={idx} className="bg-panel-2">
                    <td colSpan={4} className="px-3 py-0.5">
                      <button className="font-sans text-xs text-muted hover:text-text" onClick={() => setExpanded((s) => new Set(s).add(r.id))}>
                        {t('diff.showUnchanged', { count: r.count })}
                      </button>
                    </td>
                  </tr>,
                ];
              }
              return [<Line key={idx} r={r} />];
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Line({ r }: { r: Exclude<Row, { kind: 'gap' }> }) {
  return (
    <tr className={cx(r.kind === 'add' && 'bg-add/10', r.kind === 'del' && 'bg-del/10')}>
      <td className="w-10 select-none border-r border-line px-2 text-right text-dim">{r.a ?? ''}</td>
      <td className="w-10 select-none border-r border-line px-2 text-right text-dim">{r.b ?? ''}</td>
      <td className={cx('w-5 select-none text-center', r.kind === 'add' ? 'text-add' : r.kind === 'del' ? 'text-del' : 'text-dim')}>
        {r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}
      </td>
      <td className={cx('whitespace-pre pr-4', r.kind === 'add' ? 'text-[#aff5b4]' : r.kind === 'del' ? 'text-[#ffc1bd]' : 'text-text/75')}>{r.text}</td>
    </tr>
  );
}

const nodeJson = (n?: unknown) => (n ? stableStringify(n, 2) : '');

function NodeChangeItem({ c, open, onToggle, fail }: { c: NodeChange; open: boolean; onToggle: () => void; fail?: FailingNode }) {
  const n = (c.after ?? c.before)!;
  const v = nodeVisual(n.type);
  const sym = { added: ['+', 'text-add'], removed: ['−', 'text-del'], modified: ['~', 'text-mod'], unchanged: ['→', 'text-dim'] }[c.status];
  const label = t({ added: 'diff.status.added', removed: 'diff.status.removed', modified: 'diff.status.modified', unchanged: c.renamed ? 'diff.status.renamed' : 'diff.status.moved' }[c.status] as 'diff.status.added');
  return (
    <div className="border-b border-line last:border-0">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-panel-2">
        {open ? <ChevronDown className="size-4 shrink-0 text-dim" /> : <ChevronRight className="size-4 shrink-0 text-dim" />}
        <span className={cx('w-3 shrink-0 text-center font-mono text-sm', sym[1])}>{sym[0]}</span>
        <v.Icon className="size-4 shrink-0 text-dim" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {c.renamed ? (
              <>
                <span className="text-muted line-through">{c.before!.name}</span> → {c.after!.name}
              </>
            ) : (
              n.name
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-dim">
            {shortType(n.type)}
            {c.fields.length > 0 && <> · {c.fields.map((f) => f.replace(/^parameters\./, '')).join(', ')}</>}
          </span>
        </span>
        {fail && (
          <span className="shrink-0 text-xs text-del" title={fail.lastMessage ?? undefined}>
            {t(fail.isNew ? 'diff.failedTimesNew' : 'diff.failedTimes', { count: fail.failed })}
          </span>
        )}
        <span className="shrink-0 text-xs text-dim">{label}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <JsonDiff before={nodeJson(c.before)} after={nodeJson(c.after)} className="max-h-[420px]" />
        </div>
      )}
    </div>
  );
}

export function DiffView({ from, to, diff, failing }: { from: Snapshot | null; to: Snapshot; diff: WorkflowDiff; failing?: FailingNode[] }) {
  const failByName = useMemo(() => new Map((failing ?? []).map((f) => [f.name, f])), [failing]);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showFull, setShowFull] = useState(false);
  const canvas = useMemo(() => canvasFromDiff(diff), [diff]);
  const s = diff.summary;

  const changed = diff.nodes.filter((n) => n.status !== 'unchanged' || n.renamed);
  const movedOnly = diff.nodes.filter((n) => n.status === 'unchanged' && !n.renamed && n.moved);
  const edgesAdded = diff.edges.filter((e) => e.status === 'added');
  const edgesRemoved = diff.edges.filter((e) => e.status === 'removed');

  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const selectNode = (k: string | null) => {
    setSelected(k);
    if (k && changed.some((c) => c.key === k)) {
      setOpen((o) => new Set(o).add(k));
      setTimeout(() => document.getElementById(`chg-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  };

  const meta: { icon: typeof Type; text: React.ReactNode }[] = [];
  if (s.nameChanged) meta.push({ icon: Type, text: rich('diff.nameChanged', { s: (c) => <span className="text-muted line-through">{c}</span> }, { from: s.nameChanged.from, to: s.nameChanged.to }) });
  if (s.activeChanged !== undefined) meta.push({ icon: Power, text: t(s.activeChanged ? 'diff.activated' : 'diff.deactivated') });
  if (s.tagsChanged) meta.push({ icon: Tag, text: t('diff.tags', { from: from?.tags.join(', ') || '–', to: to.tags.join(', ') || '–' }) });
  if (s.settingsChanged) meta.push({ icon: Settings, text: t('diff.settings') });
  if (s.pinDataChanged) meta.push({ icon: FileJson, text: t('diff.pinData') });

  return (
    <div className="space-y-6">
      <WorkflowCanvas {...canvas} selected={selected} onSelect={selectNode} showLegend failing={failing} className="h-[460px]" />

      {meta.length > 0 && (
        <Card className="divide-y divide-line">
          {meta.map((m, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
              <m.icon className="size-4 shrink-0 text-dim" />
              <span>{m.text}</span>
            </div>
          ))}
          {s.settingsChanged && (
            <div className="p-4">
              <JsonDiff before={stableStringify(from?.settings ?? {}, 2)} after={stableStringify(to.settings ?? {}, 2)} />
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">{t('diff.changedNodes')}</h2>
          <span className="text-xs text-muted">
            {t('diff.nodesOf', { changed: changed.length, total: diff.nodes.length })}
          </span>
        </div>
        {changed.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted">{t('diff.noNodeChanged')}</div>}
        {changed.map((c) => (
          <div id={`chg-${c.key}`} key={c.key} className={cx(selected === c.key && 'bg-panel-2')}>
            <NodeChangeItem c={c} open={open.has(c.key)} onToggle={() => toggle(c.key)} fail={c.after ? failByName.get(c.after.name) : undefined} />
          </div>
        ))}
        {movedOnly.length > 0 && (
          <div className="border-t border-line px-4 py-3 text-xs text-dim">
            {t('diff.movedOnly', { names: movedOnly.map((m) => m.after!.name).join(', ') })}
          </div>
        )}
      </Card>

      {(edgesAdded.length > 0 || edgesRemoved.length > 0) && (
        <Card>
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">{t('diff.connections')}</h2>
          </div>
          <div className="divide-y divide-line text-sm">
            {[...edgesAdded, ...edgesRemoved].map((e) => (
              <div key={e.key} className="flex items-center gap-2 px-4 py-2">
                <span className={cx('w-3 text-center font-mono', e.status === 'added' ? 'text-add' : 'text-del')}>{e.status === 'added' ? '+' : '−'}</span>
                <span className="font-medium">{e.fromName}</span>
                <span className="text-dim">{e.outputIndex > 0 ? `${t('diff.output', { number: e.outputIndex + 1 })} ` : ''}→</span>
                <span className="font-medium">{e.toName}</span>
                {e.type !== 'main' && <span className="font-mono text-xs text-dim">{e.type.replace(/^ai_/, t('diff.aiPrefix'))}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <button onClick={() => setShowFull((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-panel-2">
          {showFull ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
          {t('diff.fullDiff')}
        </button>
        {showFull && (
          <div className="px-4 pb-4">
            <JsonDiff
              before={from ? stableStringify(hashableContent(from), 2) : ''}
              after={stableStringify(hashableContent(to), 2)}
              className="max-h-[70vh]"
            />
          </div>
        )}
      </Card>
    </div>
  );
}
