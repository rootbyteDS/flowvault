/**
 * KI-Änderungstexte über Melious (OpenAI-kompatibel, EU-Infrastruktur).
 * https://melious.ai – POST /v1/chat/completions, GET /v1/models
 */
import { db, getSetting, setSetting } from './db.ts';
import { decrypt, encrypt, unpack } from './crypto.ts';
import { FetchError, errorMessageFrom, safeFetch } from './net.ts';
import { diffWorkflows, type Snapshot, type WfNode, type WorkflowDiff } from '../shared/diff.ts';

export const DEFAULT_BASE_URL = 'https://api.melious.ai/v1';
export const DEFAULT_MODEL = 'qwen3.6-35b-a3b';

export interface AiConfig {
  enabled: boolean;
  auto: boolean;
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

export interface AiSummary {
  title: string;
  details: string[];
}

export function getAiConfig(): AiConfig {
  const enc = getSetting('ai_api_key');
  let apiKey: string | null = null;
  try {
    apiKey = enc ? decrypt(enc) : null;
  } catch {
    apiKey = null;
  }
  return {
    enabled: getSetting('ai_enabled') === '1',
    auto: getSetting('ai_auto') !== '0',
    baseUrl: getSetting('ai_base_url') || DEFAULT_BASE_URL,
    model: getSetting('ai_model') || DEFAULT_MODEL,
    apiKey,
  };
}

export function publicAiConfig() {
  const c = getAiConfig();
  return {
    enabled: c.enabled,
    auto: c.auto,
    base_url: c.baseUrl,
    model: c.model,
    configured: !!c.apiKey,
    key_hint: c.apiKey ? '…' + c.apiKey.slice(-4) : null,
    pending: (db.prepare("SELECT COUNT(*) AS n FROM versions WHERE ai_status = 'pending'").get() as { n: number }).n,
    missing: (db.prepare("SELECT COUNT(*) AS n FROM versions WHERE ai_summary IS NULL AND summary NOT LIKE '%\"initial\":true%' AND summary NOT LIKE '%restoredFrom%'").get() as { n: number }).n,
  };
}

export function saveAiConfig(input: { enabled?: boolean; auto?: boolean; base_url?: string; model?: string; api_key?: string }) {
  if (input.enabled !== undefined) setSetting('ai_enabled', input.enabled ? '1' : '0');
  if (input.auto !== undefined) setSetting('ai_auto', input.auto ? '1' : '0');
  if (input.base_url !== undefined) setSetting('ai_base_url', normalizeBase(input.base_url) || DEFAULT_BASE_URL);
  if (input.model !== undefined) setSetting('ai_model', input.model.trim() || DEFAULT_MODEL);
  if (input.api_key) setSetting('ai_api_key', encrypt(input.api_key.trim()));
}

function normalizeBase(url: string) {
  let u = url.trim().replace(/\/+$/, '');
  if (u && !/\/v1$/.test(u)) u += '/v1';
  return u;
}

/**
 * Würde der gespeicherte Key bei dieser Adresse an einen anderen Server gehen?
 * Dann muss der Key neu eingegeben werden – sonst ließe er sich mit einer
 * gestohlenen Sitzung an einen beliebigen Server umleiten.
 */
export function wouldMoveStoredKey(baseUrl: string | undefined) {
  const c = getAiConfig();
  if (!c.apiKey || baseUrl === undefined) return false;
  return (normalizeBase(baseUrl) || DEFAULT_BASE_URL) !== c.baseUrl;
}
export const KEY_REQUIRED_AI = 'Bei geänderter API-Adresse bitte den API-Key erneut eingeben';

async function call<T>(cfg: { baseUrl: string; apiKey: string }, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await safeFetch(`${cfg.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    if (e instanceof FetchError) throw e;
    const cause = (e as { cause?: { code?: string } }).cause;
    throw new Error(`Melious nicht erreichbar (${cause?.code ?? (e as Error).message})`);
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = errorMessageFrom(text, res.status);
    if (res.status === 401) msg = 'API-Key ungültig (401)';
    throw new FetchError(msg.slice(0, 300), res.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FetchError('Antwort ist kein JSON – stimmt die API-Adresse?', res.status);
  }
}

export async function listModels(override?: { baseUrl?: string; apiKey?: string }) {
  const c = getAiConfig();
  if (!override?.apiKey && override?.baseUrl && wouldMoveStoredKey(override.baseUrl)) throw new Error(KEY_REQUIRED_AI);
  const apiKey = override?.apiKey || c.apiKey;
  if (!apiKey) throw new Error('Kein Melious-API-Key hinterlegt');
  const r = await call<{ data: { id: string }[] }>({ baseUrl: normalizeBase(override?.baseUrl || c.baseUrl), apiKey }, '/models');
  return r.data.map((m) => m.id).sort();
}

// ───────────── Prompt ─────────────

const SECRET_KEY = /pass(word|wd|phrase)?|secret|token|api[-_]?key|access[-_]?key|authorization|x[-_]auth|bearer|private[-_]?key|cookie|session|signature/i;

/** Typische Key-Formate – werden auch mitten in Code, URLs und Freitext ersetzt. */
const SECRET_VALUES: RegExp[] = [
  /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/g, // OpenAI, Stripe (sk_live_…), Anthropic …
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS Access Key
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API Key
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];
/** Zuweisungen in Code & Query-Strings: password = "…", "token": "…", ?api_key=…, &key=… */
const SECRET_ASSIGN =
  /((?:pass(?:word|wd|phrase)?|secret|token|api[-_]?key|access[-_]?key|auth|signature)["']?\s*[:=]\s*["'`]?|[?&](?:key|sig|code)=)([^\s"'`&,;)}]{4,})/gi;

function redactString(s: string) {
  for (const re of SECRET_VALUES) s = s.replace(re, '[entfernt]');
  return s.replace(SECRET_ASSIGN, '$1[entfernt]');
}

/** Entfernt Werte, die wie Zugangsdaten aussehen, bevor etwas das Haus verlässt. */
export function redact(v: unknown, depth = 0): unknown {
  if (depth > 12) return '…';
  if (typeof v === 'string') {
    const s = redactString(v);
    return s.length > 600 ? s.slice(0, 600) + '…' : s;
  }
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => redact(x, depth + 1));
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    // n8n speichert Header/Query-Parameter als { name, value } – dann zählt der Name
    const secretPair = typeof o.name === 'string' && SECRET_KEY.test(o.name);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      out[k] = SECRET_KEY.test(k) || (secretPair && k === 'value') ? '[entfernt]' : redact(val, depth + 1);
    }
    return out;
  }
  return v;
}

