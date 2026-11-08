/**
 * Workflow-Vergleich – geteilt zwischen Server (Zusammenfassungen beim Sync)
 * und Weboberfläche (Diff-Ansicht).
 */

export interface WfNode {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: [number, number];
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  disabled?: boolean;
  [k: string]: unknown;
}

export interface Snapshot {
  n8nId: string;
  name: string;
  active: boolean;
  nodes: WfNode[];
  connections: Record<string, Record<string, ({ node: string; type: string; index: number } | null)[][] | null>>;
  settings: Record<string, unknown>;
  pinData?: Record<string, unknown> | null;
  staticData?: unknown;
  tags: string[];
  versionId?: string;
  updatedAt?: string;
}

export interface ChangeSummary {
  initial?: boolean;
  restoredFrom?: number;
  added: string[];
  removed: string[];
  modified: string[];
  renamed: { from: string; to: string }[];
  moved: string[];
  connectionsAdded: number;
  connectionsRemoved: number;
  nameChanged?: { from: string; to: string };
  activeChanged?: boolean; // neuer Zustand
  settingsChanged: boolean;
  tagsChanged: boolean;
  pinDataChanged: boolean;
  nodeCount: number;
}

export type ChangeStatus = 'added' | 'removed' | 'modified' | 'unchanged';

export interface NodeChange {
  key: string;
  status: ChangeStatus;
  renamed: boolean;
  moved: boolean;
  before?: WfNode;
  after?: WfNode;
  fields: string[]; // geänderte Felder, z. B. "parameters.url"
}

export interface EdgeChange {
  key: string;
  status: 'added' | 'removed' | 'unchanged';
  from: string; // node key
  to: string; // node key
  fromName: string;
  toName: string;
  type: string;
  outputIndex: number;
}

export interface WorkflowDiff {
  summary: ChangeSummary;
  nodes: NodeChange[];
  edges: EdgeChange[];
}

/** JSON mit sortierten Schlüsseln – Grundlage für stabile Hashes & Vergleiche. */
export function stableStringify(value: unknown, indent?: number): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) {
        const val = (v as Record<string, unknown>)[k];
        if (val !== undefined) out[k] = sort(val);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value), null, indent);
}

/** Inhalt, der für "hat sich etwas geändert?" zählt (ohne Zeitstempel, staticData etc.). */
export function hashableContent(s: Snapshot) {
  return {
    name: s.name,
    active: s.active,
    nodes: s.nodes,
    connections: s.connections,
    settings: s.settings ?? {},
    pinData: s.pinData && Object.keys(s.pinData).length ? s.pinData : null,
    tags: [...s.tags].sort(),
  };
}

const eq = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

function matchNodes(before: WfNode[], after: WfNode[]) {
  const pairs: { key: string; before?: WfNode; after?: WfNode }[] = [];
  const usedBefore = new Set<WfNode>();
  const byId = new Map(before.filter((n) => n.id).map((n) => [n.id!, n]));
  const byName = new Map(before.map((n) => [n.name, n]));

  for (const a of after) {
    let b = a.id ? byId.get(a.id) : undefined;
    if (!b) {
      const cand = byName.get(a.name);
      if (cand && !usedBefore.has(cand) && (!cand.id || !a.id || !after.some((x) => x.id === cand.id))) b = cand;
    }
    if (b && usedBefore.has(b)) b = undefined;
    if (b) usedBefore.add(b);
    pairs.push({ key: a.id ?? b?.id ?? `name:${a.name}`, before: b, after: a });
  }
  for (const b of before) {
    if (!usedBefore.has(b)) pairs.push({ key: b.id ?? `name:${b.name}`, before: b });
  }
  return pairs;
}

function changedFields(b: WfNode, a: WfNode): string[] {
  const fields: string[] = [];
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const k of keys) {
    if (k === 'position' || k === 'name' || k === 'id') continue;
    if (k === 'parameters') {
      const pb = (b.parameters ?? {}) as Record<string, unknown>;
      const pa = (a.parameters ?? {}) as Record<string, unknown>;
      for (const pk of new Set([...Object.keys(pb), ...Object.keys(pa)])) {
        if (!eq(pb[pk], pa[pk])) fields.push(`parameters.${pk}`);
      }
    } else if (!eq(b[k], a[k])) {
      fields.push(k);
    }
  }
  return fields;
}

function edgesOf(s: Snapshot, keyByName: Map<string, string>) {
  const edges = new Map<string, Omit<EdgeChange, 'status'>>();
  for (const [src, types] of Object.entries(s.connections ?? {})) {
    for (const [type, outputs] of Object.entries(types ?? {})) {
      (outputs ?? []).forEach((targets, outIdx) => {
        for (const t of targets ?? []) {
          if (!t) continue;
          const from = keyByName.get(src) ?? `name:${src}`;
          const to = keyByName.get(t.node) ?? `name:${t.node}`;
          const key = `${from}|${type}|${outIdx}->${to}|${t.type}|${t.index}`;
          edges.set(key, { key, from, to, fromName: src, toName: t.node, type, outputIndex: outIdx });
        }
      });
    }
  }
  return edges;
}

