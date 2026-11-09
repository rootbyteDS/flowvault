/**
 * Umgebungen (Staging → Prod): HTTP-API des Moduls.
 *
 * Wird in index.ts unter /api/promote eingehängt (hinter Login & CSRF-Schutz):
 *   GET    /:sourceId/:targetId                 Drift-Übersicht + Zuordnungen
 *   GET    /:sourceId/:targetId/suggestions     Vorschläge für Zuordnungen
 *   PUT    /:sourceId/:targetId/mappings        Zuordnung anlegen/aktualisieren
 *   DELETE /:sourceId/:targetId/mappings        Zuordnung löschen (?kind=&from=)
 *   GET    /:sourceId/:targetId/diff/:wfId      Diff nach Zuordnungen (Ziel vs. Quelle)
 *   POST   /:sourceId/:targetId/promote         Workflows übernehmen
 */
import { Router } from 'express';
import { HttpError, requestT } from '../../shared/i18n/server.ts';
import { renderError } from '../../shared/i18n/index.ts';
import { db } from '../db.ts';
import { getInstance } from '../sync.ts';
import { computeDrift, type DriftResult } from './drift.ts';
import { listMappings, MAPPING_KINDS, mappingSetFor, suggestMappings, targetWorkflowFor, upsertMapping, deleteMapping, workflowLabelsFor, type MappingRow } from './mappings.ts';
import { promoteWorkflows, type PromoteItem, type PromoteOutcome } from './promote.ts';
import { transformSnapshot } from './transform.ts';
import { diffWorkflows } from '../../shared/diff.ts';
import { listPairs, savePair, pairConfigured, requirePair, workflowChoices, chooseWorkflow } from './pairs.ts';
import { buildPlan } from './plan.ts';
import { loadSnapshot } from '../sync.ts';

const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, 'errors.http.invalidId');
  return n;
};

function pair(req: { params: Record<string, string> }) {
  const sourceId = num(req.params.sourceId);
  const targetId = num(req.params.targetId);
  if (sourceId === targetId) throw new HttpError(400, 'errors.promote.sameInstance');
  const source = getInstance(sourceId);
  const target = getInstance(targetId);
  if (!source || !target) throw new HttpError(404, 'errors.instance.notFound');
  return { sourceId, targetId, source, target };
}

function instanceInfo(id: number, name: string, color: string) {
  const counts = db
    .prepare('SELECT COUNT(*) AS n FROM workflows WHERE instance_id = ? AND deleted_at IS NULL')
    .get(id) as { n: number };
  return { id, name, color, workflows: counts.n };
}

export interface PromoteOverview {
  source: ReturnType<typeof instanceInfo>;
  target: ReturnType<typeof instanceInfo>;
  configured: boolean;
  choices: ReturnType<typeof workflowChoices>;
  mappings: MappingRow[];
  drift: DriftResult;
}

function overview(sourceId: number, targetId: number): PromoteOverview {
  const source = getInstance(sourceId)!;
  const target = getInstance(targetId)!;
  return {
    source: instanceInfo(source.id, source.name, source.color),
    target: instanceInfo(target.id, target.name, target.color),
    configured: pairConfigured(sourceId, targetId),
    choices: workflowChoices(sourceId, targetId),
    mappings: listMappings(sourceId, targetId),
    drift: computeDrift(sourceId, targetId),
  };
}

export const promoteRouter = Router();

promoteRouter.get('/pairs', (_req, res) => res.json(listPairs()));
promoteRouter.put('/:sourceId/:targetId/pair', (req, res) => {
  const { sourceId, targetId } = pair(req);
  savePair(sourceId, targetId);
  res.json(overview(sourceId, targetId));
});
promoteRouter.put('/:sourceId/:targetId/workflows', (req, res) => {
  const { sourceId, targetId } = pair(req);
  const from = typeof req.body?.from === 'string' ? req.body.from : '';
  const to = req.body?.to;
  if (!from || (to !== null && (typeof to !== 'string' || !to))) throw new HttpError(400, 'errors.promote.emptyMapping');
  chooseWorkflow(sourceId, targetId, from, to);
  res.json(overview(sourceId, targetId));
});
promoteRouter.post('/:sourceId/:targetId/plan', (req, res) => {
  const { sourceId, targetId } = pair(req);
  const ids = Array.isArray(req.body?.workflowIds) ? req.body.workflowIds.map(num) : [];
  if (ids.length > 200) throw new HttpError(400, 'errors.promote.tooMany');
  res.json(buildPlan(sourceId, targetId, ids, requestT(req)));
});

promoteRouter.get('/:sourceId/:targetId', (req, res) => {
  const { sourceId, targetId } = pair(req);
  res.json(overview(sourceId, targetId));
});

