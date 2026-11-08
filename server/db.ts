import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');

// Datenbank (Passwort-Hash, Sitzungen, Workflows) und Schlüssel nur für den eigenen Benutzer lesbar
process.umask(0o077);
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
for (const f of ['flowvault.db', 'flowvault.db-wal', 'flowvault.db-shm', 'secret.key', 'internal.token']) {
  try {
    fs.chmodSync(path.join(DATA_DIR, f), 0o600);
  } catch {}
}

export const db = new DatabaseSync(path.join(DATA_DIR, 'flowvault.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_challenges (
    token         TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    session_token TEXT REFERENCES sessions(token) ON DELETE CASCADE,
    secret_enc    TEXT,
    expires_at    INTEGER NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_auth_challenges_session ON auth_challenges(session_token);

  CREATE TABLE IF NOT EXISTS instances (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    base_url        TEXT NOT NULL,
    api_key_enc     TEXT NOT NULL,
    color           TEXT NOT NULL DEFAULT '#ea4b71',
    sync_interval   INTEGER NOT NULL DEFAULT 15,   -- Minuten, 0 = nur manuell
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_sync_at    INTEGER,
    last_sync_ok    INTEGER,
    last_sync_error TEXT,
    created_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workflows (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id    INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    n8n_id         TEXT NOT NULL,
    name           TEXT NOT NULL,
    active         INTEGER NOT NULL DEFAULT 0,
    archived       INTEGER NOT NULL DEFAULT 0,
    node_count     INTEGER NOT NULL DEFAULT 0,
    tags           TEXT NOT NULL DEFAULT '[]',
    latest_hash    TEXT,
    version_count  INTEGER NOT NULL DEFAULT 0,
    n8n_updated_at TEXT,
    first_seen_at  INTEGER NOT NULL,
    last_seen_at   INTEGER NOT NULL,
    last_change_at INTEGER NOT NULL,
    deleted_at     INTEGER,
    UNIQUE (instance_id, n8n_id)
  );

  CREATE TABLE IF NOT EXISTS versions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id    INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    number         INTEGER NOT NULL,
    hash           TEXT NOT NULL,
    snapshot       BLOB NOT NULL,          -- gzip(JSON)
    summary        TEXT NOT NULL,          -- JSON ChangeSummary
    message        TEXT,                   -- optionale "Commit-Nachricht"
    n8n_version_id TEXT,
    n8n_updated_at TEXT,
    created_at     INTEGER NOT NULL,
    UNIQUE (workflow_id, number)
  );
  CREATE INDEX IF NOT EXISTS idx_versions_created ON versions(created_at DESC);

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
    workflow_id INTEGER REFERENCES workflows(id) ON DELETE CASCADE,
    version_id  INTEGER REFERENCES versions(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,   -- created | changed | deleted | restored | sync_error
    detail      TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);

  CREATE TABLE IF NOT EXISTS sync_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER,
    ok          INTEGER,
    total       INTEGER DEFAULT 0,
    created     INTEGER DEFAULT 0,
    changed     INTEGER DEFAULT 0,
    deleted     INTEGER DEFAULT 0,
    error       TEXT,
    trigger     TEXT NOT NULL DEFAULT 'manual'
  );
`);

// Migrationen: Spalten nachrüsten, ohne bestehende Daten anzufassen
function addColumn(table: string, column: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn('versions', 'ai_summary', 'TEXT'); // JSON { title, details[] }
addColumn('versions', 'ai_status', 'TEXT'); //  pending | done | error
addColumn('versions', 'ai_error', 'TEXT');
addColumn('versions', 'ai_model', 'TEXT');

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// Sitzungs-Tokens werden nur noch gehasht gespeichert – alte Klartext-Sitzungen einmalig verwerfen
if (getSetting('sessions_hashed') !== '1') {
  db.exec('DELETE FROM sessions');
  setSetting('sessions_hashed', '1');
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
