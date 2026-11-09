import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeSummary, Snapshot, WorkflowDiff } from '../../shared/diff.ts';
import { currentLocale, t } from './i18n.tsx';

import type { FailingNode, HealthAlert, HealthSettings, HealthStatus, VersionHealth, WorkflowHealth } from '../../shared/executions.ts';

export type { ChangeSummary, Snapshot, WorkflowDiff };
export type { FailingNode, HealthAlert, HealthSettings, HealthStatus, VersionHealth, WorkflowHealth };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body ? 'POST' : 'GET');
  // Der Server nimmt schreibende Requests nur als JSON an (CSRF-Schutz) – auch ohne Inhalt
  const write = method !== 'GET' && method !== 'HEAD';
  const res = await fetch(`/api${path}`, {
    method,
    // Accept-Language: Der Server antwortet (Fehlermeldungen, Vorschläge) in der gewählten Sprache
    headers: { 'Accept-Language': currentLocale(), ...(write ? { 'Content-Type': 'application/json' } : {}) },
    body: write ? JSON.stringify(opts.body ?? {}) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth')) {
    window.dispatchEvent(new Event('fv:unauthorized'));
  }
  if (!res.ok) throw new ApiError(data.error ?? t('errors.http.status', { status: res.status }), res.status);
  return data as T;
}

