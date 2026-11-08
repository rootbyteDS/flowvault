/**
 * Ausführungen aus der n8n Public API in schlanker Form – geteilt zwischen Core
 * (holt sie bei n8n ab) und Health-Dienst (wertet sie aus).
 *
 * Der Core reduziert jede Ausführung auf diese Felder, bevor sie ihn verlässt:
 * Laufzeitdaten (runData, Eingaben, Ausgaben) können personenbezogene Daten
 * enthalten und werden nie weitergegeben – nur Name und Meldung des
 * fehlgeschlagenen Nodes.
 */

export type ExecStatus = 'success' | 'error' | 'crashed' | 'canceled' | 'running' | 'waiting' | 'new' | 'unknown';

export interface SlimExecution {
  id: string;
  workflowId: string; // n8n-ID des Workflows
  status: ExecStatus;
  mode: string; // trigger | webhook | manual | retry | …
  startedAt: string | null;
  stoppedAt: string | null;
  /** Nur bei neueren n8n-Versionen: Versions-ID des ausgeführten Workflow-Stands. */
  workflowVersionId: string | null;
  errorNode: string | null;
  errorMessage: string | null;
}

export interface ExecutionPage {
  data: SlimExecution[];
  nextCursor: string | null;
}

export const FINISHED: ReadonlySet<ExecStatus> = new Set(['success', 'error', 'crashed', 'canceled']);
export const FAILED: ReadonlySet<ExecStatus> = new Set(['error', 'crashed']);

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

function statusOf(e: Record<string, unknown>): ExecStatus {
  const s = str(e.status);
  if (s) return (['success', 'error', 'crashed', 'canceled', 'running', 'waiting', 'new'].includes(s) ? s : 'unknown') as ExecStatus;
  // Ältere n8n-Versionen kennen kein `status`
  if (e.finished === true) return 'success';
  if (e.waitTill) return 'waiting';
  if (e.stoppedAt) return 'error';
  return 'running';
}

/** Findet Node und Meldung des Fehlers in `data` (nur bei includeData=true vorhanden). */
function errorOf(data: unknown): { node: string | null; message: string | null } {
  let d = data;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      return { node: null, message: null };
    }
  }
  const rd = (d as { resultData?: Record<string, unknown> } | null)?.resultData;
  if (!rd) return { node: null, message: null };
  const err = rd.error as { message?: unknown; node?: { name?: unknown } } | undefined;
  let node = str(err?.node?.name);
  let message = str(err?.message);

  if (!node || !message) {
    // Fehler steckt im letzten Lauf eines Nodes (z. B. bei „Continue on Fail“ deaktiviert)
    const runData = (rd.runData ?? {}) as Record<string, { error?: { message?: unknown } }[]>;
    for (const [name, runs] of Object.entries(runData)) {
      const failed = Array.isArray(runs) ? runs.findLast((r) => r?.error) : undefined;
      if (failed) {
        node ??= name;
        message ??= str(failed.error?.message);
        break;
      }
    }
  }
  node ??= str(rd.lastNodeExecuted);
  return { node, message: message ? message.slice(0, 300) : null };
}

export function slimExecution(raw: unknown): SlimExecution | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (e.id === undefined || e.workflowId === undefined) return null;
  const status = statusOf(e);
  const err = FAILED.has(status) ? errorOf(e.data) : { node: null, message: null };
  return {
    id: String(e.id),
    workflowId: String(e.workflowId),
    status,
    mode: str(e.mode) ?? 'unknown',
    startedAt: str(e.startedAt),
    stoppedAt: str(e.stoppedAt),
    workflowVersionId: str(e.workflowVersionId),
    errorNode: err.node,
    errorMessage: err.message,
  };
}

// ───────────── Antworten des Health-Dienstes (auch vom Frontend genutzt) ─────────────

export interface FailingNode {
  name: string;
  failed: number;
  /** Anteil der Läufe dieser Version, die an diesem Node gescheitert sind. */
  rate: number;
  /** In der Vergleichsbasis (Versionen davor) nicht oder kaum gescheitert. */
  isNew: boolean;
  lastMessage: string | null;
  lastAt: number | null;
}

export interface VersionHealth {
  versionId: number;
  number: number;
  from: number; // ab wann diese Version in n8n lief (ms)
  to: number | null; // bis wann (Beginn der nächsten Version), null = läuft noch
  total: number; // abgeschlossene Läufe
  failed: number;
  canceled: number;
  rate: number | null; // Fehlerquote 0..1, null ohne Läufe
  failingNodes: FailingNode[];
  baseline: { total: number; failed: number; rate: number | null; fromNumber: number; toNumber: number } | null;
  regression: boolean;
  /** Vorschlag für einen Rollback: letzte Version, die vorher stabil lief. */
  rollback: { versionId: number; number: number; rate: number | null } | null;
}

export interface WorkflowHealth {
  workflowId: number;
  available: boolean;
  lastPollAt: number | null;
  pollError: string | null;
  versions: VersionHealth[]; // neueste zuerst, wie im Frontend
  /** Läufe vor der ersten gesicherten Version – keiner Version zuzuordnen. */
  unattributed: number;
  alert: HealthAlert | null;
  /** Für Erklärungen in der Oberfläche („erst 3 von 5 Läufen“, „Testläufe zählen nicht“). */
  settings: HealthSettings;
}

export interface HealthAlert {
  id: number;
  workflowId: number;
  workflowName: string;
  instanceId: number;
  instanceName: string;
  versionId: number;
  versionNumber: number;
  rate: number;
  total: number;
  failed: number;
  baselineRate: number;
  baselineTotal: number;
  rollbackVersionId: number | null;
  rollbackNumber: number | null;
  failingNodes: FailingNode[];
  status: 'open' | 'dismissed' | 'resolved';
  createdAt: number;
  updatedAt: number;
}

export interface HealthSettings {
  enabled: boolean;
  pollMinutes: number;
  lookbackDays: number;
  retentionDays: number;
  minRuns: number;
  thresholdPct: number;
  includeManual: boolean;
  alerts: boolean;
}

export interface HealthStatus {
  settings: HealthSettings;
  instances: { instanceId: number; name: string; lastPollAt: number | null; ok: boolean | null; error: string | null; executions: number }[];
  openAlerts: number;
}
