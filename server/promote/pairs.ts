/** Persistente, gerichtete Instanzpaare und ausdrückliche Entscheidungen zum Neuanlegen. */
import { db, tx } from '../db.ts';
import { HttpError } from '../../shared/i18n/server.ts';
import { listMappings, setWorkflowMapping, targetWorkflowFor } from './mappings.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS env_pairs (
    source_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(source_id, target_id), CHECK(source_id <> target_id)
  );
  CREATE TABLE IF NOT EXISTS env_workflow_creates (
    source_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    from_value TEXT NOT NULL,
    PRIMARY KEY(source_id, target_id, from_value)
  );
`);

export function listPairs() {
  return db.prepare(`SELECT p.source_id AS sourceId, p.target_id AS targetId,
    s.name AS sourceName, t.name AS targetName FROM env_pairs p
    JOIN instances s ON s.id=p.source_id JOIN instances t ON t.id=p.target_id ORDER BY p.created_at, p.source_id, p.target_id`).all();
}
export function pairConfigured(sourceId: number, targetId: number): boolean {
  return !!db.prepare('SELECT 1 FROM env_pairs WHERE source_id=? AND target_id=?').get(sourceId, targetId);
}
export function requirePair(sourceId: number, targetId: number) {
  if (!pairConfigured(sourceId, targetId)) throw new HttpError(409, 'errors.promote.pairRequired');
}
export function savePair(sourceId: number, targetId: number) {
  if (sourceId === targetId) throw new HttpError(400, 'errors.promote.sameInstance');
  for (const id of [sourceId, targetId]) {
    if (!db.prepare('SELECT id FROM instances WHERE id=?').get(id)) throw new HttpError(404, 'errors.instance.notFound');
  }
  db.prepare('INSERT OR IGNORE INTO env_pairs VALUES (?,?,?)').run(sourceId, targetId, Date.now());
}
export function wantsCreate(sourceId: number, targetId: number, from: string): boolean {
  return !!db.prepare('SELECT 1 FROM env_workflow_creates WHERE source_id=? AND target_id=? AND from_value=?').get(sourceId, targetId, from);
}
export function workflowChoices(sourceId: number, targetId: number) {
  const source = db.prepare('SELECT id, n8n_id AS n8nId, name FROM workflows WHERE instance_id=? AND deleted_at IS NULL ORDER BY name, id').all(sourceId) as { id: number; n8nId: string; name: string }[];
  const targets = db.prepare('SELECT n8n_id AS n8nId, name FROM workflows WHERE instance_id=? AND deleted_at IS NULL ORDER BY name, id').all(targetId) as { n8nId: string; name: string }[];
  const mappings = listMappings(sourceId, targetId);
  return { targets, sources: source.map((s) => {
    const mapping = mappings.find((m) => m.kind === 'workflow' && m.from === s.n8nId);
    const candidates = targets.filter((t) => t.n8nId === s.n8nId || t.name === s.name);
    return { ...s, decision: mapping ? 'existing' : wantsCreate(sourceId, targetId, s.n8nId) ? 'create' : null,
      targetId: mapping?.to ?? null, valid: mapping ? !!targetWorkflowFor(sourceId, targetId, s.n8nId, s.name) : true,
      suggestion: candidates.length === 1 ? candidates[0]!.n8nId : null };
  }) };
}
export function chooseWorkflow(sourceId: number, targetId: number, from: string, to: string | null) {
  requirePair(sourceId, targetId);
  const src = db.prepare('SELECT name FROM workflows WHERE instance_id=? AND n8n_id=? AND deleted_at IS NULL').get(sourceId, from) as { name: string } | undefined;
  if (!src) throw new HttpError(404, 'errors.promote.notInSource');
  const target = to === null ? null : db.prepare('SELECT name FROM workflows WHERE instance_id=? AND n8n_id=? AND deleted_at IS NULL').get(targetId, to) as { name: string } | undefined;
  if (to !== null && !target) throw new HttpError(409, 'errors.promote.targetMissing');
  const duplicate = to !== null && listMappings(sourceId, targetId).some((m) => m.kind === 'workflow' && m.to === to && m.from !== from);
  if (duplicate) throw new HttpError(409, 'errors.promote.targetUsed');
  tx(() => {
    db.prepare("DELETE FROM env_mappings WHERE source_id=? AND target_id=? AND kind='workflow' AND from_value=?").run(sourceId, targetId, from);
    db.prepare('DELETE FROM env_workflow_creates WHERE source_id=? AND target_id=? AND from_value=?').run(sourceId, targetId, from);
    if (to === null) db.prepare('INSERT INTO env_workflow_creates VALUES (?,?,?)').run(sourceId, targetId, from);
    else setWorkflowMapping(sourceId, targetId, from, src.name, to, target!.name);
  });
}