promoteRouter.get('/:sourceId/:targetId/suggestions', async (req, res) => {
  const { source, target } = pair(req);
  try {
    const tr = requestT(req);
    res.json({ suggestions: await suggestMappings(source, target, tr) });
  } catch (e) {
    throw new HttpError(502, 'errors.promote.suggestionsFailed', { reason: renderError(e, requestT(req)) });
  }
});

promoteRouter.put('/:sourceId/:targetId/mappings', (req, res) => {
  const { sourceId, targetId } = pair(req);
  const body = req.body ?? {};
  const kind = String(body.kind ?? '');
  if (!MAPPING_KINDS.includes(kind as never)) throw new HttpError(400, 'errors.promote.unknownKind');
  const from = String(body.from ?? '').trim().slice(0, 500);
  const to = String(body.to ?? '').trim().slice(0, 500);
  const fromName = body.fromName ? String(body.fromName).slice(0, 300) : null;
  const toName = body.toName ? String(body.toName).slice(0, 300) : null;
  if (!from || !to) throw new HttpError(400, 'errors.promote.emptyMapping');
  if (kind === 'credential' && !toName) throw new HttpError(400, 'errors.promote.credentialNeedsName');
  requirePair(sourceId, targetId);
  if (kind === 'workflow') chooseWorkflow(sourceId, targetId, from, to);
  else upsertMapping(sourceId, targetId, { kind: kind as never, from, to, fromName, toName });
  res.json(overview(sourceId, targetId));
});

promoteRouter.delete('/:sourceId/:targetId/mappings', (req, res) => {
  const { sourceId, targetId } = pair(req);
  requirePair(sourceId, targetId);
  const kind = String(req.query.kind ?? '');
  const from = String(req.query.from ?? '');
  if (!MAPPING_KINDS.includes(kind as never) || !from) throw new HttpError(400, 'errors.promote.mappingAmbiguous');
  if (!deleteMapping(sourceId, targetId, kind, from)) throw new HttpError(404, 'errors.promote.mappingNotFound');
  res.json(overview(sourceId, targetId));
});

/** Diff zwischen Ziel-Workflow und (transformiertem) Quell-Workflow – wie eine Übernahme ihn ändern würde. */
promoteRouter.get('/:sourceId/:targetId/diff/:workflowId', (req, res) => {
  const { sourceId, targetId } = pair(req);
  const workflowId = num(req.params.workflowId);
  const src = db
    .prepare('SELECT id, n8n_id, name FROM workflows WHERE id = ? AND instance_id = ?')
    .get(workflowId, sourceId) as { id: number; n8n_id: string; name: string } | undefined;
  if (!src) throw new HttpError(404, 'errors.promote.notInSource');
  const version = db
    .prepare('SELECT id, number FROM versions WHERE workflow_id = ? ORDER BY number DESC LIMIT 1')
    .get(workflowId) as { id: number; number: number } | undefined;
  if (!version) throw new HttpError(404, 'errors.promote.noVersion');
  const snap = loadSnapshot(version.id)!;

  const match = targetWorkflowFor(sourceId, targetId, src.n8n_id, src.name);
  let targetSnap = null;
  if (match) {
    const t = db
      .prepare('SELECT id FROM versions WHERE workflow_id = ? ORDER BY number DESC LIMIT 1')
      .get(match.row.id) as { id: number } | undefined;
    if (t) targetSnap = loadSnapshot(t.id) ?? null;
  }

  const transformed = transformSnapshot(snap, mappingSetFor(sourceId, targetId), { workflowNames: workflowLabelsFor(sourceId, targetId) });
  res.json({
    version: version.number,
    sourceName: src.name,
    targetFound: !!targetSnap,
    applied: transformed.applied,
    from: targetSnap,
    to: transformed.snapshot,
    diff: diffWorkflows(targetSnap, transformed.snapshot),
  });
});

promoteRouter.post('/:sourceId/:targetId/promote', async (req, res) => {
  const { sourceId, targetId } = pair(req);
  const raw = Array.isArray(req.body?.workflowIds) ? req.body.workflowIds : [];
  const items: PromoteItem[] = raw
    .map((v: unknown) => num(v))
    .filter((n: number) => Number.isInteger(n))
    .map((workflowId: number) => ({ workflowId }));
  if (!items.length) throw new HttpError(400, 'errors.promote.noWorkflows');
  if (items.length > 200) throw new HttpError(400, 'errors.promote.tooMany');
  const results: PromoteOutcome[] = await promoteWorkflows(sourceId, targetId, items, requestT(req), String(req.body?.fingerprint ?? ''));
  res.json({ results, overview: overview(sourceId, targetId) });
});
