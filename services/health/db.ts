/** Eigene Datenbank des Health-Dienstes. Kennt keine Workflows oder API-Keys – nur Ausführungen und Warnungen. */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { HealthSettings } from '../../shared/executions.ts';

export const DATA_DIR = path.resolve(process.env.HEALTH_DATA_DIR ?? process.env.DATA_DIR ?? 'data');

process.umask(0o077);
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

export const db = new DatabaseSync(path.join(DATA_DIR, 'health.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Eine Zeile pro n8n-Ausführung, ohne Laufzeitdaten
  CREATE TABLE IF NOT EXISTS executions (
    instance_id         INTEGER NOT NULL,   -- ID der Instanz im Core
    id                  TEXT NOT NULL,      -- Ausführungs-ID in n8n
    seq                 INTEGER NOT NULL,   -- numerische ID für "bis hierhin schon bekannt"
    workflow_n8n_id     TEXT NOT NULL,
    status              TEXT NOT NULL,
    mode                TEXT NOT NULL,
    started_at          INTEGER,
    stopped_at          INTEGER,
    workflow_version_id TEXT,
    error_node          TEXT,
    error_message       TEXT,
    PRIMARY KEY (instance_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_exec_wf ON executions(instance_id, workflow_n8n_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_exec_seq ON executions(instance_id, seq);

  CREATE TABLE IF NOT EXISTS poll_state (
    instance_id  INTEGER PRIMARY KEY,
    name         TEXT NOT NULL DEFAULT '',
    last_poll_at INTEGER,
    ok           INTEGER,
    error        TEXT,
    error_seq    INTEGER NOT NULL DEFAULT 0   -- bis hierhin sind Fehlerdetails (Node, Meldung) geholt
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id         INTEGER NOT NULL,     -- ID im Core
    workflow_name       TEXT NOT NULL,
    instance_id         INTEGER NOT NULL,
    instance_name       TEXT NOT NULL,
    version_id          INTEGER NOT NULL,
    version_number      INTEGER NOT NULL,
    rate                REAL NOT NULL,
    total               INTEGER NOT NULL,
    failed              INTEGER NOT NULL,
    baseline_rate       REAL NOT NULL,
    baseline_total      INTEGER NOT NULL,
    rollback_version_id INTEGER,
    rollback_number     INTEGER,
    failing_nodes       TEXT NOT NULL DEFAULT '[]',
    status              TEXT NOT NULL DEFAULT 'open',  -- open | dismissed | resolved
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    UNIQUE (workflow_id, version_id)
  );
`);

export const DEFAULT_SETTINGS: HealthSettings = {
  enabled: true,
  pollMinutes: 5,
  lookbackDays: 14,
  retentionDays: 30,
  minRuns: 5,
  thresholdPct: 20,
  includeManual: false,
  alerts: true,
};

const LIMITS: Record<keyof HealthSettings, [number, number] | null> = {
  enabled: null,
  pollMinutes: [1, 1440],
  lookbackDays: [1, 90],
  retentionDays: [1, 365],
  minRuns: [1, 1000],
  thresholdPct: [1, 100],
  includeManual: null,
  alerts: null,
};

export function getSettings(): HealthSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'settings'").get() as { value: string } | undefined;
  return { ...DEFAULT_SETTINGS, ...(row ? (JSON.parse(row.value) as Partial<HealthSettings>) : {}) };
}

export function saveSettings(input: Record<string, unknown>): HealthSettings {
  const next = getSettings() as unknown as Record<string, number | boolean>;
  for (const [key, lim] of Object.entries(LIMITS)) {
    const v = input[key];
    if (v === undefined) continue;
    if (lim) {
      const n = Math.round(Number(v));
      if (Number.isFinite(n)) next[key] = Math.max(lim[0], Math.min(lim[1], n));
    } else next[key] = !!v;
  }
  if ((next.retentionDays as number) < (next.lookbackDays as number)) next.retentionDays = next.lookbackDays;
  db.prepare("INSERT INTO settings (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify(next),
  );
  return next as unknown as HealthSettings;
}
