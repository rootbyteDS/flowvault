/** Verbindet gespeicherte Ausführungen mit der Versionshistorie aus dem Core und pflegt die Warnungen. */
import { db, getSettings } from './db.ts';
import { core, type WorkflowTimeline } from './core.ts';
import { analyze, type Exec } from './analysis.ts';
import type { FailingNode, HealthAlert, WorkflowHealth } from '../../shared/executions.ts';

function loadExecs(instanceId: number, n8nId: string): Exec[] {
  const rows = db
    .prepare(
      `SELECT status, mode, started_at, workflow_version_id, error_node, error_message FROM executions
        WHERE instance_id = ? AND workflow_n8n_id = ? AND started_at IS NOT NULL`,
    )
    .all(instanceId, n8nId) as {
    status: string;
    mode: string;
    started_at: number;
    workflow_version_id: string | null;
    error_node: string | null;
    error_message: string | null;
  }[];
  return rows.map((r) => ({
    status: r.status,
    mode: r.mode,
    startedAt: r.started_at,
    workflowVersionId: r.workflow_version_id,
    errorNode: r.error_node,
    errorMessage: r.error_message,
  }));
}

interface AlertRow {
  id: number;
  workflow_id: number;
  workflow_name: string;
  instance_id: number;
  instance_name: string;
  version_id: number;
  version_number: number;
  rate: number;
  total: number;
  failed: number;
  baseline_rate: number;
  baseline_total: number;
  rollback_version_id: number | null;
  rollback_number: number | null;
  failing_nodes: string;
  status: HealthAlert['status'];
  created_at: number;
  updated_at: number;
}

export function toAlert(r: AlertRow): HealthAlert {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    workflowName: r.workflow_name,
    instanceId: r.instance_id,
    instanceName: r.instance_name,
    versionId: r.version_id,
    versionNumber: r.version_number,
    rate: r.rate,
    total: r.total,
    failed: r.failed,
    baselineRate: r.baseline_rate,
    baselineTotal: r.baseline_total,
    rollbackVersionId: r.rollback_version_id,
    rollbackNumber: r.rollback_number,
    failingNodes: JSON.parse(r.failing_nodes) as FailingNode[],
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Bewertet einen Workflow und hält seine Warnung aktuell:
 * - aktuelle Version mit gestiegener Fehlerquote → Warnung anlegen bzw. Zahlen aktualisieren
 * - Warnungen für ältere Versionen (z. B. nach Rollback) oder ohne Anstieg → erledigt
 * Eine vom Nutzer ausgeblendete Warnung bleibt ausgeblendet.
 */
export function evaluateWorkflow(t: WorkflowTimeline, instanceName: string) {
  const s = getSettings();
  const result = analyze(t.versions, loadExecs(t.instanceId, t.n8nId), s);
  const latest = result.versions[0];
  const now = Date.now();

  if (latest && latest.regression && s.alerts && !t.deleted) {
    db.prepare(
      `INSERT INTO alerts (workflow_id, workflow_name, instance_id, instance_name, version_id, version_number, rate, total, failed,
                           baseline_rate, baseline_total, rollback_version_id, rollback_number, failing_nodes, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)
       ON CONFLICT (workflow_id, version_id) DO UPDATE SET
         workflow_name = excluded.workflow_name, instance_name = excluded.instance_name,
         rate = excluded.rate, total = excluded.total, failed = excluded.failed,
         baseline_rate = excluded.baseline_rate, baseline_total = excluded.baseline_total,
         rollback_version_id = excluded.rollback_version_id, rollback_number = excluded.rollback_number,
         failing_nodes = excluded.failing_nodes, updated_at = excluded.updated_at,
         status = CASE WHEN alerts.status = 'resolved' THEN 'open' ELSE alerts.status END`,
    ).run(
      t.workflowId, t.name, t.instanceId, instanceName, latest.versionId, latest.number, latest.rate ?? 0, latest.total, latest.failed,
      latest.baseline?.rate ?? 0, latest.baseline?.total ?? 0, latest.rollback?.versionId ?? null, latest.rollback?.number ?? null,
      JSON.stringify(latest.failingNodes.slice(0, 5)), now, now,
    );
  }
  db.prepare(
    `UPDATE alerts SET status = 'resolved', updated_at = ?
      WHERE workflow_id = ? AND status = 'open' AND (version_id != ? OR ?)`,
  ).run(now, t.workflowId, latest?.versionId ?? -1, latest?.regression && s.alerts && !t.deleted ? 0 : 1);

  const alert = db.prepare("SELECT * FROM alerts WHERE workflow_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(t.workflowId) as
    | AlertRow
    | undefined;
  return { ...result, alert: alert ? toAlert(alert) : null };
}

/** Nach jedem Abruf: alle Workflows der Instanz neu bewerten, die im Betrachtungszeitraum liefen. */
export async function evaluateInstance(instanceId: number, instanceName: string) {
  const since = Date.now() - getSettings().lookbackDays * 864e5;
  const ran = new Set(
    (
      db.prepare('SELECT DISTINCT workflow_n8n_id AS id FROM executions WHERE instance_id = ? AND started_at > ?').all(instanceId, since) as {
        id: string;
      }[]
    ).map((r) => r.id),
  );
  const open = new Set(
    (db.prepare("SELECT workflow_id FROM alerts WHERE instance_id = ? AND status = 'open'").all(instanceId) as { workflow_id: number }[]).map(
      (r) => r.workflow_id,
    ),
  );
  for (const t of await core.instanceTimeline(instanceId)) {
    if (ran.has(t.n8nId) || open.has(t.workflowId)) evaluateWorkflow(t, instanceName);
  }
}

export async function workflowHealth(workflowId: number): Promise<WorkflowHealth> {
  const t = await core.workflowTimeline(workflowId);
  const r = evaluateWorkflow(t, t.instanceName);
  const st = db.prepare('SELECT last_poll_at, ok, error FROM poll_state WHERE instance_id = ?').get(t.instanceId) as
    | { last_poll_at: number | null; ok: number | null; error: string | null }
    | undefined;
  return {
    workflowId,
    available: true,
    lastPollAt: st?.last_poll_at ?? null,
    pollError: st?.ok === 0 ? st.error : null,
    versions: r.versions,
    unattributed: r.unattributed,
    alert: r.alert,
    settings: getSettings(),
  };
}

/** Offene Warnungen vor der Ausgabe neu bewerten – z. B. ist nach einem Rollback die auffällige Version nicht mehr aktuell. */
export async function refreshOpenAlerts() {
  const open = db.prepare("SELECT DISTINCT workflow_id, instance_name FROM alerts WHERE status = 'open'").all() as {
    workflow_id: number;
    instance_name: string;
  }[];
  await Promise.allSettled(
    open.map(async (a) => {
      try {
        const t = await core.workflowTimeline(a.workflow_id);
        evaluateWorkflow(t, t.instanceName);
      } catch (e) {
        // Workflow im Core gelöscht: Warnung ist gegenstandslos
        if ((e as { status?: number }).status === 404) {
          db.prepare("UPDATE alerts SET status = 'resolved', updated_at = ? WHERE workflow_id = ?").run(Date.now(), a.workflow_id);
        }
      }
    }),
  );
}

export function listAlerts(status: string) {
  const rows = (
    status === 'all'
      ? db.prepare('SELECT * FROM alerts ORDER BY updated_at DESC LIMIT 200').all()
      : db.prepare('SELECT * FROM alerts WHERE status = ? ORDER BY updated_at DESC LIMIT 200').all(status)
  ) as unknown as AlertRow[];
  return rows.map(toAlert);
}
