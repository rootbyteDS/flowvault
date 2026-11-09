/**
 * Umgebungen (Staging → Prod): Ersetzt instanzspezifische IDs in einem gesicherten
 * Workflow-Snapshot anhand gespeicherter Zuordnungen (siehe mappings.ts).
 *
 * Rein funktional – kein I/O, kein Datenbankzugriff – und deshalb direkt testbar
 * (transform.test.ts). Die Zuordnungen selbst liefert mappings.ts als MappingSet.
 */
import type { Snapshot } from '../../shared/diff.ts';
import { packMessage } from '../../shared/i18n/index.ts';

export type MappingKind = 'credential' | 'workflow' | 'webhookPath' | 'dataTable';

/** n8n speichert Credentials im Node als { id, name } – beides muss zur Ziel-Instanz passen. */
export interface CredentialTarget {
  id: string;
  name: string;
}

export interface MappingSet {
  /** Quell-Credential-ID → Ziel { id, name } */
  credentials: Map<string, CredentialTarget>;
  /** Quell-Workflow-ID → Ziel-Workflow-ID (Execute Workflow, Error-Workflow) */
  workflows: Map<string, string>;
  /** Webhook-Pfad Quelle → Ziel */
  webhookPaths: Map<string, string>;
  /** Data-Table-ID/-Name Quelle → Ziel */
  dataTables: Map<string, string>;
}

export interface TransformResult {
  snapshot: Snapshot;
  /** Was ersetzt wurde – als übersetzbare Meldungen (`i18n:…`), die Oberfläche macht Text daraus */
  applied: string[];
  /** Welche Referenzen ohne Zuordnung blieben – ebenfalls übersetzbar */
  missing: string[];
}

export function emptyMappingSet(): MappingSet {
  return { credentials: new Map(), workflows: new Map(), webhookPaths: new Map(), dataTables: new Map() };
}

/** Nur echte Werte – Ausdrücke („={{ … }}“) bleiben grundsätzlich unberührt. */
const isPlainValue = (v: unknown): v is string => typeof v === 'string' && v !== '' && !v.startsWith('=');

/**
 * Ersetzt die IDs in `snap`. Das Original bleibt unverändert; das Ergebnis ist eine
 * tiefe Kopie. `workflowNames` (Quell-Instanz) macht die Meldungen lesbar, ist optional.
 */
export function transformSnapshot(
  snap: Snapshot,
  mappings: MappingSet,
  opts: { workflowNames?: Map<string, string> } = {},
): TransformResult {
  const applied = new Set<string>();
  const missing = new Set<string>();
  const wfName = (id: string) => opts.workflowNames?.get(id) ?? id;

  const next: Snapshot = structuredClone(snap);

  for (const node of next.nodes ?? []) {
    // ── Credentials: je Typ ein Eintrag { id, name } ──
    if (node.credentials && typeof node.credentials === 'object') {
      for (const [typeKey, raw] of Object.entries(node.credentials)) {
        if (!raw || typeof raw !== 'object' || typeof (raw as { id?: unknown }).id !== 'string') continue;
        const cred = raw as { id: string; name?: string };
        const to = mappings.credentials.get(cred.id);
        if (to) {
          (node.credentials as Record<string, unknown>)[typeKey] = { id: to.id, name: to.name };
          applied.add(packMessage('transform.applied.credential', { from: cred.name ?? cred.id, to: to.name }));
        } else {
          missing.add(packMessage('transform.missing.credential', { name: cred.name ?? cred.id, type: typeKey }));
        }
      }
    }

    // ── Node-Ebene: von n8n zwischengespeicherte Sub-Workflow-Referenz ──
    if (typeof node.cachedResultWorkflowId === 'string' && isPlainValue(node.cachedResultWorkflowId)) {
      const to = mappings.workflows.get(node.cachedResultWorkflowId);
      if (to) node.cachedResultWorkflowId = to;
    }

    const isExecute = /executeWorkflow/i.test(node.type ?? '');
    const isWebhook = /n8n-nodes-base\.webhook$/i.test(node.type ?? '');
    node.parameters = walkParams(node.parameters, { isExecute, isWebhook, wfName, applied, missing, mappings }) as
      | Record<string, unknown>
      | undefined;
  }

  // ── Error-Workflow in den Workflow-Settings ──
  const errorWorkflow = next.settings?.['errorWorkflow'];
  if (typeof errorWorkflow === 'string' && isPlainValue(errorWorkflow)) {
    const to = mappings.workflows.get(errorWorkflow);
    if (to) {
      next.settings = { ...(next.settings ?? {}), errorWorkflow: to };
      applied.add(packMessage('transform.applied.errorWorkflow', { from: wfName(errorWorkflow), to: wfName(to) }));
    } else {
      missing.add(packMessage('transform.missing.errorWorkflow', { name: wfName(errorWorkflow) }));
    }
  }

  return { snapshot: next, applied: [...applied].sort(), missing: [...missing].sort() };
}

interface WalkCtx {
  isExecute: boolean;
  isWebhook: boolean;
  wfName: (id: string) => string;
  applied: Set<string>;
  missing: Set<string>;
  mappings: MappingSet;
}

/**
 * Parameters rekursiv durchlaufen. Ersetzt wird nur, wenn der exakte Wert in der
 * Zuordnung steht – getippte Parameter oder Ausdrücke bleiben, wie sie sind.
 * Der Webhook-Pfad ist bewusst nur direkt am Webhook-Node gültig, nicht in
 * verschachtelten Parametern (dort bedeutet „path“ oft etwas anderes).
 */
function walkParams(value: unknown, ctx: WalkCtx & { top?: boolean }): unknown {
  if (Array.isArray(value)) return value.map((v) => walkParams(v, ctx));
  if (!value || typeof value !== 'object') return value;
  const top = ctx.top !== false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' && isPlainValue(v)) {
      const next = mapValue(k, v, top, ctx);
      out[k] = next;
      continue;
    }
    out[k] = walkParams(v, ctx);
  }
  return out;
}

function mapValue(key: string, v: string, top: boolean, ctx: WalkCtx): string {
  const { mappings, applied, missing } = ctx;

  // Sub-Workflows in Execute-Workflow-Nodes
  if (key === 'workflowId') {
    const to = mappings.workflows.get(v);
    if (to) {
      applied.add(packMessage('transform.applied.subWorkflow', { from: ctx.wfName(v), to: ctx.wfName(to) }));
      return to;
    }
    if (ctx.isExecute) missing.add(packMessage('transform.missing.subWorkflow', { name: ctx.wfName(v) }));
    return v;
  }

  // Data-Tables: dataTableId ist der n8n-Parameter; tableId ist älter/unspezifischer
  // und wird nur ersetzt, wenn dazu tatsächlich eine Zuordnung existiert.
  if (key === 'dataTableId' || key === 'tableId') {
    const to = mappings.dataTables.get(v);
    if (to) {
      if (key === 'dataTableId') applied.add(packMessage('transform.applied.dataTable', { from: v, to }));
      return to;
    }
    if (key === 'dataTableId') missing.add(packMessage('transform.missing.dataTable', { name: v }));
    return v;
  }

  // Webhook-Pfad – nur direkt am Webhook-Node. Ohne Zuordnung bleibt der Pfad
  // unverändert (Pfade dürfen auf beiden Instanzen identisch sein).
  if (key === 'path' && ctx.isWebhook && top) {
    const to = mappings.webhookPaths.get(v);
    if (to && to !== v) {
      applied.add(packMessage('transform.applied.webhookPath', { from: v, to }));
      return to;
    }
    return v;
  }

  return v;
}
