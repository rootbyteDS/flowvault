import { db, tx } from './db.ts';
import { decrypt, pack, sha256, unpack } from './crypto.ts';
import { N8nClient, type N8nWorkflow } from './n8n.ts';
import { onVersionCreated } from './ai.ts';
import { mappingSetFor, workflowLabelsFor, targetWorkflowFor } from './promote/mappings.ts';
import { requirePair } from './promote/pairs.ts';
import { transformSnapshot, hasDynamicReferences, workflowDependencies } from './promote/transform.ts';
import { diffWorkflows, hashableContent, stableStringify, type ChangeSummary, type Snapshot } from '../shared/diff.ts';
import { LocalizedError, packError, packMessage, renderError } from '../shared/i18n/index.ts';
import { t } from '../shared/i18n/server.ts';

export interface InstanceRow {
  id: number;
  name: string;
  base_url: string;
  api_key_enc: string;
  color: string;
  sync_interval: number;
  enabled: number;
  include_archived: number;
  last_sync_at: number | null;
  last_sync_ok: number | null;
  last_sync_error: string | null;
  created_at: number;
}

export interface WorkflowRow {
  id: number;
  instance_id: number;
  n8n_id: string;
  name: string;
  active: number;
  archived: number;
  node_count: number;
  tags: string;
  latest_hash: string | null;
  version_count: number;
  n8n_updated_at: string | null;
  first_seen_at: number;
  last_seen_at: number;
  last_change_at: number;
  deleted_at: number | null;
}

export function getInstance(id: number) {
  return db.prepare('SELECT * FROM instances WHERE id = ?').get(id) as InstanceRow | undefined;
}

export function clientFor(inst: InstanceRow) {
  return new N8nClient(inst.base_url, decrypt(inst.api_key_enc));
}

export function toSnapshot(wf: N8nWorkflow): Snapshot {
  return {
    n8nId: String(wf.id),
    name: wf.name,
    active: !!wf.active,
    nodes: wf.nodes ?? [],
    connections: (wf.connections ?? {}) as Snapshot['connections'],
    settings: wf.settings ?? {},
    pinData: wf.pinData && Object.keys(wf.pinData).length ? wf.pinData : null,
    staticData: wf.staticData ?? null,
    tags: (wf.tags ?? []).map((t) => t.name).sort(),
    versionId: wf.versionId,
    updatedAt: wf.updatedAt,
  };
}

export function hashSnapshot(s: Snapshot) {
  return sha256(stableStringify(hashableContent(s)));
}

export function loadSnapshot(versionId: number): Snapshot | undefined {
  const row = db.prepare('SELECT snapshot FROM versions WHERE id = ?').get(versionId) as { snapshot: Uint8Array } | undefined;
  return row ? unpack<Snapshot>(row.snapshot) : undefined;
}

function latestVersion(workflowId: number) {
  return db.prepare('SELECT id, number FROM versions WHERE workflow_id = ? ORDER BY number DESC LIMIT 1').get(workflowId) as
    | { id: number; number: number }
    | undefined;
}

/**
 * Speichert einen Workflow-Stand. Legt nur dann eine neue Version an, wenn sich
 * der relevante Inhalt geändert hat. Gibt 'created' | 'changed' | null zurück.
 */
