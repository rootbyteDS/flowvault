/**
 * Umgebungen (Staging → Prod): Übernimmt gesicherte Workflow-Versionen auf eine
 * andere Instanz – mit automatischer Ersetzung der IDs anhand der Zuordnungen.
 *
 * Existiert der Workflow auf dem Ziel (Zuordnung, gleiche ID oder eindeutiger Name),
 * wird er überschrieben; andernfalls neu (inaktiv) angelegt und die Workflow-Paarung
 * gemerkt, damit künftige Übernahmen denselben Workflow aktualisieren.
 */
import { db } from '../db.ts';
import { clientFor, getInstance, loadSnapshot, recordWorkflow } from '../sync.ts';
import { mappingSetFor, setWorkflowMapping, targetWorkflowFor, workflowLabelsFor } from './mappings.ts';
import { transformSnapshot } from './transform.ts';
import { LocalizedError, packMessage, renderError, type Translator } from '../../shared/i18n/index.ts';

export interface PromoteItem {
  workflowId: number;
  versionId?: number;
}

export interface PromoteOutcome {
  sourceWorkflowId: number;
  name: string;
  version: number;
  action: 'updated' | 'created';
  targetWorkflowId: number | null;
  targetN8nId: string | null;
  applied: string[];
  missing: string[];
  error: string | null;
}

function sourceInstanceRow(workflowId: number, sourceId: number) {
  const row = db
    .prepare('SELECT * FROM workflows WHERE id = ? AND instance_id = ?')
    .get(workflowId, sourceId) as { id: number; n8n_id: string; name: string; deleted_at: number | null } | undefined;
  if (!row) throw new LocalizedError({ key: 'errors.promote.notInSource' }, 404);
  return row;
}

function latestVersionId(workflowId: number) {
  return db
    .prepare('SELECT id, number FROM versions WHERE workflow_id = ? ORDER BY number DESC LIMIT 1')
    .get(workflowId) as { id: number; number: number } | undefined;
}

/** IDs der Version prüfen (gehört sie zum Workflow?). */
function versionOf(workflowId: number, versionId: number | undefined) {
  if (!versionId) return latestVersionId(workflowId);
  return db
    .prepare('SELECT id, number FROM versions WHERE id = ? AND workflow_id = ?')
    .get(versionId, workflowId) as { id: number; number: number } | undefined;
}

async function flowvaultWorkflowId(instanceId: number, n8nId: string): Promise<number | null> {
  const row = db.prepare('SELECT id FROM workflows WHERE instance_id = ? AND n8n_id = ?').get(instanceId, n8nId) as { id: number } | undefined;
  return row?.id ?? null;
}

/**
 * Übernimmt Workflows von `sourceId` nach `targetId`. Fehler einzelner Workflows
 * brechen den Batch nicht ab – sie landen als error im jeweiligen Ergebnis.
 */
export async function promoteWorkflows(sourceId: number, targetId: number, items: PromoteItem[], tr: Translator): Promise<PromoteOutcome[]> {
  const sourceInst = getInstance(sourceId);
  const targetInst = getInstance(targetId);
  if (!sourceInst || !targetInst) throw new LocalizedError({ key: 'errors.instance.notFound' }, 404);
  if (sourceId === targetId) throw new LocalizedError({ key: 'errors.promote.sameInstance' }, 400);

  const mappings = mappingSetFor(sourceId, targetId);
  const names = workflowLabelsFor(sourceId, targetId);
  const client = clientFor(targetInst);
  const out: PromoteOutcome[] = [];

  for (const item of items) {
    const base: Omit<PromoteOutcome, 'action' | 'applied' | 'missing' | 'error' | 'targetWorkflowId' | 'targetN8nId'> = {
      sourceWorkflowId: item.workflowId,
      name: '',
      version: 0,
    };
    try {
      const src = sourceInstanceRow(item.workflowId, sourceId);
      const v = versionOf(item.workflowId, item.versionId);
      if (!v) throw new LocalizedError({ key: 'errors.promote.noVersionForWorkflow' }, 404);
      const snap = loadSnapshot(v.id)!;
      base.name = src.name;
      base.version = v.number;

      const transformed = transformSnapshot(snap, mappings, { workflowNames: names });
      const match = targetWorkflowFor(sourceId, targetId, src.n8n_id, src.name);
      const message = packMessage('versionMessage.promoted', { name: src.name, version: v.number, instance: sourceInst.name });

      if (match) {
        await client.updateWorkflow(match.row.n8n_id, transformed.snapshot);
        const fresh = await client.getWorkflow(match.row.n8n_id);
        recordWorkflow(targetInst, fresh, { message, event: 'promoted' });
        // Paarung merken: dann trifft die nächste Übernahme das Ziel auch nach Umbenennung.
        if (!mappings.workflows.has(src.n8n_id)) {
          setWorkflowMapping(sourceId, targetId, src.n8n_id, src.name, match.row.n8n_id, match.row.name);
          mappings.workflows.set(src.n8n_id, match.row.n8n_id);
        }
        out.push({
          ...base,
          action: 'updated',
          targetWorkflowId: await flowvaultWorkflowId(targetId, match.row.n8n_id),
          targetN8nId: match.row.n8n_id,
          applied: transformed.applied,
          missing: transformed.missing,
          error: null,
        });
      } else {
        const created = await client.createWorkflow({ ...transformed.snapshot, name: transformed.snapshot.name });
        const fresh = await client.getWorkflow(String(created.id));
        recordWorkflow(targetInst, fresh, { message, event: 'promoted' });
        setWorkflowMapping(sourceId, targetId, src.n8n_id, src.name, String(created.id), fresh.name);
        out.push({
          ...base,
          action: 'created',
          targetWorkflowId: await flowvaultWorkflowId(targetId, String(created.id)),
          targetN8nId: String(created.id),
          applied: transformed.applied,
          missing: transformed.missing,
          error: null,
        });
      }
    } catch (e) {
      out.push({ ...base, action: 'updated', targetWorkflowId: null, targetN8nId: null, applied: [], missing: [], error: renderError(e, tr) });
    }
  }
  return out;
}
