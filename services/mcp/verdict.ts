/** Urteil je Instanz für `get_status`: ok, Warnung oder kritisch, jeweils mit Gründen. */
import type { McpLevel, McpReasonCode } from '../../shared/mcp.ts';

export interface InstanceFacts {
  enabled: boolean;
  syncIntervalMin: number; // 0 = nur manuell
  lastSyncAt: number | null;
  lastSyncOk: boolean | null;
  /** null = Health-Dienst nicht erreichbar */
  pollOk: boolean | null;
  lastPollAt: number | null;
  incomplete: boolean;
  openAlerts: number;
  runs24h: number;
  failed24h: number;
}

/** Aus den Health-Einstellungen: dieselben Schwellen wie für Warnungen in der Oberfläche. */
export interface Thresholds {
  /** null = Health-Dienst nicht erreichbar, Einstellungen unbekannt */
  healthEnabled: boolean | null;
  pollMinutes: number;
  minRuns: number;
  thresholdPct: number;
}

export interface Verdict {
  level: McpLevel | 'disabled';
  reasons: { code: McpReasonCode; level: McpLevel }[];
}

/** Reine Funktion: gleiche Fakten, gleiches Ergebnis. */
export function verdict(f: InstanceFacts, t: Thresholds, now = Date.now()): Verdict {
  if (!f.enabled) return { level: 'disabled', reasons: [] };
  const reasons: Verdict['reasons'] = [];
  const add = (code: McpReasonCode, level: McpLevel) => reasons.push({ code, level });

  if (f.lastSyncOk === false) add('sync_failed', 'critical');
  else if (f.lastSyncAt === null) add('never_synced', 'warning');
  else if (f.syncIntervalMin > 0 && now - f.lastSyncAt > 3 * f.syncIntervalMin * 60_000) add('sync_overdue', 'warning');

  if (t.healthEnabled === null) add('health_unavailable', 'warning');
  else if (!t.healthEnabled) add('health_disabled', 'warning');
  else if (f.pollOk === false) add('poll_failed', 'critical');
  else if (f.lastPollAt === null || now - f.lastPollAt > 3 * t.pollMinutes * 60_000) add('poll_overdue', 'warning');
  if (f.incomplete) add('history_incomplete', 'warning');

  if (f.openAlerts > 0) add('open_alerts', 'critical');
  if (f.failed24h > 0) {
    const high = f.runs24h >= t.minRuns && (f.failed24h / f.runs24h) * 100 >= t.thresholdPct;
    add(high ? 'failure_rate_high' : 'failures_24h', high ? 'critical' : 'warning');
  }
  const level: McpLevel = reasons.some((r) => r.level === 'critical') ? 'critical' : reasons.length ? 'warning' : 'ok';
  return { level, reasons };
}

/** Schlimmstes Urteil über alle Instanzen; ausgeschaltete zählen nicht. */
export function overall(levels: Verdict['level'][]): McpLevel {
  if (levels.includes('critical')) return 'critical';
  return levels.includes('warning') ? 'warning' : 'ok';
}
