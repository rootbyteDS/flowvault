/**
 * Client für die interne API des Cores (server/internal.ts) mit dem MCP-Token.
 * Der Core nimmt dieses Token nur für lesende Pfade an; Health-Daten reicht er unter /internal/health/* durch.
 */
import type { ExecutionHistory, HealthAlert, HealthStatus, WorkflowHealth } from '../../shared/executions.ts';
import type { FailureList, RunSummary } from '../health/failures.ts';

export class CoreError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface CoreInstance {
  id: number;
  name: string;
  color: string;
  enabled: number;
  sync_interval: number;
  last_sync_at: number | null;
  last_sync_ok: number | null;
  last_sync_error: string | null;
}

export interface CoreWorkflow {
  id: number;
  instance_id: number;
  n8n_id: string;
  name: string;
  active: number;
  archived: number;
  deleted_at: number | null;
  node_count: number;
  version_count: number;
  last_change_at: number;
}

export interface CoreEvent {
  id: number;
  kind: string;
  detail: string | null;
  created_at: number;
  instance_id: number | null;
  instance_name: string | null;
  workflow_id: number | null;
  workflow_name: string | null;
  version_number: number | null;
}

export interface CoreTimeline {
  workflowId: number;
  instanceId: number;
  instanceName: string;
  n8nId: string;
  name: string;
  deleted: boolean;
}

const qs = (q: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.size ? `?${p}` : '';
};

export function coreClient(baseUrl: string, token: () => string) {
  const base = baseUrl.replace(/\/+$/, '');
  async function get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}/internal${path}`, {
        headers: { 'X-Internal-Token': token(), Accept: 'application/json', 'Accept-Language': 'en' },
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new CoreError('FlowVault core is not reachable', 0);
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new CoreError(typeof body.error === 'string' ? body.error : `FlowVault core answered HTTP ${res.status}`, res.status);
    return body as T;
  }

  return {
    instances: () => get<CoreInstance[]>('/instances'),
    workflows: (q: { instance?: number; q?: string; limit?: number; all?: boolean }) => get<CoreWorkflow[]>(`/workflows${qs(q)}`),
    timeline: (workflowId: number) => get<CoreTimeline>(`/workflows/${workflowId}/timeline`),
    activity: (q: { since: number; instance?: number; limit?: number }) => get<CoreEvent[]>(`/activity${qs(q)}`),
    health: {
      status: () => get<HealthStatus>('/health/status'),
      alerts: () => get<HealthAlert[]>('/health/alerts'),
      history: () => get<ExecutionHistory>('/health/executions/history'),
      summary: (q: { hours: number; instances?: string }) => get<RunSummary[]>(`/health/executions/summary${qs(q)}`),
      failures: (q: { hours: number; limit: number; instances?: string }) => get<FailureList>(`/health/executions/failures${qs(q)}`),
      workflow: (workflowId: number) => get<WorkflowHealth>(`/health/workflows/${workflowId}`),
    },
  };
}

export type CoreClient = ReturnType<typeof coreClient>;
