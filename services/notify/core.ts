/**
 * Schmaler Core-Client für den Notification-Dienst.
 * Nutzt NOTIFY_TOKEN: darf nur Metadaten lesen und Health-Warnungen ausblenden (keine Snapshots, kein n8n).
 */
import type { HealthAlert } from '../../shared/executions.ts';

export interface CoreInstanceMeta {
  id: number;
  name: string;
  color: string;
  enabled: number;
  sync_interval: number;
  last_sync_at: number | null;
  last_sync_ok: number | null;
  last_sync_error: string | null;
}

export interface CoreClient {
  instances: () => Promise<CoreInstanceMeta[]>;
  openAlerts: () => Promise<HealthAlert[]>;
  dismissAlert: (alertId: number) => Promise<void>;
}

export function coreClient(baseUrl: string, token: () => string): CoreClient {
  const base = baseUrl.replace(/\/+$/, '');
  async function request<T>(method: 'GET' | 'POST', p: string): Promise<T> {
    const res = await fetch(`${base}/internal${p}`, {
      method,
      headers: {
        'X-Internal-Token': token(),
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? '{}' : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
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
  };
}