/** Lädt Daten; `poll` (ms) aktualisiert periodisch, solange die Funktion eine Zahl liefert – auch nach reload(). */
export function useApi<T>(path: string | null, opts: { poll?: (d: T) => number | false } = {}) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(opts.poll);
  pollRef.current = opts.poll;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const alive = useRef(true);

  const load = useCallback(async (): Promise<T | undefined> => {
    if (!path) return;
    clearTimeout(timer.current);
    try {
      const d = await api<T>(path);
      if (!alive.current) return d;
      setData(d);
      setError(undefined);
      const ms = pollRef.current ? pollRef.current(d) : false;
      if (ms) timer.current = setTimeout(() => void load(), ms);
      return d;
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    void load();
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

// ───────────── Typen ─────────────

export interface Instance {
  id: number;
  name: string;
  base_url: string;
  color: string;
  sync_interval: number;
  enabled: boolean;
  include_archived: boolean;
  last_sync_at: number | null;
  last_sync_ok: boolean | null;
  last_sync_error: string | null;
  created_at: number;
  key_hint: string;
  syncing: boolean;
  workflows: number;
  active_workflows: number;
  deleted_workflows: number;
  versions: number;
}

export interface SyncRun {
  id: number;
  started_at: number;
  finished_at: number | null;
  ok: number | null;
  total: number;
  created: number;
  changed: number;
  deleted: number;
  error: string | null;
  trigger: string;
}

export interface WorkflowListItem {
  id: number;
  instance_id: number;
  instance_name: string;
  instance_color: string;
  base_url: string;
  n8n_id: string;
  name: string;
  active: boolean;
  archived: boolean;
  node_count: number;
  tags: string[];
  version_count: number;
  last_change_at: number;
  last_seen_at: number;
  first_seen_at: number;
  deleted_at: number | null;
  last_summary: ChangeSummary | null;
}

export interface AiSummary {
  title: string;
  details: string[];
}

export interface AiSettings {
  enabled: boolean;
  auto: boolean;
  base_url: string;
  model: string;
  language: string;
  configured: boolean;
  key_hint: string | null;
  pending: number;
  missing: number;
}

export interface VersionItem {
  id: number;
  number: number;
  hash: string;
  summary: ChangeSummary;
  ai_summary: AiSummary | null;
  ai_status: 'pending' | 'done' | 'error' | null;
  ai_error: string | null;
  ai_model: string | null;
  message: string | null;
  n8n_version_id: string | null;
  n8n_updated_at: string | null;
  created_at: number;
  size: number;
}

export interface WorkflowDetail extends Omit<WorkflowListItem, 'last_summary'> {
  versions: VersionItem[];
}

export interface VersionFull extends Omit<VersionItem, 'size'> {
  workflow_id: number;
  workflow_name: string;
  instance_id: number;
  n8n_id: string;
  snapshot: Snapshot;
}

export interface ActivityItem {
  id: number;
  kind: 'created' | 'changed' | 'deleted' | 'restored' | 'promoted' | 'sync_error';
  detail: string | null;
  created_at: number;
  instance_id: number | null;
  instance_name: string | null;
  instance_color: string | null;
  workflow_id: number | null;
  workflow_name: string | null;
  version_id: number | null;
  version_number: number | null;
  summary: ChangeSummary | null;
  ai_summary: AiSummary | null;
  message: string | null;
}

export interface Overview {
  stats: {
    instances: number;
    workflows: number;
    active: number;
    versions: number;
    versions_7d: number;
    last_sync: number | null;
    first_backup: number | null;
    storage_bytes: number;
  };
  days: { day: number; n: number }[];
  activity: ActivityItem[];
}

export interface CompareResult {
  from: VersionFull | null;
  to: VersionFull;
  diff: WorkflowDiff;
}

// ───────────── Umgebungen (Staging → Prod) ─────────────

export type MappingKind = 'credential' | 'workflow' | 'webhookPath' | 'dataTable';

/** Beschriftung einer Zuordnungsart in der aktiven Sprache. */
export const mappingKindLabel = (kind: MappingKind): string => t(`promote.kind.${kind}`);

export interface MappingRow {
  id: number;
  kind: MappingKind;
  from: string;
  fromName: string | null;
  to: string;
  toName: string | null;
}

export interface DriftSide {
  workflowId: number;
  versionId: number;
  versionNumber: number;
  name: string;
  active: boolean;
  lastChangeAt: number;
}

export interface DriftRow {
  source: DriftSide | null;
  target: DriftSide | null;
  matchedBy: 'mapping' | 'id' | 'name' | null;
  status: 'in-sync' | 'drifted' | 'only-source' | 'only-target' | 'unpaired';
  ahead: 'source' | 'target' | null;
  summary: ChangeSummary | null;
  activeDiffers: boolean;
  missing: string[];
}

export interface EnvironmentPair { sourceId: number; targetId: number; sourceName: string; targetName: string }
export interface WorkflowChoice {
  id: number; n8nId: string; name: string; decision: 'existing' | 'create' | null;
  targetId: string | null; valid: boolean; suggestion: string | null;
}
export interface PromotePlan {
  fingerprint: string;
  blockers: string[];
  items: { workflowId: number; name: string; version: number; action: 'created' | 'updated'; targetName: string | null; dependency: boolean }[];
}
export interface PromoteOverview {
  configured: boolean;
  choices: { sources: WorkflowChoice[]; targets: { n8nId: string; name: string }[] };
  source: { id: number; name: string; color: string; workflows: number };
  target: { id: number; name: string; color: string; workflows: number };
  mappings: MappingRow[];
  drift: {
    rows: DriftRow[];
    counts: { inSync: number; drifted: number; onlySource: number; onlyTarget: number; unpaired: number };
  };
}

export interface MappingSuggestion {
  kind: MappingKind;
  from: string;
  fromName: string | null;
  to: string | null;
  toName: string | null;
  reason: string;
  candidates: { value: string; label: string; name: string; hint?: string }[];
}

export interface PromoteOutcome {
  sourceWorkflowId: number;
  name: string;
  version: number;
  action: 'updated' | 'created';
  targetWorkflowId: number | null;
  targetN8nId: string | null;
  applied: string[];
  missing: string[];
  error: string | null;
}

export interface PromoteDiff {
  version: number;
  sourceName: string;
  targetFound: boolean;
  applied: string[];
  from: Snapshot | null;
  to: Snapshot;
  diff: WorkflowDiff;
}
