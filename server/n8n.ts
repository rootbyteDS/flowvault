/** Minimaler Client für die öffentliche n8n REST API (/api/v1). */
import { FetchError, errorMessageFrom, safeFetch } from './net.ts';
import { slimExecution, type ExecutionPage } from '../shared/executions.ts';

export interface N8nNode {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: [number, number];
  parameters?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  disabled?: boolean;
  [k: string]: unknown;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  isArchived?: boolean;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  staticData?: unknown;
  pinData?: Record<string, unknown>;
  tags?: { id?: string; name: string }[];
  versionId?: string;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export class N8nError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function normalizeBaseUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '');
  u = u.replace(/\/api\/v1$/, '');
  if (!/^https?:\/\//i.test(u)) {
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^.:/]+(:\d+)?(\/|$))/i.test(u);
    u = (local ? 'http://' : 'https://') + u;
  }
  return u;
}

export class N8nClient {
  baseUrl: string;
  apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await safeFetch(`${this.baseUrl}/api/v1${path}`, {
        method,
        headers: {
          'X-N8N-API-KEY': this.apiKey,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      if (e instanceof FetchError) throw new N8nError(e.message, e.status);
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      throw new N8nError(`Instanz nicht erreichbar (${cause?.code ?? cause?.message ?? (e as Error).message})`, 0);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = errorMessageFrom(text, res.status);
      if (res.status === 401) msg = 'API-Key ungültig oder abgelaufen (401)';
      if (res.status === 404 && path.startsWith('/workflows?')) msg = 'Keine n8n Public API unter dieser URL gefunden (404)';
      throw new N8nError(`${msg}`.slice(0, 500), res.status);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new N8nError('Antwort ist kein JSON – stimmt die URL?', res.status);
    }
  }

  /** Lädt alle Workflows inkl. Nodes (paginiert). */
  async listWorkflows(): Promise<N8nWorkflow[]> {
    const all: N8nWorkflow[] = [];
    let cursor: string | undefined;
    do {
      const qs = new URLSearchParams({ limit: '250' });
      if (cursor) qs.set('cursor', cursor);
      const page = await this.request<{ data: N8nWorkflow[]; nextCursor?: string | null }>('GET', `/workflows?${qs}`);
      all.push(...page.data);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return all;
  }

  /**
   * Eine Seite Ausführungen, neueste zuerst. Gibt sie schon reduziert zurück:
   * Laufzeitdaten verlassen den Core nie (siehe shared/executions.ts).
   */
  async listExecutions(opts: { cursor?: string; limit?: number; status?: string; workflowId?: string; includeData?: boolean }): Promise<ExecutionPage> {
    const qs = new URLSearchParams({ limit: String(opts.limit ?? 100) });
    if (opts.cursor) qs.set('cursor', opts.cursor);
    if (opts.status) qs.set('status', opts.status);
    if (opts.workflowId) qs.set('workflowId', opts.workflowId);
    if (opts.includeData) qs.set('includeData', 'true');
    const page = await this.request<{ data: unknown[]; nextCursor?: string | null }>('GET', `/executions?${qs}`);
    return {
      data: (page.data ?? []).map(slimExecution).filter((e): e is NonNullable<typeof e> => !!e),
      nextCursor: page.nextCursor ?? null,
    };
  }

  async getWorkflow(id: string) {
    return this.request<N8nWorkflow>('GET', `/workflows/${encodeURIComponent(id)}`);
  }

  /** Credentials der Instanz (für Umgebungs-Zuordnungen). null, wenn die API/der Key sie nicht hergibt. */
  async listCredentials(): Promise<{ id: string; name: string; type: string }[] | null> {
    try {
      const page = await this.request<{ data?: unknown[] }>('GET', '/credentials');
      if (!Array.isArray(page.data)) return null;
      return page.data
        .filter((c): c is { id: string; name: string; type: string } => !!c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string')
        .map((c) => ({ id: String(c.id), name: c.name ?? c.id, type: c.type ?? '' }));
    } catch {
      return null;
    }
  }

  async test(): Promise<{ workflows: number }> {
    const page = await this.request<{ data: unknown[]; nextCursor?: string | null }>('GET', '/workflows?limit=250');
    return { workflows: page.data.length + (page.nextCursor ? 1 : 0) };
  }

  /** Body für POST/PUT – die n8n API lehnt zusätzliche Felder strikt ab. */
  static writableBody(wf: Pick<N8nWorkflow, 'name' | 'nodes' | 'connections' | 'settings' | 'staticData'>, minimalSettings = false) {
    const allowed = [
      'saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution',
      'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder', 'callerPolicy', 'callerIds',
    ];
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(wf.settings ?? {})) {
      if (minimalSettings ? k === 'executionOrder' : allowed.includes(k)) settings[k] = v;
    }
    return {
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings,
      ...(wf.staticData ? { staticData: wf.staticData } : {}),
    };
  }

  private async write(method: 'POST' | 'PUT', path: string, wf: Parameters<typeof N8nClient.writableBody>[0]) {
    try {
      return await this.request<N8nWorkflow>(method, path, N8nClient.writableBody(wf));
    } catch (e) {
      // Ältere/neuere n8n-Versionen kennen nicht alle Settings – dann minimal erneut versuchen.
      if (e instanceof N8nError && e.status === 400 && /settings|additional properties/i.test(e.message)) {
        return await this.request<N8nWorkflow>(method, path, N8nClient.writableBody(wf, true));
      }
      throw e;
    }
  }

  createWorkflow(wf: Parameters<typeof N8nClient.writableBody>[0]) {
    return this.write('POST', '/workflows', wf);
  }

  updateWorkflow(id: string, wf: Parameters<typeof N8nClient.writableBody>[0]) {
    return this.write('PUT', `/workflows/${encodeURIComponent(id)}`, wf);
  }
}
