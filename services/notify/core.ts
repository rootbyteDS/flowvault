/**
 * Schmaler Core-Client für den Notification-Dienst.
 * Nutzt NOTIFY_TOKEN: darf Metadaten lesen, Health-Warnungen ausblenden, E2E-verschlüsselte
 * Diagnosen anfordern und kryptografisch signierte Rollbacks weiterleiten (keine Snapshots, keine Keys).
 */
import type { HealthAlert } from '../../shared/executions.ts';
import type { DiagnosisResponse, RollbackExecuteResult } from '../../shared/notify.ts';

export interface CoreInstanceMeta {
  id: number;
  name: string;
  base_url?: string | null;
  color: string;
  enabled: number;
  sync_interval: number;
  last_sync_at: number | null;
  last_sync_ok: number | null;
  last_sync_error: string | null;
}

export interface RollbackPreview {
  instanceId: number;
  instanceName: string;
  workflowId: number;
  workflowName: string;
  currentVersionNumber: number;
  targetVersionId: number;
  targetVersionNumber: number;
}

export interface CoreClient {
  instances: () => Promise<CoreInstanceMeta[]>;
  openAlerts: () => Promise<HealthAlert[]>;
  dismissAlert: (alertId: number) => Promise<void>;
  rollbackPreview: (workflowId: number, targetVersionId: number) => Promise<RollbackPreview>;
  diagnose: (input: {
    workflowId: number;
    versionId?: number | null;
    rollbackVersionId?: number | null;
    errorNode?: string | null;
    errorMessage?: string | null;
    language?: string;
    encryptionPublicKey?: string | null;
  }) => Promise<DiagnosisResponse & { instanceId: number }>;
  executeRollback: (input: {
    challengeId: string;
    nonce: string;
    deviceId: number;
    workflowId: number;
    targetVersionId: number;
    signingPublicKey: string;
    signature: string;
  }) => Promise<RollbackExecuteResult>;
}

export function coreClient(baseUrl: string, token: () => string): CoreClient {
  const base = baseUrl.replace(/\/+$/, '');
  async function request<T>(method: 'GET' | 'POST', p: string, bodyObj?: unknown): Promise<T> {
    const res = await fetch(`${base}/internal${p}`, {
      method,
      headers: {
        'X-Internal-Token': token(),
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? JSON.stringify(bodyObj ?? {}) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(35_000),
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as { error?: string }) : {};
    if (!res.ok) {
      const err = new Error(body.error ?? `Core HTTP ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return body as T;
  }

  return {
    instances: () => request<CoreInstanceMeta[]>('GET', '/instances'),
    openAlerts: () => request<HealthAlert[]>('GET', '/health/alerts'),
    dismissAlert: async (alertId: number) => {
      await request<{ ok: boolean }>('POST', `/health/alerts/${alertId}/dismiss`);
    },
    rollbackPreview: (workflowId: number, targetVersionId: number) =>
      request<RollbackPreview>('GET', `/workflows/${workflowId}/rollback-preview?versionId=${targetVersionId}`),
    diagnose: (input) => request<DiagnosisResponse & { instanceId: number }>('POST', '/actions/diagnose', input),
    executeRollback: (input) => request<RollbackExecuteResult>('POST', '/actions/rollback', input),
  };
}
