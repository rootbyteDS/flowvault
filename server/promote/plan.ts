/** Schreibfreie Übernahmeplanung. Abhängigkeiten werden vor ihren Aufrufern eingeplant. */
import { db } from '../db.ts';
import { sha256 } from '../crypto.ts';
import { loadSnapshot } from '../sync.ts';
import { stableStringify } from '../../shared/diff.ts';
import { listMappings, mappingSetFor, targetWorkflowFor, workflowLabelsFor } from './mappings.ts';
import { pairConfigured, wantsCreate } from './pairs.ts';
import { transformSnapshot, workflowDependencies, hasDynamicReferences } from './transform.ts';
import type { Translator } from '../../shared/i18n/index.ts';

export interface PlanItem {
  workflowId: number;
  n8nId: string;
  name: string;
  versionId: number;
  version: number;
  targetId: string | null;
  targetName: string | null;
  targetVersionId: number | null;
  action: 'created' | 'updated';
  dependency: boolean;
}
export interface PromotePlan {
  fingerprint: string;
  items: PlanItem[];
  blockers: string[];
}
export function buildPlan(sourceId: number, targetId: number, ids: number[], tr: Translator): PromotePlan {
  const blockers = new Set<string>();
  const items: PlanItem[] = [];
  const maps = mappingSetFor(sourceId, targetId);
  const names = workflowLabelsFor(sourceId, targetId);
  const selected = new Set(ids);
  const visiting = new Set<string>();
  const done = new Set<string>();
  if (!pairConfigured(sourceId, targetId)) blockers.add(tr('errors.promote.pairRequired'));
  if (!ids.length) blockers.add(tr('errors.promote.noWorkflows'));
  const latest = (id: number) => db.prepare('SELECT id, number FROM versions WHERE workflow_id=? ORDER BY number DESC LIMIT 1').get(id) as { id: number; number: number } | undefined;
  function visit(workflowId: number) {
    const src = db.prepare('SELECT n8n_id, name FROM workflows WHERE id=? AND instance_id=? AND deleted_at IS NULL').get(workflowId, sourceId) as { n8n_id: string; name: string } | undefined;
    if (!src) { blockers.add(tr('errors.promote.notInSource')); return; }
    if (done.has(src.n8n_id)) return;
    if (visiting.has(src.n8n_id)) { blockers.add(tr('errors.promote.cycle', { name: src.name })); return; }
    if (visiting.size + done.size >= 200) { blockers.add(tr('errors.promote.tooMany')); return; }
    visiting.add(src.n8n_id);
    const v = latest(workflowId);
    const snap = v && loadSnapshot(v.id);
    if (!v || !snap) { blockers.add(tr('errors.promote.noVersionForWorkflow')); visiting.delete(src.n8n_id); return; }
    const mapping = listMappings(sourceId, targetId).find((m) => m.kind === 'workflow' && m.from === src.n8n_id);
    const match = targetWorkflowFor(sourceId, targetId, src.n8n_id, src.name);
    if (mapping && listMappings(sourceId, targetId).some((m) => m.kind === 'workflow' && m.from !== src.n8n_id && m.to === mapping.to)) blockers.add(tr('errors.promote.targetUsed'));
    if (mapping && !match) blockers.add(tr('errors.promote.targetMissing') + ': ' + src.name);
    if (!mapping && !wantsCreate(sourceId, targetId, src.n8n_id)) blockers.add(tr('errors.promote.choiceRequired', { name: src.name }));
    for (const ref of workflowDependencies(snap)) {
      const refMatch = targetWorkflowFor(sourceId, targetId, ref, names.get(ref) ?? ref);
      const dep = db.prepare('SELECT id FROM workflows WHERE instance_id=? AND n8n_id=? AND deleted_at IS NULL').get(sourceId, ref) as { id: number } | undefined;
      if (refMatch) {
        if (dep && selected.has(dep.id) && !visiting.has(ref)) visit(dep.id);
        continue;
      }
      if (dep && wantsCreate(sourceId, targetId, ref)) visit(dep.id);
      else blockers.add(tr('errors.promote.dependencyMissing', { name: names.get(ref) ?? ref }));
    }
    // Already planned new dependencies get symbolic IDs during the write-free check.
    const transformed = transformSnapshot(snap, maps, { workflowNames: names });
    for (const missing of transformed.missing) blockers.add(missing);
    if (items.length >= 200) blockers.add(tr('errors.promote.tooMany'));
    const targetVersion = match && latest(match.row.id);
    if (match && !targetVersion) blockers.add(tr('errors.promote.noVersion') + ': ' + match.row.name);
    items.push({ workflowId, n8nId: src.n8n_id, name: src.name, versionId: v.id, version: v.number,
      targetId: match?.row.n8n_id ?? null, targetName: match?.row.name ?? null,
      targetVersionId: targetVersion?.id ?? null, action: match ? 'updated' : 'created', dependency: !selected.has(workflowId) });
    if (!match && wantsCreate(sourceId, targetId, src.n8n_id)) maps.workflows.set(src.n8n_id, `planned:${src.n8n_id}`);
    visiting.delete(src.n8n_id);
    done.add(src.n8n_id);
  }
  for (const id of new Set(ids)) visit(id);
  // Detect dynamic references which cannot be verified statically.
  for (const item of items) {
    const snap = loadSnapshot(item.versionId)!;
    if (hasDynamicReferences(snap)) {
      blockers.add(tr('errors.promote.dynamicReference', { name: item.name }));
    }
  }
  const choices = db.prepare('SELECT from_value FROM env_workflow_creates WHERE source_id=? AND target_id=? ORDER BY from_value').all(sourceId, targetId);
  const config = db.prepare('SELECT id, base_url, api_key_enc FROM instances WHERE id IN (?,?) ORDER BY id').all(sourceId, targetId);
  const fingerprint = sha256(stableStringify({ sourceId, targetId, ids: [...selected].sort((a,b) => a-b), items, mappings: listMappings(sourceId, targetId), choices, config }));
  return { fingerprint, items, blockers: [...blockers] };
}
