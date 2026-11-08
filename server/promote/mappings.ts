/**
 * Umgebungen (Staging → Prod): Speicher und Auflösung der ID-Zuordnungen.
 *
 * Das Modul bringt seine eigenen Tabellen mit (Migration beim ersten Import) und
 * greift ansonsten nur lesend auf die Workflows/Snapshots des Cores zu. Vorschläge
 * entstehen aus zwei Quellen: der n8n Public API (Credentials, soweit der API-Key
 * sie hergibt) und den gespeicherten Snapshots selbst – dort stehen alle Referenzen,
 * die ein Workflow tatsächlich benutzt.
 */
import { db } from '../db.ts';
import { decrypt, unpack } from '../crypto.ts';
import { N8nClient } from '../n8n.ts';
import type { InstanceRow, WorkflowRow } from '../sync.ts';
import type { Snapshot } from '../../shared/diff.ts';
import { emptyMappingSet, type MappingKind, type MappingSet } from './transform.ts';

export const MAPPING_KINDS: MappingKind[] = ['credential', 'workflow', 'webhookPath', 'dataTable'];

db.exec(`
  CREATE TABLE IF NOT EXISTS env_mappings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id  INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    target_id  INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,             -- credential | workflow | webhookPath | dataTable
    from_value TEXT NOT NULL,
    from_name  TEXT,
    to_value   TEXT NOT NULL,
    to_name    TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (source_id, target_id, kind, from_value)
  );
`);

export interface MappingRow {
  id: number;
  kind: MappingKind;
  from: string;
  fromName: string | null;
  to: string;
  toName: string | null;
}

// ───────────────────────── Speichern / Laden ─────────────────────────

function toRow(r: Record<string, unknown>): MappingRow {
  return { id: Number(r.id), kind: String(r.kind) as MappingKind, from: String(r.from_value), fromName: (r.from_name as string) ?? null, to: String(r.to_value), toName: (r.to_name as string) ?? null };
}

export function listMappings(sourceId: number, targetId: number): MappingRow[] {
  const rows = db
    .prepare(`SELECT * FROM env_mappings WHERE source_id = ? AND target_id = ? ORDER BY kind, COALESCE(from_name, from_value) COLLATE NOCASE`)
    .all(sourceId, targetId) as unknown as Record<string, unknown>[];
  return rows.map(toRow).filter((m) => MAPPING_KINDS.includes(m.kind));
}

