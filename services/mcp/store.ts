/**
 * Eigene Datenbank des MCP-Dienstes (mcp.db): Ein/Aus und Agent-Tokens.
 * Von jedem Token steht nur der SHA-256 hier; das Token selbst gibt es genau einmal beim Anlegen.
 */
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { McpCreatedToken, McpState, McpToken } from '../../shared/mcp.ts';
import { HttpError } from '../../shared/i18n/server.ts';

export const TOKEN_PREFIX = 'fv_mcp_';
const MAX_TOKENS = 50;
/** „Zuletzt benutzt“ höchstens einmal pro Minute schreiben */
const TOUCH_EVERY = 60_000;

/** Wer fragt: ein Agent-Token, ggf. auf Instanzen beschränkt (null = alle). */
export interface Scope {
  tokenId: number;
  name: string;
  instances: number[] | null;
}

interface TokenRow {
  id: number;
  name: string;
  hint: string;
  instances: string | null;
  created_at: number;
  last_used_at: number | null;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function toToken(r: TokenRow): McpToken {
  return {
    id: r.id,
    name: r.name,
    hint: r.hint,
    instances: r.instances ? (JSON.parse(r.instances) as number[]) : null,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  };
}

function parseInstances(v: unknown): number[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || !v.length || v.length > 200 || !v.every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw new HttpError(400, 'errors.mcp.invalidInstances');
  }
  return [...new Set(v as number[])].sort((a, b) => a - b);
}

export function createStore(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      hash         TEXT NOT NULL UNIQUE,   -- SHA-256 des Tokens
      hint         TEXT NOT NULL,          -- Anfang zum Wiedererkennen
      instances    TEXT,                   -- JSON-Liste erlaubter Instanzen, NULL = alle
      created_at   INTEGER NOT NULL,
      last_used_at INTEGER
    );
  `);

  const list = () => (db.prepare('SELECT * FROM tokens ORDER BY id').all() as unknown as TokenRow[]).map(toToken);

  return {
    /** Standardmäßig aus: Erst ein Admin schaltet den Zugang für Agents frei. */
    enabled(): boolean {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'enabled'").get() as { value: string } | undefined;
      return row?.value === '1';
    },

    setEnabled(on: boolean) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
        on ? '1' : '0',
      );
    },

    state(): McpState {
      return { enabled: this.enabled(), tokens: list() };
    },

    create(input: { name?: unknown; instances?: unknown }, now = Date.now()): McpCreatedToken {
      const name = String(input.name ?? '').replace(/\s+/g, ' ').trim();
      if (!name) throw new HttpError(400, 'errors.mcp.nameMissing');
      if (name.length > 60) throw new HttpError(400, 'errors.mcp.nameTooLong');
      const instances = parseInstances(input.instances);
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM tokens').get() as { n: number };
      if (n >= MAX_TOKENS) throw new HttpError(400, 'errors.mcp.tooManyTokens', { max: MAX_TOKENS });
      const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
      const hint = `${token.slice(0, TOKEN_PREFIX.length + 4)}…`;
      const r = db
        .prepare('INSERT INTO tokens (name, hash, hint, instances, created_at) VALUES (?,?,?,?,?)')
        .run(name, sha256(token), hint, instances ? JSON.stringify(instances) : null, now);
      const row = db.prepare('SELECT * FROM tokens WHERE id = ?').get(Number(r.lastInsertRowid)) as unknown as TokenRow;
      return { token, info: toToken(row) };
    },

    revoke(id: number): boolean {
      return db.prepare('DELETE FROM tokens WHERE id = ?').run(id).changes > 0;
    },

    /** Prüft `Authorization: Bearer fv_mcp_…`. Gibt den Geltungsbereich zurück oder null. */
    authenticate(header: unknown, now = Date.now()): Scope | null {
      if (typeof header !== 'string') return null;
      const token = /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1];
      if (!token?.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
      const row = db.prepare('SELECT * FROM tokens WHERE hash = ?').get(sha256(token)) as unknown as TokenRow | undefined;
      if (!row) return null;
      if (!row.last_used_at || now - row.last_used_at > TOUCH_EVERY) {
        db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(now, row.id);
      }
      const t = toToken(row);
      return { tokenId: t.id, name: t.name, instances: t.instances };
    },
  };
}

export type Store = ReturnType<typeof createStore>;
