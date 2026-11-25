/**
 * Notification-Dienst (services/notify): gemeinsame Typen für Core, Notify-Dienst,
 * Web-Oberfläche und die Android-App (/mobile/v1/*).
 */
import type { ChangeSummary } from './diff.ts';
import type { FailingNode } from './executions.ts';

export type NotifyKind =
  | 'alert_opened'
  | 'alert_escalated'
  | 'alert_resolved'
  | 'execution_failed'
  | 'execution_recovered'
  | 'sync_error'
  | 'sync_recovered'
  | 'health_poll_error'
  | 'health_poll_recovered'
  | 'workflow_changed'
  | 'workflow_created'
  | 'workflow_deleted'
  | 'workflow_restored'
  | 'workflow_promoted'
  | 'initial_sync'
  | 'test';

export type NotifyCategory = 'fails' | 'changes' | 'ops';
export type NotifySeverity = 'critical' | 'high' | 'normal' | 'info';
export type RedactionMode = 'none' | 'lockscreen' | 'full';
export type PushType = 'none' | 'unifiedpush' | 'sse_bg';

export const FAIL_KINDS: ReadonlySet<NotifyKind> = new Set([
  'alert_opened',
  'alert_escalated',
  'alert_resolved',
  'execution_failed',
  'execution_recovered',
  'sync_error',
  'sync_recovered',
  'health_poll_error',
  'health_poll_recovered',
]);

export const CHANGE_KINDS: ReadonlySet<NotifyKind> = new Set([
  'workflow_changed',
  'workflow_created',
  'workflow_deleted',
  'workflow_restored',
  'workflow_promoted',
  'initial_sync',
]);

export function categoryOfKind(kind: NotifyKind): NotifyCategory {
  if (kind === 'sync_error' || kind === 'sync_recovered' || kind === 'health_poll_error' || kind === 'health_poll_recovered') return 'ops';
  if (CHANGE_KINDS.has(kind)) return 'changes';
  return 'fails';
}

export interface QuietHours {
  enabled: boolean;
  /** HH:MM im 24h-Format, z. B. "22:00" */
  start: string;
  /** HH:MM im 24h-Format, z. B. "07:00" */
  end: string;
  /** IANA-Zeitzone, z. B. "Europe/Berlin" */
  tz: string;
  allowCritical: boolean;
}

export interface NotifyDevice {
  id: number;
  name: string;
  platform: string;
  hint: string;
  instances: number[] | null;
  redactionMode: RedactionMode;
  pushType: PushType;
  pushConfigured: boolean;
  language: string;
  quietHours: QuietHours | null;
  createdAt: number;
  lastSeenAt: number | null;
}

export interface NotifyState {
  enabled: boolean;
  retentionDays: number;
  defaultRedaction: RedactionMode;
  devices: NotifyDevice[];
}

export interface NotifyPairingCreated {
  code: string;
  uri: string;
  qrDataUrl: string;
  expiresAt: number;
  label: string;
  instances: number[] | null;
  redactionMode: RedactionMode;
}

export interface NotifyPairedResponse {
  deviceId: number;
  token: string;
  serverName: string;
  serverVersion: string;
  redactionMode: RedactionMode;
  allowedInstances: number[] | null;
}

export interface NotifyMessageMetadata {
  summary?: ChangeSummary;
  aiSummary?: { title: string; details: string[] } | null;
  rate?: number;
  total?: number;
  failed?: number;
  baselineRate?: number;
  baselineTotal?: number;
  rollback?: { versionId: number; number: number; rate: number | null } | null;
  failingNodes?: FailingNode[];
  errorNode?: string | null;
  errorMessage?: string | null;
  activeChanged?: boolean;
  restoredFrom?: number;
  importedCount?: number;
  webPath?: string;
}

export interface NotifyMessage {
  seq: number;
  updatedSeq: number;
  instance: { id: number; name: string; color: string };
  workflow: { id: number; name: string } | null;
  version: { id: number; number: number } | null;
  alertId: number | null;
  kind: NotifyKind;
  severity: NotifySeverity;
  title: string;
  body: string;
  groupCount: number;
  resolvedBySeq: number | null;
  metadata: NotifyMessageMetadata;
  createdAt: number;
  updatedAt: number;
}

export interface NotifyRule {
  scopeType: 'global' | 'instance' | 'workflow';
  scopeId: number;
  enabledKinds: NotifyKind[] | null;
  /** null = aktiv, -1 = dauerhaft stumm, >0 = Unix-ms bis wann stumm */
  mutedUntil: number | null;
}

export interface NotifyChannel {
  instanceId: number;
  name: string;
  color: string;
  enabled: boolean;
  lastSyncOk: boolean | null;
  openAlerts: number;
  unreadCount: number;
  readSeq: number;
  mutedUntil: number | null;
  lastMessage: NotifyMessage | null;
}

export interface NotifyBootstrap {
  serverName: string;
  serverVersion: string;
  device: NotifyDevice;
  latestSeq: number;
  openAlertsTotal: number;
  channels: NotifyChannel[];
  rules: NotifyRule[];
}

export interface NotifyIngestPayload {
  /** Sonder-Typ: reichert bestehende workflow_changed-Nachricht still um KI-Text an. */
  type?: 'event' | 'ai_summary';
  eventUid?: string;
  groupKey?: string;
  instanceId: number;
  instanceName: string;
  instanceColor?: string;
  workflowId?: number | null;
  workflowName?: string | null;
  versionId?: number | null;
  versionNumber?: number | null;
  alertId?: number | null;
  kind?: NotifyKind;
  severity?: NotifySeverity;
  title?: string;
  body?: string;
  metadata?: NotifyMessageMetadata;
  aiSummary?: { title: string; details: string[] };
  createdAt?: number;
}