export function recordWorkflow(
  inst: InstanceRow,
  wf: N8nWorkflow,
  opts: { restoredFrom?: number; message?: string; event?: 'restored' | 'promoted' } = {},
): 'created' | 'changed' | null {
  const now = Date.now();
  const snap = toSnapshot(wf);
  const hash = hashSnapshot(snap);
  let row = db.prepare('SELECT * FROM workflows WHERE instance_id = ? AND n8n_id = ?').get(inst.id, snap.n8nId) as WorkflowRow | undefined;

  const meta = {
    name: snap.name,
    active: snap.active ? 1 : 0,
    archived: wf.isArchived ? 1 : 0,
    node_count: snap.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length,
    tags: JSON.stringify(snap.tags),
    n8n_updated_at: snap.updatedAt ?? null,
  };

  if (row && row.latest_hash === hash) {
    db.prepare(
      `UPDATE workflows SET name=?, active=?, archived=?, node_count=?, tags=?, n8n_updated_at=?, last_seen_at=?, deleted_at=NULL WHERE id=?`,
    ).run(meta.name, meta.active, meta.archived, meta.node_count, meta.tags, meta.n8n_updated_at, now, row.id);
    return null;
  }

  let versionId = 0;
  const result = tx(() => {
    let kind: 'created' | 'changed' = 'changed';
    if (!row) {
      const r = db
        .prepare(
          `INSERT INTO workflows (instance_id, n8n_id, name, active, archived, node_count, tags, first_seen_at, last_seen_at, last_change_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(inst.id, snap.n8nId, meta.name, meta.active, meta.archived, meta.node_count, meta.tags, now, now, now);
      row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(Number(r.lastInsertRowid)) as unknown as WorkflowRow;
      kind = 'created';
    }
    const prev = latestVersion(row.id);
    const prevSnap = prev ? loadSnapshot(prev.id)! : null;
    const summary: ChangeSummary = diffWorkflows(prevSnap, snap).summary;
    if (opts.restoredFrom) summary.restoredFrom = opts.restoredFrom;
    const number = (prev?.number ?? 0) + 1;

    const v = db
      .prepare(
        `INSERT INTO versions (workflow_id, number, hash, snapshot, summary, message, n8n_version_id, n8n_updated_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(row.id, number, hash, pack(snap), JSON.stringify(summary), opts.message ?? null, snap.versionId ?? null, snap.updatedAt ?? null, now);

    db.prepare(
      `UPDATE workflows SET name=?, active=?, archived=?, node_count=?, tags=?, n8n_updated_at=?, last_seen_at=?, last_change_at=?,
         latest_hash=?, version_count=?, deleted_at=NULL WHERE id=?`,
    ).run(meta.name, meta.active, meta.archived, meta.node_count, meta.tags, meta.n8n_updated_at, now, now, hash, number, row.id);

    versionId = Number(v.lastInsertRowid);
    db.prepare('INSERT INTO events (instance_id, workflow_id, version_id, kind, created_at) VALUES (?,?,?,?,?)').run(
      inst.id,
      row.id,
      versionId,
      opts.event ?? (opts.restoredFrom ? 'restored' : kind),
      now,
    );
    return kind;
  });
  onVersionCreated(versionId, opts.restoredFrom ? 'restored' : result);
  return result;
}

const running = new Set<number>();

export function isSyncing(instanceId: number) {
  return running.has(instanceId);
}

export async function syncInstance(instanceId: number, trigger: 'manual' | 'schedule' | 'restore' = 'manual') {
  const inst = getInstance(instanceId);
  if (!inst) throw new LocalizedError({ key: 'errors.instance.notFound' }, 404);
  if (running.has(instanceId)) return { skipped: true as const };
  running.add(instanceId);

  const started = Date.now();
  const run = db.prepare('INSERT INTO sync_runs (instance_id, started_at, trigger) VALUES (?,?,?)').run(instanceId, started, trigger);
  const runId = Number(run.lastInsertRowid);
  const stats = { total: 0, created: 0, changed: 0, deleted: 0, archivedSkipped: 0 };

  try {
    const workflows = await clientFor(inst).listWorkflows();
    const seen = new Set<string>();
    const now0 = Date.now();
    for (const wf of workflows) {
      // Auch übersprungene als „gesehen“ zählen – sonst gälten sie als in n8n gelöscht
      seen.add(String(wf.id));
      if (wf.isArchived && !inst.include_archived) {
        // Keine neue Version. Schon bekannte Historie bleibt, wird nur als archiviert markiert.
        db.prepare('UPDATE workflows SET archived = 1, last_seen_at = ?, deleted_at = NULL WHERE instance_id = ? AND n8n_id = ?').run(
          now0, inst.id, String(wf.id),
        );
        stats.archivedSkipped++;
        continue;
      }
      stats.total++;
      const r = recordWorkflow(inst, wf);
      if (r === 'created') stats.created++;
      if (r === 'changed') stats.changed++;
    }

    // In n8n gelöschte Workflows markieren (Versionen bleiben erhalten!)
    const known = db.prepare('SELECT id, n8n_id FROM workflows WHERE instance_id = ? AND deleted_at IS NULL').all(instanceId) as {
      id: number;
      n8n_id: string;
    }[];
    const now = Date.now();
    for (const w of known) {
      if (!seen.has(w.n8n_id)) {
        db.prepare('UPDATE workflows SET deleted_at = ? WHERE id = ?').run(now, w.id);
        db.prepare('INSERT INTO events (instance_id, workflow_id, kind, created_at) VALUES (?,?,?,?)').run(instanceId, w.id, 'deleted', now);
        stats.deleted++;
      }
    }

    db.prepare('UPDATE sync_runs SET finished_at=?, ok=1, total=?, created=?, changed=?, deleted=? WHERE id=?').run(
      Date.now(), stats.total, stats.created, stats.changed, stats.deleted, runId,
    );
    db.prepare('UPDATE instances SET last_sync_at=?, last_sync_ok=1, last_sync_error=NULL WHERE id=?').run(Date.now(), instanceId);
    return { skipped: false as const, ...stats };
  } catch (e) {
    // Fertige Texte würden die Sprache des Servers einfrieren – gespeichert wird eine übersetzbare Meldung
    const msg = packError(e);
    db.prepare('UPDATE sync_runs SET finished_at=?, ok=0, error=? WHERE id=?').run(Date.now(), msg, runId);
    db.prepare('UPDATE instances SET last_sync_at=?, last_sync_ok=0, last_sync_error=? WHERE id=?').run(Date.now(), msg, instanceId);
    if (inst.last_sync_ok !== 0) {
      db.prepare('INSERT INTO events (instance_id, kind, detail, created_at) VALUES (?,?,?,?)').run(instanceId, 'sync_error', msg, Date.now());
    }
    throw e;
  } finally {
    running.delete(instanceId);
    db.prepare(
      'DELETE FROM sync_runs WHERE instance_id = ? AND id NOT IN (SELECT id FROM sync_runs WHERE instance_id = ? ORDER BY id DESC LIMIT 200)',
    ).run(instanceId, instanceId);
  }
}

/** Prüft jede Minute, welche Instanz fällig ist. */
export function startScheduler() {
  const tick = () => {
    const due = db
      .prepare(
        `SELECT id FROM instances WHERE enabled = 1 AND sync_interval > 0
           AND (last_sync_at IS NULL OR last_sync_at + sync_interval * 60000 <= ?)`,
      )
      .all(Date.now()) as { id: number }[];
    for (const { id } of due) {
      syncInstance(id, 'schedule').catch((e) => console.warn(t('log.syncInstance', { id, reason: renderError(e, t) })));
    }
  };
  setTimeout(tick, 3_000);
  return setInterval(tick, 60_000);
}

/** Version zurück nach n8n schreiben – überschreiben oder als Kopie (auch auf anderer Instanz). */
export async function restoreVersion(
  versionId: number,
  opts: { mode: 'overwrite' | 'copy'; targetInstanceId?: number; name?: string },
) {
  const v = db
    .prepare(
      `SELECT v.id, v.number, w.instance_id, w.n8n_id, w.deleted_at FROM versions v JOIN workflows w ON w.id = v.workflow_id WHERE v.id = ?`,
    )
    .get(versionId) as { id: number; number: number; instance_id: number; n8n_id: string; deleted_at: number | null } | undefined;
  if (!v) throw new LocalizedError({ key: 'errors.version.notFound' }, 404);
  const snap = loadSnapshot(versionId)!;

  if (opts.mode === 'overwrite') {
    const inst = getInstance(v.instance_id)!;
    const client = clientFor(inst);
    if (v.deleted_at) throw new LocalizedError({ key: 'errors.restore.workflowGone' }, 409);
    await client.updateWorkflow(v.n8n_id, snap);
    const fresh = await client.getWorkflow(v.n8n_id);
    recordWorkflow(inst, fresh, { restoredFrom: v.number });
    return { instanceId: inst.id, n8nId: v.n8n_id };
  }

  const inst = getInstance(opts.targetInstanceId ?? v.instance_id);
  if (!inst) throw new LocalizedError({ key: 'errors.restore.targetNotFound' }, 404);
  const client = clientFor(inst);

  // Auf eine andere Instanz: gespeicherte Zuordnungen anwenden (Umgebungen-Modul)
  let snapOut = snap;
  let mapped = 0;
  if (inst.id !== v.instance_id) {
    requirePair(v.instance_id, inst.id);
    if (hasDynamicReferences(snap)) throw new LocalizedError({ key: 'errors.promote.dynamicReference', params: { name: snap.name } }, 409);
    for (const ref of workflowDependencies(snap)) {
      if (!targetWorkflowFor(v.instance_id, inst.id, ref, ref)) throw new LocalizedError({ key: 'errors.promote.dependencyMissing', params: { name: ref } }, 409);
    }
    const r = transformSnapshot(snap, mappingSetFor(v.instance_id, inst.id), { workflowNames: workflowLabelsFor(v.instance_id, inst.id) });
    if (r.missing.length) throw new LocalizedError({ key: 'errors.promote.choiceRequired', params: { name: snap.name } }, 409);
    snapOut = r.snapshot;
    mapped = r.applied.length;
  }

  const created = await client.createWorkflow({ ...snapOut, name: opts.name?.trim() || `${snap.name} (v${v.number})` });
  const fresh = await client.getWorkflow(String(created.id));
  recordWorkflow(inst, fresh, { message: packMessage('versionMessage.copied', { name: snap.name, version: v.number }) });
  return { instanceId: inst.id, n8nId: String(created.id), mapped };
}
