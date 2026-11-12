/**
 * Fehlläufe für den MCP-Dienst: gruppiert nach Workflow, Node und Meldung, dazu Summen je Instanz.
 * Nur lesend. Meldungen kommen ungeschwärzt heraus – geschwärzt wird im MCP-Dienst, bevor sie einen
 * Agent erreichen (shared/redact.ts). Der Core reicht diese Endpunkte nur an den MCP-Dienst durch.
 */
import { Router, type Request } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { ExecStatus, HealthSettings } from '../../shared/executions.ts';
import { HttpError } from '../../shared/i18n/server.ts';

const HOUR = 3600_000;

export interface FailureRow {
  instanceId: number;
  workflowN8nId: string;
  node: string | null;
  message: string | null;
  count: number;
  firstAt: number;
  lastAt: number;
}

export interface FailureList {
  groups: FailureRow[];
  /** Letzter abgeschlossener Lauf je Workflow, der in `groups` vorkommt */
  lastRuns: { instanceId: number; workflowN8nId: string; status: ExecStatus }[];
  truncated: boolean;
}

export interface RunSummary {
  instanceId: number;
  runs: number;
  failed: number;
}

/** Filter auf Instanzen; leere Liste = alle. */
function instanceFilter(instances: number[]) {
  return instances.length ? { sql: ` AND instance_id IN (${instances.map(() => '?').join(',')})`, params: instances } : { sql: '', params: [] };
}

export function recentFailures(
  db: DatabaseSync, settings: HealthSettings, q: { hours: number; limit: number; instances: number[] }, now = Date.now(),
): FailureList {
  const manual = settings.includeManual ? '' : " AND mode != 'manual'";
  const f = instanceFilter(q.instances);
  const rows = db.prepare(`
    SELECT instance_id AS instanceId, workflow_n8n_id AS workflowN8nId, error_node AS node, error_message AS message,
           COUNT(*) AS count, MIN(started_at) AS firstAt, MAX(started_at) AS lastAt
      FROM executions
     WHERE status IN ('error', 'crashed') AND started_at >= ?${manual}${f.sql}
     GROUP BY instance_id, workflow_n8n_id, error_node, error_message
     ORDER BY lastAt DESC LIMIT ?`).all(now - q.hours * HOUR, ...f.params, q.limit + 1) as unknown as FailureRow[];
  const truncated = rows.length > q.limit;
  const groups = rows.slice(0, q.limit).map((r) => ({ ...r }));

  const last = db.prepare(`
    SELECT status FROM executions
     WHERE instance_id = ? AND workflow_n8n_id = ? AND status IN ('success', 'error', 'crashed', 'canceled')${manual}
     ORDER BY started_at DESC LIMIT 1`);
  const seen = new Map<string, FailureList['lastRuns'][number]>();
  for (const g of groups) {
    const key = `${g.instanceId}/${g.workflowN8nId}`;
    if (seen.has(key)) continue;
    const row = last.get(g.instanceId, g.workflowN8nId) as { status: ExecStatus } | undefined;
    if (row) seen.set(key, { instanceId: g.instanceId, workflowN8nId: g.workflowN8nId, status: row.status });
  }
  return { groups, lastRuns: [...seen.values()], truncated };
}

export function runSummary(db: DatabaseSync, settings: HealthSettings, q: { hours: number; instances: number[] }, now = Date.now()): RunSummary[] {
  const manual = settings.includeManual ? '' : " AND mode != 'manual'";
  const f = instanceFilter(q.instances);
  return (db.prepare(`
    SELECT instance_id AS instanceId, COUNT(*) AS runs, SUM(status IN ('error', 'crashed')) AS failed
      FROM executions
     WHERE status IN ('success', 'error', 'crashed', 'canceled') AND started_at >= ?${manual}${f.sql}
     GROUP BY instance_id ORDER BY instance_id`).all(now - q.hours * HOUR, ...f.params) as unknown as RunSummary[]).map((r) => ({ ...r }));
}

function int(v: unknown, def: number, min: number, max: number) {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, 'errors.http.invalidNumber');
  return Math.max(min, Math.min(max, n));
}

function instancesParam(req: Request): number[] {
  const raw = req.query.instances;
  if (raw === undefined || raw === '') return [];
  if (typeof raw !== 'string' || !/^[1-9]\d*(,[1-9]\d*)*$/.test(raw)) throw new HttpError(400, 'errors.http.invalidId');
  return raw.split(',').map(Number).slice(0, 200);
}

export function createFailuresRouter(db: DatabaseSync, settings: () => HealthSettings) {
  const router = Router();
  router.get('/executions/failures', (req, res) => {
    res.json(recentFailures(db, settings(), {
      hours: int(req.query.hours, 24, 1, 720),
      limit: int(req.query.limit, 50, 1, 200),
      instances: instancesParam(req),
    }));
  });
  router.get('/executions/summary', (req, res) => {
    res.json(runSummary(db, settings(), { hours: int(req.query.hours, 24, 1, 720), instances: instancesParam(req) }));
  });
  return router;
}
