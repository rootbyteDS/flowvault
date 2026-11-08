/** Client für die interne API des Cores (server/internal.ts). */
import fs from 'node:fs';
import path from 'node:path';
import type { ExecutionPage } from '../../shared/executions.ts';
import type { TimelineVersion } from './analysis.ts';

export const CORE_URL = (process.env.CORE_URL ?? `http://127.0.0.1:${process.env.CORE_PORT ?? 4000}`).replace(/\/+$/, '');

/**
 * Gemeinsames Token mit dem Core: INTERNAL_TOKEN oder – lokal – die Datei, die der Core
 * in seinem DATA_DIR anlegt. Wird bei jedem Aufruf gelesen, damit der Dienst auch dann
 * funktioniert, wenn er vor dem Core gestartet wurde.
 */
function token(): string {
  if (process.env.INTERNAL_TOKEN) return process.env.INTERNAL_TOKEN;
  const file = path.join(path.resolve(process.env.CORE_DATA_DIR ?? process.env.DATA_DIR ?? 'data'), 'internal.token');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    throw new CoreError('Kein INTERNAL_TOKEN gesetzt und keine internal.token-Datei vom Core gefunden', 0);
  }
}

export function internalToken() {
  return token();
}

export class CoreError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function get<T>(p: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${CORE_URL}/internal${p}`, {
      headers: { 'X-Internal-Token': token(), Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    if (e instanceof CoreError) throw e;
    throw new CoreError(`Core nicht erreichbar (${CORE_URL})`, 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new CoreError(body.error ?? `Core antwortet mit HTTP ${res.status}`, res.status);
  return body as T;
}

export interface CoreInstance {
  id: number;
  name: string;
  enabled: number;
}

export interface WorkflowTimeline {
  workflowId: number;
  instanceId: number;
  n8nId: string;
  name: string;
  deleted: boolean;
  versions: TimelineVersion[];
}

export const core = {
  instances: () => get<CoreInstance[]>('/instances'),
  executions: (instanceId: number, q: { cursor?: string; limit?: number; status?: string; includeData?: boolean }) => {
    const qs = new URLSearchParams();
    if (q.cursor) qs.set('cursor', q.cursor);
    if (q.limit) qs.set('limit', String(q.limit));
    if (q.status) qs.set('status', q.status);
    if (q.includeData) qs.set('includeData', 'true');
    return get<ExecutionPage>(`/instances/${instanceId}/executions?${qs}`);
  },
  instanceTimeline: (instanceId: number) => get<WorkflowTimeline[]>(`/instances/${instanceId}/timeline`),
  workflowTimeline: (workflowId: number) => get<WorkflowTimeline & { instanceName: string }>(`/workflows/${workflowId}/timeline`),
};
