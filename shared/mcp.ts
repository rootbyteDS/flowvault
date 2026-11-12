/**
 * MCP-Dienst (services/mcp): Antworttypen der Tools und die Token-Verwaltung für die Oberfläche.
 *
 * Alle Texte, die aus n8n stammen (Namen, Fehlermeldungen), sind geschwärzt, einzeilig und gekürzt.
 * Zeitpunkte sind ISO-8601 in UTC.
 */
import type { ExecStatus } from './executions.ts';

// ───────────── Verwaltung (Einstellungen → MCP) ─────────────

export interface McpToken {
  id: number;
  name: string;
  /** Anfang des Tokens zum Wiedererkennen, z. B. „fv_mcp_Ab3d…“. Das ganze Token gibt es nur beim Anlegen. */
  hint: string;
  /** Erlaubte Instanzen; null = alle */
  instances: number[] | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface McpState {
  enabled: boolean;
  tokens: McpToken[];
}

export interface McpCreatedToken {
  token: string;
  info: McpToken;
}

// ───────────── Tool-Antworten ─────────────

export type McpLevel = 'ok' | 'warning' | 'critical';
export type McpReasonCode =
  | 'sync_failed' | 'never_synced' | 'sync_overdue'
  | 'health_unavailable' | 'health_disabled' | 'poll_failed' | 'poll_overdue' | 'history_incomplete'
  | 'open_alerts' | 'failure_rate_high' | 'failures_24h';

export interface McpInstanceStatus {
  instanceId: number;
  name: string;
  level: McpLevel | 'disabled';
  reasons: { code: McpReasonCode; level: McpLevel }[];
  sync: { lastAt: string | null; ok: boolean | null; error: string | null; intervalMinutes: number };
  executions: {
    lastPollAt: string | null;
    pollOk: boolean | null;
    pollError: string | null;
    /** Läufe der letzten 24 Stunden mit Fehlschlägen im Verhältnis */
    runs24h: number;
    failed24h: number;
    /** Ein Abruf hat nicht alles erwischt; Zahlen können zu niedrig sein. */
    incomplete: boolean;
  };
  openAlerts: number;
}

export interface McpStatus {
  generatedAt: string;
  dataAsOf: string | null;
  overall: McpLevel;
  healthEnabled: boolean;
  instances: McpInstanceStatus[];
}

export interface McpFailureGroup {
  instanceId: number;
  instanceName: string;
  /** ID in FlowVault; null, wenn der Workflow (noch) nicht gesichert ist */
  workflowId: number | null;
  workflowName: string | null;
  workflowActive: boolean | null;
  node: string | null;
  message: string | null;
  count: number;
  firstAt: string;
  lastAt: string;
  /** Letzter abgeschlossener Lauf des Workflows: „success“ heißt, er läuft wieder. */
  lastRunStatus: ExecStatus | null;
}

export interface McpFailures {
  generatedAt: string;
  dataAsOf: string | null;
  hours: number;
  groups: McpFailureGroup[];
  truncated: boolean;
}

export interface McpFailingNode {
  node: string;
  failed: number;
  rate: number;
  isNew: boolean;
  lastMessage: string | null;
  lastAt: string | null;
}

export interface McpAlert {
  alertId: number;
  instanceId: number;
  instanceName: string;
  workflowId: number;
  workflowName: string;
  versionNumber: number;
  failureRate: number;
  runs: number;
  failed: number;
  baselineRate: number;
  baselineRuns: number;
  rollbackVersionNumber: number | null;
  failingNodes: McpFailingNode[];
  since: string;
}

export interface McpAlerts {
  generatedAt: string;
  dataAsOf: string | null;
  alerts: McpAlert[];
}

export interface McpVersionHealth {
  versionNumber: number;
  from: string;
  to: string | null;
  runs: number;
  failed: number;
  canceled: number;
  failureRate: number | null;
  baselineRate: number | null;
  regression: boolean;
  rollbackVersionNumber: number | null;
  failingNodes: McpFailingNode[];
}

export interface McpWorkflowHealth {
  generatedAt: string;
  dataAsOf: string | null;
  workflowId: number;
  workflowName: string;
  instanceId: number;
  instanceName: string;
  available: boolean;
  pollError: string | null;
  /** Neueste zuerst, höchstens 10 */
  versions: McpVersionHealth[];
  unattributedRuns: number;
}

export interface McpChange {
  at: string;
  kind: 'created' | 'changed' | 'deleted' | 'restored' | 'sync_error' | string;
  instanceId: number | null;
  instanceName: string | null;
  workflowId: number | null;
  workflowName: string | null;
  versionNumber: number | null;
  /** Nur bei sync_error: die Fehlermeldung */
  detail: string | null;
}

export interface McpChanges {
  generatedAt: string;
  hours: number;
  changes: McpChange[];
  truncated: boolean;
}

export interface McpWorkflow {
  workflowId: number;
  instanceId: number;
  instanceName: string;
  name: string;
  active: boolean;
  archived: boolean;
  deleted: boolean;
  nodeCount: number;
  versions: number;
  lastChangeAt: string;
}

export interface McpWorkflows {
  generatedAt: string;
  workflows: McpWorkflow[];
  truncated: boolean;
}
