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

/** Bereinigt eine n8n-Basis-URL auf `http(s)://host[:port][/subpath]` ohne Zugangsdaten, Query oder Slash am Ende. */
export function cleanInstanceUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const p = u.pathname.replace(/\/+$/, '');
    return `${u.origin}${p}`;
  } catch {
    return null;
  }
}

/** Baut den direkten n8n-Sprunglink (Execution → Workflow → Instanz). */
export function buildN8nUrl(opts: {
  instanceUrl?: string | null;
  n8nWorkflowId?: string | null;
  executionId?: string | null;
}): string | null {
  const base = cleanInstanceUrl(opts.instanceUrl);
  if (!base) return null;
  const wfId = opts.n8nWorkflowId?.trim();
  const execId = opts.executionId?.trim();
  if (wfId && execId) return `${base}/workflow/${encodeURIComponent(wfId)}/executions/${encodeURIComponent(execId)}`;
  if (wfId) return `${base}/workflow/${encodeURIComponent(wfId)}`;
  if (execId) return `${base}/executions/${encodeURIComponent(execId)}`;
  return base;
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
  allowRollback: boolean;
  signingKeyConfigured: boolean;
  encryptionKeyConfigured: boolean;
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
  allowRollback: boolean;
}

export interface NotifyPairedResponse {
  deviceId: number;
  token: string;
  serverName: string;
  serverVersion: string;
  redactionMode: RedactionMode;
  allowRollback: boolean;
  allowedInstances: number[] | null;
}

export interface EncryptedEnvelope {
  alg: 'ECDH-P256-HKDF-AES256GCM';
  ephemeralPublicKey: string;
  salt: string;
  iv: string;
  /** Base64(Ciphertext || 16-Byte GCM AuthTag) */
  ciphertext: string;
}

export interface DiagnosisResult {
  source: 'ai' | 'diff';
  headline: string;
  cause: string;
  culpritChange: string | null;
  suggestedFix: string[];
  recommendRollback: boolean;
  rollbackVersionId: number | null;
  rollbackVersionNumber: number | null;
  analyzedVersionNumber: number;
  comparedVersionNumber: number | null;
  generatedAt: number;
}

export interface DiagnosisResponse {
  encrypted: boolean;
  envelope?: EncryptedEnvelope;
  diagnosis?: DiagnosisResult;
}

export interface RollbackChallenge {
  challengeId: string;
  nonce: string;
  expiresAt: number;
  instanceId: number;
  instanceName: string;
  workflowId: number;
  workflowName: string;
  currentVersionNumber: number;
  targetVersionId: number;
  targetVersionNumber: number;
}

export interface RollbackExecuteResult {
  ok: boolean;
  workflowId: number;
  restoredFromNumber: number;
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
  /** Bereinigte Basis-URL der n8n-Instanz für Direktsprünge aus der App. */
  instanceUrl?: string | null;
  /** Originale Workflow-ID in n8n (für `/workflow/<id>`). */
  n8nWorkflowId?: string | null;
  /** Ausführungs-ID in n8n bei Fehlläufen/Regressionen (für `/workflow/<wfId>/executions/<execId>`). */
  executionId?: string | null;
  /** Fertig zusammengesetzter n8n-Direktlink (Execution → Workflow → Instanz). */
  n8nUrl?: string | null;
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
  /** Gerätespezifischer Lesestatus (berücksichtigt Kanal-readSeq und Einzel-Markierungen). */
  unread?: boolean;
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
  /** Bereinigte Basis-URL der n8n-Instanz (entfällt bei `redactionMode === 'full'`). */
  instanceUrl?: string | null;
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
