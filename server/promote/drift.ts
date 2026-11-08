/**
 * Umgebungen (Staging → Prod): Drift-Ansicht – was weicht zwischen zwei Instanzen
 * ab, und in welche Richtung? Maßgeblich ist immer der Stand NACH Anwendung der
 * gespeicherten Zuordnungen: „weicht ab“ heißt, eine Übernahme würde etwas ändern.
 */
import { diffWorkflows, type ChangeSummary } from '../../shared/diff.ts';
import { latestWorkflows, mappingSetFor, targetWorkflowFor, workflowLabelsFor, type LatestWorkflow } from './mappings.ts';
import { transformSnapshot } from './transform.ts';

export interface DriftSide {
  workflowId: number;
  versionId: number;
  versionNumber: number;
  name: string;
  active: boolean;
  lastChangeAt: number;
}

export interface DriftRow {
  source: DriftSide | null;
  target: DriftSide | null;
  matchedBy: 'mapping' | 'id' | 'name' | null;
  status: 'in-sync' | 'drifted' | 'only-source' | 'only-target';
  /** Welche Seite die neuere Änderung hat – nur bei „drifted“ gesetzt */
  ahead: 'source' | 'target' | null;
  /** Änderungen, die eine Übernahme auf dem Ziel bewirken würde (nur bei „drifted“) */
  summary: ChangeSummary | null;
  /** Aktiv-Status weicht ab – läßt sich per Übernahme nicht ändern (n8n-API) */
  activeDiffers: boolean;
  /** Referenzen ohne Zuordnung – vor der Übernahme klären */
  missing: string[];
}

export interface DriftResult {
  rows: DriftRow[];
  counts: { inSync: number; drifted: number; onlySource: number; onlyTarget: number };
}

const side = (w: LatestWorkflow): DriftSide => ({
  workflowId: w.row.id,
  versionId: w.versionId,
  versionNumber: w.versionNumber,
  name: w.row.name,
  active: !!w.row.active,
  lastChangeAt: w.row.last_change_at,
});

/** True, wenn der Diff echte Unterschiede zeigt (Aktiv-Status zählt nicht – siehe activeDiffers). */
function relevantChanges(s: ChangeSummary): boolean {
  return !!(
    s.added.length ||
    s.removed.length ||
    s.modified.length ||
    s.renamed.length ||
    s.moved.length ||
    s.connectionsAdded ||
    s.connectionsRemoved ||
    s.settingsChanged ||
    s.tagsChanged ||
    s.pinDataChanged ||
    s.nameChanged
  );
}

export function computeDrift(sourceId: number, targetId: number): DriftResult {
  const sourceWfs = latestWorkflows(sourceId);
  const targetWfs = latestWorkflows(targetId);
  const targetById = new Map(targetWfs.map((w) => [w.row.n8n_id, w]));
  const mappings = mappingSetFor(sourceId, targetId);
  const names = workflowLabelsFor(sourceId, targetId);

  const rows: DriftRow[] = [];
  const usedTargets = new Set<number>();

  for (const src of sourceWfs) {
    const match = targetWorkflowFor(sourceId, targetId, src.row.n8n_id, src.row.name);
    const tgt = match ? targetById.get(match.row.n8n_id) : undefined;
    if (tgt) usedTargets.add(tgt.row.id);

    const transformed = transformSnapshot(src.snap, mappings, { workflowNames: names });

    if (!tgt) {
      rows.push({
        source: side(src),
        target: null,
        matchedBy: null,
        status: 'only-source',
        ahead: 'source',
        summary: null,
        activeDiffers: false,
        missing: transformed.missing,
      });
      continue;
    }

    const diff = diffWorkflows(tgt.snap, transformed.snapshot);
    const drifted = relevantChanges(diff.summary);
    const ahead = src.row.last_change_at === tgt.row.last_change_at ? 'source' : src.row.last_change_at > tgt.row.last_change_at ? 'source' : 'target';
    rows.push({
      source: side(src),
      target: side(tgt),
      matchedBy: match!.matchedBy,
      status: drifted ? 'drifted' : 'in-sync',
      ahead: drifted ? ahead : null,
      summary: drifted ? diff.summary : null,
      activeDiffers: diff.summary.activeChanged !== undefined,
      // Bei „aktuell“ keine Warnungen: Unzugeordnetes, das trotzdem passt (gleiche IDs
      // auf beiden Instanzen), braucht keine Aktion.
      missing: drifted ? transformed.missing : [],
    });
  }

  for (const tgt of targetWfs) {
    if (usedTargets.has(tgt.row.id)) continue;
    rows.push({
      source: null,
      target: side(tgt),
      matchedBy: null,
      status: 'only-target',
      ahead: 'target',
      summary: null,
      activeDiffers: false,
      missing: [],
    });
  }

  const order: Record<DriftRow['status'], number> = { drifted: 0, 'only-source': 1, 'only-target': 2, 'in-sync': 3 };
  rows.sort((a, b) => {
    const d = order[a.status] - order[b.status];
    if (d) return d;
    const ta = (a.source ?? a.target)!.lastChangeAt;
    const tb = (b.source ?? b.target)!.lastChangeAt;
    return tb - ta;
  });

  return {
    rows,
    counts: {
      inSync: rows.filter((r) => r.status === 'in-sync').length,
      drifted: rows.filter((r) => r.status === 'drifted').length,
      onlySource: rows.filter((r) => r.status === 'only-source').length,
      onlyTarget: rows.filter((r) => r.status === 'only-target').length,
    },
  };
}