const short = (v: unknown, max = 500) => {
  const s = JSON.stringify(redact(v));
  return s === undefined ? 'leer' : s.length > max ? s.slice(0, max) + '…' : s;
};
const typeName = (n: WfNode) => n.type.split('.').pop();

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function buildPrompt(prev: Snapshot | null, snap: Snapshot, diff: WorkflowDiff): string {
  const L: string[] = [];
  const s = diff.summary;
  L.push(`Workflow: "${snap.name}"`);
  if (snap.tags.length) L.push(`Tags: ${snap.tags.join(', ')}`);

  if (!prev) {
    L.push('', 'Dies ist die erste gesicherte Version. Beschreibe, was der Workflow tut.', '', 'Nodes:');
    for (const n of snap.nodes.slice(0, 60)) {
      if (n.type === 'n8n-nodes-base.stickyNote') {
        L.push(`- Notiz: ${short(n.parameters?.content, 300)}`);
        continue;
      }
      L.push(`- "${n.name}" (${typeName(n)}): ${short(n.parameters, 300)}`);
    }
    const edges = diff.edges.map((e) => `${e.fromName} → ${e.toName}`);
    if (edges.length) L.push('', `Verbindungen: ${edges.slice(0, 60).join('; ')}`);
  } else {
    L.push('', 'Änderungen gegenüber der vorherigen Version:');
    if (s.nameChanged) L.push(`- Workflow umbenannt: "${s.nameChanged.from}" → "${s.nameChanged.to}"`);
    if (s.activeChanged !== undefined) L.push(`- Workflow ${s.activeChanged ? 'aktiviert' : 'deaktiviert'}`);
    if (s.tagsChanged) L.push(`- Tags: [${prev.tags.join(', ')}] → [${snap.tags.join(', ')}]`);

    for (const c of diff.nodes) {
      if (c.status === 'added') L.push(`- Node hinzugefügt: "${c.after!.name}" (${typeName(c.after!)}) mit ${short(c.after!.parameters)}`);
      if (c.status === 'removed') L.push(`- Node entfernt: "${c.before!.name}" (${typeName(c.before!)})`);
      if (c.renamed) L.push(`- Node umbenannt: "${c.before!.name}" → "${c.after!.name}"`);
      if (c.status === 'modified') {
        L.push(`- Node geändert: "${c.after!.name}" (${typeName(c.after!)})`);
        for (const f of c.fields.slice(0, 12)) {
          L.push(`    ${f}: ${short(getPath(c.before, f), 300)} → ${short(getPath(c.after, f), 300)}`);
        }
      }
    }
    for (const e of diff.edges) {
      if (e.status === 'added') L.push(`- Verbindung neu: ${e.fromName}${e.outputIndex ? ` (Ausgang ${e.outputIndex + 1})` : ''} → ${e.toName}`);
      if (e.status === 'removed') L.push(`- Verbindung entfernt: ${e.fromName} → ${e.toName}`);
    }
    if (s.settingsChanged) L.push(`- Einstellungen: ${short(prev.settings)} → ${short(snap.settings)}`);
    if (s.pinDataChanged) L.push('- Testdaten (Pin Data) geändert');
    if (s.moved.length) L.push(`- Nur verschoben (Layout): ${s.moved.join(', ')}`);

    const flow = diff.edges.filter((e) => e.status !== 'removed').map((e) => `${e.fromName} → ${e.toName}`);
    L.push('', `Zum Kontext, aktueller Ablauf: ${flow.slice(0, 40).join('; ') || snap.nodes.map((n) => n.name).join(', ')}`);
  }
  const text = L.join('\n');
  return text.length > 14_000 ? text.slice(0, 14_000) + '\n…(gekürzt)' : text;
}

