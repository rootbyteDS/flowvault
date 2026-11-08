import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { diffWorkflows, type ChangeStatus, type Snapshot, type WfNode, type WorkflowDiff } from '../../../shared/diff.ts';
import type { FailingNode } from '../../../shared/executions.ts';
import { nodeVisual } from './changes.tsx';
import { InfoTip } from './ui.tsx';
import { cx, shortType } from '../util.ts';

export interface CanvasNode {
  key: string;
  node: WfNode;
  status: ChangeStatus;
  renamed?: boolean;
  fromName?: string;
}
export interface CanvasEdge {
  key: string;
  from: string;
  to: string;
  status: 'added' | 'removed' | 'unchanged';
  type: string;
  outputIndex: number;
}

export function canvasFromDiff(d: WorkflowDiff, highlight = true): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return {
    nodes: d.nodes.map((n) => ({
      key: n.key,
      node: (n.after ?? n.before)!,
      status: highlight ? n.status : 'unchanged',
      renamed: highlight && n.renamed,
      fromName: n.before?.name,
    })),
    edges: d.edges.map((e) => ({ ...e, status: highlight ? e.status : 'unchanged' })),
  };
}

export function canvasFromSnapshot(s: Snapshot) {
  return canvasFromDiff(diffWorkflows(s, s), false);
}

const W = 168;
const H = 54;
const SX = 1.0; // n8n-Positionen etwas spreizen, damit die breiteren Karten Platz haben
const SY = 1.0;

const STATUS_COLOR: Record<string, string> = {
  added: 'var(--color-add)',
  removed: 'var(--color-del)',
  modified: 'var(--color-mod)',
  unchanged: 'var(--color-line-2)',
};