export function diffWorkflows(before: Snapshot | null, after: Snapshot): WorkflowDiff {
  const prev: Snapshot = before ?? { ...after, nodes: [], connections: {}, tags: after.tags, settings: after.settings };
  const pairs = matchNodes(prev.nodes ?? [], after.nodes ?? []);

  const nodes: NodeChange[] = pairs.map(({ key, before: b, after: a }) => {
    if (!b) return { key, status: 'added', renamed: false, moved: false, after: a, fields: [] };
    if (!a) return { key, status: 'removed', renamed: false, moved: false, before: b, fields: [] };
    const fields = changedFields(b, a);
    const renamed = b.name !== a.name;
    const moved = !eq(b.position, a.position);
    return { key, status: fields.length ? 'modified' : 'unchanged', renamed, moved, before: b, after: a, fields };
  });

  const keyBefore = new Map<string, string>();
  const keyAfter = new Map<string, string>();
  for (const p of pairs) {
    if (p.before) keyBefore.set(p.before.name, p.key);
    if (p.after) keyAfter.set(p.after.name, p.key);
  }
  const eb = edgesOf(prev, keyBefore);
  const ea = edgesOf(after, keyAfter);
  const edges: EdgeChange[] = [];
  for (const [k, e] of ea) edges.push({ ...e, status: eb.has(k) ? 'unchanged' : 'added' });
  for (const [k, e] of eb) if (!ea.has(k)) edges.push({ ...e, status: 'removed' });

  const summary: ChangeSummary = {
    initial: !before,
    added: nodes.filter((n) => n.status === 'added').map((n) => n.after!.name),
    removed: nodes.filter((n) => n.status === 'removed').map((n) => n.before!.name),
    modified: nodes.filter((n) => n.status === 'modified').map((n) => n.after!.name),
    renamed: nodes.filter((n) => n.renamed).map((n) => ({ from: n.before!.name, to: n.after!.name })),
    moved: nodes.filter((n) => n.moved && n.status === 'unchanged' && !n.renamed).map((n) => n.after!.name),
    connectionsAdded: before ? edges.filter((e) => e.status === 'added').length : 0,
    connectionsRemoved: edges.filter((e) => e.status === 'removed').length,
    settingsChanged: !!before && !eq(prev.settings ?? {}, after.settings ?? {}),
    tagsChanged: !!before && !eq([...prev.tags].sort(), [...after.tags].sort()),
    pinDataChanged: !!before && !eq(prev.pinData || null, after.pinData || null),
    nodeCount: (after.nodes ?? []).filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length,
  };
  if (!summary.initial) delete summary.initial;
  if (before && before.name !== after.name) summary.nameChanged = { from: before.name, to: after.name };
  if (before && before.active !== after.active) summary.activeChanged = after.active;
  if (!before) summary.added = [];

  return { summary, nodes, edges };
}

/** Kurzer, menschenlesbarer Titel für eine Version – wie eine Commit-Message. */
export function describeSummary(s: ChangeSummary): string {
  if (s.restoredFrom) return `Wiederhergestellt aus Version ${s.restoredFrom}`;
  if (s.initial) return `Erste Sicherung · ${s.nodeCount} Nodes`;
  const parts: string[] = [];
  if (s.nameChanged) parts.push(`Umbenannt in „${s.nameChanged.to}“`);
  if (s.activeChanged !== undefined) parts.push(s.activeChanged ? 'Aktiviert' : 'Deaktiviert');
  if (s.added.length) parts.push(s.added.length === 1 ? `„${s.added[0]}“ hinzugefügt` : `${s.added.length} Nodes hinzugefügt`);
  if (s.removed.length) parts.push(s.removed.length === 1 ? `„${s.removed[0]}“ entfernt` : `${s.removed.length} Nodes entfernt`);
  if (s.modified.length) parts.push(s.modified.length === 1 ? `„${s.modified[0]}“ geändert` : `${s.modified.length} Nodes geändert`);
  if (s.renamed.length) parts.push(s.renamed.length === 1 ? `„${s.renamed[0].from}“ → „${s.renamed[0].to}“` : `${s.renamed.length} Nodes umbenannt`);
  if (!parts.length && (s.connectionsAdded || s.connectionsRemoved)) parts.push('Verbindungen geändert');
  if (!parts.length && s.settingsChanged) parts.push('Einstellungen geändert');
  if (!parts.length && s.tagsChanged) parts.push('Tags geändert');
  if (!parts.length && s.pinDataChanged) parts.push('Testdaten (Pin Data) geändert');
  if (!parts.length && s.moved.length) parts.push('Layout angepasst');
  if (!parts.length) parts.push('Kleinere Änderungen');
  return parts.slice(0, 3).join(' · ');
}