const SYSTEM = `Du schreibst Änderungsbeschreibungen für n8n-Workflows, so wie gute Git-Commit-Nachrichten.
Antworte ausschließlich mit JSON in der Form {"title": string, "details": string[]}.
- title: Deutsch, höchstens 72 Zeichen, ohne Punkt am Ende. Beschreibe den fachlichen Zweck der Änderung, z. B. "Slack-Hinweis bei neuen Leads ergänzt" oder "Stripe-Abruf auf Zahlungen der letzten 24 h begrenzt". Bei einer ersten Version: was der Workflow tut, z. B. "Leads aus Webformular ins CRM übertragen".
- details: 0 bis 4 kurze Stichpunkte auf Deutsch mit den konkreten Änderungen (welcher Node, welcher Wert). Bei reinen Layout-Änderungen eine leere Liste.
- Nenne nur, was in den Daten steht. Keine Vermutungen, keine Emojis, keine Werbesprache.`;

function parseSummary(content: string): AiSummary {
  const clean = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(match ? match[0] : clean);
    const title = String(j.title ?? '').trim().replace(/\.$/, '').slice(0, 120);
    const details = Array.isArray(j.details) ? j.details.map((d: unknown) => String(d).trim().replace(/^[-•]\s*/, '')).filter(Boolean).slice(0, 6) : [];
    if (title) return { title, details };
  } catch {}
  const lines = clean.split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  return { title: (lines[0] ?? 'Änderung').slice(0, 120), details: lines.slice(1, 5) };
}