export function upsertMapping(sourceId: number, targetId: number, input: { kind: MappingKind; from: string; fromName?: string | null; to: string; toName?: string | null }) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO env_mappings (source_id, target_id, kind, from_value, from_name, to_value, to_name, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(source_id, target_id, kind, from_value)
       DO UPDATE SET to_value = excluded.to_value, to_name = excluded.to_name, from_name = COALESCE(excluded.from_name, from_name), updated_at = excluded.updated_at`,
  ).run(sourceId, targetId, input.kind, input.from, input.fromName ?? null, input.to, input.toName ?? null, now, now);
}

/** Workflow-Paarung merken – dadurch trifft die Übernahme auch nach Umbenennungen das richtige Ziel. */
export function setWorkflowMapping(sourceId: number, targetId: number, fromN8nId: string, fromName: string, toN8nId: string, toName: string) {
  upsertMapping(sourceId, targetId, { kind: 'workflow', from: fromN8nId, fromName, to: toN8nId, toName });
}

export function deleteMapping(sourceId: number, targetId: number, kind: string, from: string): boolean {
  const r = db.prepare('DELETE FROM env_mappings WHERE source_id = ? AND target_id = ? AND kind = ? AND from_value = ?').run(sourceId, targetId, kind, from);
  return Number(r.changes) > 0;
}

/** Alle Zuordnungen eines Instanz-Paares als Maps für transform.ts. */
export function mappingSetFor(sourceId: number, targetId: number): MappingSet {
  const set = emptyMappingSet();
  for (const m of listMappings(sourceId, targetId)) {
    if (m.kind === 'credential') {
      // Ohne Zielnamen kann n8n das Credential nicht sauber auflösen – dann als ID-Zuordnung mit ID als Name.
      set.credentials.set(m.from, { id: m.to, name: m.toName ?? m.to });
    } else if (m.kind === 'workflow') {
      set.workflows.set(m.from, m.to);
    } else if (m.kind === 'webhookPath') {
      set.webhookPaths.set(m.from, m.to);
    } else if (m.kind === 'dataTable') {
      set.dataTables.set(m.from, m.to);
    }
  }
  return set;
}

/** n8n_id → Workflow-Name einer Instanz (für lesbare Meldungen). */
export function workflowNamesFor(instanceId: number): Map<string, string> {
  const rows = db.prepare('SELECT n8n_id, name FROM workflows WHERE instance_id = ?').all(instanceId) as { n8n_id: string; name: string }[];
  return new Map(rows.map((r) => [r.n8n_id, r.name]));
}

/** Namen beider Instanzen – Meldungen nennen sonst beim Ziel die Roh-ID. */
export function workflowLabelsFor(sourceId: number, targetId: number): Map<string, string> {
  return new Map([...workflowNamesFor(sourceId), ...workflowNamesFor(targetId)]);
}

// ───────────────────────── Snapshots der Instanz ─────────────────────────

export interface LatestWorkflow {
  row: WorkflowRow;
  versionId: number;
  versionNumber: number;
  snap: Snapshot;
}

/** Letzte gesicherte Version jedes Workflows einer Instanz (Standard: ohne gelöschte). */
export function latestWorkflows(instanceId: number, opts: { includeDeleted?: boolean } = {}): LatestWorkflow[] {
  const rows = db
    .prepare(
      `SELECT w.*,
              (SELECT id FROM versions WHERE workflow_id = w.id ORDER BY number DESC LIMIT 1) AS version_id,
              (SELECT number FROM versions WHERE workflow_id = w.id ORDER BY number DESC LIMIT 1) AS version_number
         FROM workflows w
        WHERE w.instance_id = ? ${opts.includeDeleted ? '' : 'AND w.deleted_at IS NULL'}`,
    )
    .all(instanceId) as unknown as (WorkflowRow & { version_id: number | null; version_number: number | null })[];
  const out: LatestWorkflow[] = [];
  for (const r of rows) {
    if (!r.version_id || !r.version_number) continue;
    const packed = db.prepare('SELECT snapshot FROM versions WHERE id = ?').get(r.version_id) as { snapshot: Uint8Array } | undefined;
    if (!packed) continue;
    out.push({ row: r, versionId: r.version_id, versionNumber: r.version_number, snap: unpack<Snapshot>(packed.snapshot) });
  }
  return out;
}

// ───────────────────────── Referenzen in Snapshots ─────────────────────────

export interface CredentialRef {
  id: string;
  name: string;
  type: string;
}

/** Alle benutzten Credentials: { slackApi: { id, name } } je Node. */
export function credentialRefs(snaps: Snapshot[]): Map<string, CredentialRef> {
  const out = new Map<string, CredentialRef>();
  for (const s of snaps) {
    for (const n of s.nodes ?? []) {
      if (!n.credentials || typeof n.credentials !== 'object') continue;
      for (const [type, raw] of Object.entries(n.credentials)) {
        if (!raw || typeof raw !== 'object' || typeof (raw as { id?: unknown }).id !== 'string') continue;
        const c = raw as { id: string; name?: string };
        if (!out.has(c.id)) out.set(c.id, { id: c.id, name: c.name ?? c.id, type });
      }
    }
  }
  return out;
}

/** Distinct Data-Table-Referenzen (Parameter „dataTableId“). */
export function dataTableValues(snaps: Snapshot[]): string[] {
  const out = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    for (const [k, v] of Object.entries(value)) {
      if (k === 'dataTableId' && typeof v === 'string' && v) out.add(v);
      else walk(v);
    }
  };
  for (const s of snaps) {
    for (const n of s.nodes ?? []) walk(n.parameters);
  }
  return [...out];
}

/** Webhook-Pfade (direkt am Webhook-Node). */
export function webhookPaths(snaps: Snapshot[]): string[] {
  const out = new Set<string>();
  for (const s of snaps) {
    for (const n of s.nodes ?? []) {
      if (!/n8n-nodes-base\.webhook$/i.test(n.type ?? '')) continue;
      const p = (n.parameters ?? {}) as Record<string, unknown>;
      if (typeof p.path === 'string' && p.path) out.add(p.path);
    }
  }
  return [...out];
}

/** Referenzierte Workflow-IDs: Execute-Workflow-Nodes und Error-Workflow-Settings. */
export function referencedWorkflowIds(snaps: Snapshot[]): Set<string> {
  const out = new Set<string>();
  for (const s of snaps) {
    for (const n of s.nodes ?? []) {
      if (!/executeWorkflow/i.test(n.type ?? '')) continue;
      const p = (n.parameters ?? {}) as Record<string, unknown>;
      if (typeof p.workflowId === 'string' && p.workflowId && !p.workflowId.startsWith('=')) out.add(p.workflowId);
    }
    const ew = s.settings?.['errorWorkflow'];
    if (typeof ew === 'string' && ew && !ew.startsWith('=')) out.add(ew);
  }
  return out;
}

// ───────────────────────── Workflow-Paarung ─────────────────────────

export interface TargetMatch {
  row: WorkflowRow;
  matchedBy: 'mapping' | 'id' | 'name';
}

/**
 * Findet den Ziel-Workflow auf der Ziel-Instanz: erst die gespeicherte Zuordnung,
 * dann die gleiche n8n-ID (bei geklonten Instanzen), dann ein eindeutiger Name.
 */
export function targetWorkflowFor(sourceInstanceId: number, targetInstanceId: number, sourceN8nId: string, sourceName: string): TargetMatch | null {
  const byMapping = db
    .prepare('SELECT to_value FROM env_mappings WHERE source_id = ? AND target_id = ? AND kind = ? AND from_value = ?')
    .get(sourceInstanceId, targetInstanceId, 'workflow', sourceN8nId) as { to_value: string } | undefined;
  const byId = db
    .prepare('SELECT * FROM workflows WHERE instance_id = ? AND n8n_id = ? AND deleted_at IS NULL')
    .get(targetInstanceId, sourceN8nId) as unknown as WorkflowRow | undefined;
  if (byId) return { row: byId, matchedBy: byMapping?.to_value === sourceN8nId ? 'mapping' : 'id' };
  if (byMapping) {
    const mapped = db
      .prepare('SELECT * FROM workflows WHERE instance_id = ? AND n8n_id = ? AND deleted_at IS NULL')
      .get(targetInstanceId, byMapping.to_value) as unknown as WorkflowRow | undefined;
    // Gemappter Workflow existiert nicht mehr auf dem Ziel → neu anlegen (Zuordnung wird dann erneuert)
    if (mapped) return { row: mapped, matchedBy: 'mapping' };
  }
  const byName = db
    .prepare('SELECT * FROM workflows WHERE instance_id = ? AND name = ? AND deleted_at IS NULL')
    .all(targetInstanceId, sourceName) as unknown as WorkflowRow[];
  if (byName.length === 1) return { row: byName[0], matchedBy: 'name' };
  return null;
}

// ───────────────────────── Vorschläge ─────────────────────────

export interface MappingCandidate {
  value: string;
  label: string;
  /** Name auf der Ziel-Instanz – n8n speichert bei Credentials ID und Namen */
  name: string;
  hint?: string;
}

export interface Suggestion {
  kind: MappingKind;
  from: string;
  fromName: string | null;
  /** Vorschlag, null = selbst wählen */
  to: string | null;
  toName: string | null;
  /** Ziel-Auswahlmöglichkeiten für die Oberfläche */
  candidates: MappingCandidate[];
  reason: string;
}

const ENV_WORDS = /^(staging|stage|stg|prod|production|prd|live|dev|test|tst|qa|prelive|preprod)$/i;

/**
 * Namen ohne Umgebungszusatz: „Slack Staging“ und „Slack Prod“ → „slack“.
 * Zusätze werden nur an den Enden entfernt, nie der ganze Name.
 */
export function normalizeEnvName(name: string): string {
  const tokens = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  while (tokens.length > 1 && ENV_WORDS.test(tokens[0]!)) tokens.shift();
  while (tokens.length > 1 && ENV_WORDS.test(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join('-');
}

function clientFor(inst: InstanceRow) {
  return new N8nClient(inst.base_url, decrypt(inst.api_key_enc));
}

/**
 * Vorschläge für Zuordnungen eines Paares. Automatisch (mit Ziel) nur, wo der
 * Name eindeutig passt; alles andere erscheint als Auswahl mit Kandidaten.
 */
export async function suggestMappings(source: InstanceRow, target: InstanceRow): Promise<Suggestion[]> {
  const sourceLatest = latestWorkflows(source.id);
  const targetLatest = latestWorkflows(target.id);
  const existing = new Set(listMappings(source.id, target.id).map((m) => `${m.kind}:${m.from}`));
  const out: Suggestion[] = [];

  // ── Credentials ──
  // Ziel-Kandidaten: Public API (wenn der Key sie hergibt) plus alles, was in den
  // gesicherten Ziel-Workflows referenziert wird. Gleiche ID auf beiden Seiten
  // braucht keine Zuordnung.
  let apiCreds: { id: string; name: string; type: string }[] | null = null;
  try {
    apiCreds = await clientFor(target).listCredentials();
  } catch {
    apiCreds = null;
  }
  const targetCreds = new Map<string, CredentialRef>();
  for (const c of apiCreds ?? []) targetCreds.set(c.id, { id: c.id, name: c.name, type: c.type });
  for (const [id, ref] of credentialRefs(targetLatest.map((w) => w.snap))) {
    if (!targetCreds.has(id)) targetCreds.set(id, ref);
  }

  for (const [id, ref] of credentialRefs(sourceLatest.map((w) => w.snap))) {
    if (existing.has(`credential:${id}`) || targetCreds.has(id)) continue;
    const candidates = [...targetCreds.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const ci = (s: string) => s.trim().toLowerCase();
    let match = candidates.find((c) => ci(c.name) === ci(ref.name));
    let reason = 'Gleicher Name auf der Ziel-Instanz';
    if (!match) {
      const norm = normalizeEnvName(ref.name);
      match = candidates.find((c) => normalizeEnvName(c.name) === norm);
      reason = 'Name ohne Umgebungszusatz („Staging“/„Prod“ …) passt';
    }
    if (!match) {
      const sameType = candidates.filter((c) => c.type === ref.type);
      if (sameType.length === 1) {
        match = sameType[0];
        reason = 'Einziger Credential dieses Typs auf der Ziel-Instanz';
      }
    }
    out.push({
      kind: 'credential',
      from: id,
      fromName: ref.name,
      to: match?.id ?? null,
      toName: match?.name ?? null,
      candidates: candidates.map((c) => ({ value: c.id, label: c.name, name: c.name, hint: c.type })),
      reason: match ? reason : 'Kein eindeutiges Gegenstück – bitte zuordnen',
    });
  }

  // ── Sub-Workflows & Error-Workflows ──
  const sourceNames = workflowNamesFor(source.id);
  const targetWorkflows = db
    .prepare('SELECT n8n_id, name FROM workflows WHERE instance_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE LIMIT 100')
    .all(target.id) as { n8n_id: string; name: string }[];
  const targetByName = new Map(targetWorkflows.map((w) => [w.name, w]));
  for (const id of referencedWorkflowIds(sourceLatest.map((w) => w.snap))) {
    if (existing.has(`workflow:${id}`)) continue;
    const byId = db
      .prepare('SELECT n8n_id, name FROM workflows WHERE instance_id = ? AND n8n_id = ? AND deleted_at IS NULL')
      .get(target.id, id) as { n8n_id: string; name: string } | undefined;
    if (byId) continue; // gleiche ID auf beiden Seiten – braucht keine Zuordnung
    const name = sourceNames.get(id) ?? null;
    const match = name ? targetByName.get(name) : undefined;
    out.push({
      kind: 'workflow',
      from: id,
      fromName: name,
      to: match?.n8n_id ?? null,
      toName: match?.name ?? null,
      candidates: targetWorkflows.map((w) => ({ value: w.n8n_id, label: w.name, name: w.name })),
      reason: match ? 'Gleicher Name auf der Ziel-Instanz' : 'Kein Workflow mit diesem Namen auf dem Ziel – bitte zuordnen',
    });
  }

  // ── Webhook-Pfade ──
  const targetPaths = webhookPaths(targetLatest.map((w) => w.snap));
  for (const path of webhookPaths(sourceLatest.map((w) => w.snap))) {
    if (existing.has(`webhookPath:${path}`) || targetPaths.includes(path)) continue; // gleicher Pfad braucht keine Zuordnung
    out.push({
      kind: 'webhookPath',
      from: path,
      fromName: path,
      to: null,
      toName: null,
      candidates: targetPaths.map((p) => ({ value: p, label: p, name: p })),
      reason: 'Pfad unterscheidet sich zwischen den Instanzen – Ziel-Pfad wählen',
    });
  }

  // ── Data-Tables ──
  const targetTables = dataTableValues(targetLatest.map((w) => w.snap));
  const sourceTables = dataTableValues(sourceLatest.map((w) => w.snap)).filter((t) => !existing.has(`dataTable:${t}`));
  for (const table of sourceTables) {
    if (targetTables.includes(table)) continue; // gleicher Bezeichner braucht keine Zuordnung
    const auto = targetTables.length === 1 && sourceTables.length === 1 ? targetTables[0] : null;
    out.push({
      kind: 'dataTable',
      from: table,
      fromName: table,
      to: auto,
      toName: auto,
      candidates: targetTables.map((t) => ({ value: t, label: t, name: t })),
      reason: auto ? 'Einzige Data-Table auf der Ziel-Instanz' : 'Bezeichner auf der Ziel-Instanz wählen',
    });
  }

  return out;
}
