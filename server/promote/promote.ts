/**
 * Umgebungen (Staging → Prod): Übernimmt gesicherte Workflow-Versionen auf eine
 * andere Instanz – mit automatischer Ersetzung der IDs anhand der Zuordnungen.
 *
 * Geschrieben wird ausschließlich nach bestätigter Paarung oder Neuanlage,
 * mit einer aktuellen, blockerfreien Übernahmeplanung.
 */
import { db } from '../db.ts';
import { clientFor, getInstance, loadSnapshot, recordWorkflow, hashSnapshot, toSnapshot } from '../sync.ts';
import { mappingSetFor, setWorkflowMapping, workflowLabelsFor } from './mappings.ts';
import { transformSnapshot } from './transform.ts';
import { packMessage, renderMessage, renderError, type Translator } from '../../shared/i18n/index.ts';

import { requirePair } from './pairs.ts';
import { buildPlan } from './plan.ts';
import { HttpError } from '../../shared/i18n/server.ts';
import { stableStringify } from '../../shared/diff.ts';
import { N8nClient } from '../n8n.ts';

export interface PromoteItem {
  workflowId: number;
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

/** Target-level serialization prevents simultaneous promotions from using stale plans. */
const runningTargets = new Set<number>();

export async function promoteWorkflows(sourceId: number, targetId: number, items: PromoteItem[], tr: Translator, fingerprint: string): Promise<PromoteOutcome[]> {
  requirePair(sourceId, targetId);
  if (runningTargets.has(targetId)) throw new HttpError(409, 'errors.promote.busy');
  runningTargets.add(targetId);
  try {
    const ids = items.map((i) => i.workflowId);
    const plan = buildPlan(sourceId, targetId, ids, tr);
    if (plan.blockers.length) throw new HttpError(409, { raw: plan.blockers.map((m) => renderMessage(m, tr)).join(' · ') });
    if (!fingerprint || fingerprint !== plan.fingerprint) throw new HttpError(409, 'errors.promote.stalePlan');
    const sourceInst = getInstance(sourceId)!;
    const targetInst = getInstance(targetId)!;
    const client = clientFor(targetInst);
    // Read and back up every existing target before the first remote write.
    for (const item of plan.items) {
      if (!item.targetId) continue;
      const fresh = await client.getWorkflow(item.targetId);
      const previous = loadSnapshot(item.targetVersionId!)!;
      recordWorkflow(targetInst, fresh);
      if (hashSnapshot(toSnapshot(fresh)) !== hashSnapshot(previous)) throw new HttpError(409, 'errors.promote.stalePlan');
    }
    if (buildPlan(sourceId, targetId, ids, tr).fingerprint !== fingerprint) throw new HttpError(409, 'errors.promote.stalePlan');
    const mappings = mappingSetFor(sourceId, targetId);
    const names = workflowLabelsFor(sourceId, targetId);
    const out: PromoteOutcome[] = [];
    let failed = false;
    for (const item of plan.items) {
      const result: PromoteOutcome = { sourceWorkflowId: item.workflowId, name: item.name, version: item.version,
        action: item.action, targetWorkflowId: null, targetN8nId: item.targetId, applied: [], missing: [], error: null };
      try {
        if (failed) throw new HttpError(409, 'errors.promote.batchStopped');
        const transformed = transformSnapshot(loadSnapshot(item.versionId)!, mappings, { workflowNames: names });
        if (transformed.missing.length) throw new HttpError(409, { raw: transformed.missing.map((m) => renderMessage(m, tr)).join(' · ') });
        result.applied = transformed.applied;
        const message = packMessage('versionMessage.promoted', { name: item.name, version: item.version, instance: sourceInst.name });
        let targetId = item.targetId;
        if (targetId) await client.updateWorkflow(targetId, transformed.snapshot);
        else {
          const created = await client.createWorkflow(transformed.snapshot);
          targetId = String(created.id);
          result.targetN8nId = targetId;
          // Persist the allocated ID immediately: retries must not create duplicates.
          recordWorkflow(targetInst, created, { message, event: 'promoted' });
          setWorkflowMapping(sourceId, targetInst.id, item.n8nId, item.name, targetId, created.name);
          db.prepare('DELETE FROM env_workflow_creates WHERE source_id=? AND target_id=? AND from_value=?').run(sourceId, targetInst.id, item.n8nId);
        }
        const fresh = await client.getWorkflow(targetId);
        recordWorkflow(targetInst, fresh, { message, event: 'promoted' });
        result.targetN8nId = targetId;
        result.targetWorkflowId = (db.prepare('SELECT id FROM workflows WHERE instance_id=? AND n8n_id=?').get(targetInst.id, targetId) as { id: number }).id;
        if (stableStringify(N8nClient.writableBody(fresh)) !== stableStringify(N8nClient.writableBody(transformed.snapshot))) {
          throw new HttpError(502, 'errors.promote.verificationFailed');
        }
        mappings.workflows.set(item.n8nId, targetId);
      } catch (e) {
        failed = true;
        result.error = renderError(e, tr);
      }
      out.push(result);
    }
    return out;
  } finally { runningTargets.delete(targetId); }
}