export async function summarize(prev: Snapshot | null, snap: Snapshot): Promise<{ summary: AiSummary; model: string }> {
  const c = getAiConfig();
  if (!c.apiKey) throw new Error('Kein Melious-API-Key hinterlegt');
  const diff = diffWorkflows(prev, snap);
  const body = {
    model: c.model,
    temperature: 0.2,
    max_tokens: 500,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildPrompt(prev, snap, diff) },
    ],
  };
  type Resp = { model?: string; choices: { message: { content: string | null; reasoning_content?: string } }[] };
  let r: Resp;
  try {
    r = await call<Resp>({ baseUrl: c.baseUrl, apiKey: c.apiKey }, '/chat/completions', { ...body, response_format: { type: 'json_object' } });
  } catch (e) {
    // Nicht jedes Modell kann JSON-Modus – dann ohne versuchen
    if ((e as { status?: number }).status === 400) r = await call<Resp>({ baseUrl: c.baseUrl, apiKey: c.apiKey }, '/chat/completions', body);
    else throw e;
  }
  const content = r.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new Error('Leere Antwort vom Modell');
  return { summary: parseSummary(content), model: r.model ?? c.model };
}

// ───────────── Warteschlange ─────────────

const queue: number[] = [];
let pumping = false;

function snapshotOf(versionId: number) {
  const row = db.prepare('SELECT snapshot FROM versions WHERE id = ?').get(versionId) as { snapshot: Uint8Array } | undefined;
  return row ? unpack<Snapshot>(row.snapshot) : null;
}

export async function generateForVersion(versionId: number) {
  const v = db.prepare('SELECT id, workflow_id, number FROM versions WHERE id = ?').get(versionId) as
    | { id: number; workflow_id: number; number: number }
    | undefined;
  if (!v) throw new Error('Version nicht gefunden');
  const prevRow = db.prepare('SELECT id FROM versions WHERE workflow_id = ? AND number < ? ORDER BY number DESC LIMIT 1').get(v.workflow_id, v.number) as
    | { id: number }
    | undefined;
  db.prepare("UPDATE versions SET ai_status = 'pending', ai_error = NULL WHERE id = ?").run(v.id);
  try {
    const { summary, model } = await summarize(prevRow ? snapshotOf(prevRow.id) : null, snapshotOf(v.id)!);
    db.prepare("UPDATE versions SET ai_summary = ?, ai_model = ?, ai_status = 'done', ai_error = NULL WHERE id = ?").run(JSON.stringify(summary), model, v.id);
    return summary;
  } catch (e) {
    db.prepare("UPDATE versions SET ai_status = 'error', ai_error = ? WHERE id = ?").run((e as Error).message.slice(0, 300), v.id);
    throw e;
  }
}

export function enqueue(ids: number[]) {
  for (const id of ids) {
    if (queue.includes(id)) continue;
    db.prepare("UPDATE versions SET ai_status = 'pending', ai_error = NULL WHERE id = ?").run(id);
    queue.push(id);
  }
  void pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      if (!getAiConfig().enabled) {
        db.prepare("UPDATE versions SET ai_status = NULL WHERE id = ? AND ai_status = 'pending'").run(id);
        continue;
      }
      try {
        await generateForVersion(id);
      } catch (e) {
        console.warn(`[ai] Version ${id}: ${(e as Error).message}`);
        if ((e as { status?: number }).status === 429) await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  } finally {
    pumping = false;
  }
}

/** Wird beim Anlegen einer Version aufgerufen. Erste Sicherungen & Wiederherstellungen brauchen keinen KI-Text. */
export function onVersionCreated(versionId: number, kind: 'created' | 'changed' | 'restored') {
  const c = getAiConfig();
  if (kind !== 'changed' || !c.enabled || !c.auto || !c.apiKey) return;
  enqueue([versionId]);
}

/** Beim Start liegengebliebene Aufträge fortsetzen. */
export function resumeQueue() {
  const rows = db.prepare("SELECT id FROM versions WHERE ai_status = 'pending' ORDER BY id").all() as { id: number }[];
  if (rows.length && getAiConfig().enabled) enqueue(rows.map((r) => r.id));
  else db.prepare("UPDATE versions SET ai_status = NULL WHERE ai_status = 'pending'").run();
}

export function backfill(limit = 200) {
  const rows = db
    .prepare(
      `SELECT id FROM versions WHERE ai_summary IS NULL AND (ai_status IS NULL OR ai_status = 'error')
         AND summary NOT LIKE '%"initial":true%' AND summary NOT LIKE '%restoredFrom%'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as { id: number }[];
  enqueue(rows.map((r) => r.id));
  return rows.length;
}