function pos(n: WfNode) {
  const [x, y] = n.position ?? [0, 0];
  return { x: x * SX, y: y * SY };
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function WorkflowCanvas({
  nodes,
  edges,
  selected,
  onSelect,
  className,
  showLegend,
  failing,
}: {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selected?: string | null;
  onSelect?: (key: string | null) => void;
  className?: string;
  showLegend?: boolean;
  /** Nodes, an denen Ausführungen dieser Version gescheitert sind (aus dem Health-Dienst). */
  failing?: FailingNode[];
}) {
  const failingByName = useMemo(() => new Map((failing ?? []).map((f) => [f.name, f])), [failing]);
  const wrap = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  const sticky = nodes.filter((n) => n.node.type === 'n8n-nodes-base.stickyNote');
  const regular = nodes.filter((n) => n.node.type !== 'n8n-nodes-base.stickyNote');
  const byKey = useMemo(() => new Map(regular.map((n) => [n.key, n])), [regular]);

  const outputs = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) if (e.type === 'main') m.set(e.from, Math.max(m.get(e.from) ?? 1, e.outputIndex + 1));
    return m;
  }, [edges]);

  const bbox = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      const p = pos(n.node);
      const isSticky = n.node.type === 'n8n-nodes-base.stickyNote';
      const w = isSticky ? Number(n.node.parameters?.width ?? 240) * SX : W;
      const h = isSticky ? Number(n.node.parameters?.height ?? 160) : H;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + w); y1 = Math.max(y1, p.y + h);
    }
    if (!isFinite(x0)) return { x0: 0, y0: 0, x1: 400, y1: 200 };
    return { x0, y0, x1, y1 };
  }, [nodes]);

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = Math.min(60, width * 0.06);
    const bw = bbox.x1 - bbox.x0, bh = bbox.y1 - bbox.y0;
    const k = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh, 1.15);
    setT({ k, x: (width - bw * k) / 2 - bbox.x0 * k, y: (height - bh * k) / 2 - bbox.y0 * k });
  }, [bbox]);

  useEffect(() => {
    fit();
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (!e.ctrlKey && !e.metaKey) {
        // Wie in n8n: Scrollen verschiebt, Pinch bzw. ⌘/Strg + Scrollen zoomt
        setT((p) => ({ ...p, x: p.x - e.deltaX, y: p.y - e.deltaY }));
        return;
      }
      const f = Math.exp(-e.deltaY * 0.01);
      setT((p) => {
        const k = Math.min(2.5, Math.max(0.15, p.k * f));
        return { k, x: mx - ((mx - p.x) / p.k) * k, y: my - ((my - p.y) / p.k) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoom = (f: number) => {
    const el = wrap.current!;
    const { width, height } = el.getBoundingClientRect();
    setT((p) => {
      const k = Math.min(2.5, Math.max(0.15, p.k * f));
      return { k, x: width / 2 - ((width / 2 - p.x) / p.k) * k, y: height / 2 - ((height / 2 - p.y) / p.k) * k };
    });
  };

  function edgePath(e: CanvasEdge) {
    const a = byKey.get(e.from), b = byKey.get(e.to);
    if (!a || !b) return null;
    const pa = pos(a.node), pb = pos(b.node);
    if (e.type !== 'main') {
      // KI-Sub-Nodes (Model, Memory, Tools …) hängen unter dem Agenten
      const x1 = pa.x + W / 2, y1 = pa.y, x2 = pb.x + W / 2, y2 = pb.y + H;
      const c = Math.max(30, Math.abs(y1 - y2) / 2);
      return `M${x1},${y1} C${x1},${y1 - c} ${x2},${y2 + c} ${x2},${y2}`;
    }
    const n = outputs.get(e.from) ?? 1;
    const off = n > 1 ? (e.outputIndex - (n - 1) / 2) * 16 : 0;
    const x1 = pa.x + W, y1 = pa.y + H / 2 + off, x2 = pb.x - 2, y2 = pb.y + H / 2;
    const dx = x2 - x1;
    const c = dx > 30 ? Math.max(40, dx / 2) : Math.max(90, Math.abs(dx) / 2 + 60);
    return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
  }

  const sortedEdges = [...edges].sort((a, b) => (a.status === 'unchanged' ? -1 : 0) - (b.status === 'unchanged' ? -1 : 0));

  return (
    <div
      ref={wrap}
      className={cx('bg-grid relative overflow-hidden rounded-xl border border-line bg-bg select-none', className)}
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
        if (d.moved) setT((p) => ({ ...p, x: d.tx + dx, y: d.ty + dy }));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved && onSelect) {
          const key = (e.target as Element).closest('[data-key]')?.getAttribute('data-key') ?? null;
          onSelect(key === selected ? null : key);
        }
      }}
    >
      <svg className={cx('absolute inset-0 size-full', drag.current?.moved ? 'cursor-grabbing' : 'cursor-grab')}>
        <defs>
          {Object.entries({ unchanged: 'var(--color-dim)', added: STATUS_COLOR.added, removed: STATUS_COLOR.removed }).map(([k, c]) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" style={{ fill: c }} />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {sticky.map((n) => {
            const p = pos(n.node);
            const w = Number(n.node.parameters?.width ?? 240) * SX;
            const h = Number(n.node.parameters?.height ?? 160);
            const content = String(n.node.parameters?.content ?? '').replace(/[#*_>`]/g, '').trim();
            const lines = content.split('\n').filter(Boolean).slice(0, Math.max(1, Math.floor((h - 20) / 18)));
            return (
              <g key={n.key} data-key={n.key} transform={`translate(${p.x},${p.y})`} className="cursor-pointer">
                <rect width={w} height={h} rx={8} style={{
                  fill: 'color-mix(in srgb, #fbbf24 7%, var(--color-panel))',
                  stroke: n.status === 'unchanged' ? 'color-mix(in srgb, #fbbf24 25%, transparent)' : STATUS_COLOR[n.status],
                  strokeWidth: n.status === 'unchanged' ? 1 : 2,
                  strokeDasharray: n.status === 'removed' ? '6 4' : undefined,
                }} />
                {lines.map((l, i) => (
                  <text key={i} x={12} y={24 + i * 18} style={{ fill: 'color-mix(in srgb, #fbbf24 70%, var(--color-text))', fontSize: i === 0 ? 13 : 12, fontWeight: i === 0 ? 500 : 400 }}>
                    {truncate(l, Math.floor(w / 7.2))}
                  </text>
                ))}
              </g>
            );
          })}

          {sortedEdges.map((e) => {
            const d = edgePath(e);
            if (!d) return null;
            const color = e.status === 'unchanged' ? 'var(--color-dim)' : STATUS_COLOR[e.status];
            return (
              <path
                key={e.key}
                d={d}
                fill="none"
                markerEnd={e.type === 'main' ? `url(#arrow-${e.status})` : undefined}
                style={{
                  stroke: color,
                  strokeWidth: e.status === 'unchanged' ? 1.6 : 2.4,
                  strokeDasharray: e.status === 'removed' || e.type !== 'main' ? '6 5' : undefined,
                  opacity: e.status === 'removed' ? 0.8 : 1,
                }}
              />
            );
          })}

          {regular.map((n) => {
            const p = pos(n.node);
            const v = nodeVisual(n.node.type);
            const isSel = selected === n.key;
            const color = STATUS_COLOR[n.status];
            const highlighted = n.status !== 'unchanged';
            const fail = n.status !== 'removed' ? failingByName.get(n.node.name) : undefined;
            const rl = v.trigger ? 26 : 10;
            const shape = `M${rl},0 H${W - 10} Q${W},0 ${W},10 V${H - 10} Q${W},${H} ${W - 10},${H} H${rl} Q0,${H} 0,${H - rl} V${rl} Q0,0 ${rl},0 Z`;
            return (
              <g
                key={n.key}
                data-key={n.key}
                transform={`translate(${p.x},${p.y})`}
                className="cursor-pointer"
                style={{ opacity: n.status === 'removed' ? 0.75 : n.node.disabled ? 0.5 : 1 }}
              >
                <title>{`${n.node.name}\n${n.node.type}${fail ? `\n${fail.failed}× gescheitert (${Math.round(fail.rate * 100)} % der Läufe)${fail.lastMessage ? `\n${fail.lastMessage}` : ''}` : ''}`}</title>
                {fail && (
                  <rect x={-5} y={-5} width={W + 10} height={H + 10} rx={14} style={{
                    fill: 'color-mix(in srgb, var(--color-del) 7%, transparent)',
                    stroke: 'var(--color-del)',
                    strokeWidth: 1.5,
                    strokeDasharray: fail.isNew ? undefined : '4 3',
                  }} />
                )}
                <path
                  d={shape}
                  style={{
                    fill: n.status === 'removed' ? 'color-mix(in srgb, var(--color-del) 8%, var(--color-panel))' : 'var(--color-panel-2)',
                    stroke: isSel ? 'var(--color-accent-hi)' : highlighted ? color : 'rgb(239 233 223 / 0.16)',
                    strokeWidth: isSel || highlighted ? 2 : 1,
                    strokeDasharray: n.status === 'removed' ? '6 4' : undefined,
                  }}
                />
                <rect x={9} y={11} width={32} height={32} rx={6} style={{ fill: v.color, opacity: 0.12 }} />
                <v.Icon x={16} y={18} width={18} height={18} color={v.color} strokeWidth={2} />
                <text x={50} y={25} style={{ fill: 'var(--color-text)', fontSize: 12.5, fontWeight: 500, textDecoration: n.node.disabled || n.status === 'removed' ? 'line-through' : undefined }}>
                  {truncate(n.node.name, 16)}
                </text>
                <text x={50} y={41} style={{ fill: 'var(--color-muted)', fontSize: 10.5 }}>
                  {n.renamed && n.fromName ? truncate(`war: ${n.fromName}`, 21) : truncate(shortType(n.node.type), 21)}
                </text>
                {highlighted && (
                  <g transform={`translate(${W - 4},-4)`}>
                    <circle r={8} style={{ fill: color, stroke: 'var(--color-bg)', strokeWidth: 2 }} />
                    <text textAnchor="middle" y={4} style={{ fill: 'var(--color-bg)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {n.status === 'added' ? '+' : n.status === 'removed' ? '−' : '~'}
                    </text>
                  </g>
                )}
                {fail && (
                  <g transform={`translate(10,${H - 7})`}>
                    <rect width={String(fail.failed).length * 7 + 26} height={16} rx={4} style={{ fill: 'var(--color-del)', stroke: 'var(--color-bg)', strokeWidth: 2 }} />
                    <text x={7} y={12} style={{ fill: 'var(--color-bg)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      ✕ {fail.failed}
                    </text>
                  </g>
                )}
                {v.trigger && (
                  <g transform="translate(-7,19)">
                    <circle r={8} cx={0} cy={8} style={{ fill: 'var(--color-panel-3)', stroke: 'var(--color-line-2)' }} />
                    <path d="M1,2 L-3,9 H0 L-1,14 L3,7 H0 Z" style={{ fill: '#f59e0b' }} />
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {!nodes.length && <div className="absolute inset-0 grid place-items-center text-sm text-muted">Dieser Workflow hat keine Nodes.</div>}

      <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-lg border border-line-2 bg-panel" onPointerDown={(e) => e.stopPropagation()}>
        <button className="p-2 text-muted transition-colors hover:bg-panel-3 hover:text-text" onClick={() => zoom(1.25)} title="Vergrößern"><ZoomIn className="size-4" /></button>
        <button className="p-2 text-muted transition-colors hover:bg-panel-3 hover:text-text" onClick={() => zoom(0.8)} title="Verkleinern"><ZoomOut className="size-4" /></button>
        <button className="border-t border-line p-2 text-muted transition-colors hover:bg-panel-3 hover:text-text" onClick={fit} title="Einpassen"><Maximize2 className="size-4" /></button>
      </div>

      {(showLegend || failingByName.size > 0) && (
        <div className="absolute top-3 left-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-line-2 bg-panel px-3 py-2 text-xs text-muted" onPointerDown={(e) => e.stopPropagation()}>
          {showLegend && (
            <>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-add" />Hinzugefügt</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-mod" />Geändert</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-del" />Entfernt</span>
            </>
          )}
          {failingByName.size > 0 && (
            <>
              {[...failingByName.values()].some((f) => f.isNew) && (
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] border border-del" />Scheitert neu seit dieser Version</span>
              )}
              {[...failingByName.values()].some((f) => !f.isNew) && (
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] border border-dashed border-del" />Scheiterte schon vorher</span>
              )}
              <InfoTip label="Rote Umrandung">
                <p>Rot umrandete Nodes sind bei Ausführungen dieser Version in n8n gescheitert. Fahr mit der Maus über einen Node für Anzahl und letzte Fehlermeldung.</p>
                <p><b>Durchgezogen</b>: scheitert erst seit dieser Version. <b>Gestrichelt</b>: scheiterte schon in den Versionen davor.</p>
              </InfoTip>
            </>
          )}
        </div>
      )}
    </div>
  );
}
