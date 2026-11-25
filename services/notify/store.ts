/**
 * SQLite-Speicher des Notification-Dienstes (notify.db):
 * Einstellungen, QR-Pairing-Codes, gekoppelte Geräte, Nachrichten-Feed (mit Burst-Coalescing),
 * Filterregeln, Ruhezeiten und Lesestände.
 */
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import QRCode from 'qrcode';
import { HttpError } from '../../shared/i18n/server.ts';
import { redactText } from '../../shared/redact.ts';
import {
  categoryOfKind,
  type NotifyBootstrap,
  type NotifyCategory,
  type NotifyChannel,
  type NotifyDevice,
  type NotifyIngestPayload,
  type NotifyKind,
  type NotifyMessage,
  type NotifyMessageMetadata,
  type NotifyPairedResponse,
  type NotifyPairingCreated,
  type NotifyRule,
  type NotifySeverity,
  type NotifyState,
  type PushType,
  type QuietHours,
  type RedactionMode,
} from '../../shared/notify.ts';
import type { CoreInstanceMeta } from './core.ts';

export const TOKEN_PREFIX = 'fv_app_';
const MAX_DEVICES = 50;
const PAIR_TTL_MS = 5 * 60_000;
const PAIR_MAX_ATTEMPTS = 5;
const TOUCH_EVERY_MS = 60_000;
export const COALESCE_WINDOW_MS = 10 * 60_000;
const PUSH_MILESTONES = new Set([1, 10, 50, 100, 500]);

const VALID_REDACTION: ReadonlySet<string> = new Set(['none', 'lockscreen', 'full']);
const VALID_PUSH_TYPE: ReadonlySet<string> = new Set(['none', 'unifiedpush', 'sse_bg']);
const VALID_SEVERITY: ReadonlySet<string> = new Set(['critical', 'high', 'normal', 'info']);
const VALID_KINDS: ReadonlySet<string> = new Set([
  'alert_opened', 'alert_escalated', 'alert_resolved',
  'execution_failed', 'execution_recovered',
  'sync_error', 'sync_recovered',
  'health_poll_error', 'health_poll_recovered',
  'workflow_changed', 'workflow_created', 'workflow_deleted', 'workflow_restored', 'workflow_promoted',
  'initial_sync', 'test',
]);

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

interface DeviceRow {
  id: number;
  name: string;
  platform: string;
  token_hash: string;
  token_hint: string;
  allowed_instances: string | null;
  redaction_mode: RedactionMode;
  push_type: PushType;
  push_endpoint: string | null;
  language: string;
  quiet_hours: string | null;
  created_at: number;
  last_seen_at: number | null;
}

export interface DeviceRecord extends NotifyDevice {
  pushEndpoint: string | null;
}

interface PairingRow {
  id: number;
  code_hash: string;
  label: string;
  allowed_instances: string | null;
  redaction_mode: RedactionMode;
  attempts: number;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

interface MessageRow {
  seq: number;
  updated_seq: number;
  event_uid: string | null;
  group_key: string | null;
  instance_id: number;
  instance_name: string;
  instance_color: string;
  workflow_id: number | null;
  workflow_name: string | null;
  version_id: number | null;
  version_number: number | null;
  alert_id: number | null;
  kind: NotifyKind;
  severity: NotifySeverity;
  title: string;
  body: string;
  metadata: string;
  group_count: number;
  resolved_by_seq: number | null;
  created_at: number;
  updated_at: number;
}

interface RuleRow {
  scope_type: 'global' | 'instance' | 'workflow';
  scope_id: number;
  enabled_kinds: string | null;
  muted_until: number | null;
}

function parseInstances(v: unknown): number[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || !v.length || v.length > 200 || !v.every((n) => Number.isSafeInteger(n) && n > 0)) {
    throw new HttpError(400, 'errors.notify.invalidInstances');
  }
  return [...new Set(v as number[])].sort((a, b) => a - b);
}

function parseRedaction(v: unknown, fallback: RedactionMode): RedactionMode {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string' || !VALID_REDACTION.has(v)) throw new HttpError(400, 'errors.notify.invalidRedaction');
  return v as RedactionMode;
}

function parseQuietHours(v: unknown): QuietHours | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') throw new HttpError(400, 'errors.notify.invalidQuietHours');
  const q = v as Record<string, unknown>;
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  const start = String(q.start ?? '22:00');
  const end = String(q.end ?? '07:00');
  const tz = String(q.tz ?? 'UTC').slice(0, 64);
  if (!timeRe.test(start) || !timeRe.test(end)) throw new HttpError(400, 'errors.notify.invalidQuietHours');
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
  } catch {
    throw new HttpError(400, 'errors.notify.invalidQuietHours');
  }
  return { enabled: !!q.enabled, start, end, tz, allowCritical: q.allowCritical !== false };
}

function toDeviceRecord(r: DeviceRow): DeviceRecord {
  return {
    id: r.id,
    name: r.name,
    platform: r.platform,
    hint: r.token_hint,
    instances: r.allowed_instances ? (JSON.parse(r.allowed_instances) as number[]) : null,
    redactionMode: VALID_REDACTION.has(r.redaction_mode) ? r.redaction_mode : 'lockscreen',
    pushType: VALID_PUSH_TYPE.has(r.push_type) ? r.push_type : 'none',
    pushConfigured: !!r.push_endpoint,
    pushEndpoint: r.push_endpoint,
    language: r.language || 'de',
    quietHours: r.quiet_hours ? (JSON.parse(r.quiet_hours) as QuietHours) : null,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  };
}

export function publicDevice(d: DeviceRecord): NotifyDevice {
  const { pushEndpoint: _omit, ...rest } = d;
  return rest;
}

function toMessage(r: MessageRow): NotifyMessage {
  return {
    seq: r.seq,
    updatedSeq: r.updated_seq,
    instance: { id: r.instance_id, name: r.instance_name, color: r.instance_color },
    workflow: r.workflow_id !== null && r.workflow_name ? { id: r.workflow_id, name: r.workflow_name } : null,
    version: r.version_id !== null && r.version_number !== null ? { id: r.version_id, number: r.version_number } : null,
    alertId: r.alert_id,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    body: r.body,
    groupCount: r.group_count,
    resolvedBySeq: r.resolved_by_seq,
    metadata: r.metadata ? (JSON.parse(r.metadata) as NotifyMessageMetadata) : {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function redactMessage(msg: NotifyMessage, mode: RedactionMode): NotifyMessage {
  if (mode !== 'full') return msg;
  const meta: NotifyMessageMetadata = { ...msg.metadata };
  if (meta.errorMessage) meta.errorMessage = redactText(meta.errorMessage, 300);
  if (meta.errorNode) meta.errorNode = redactText(meta.errorNode, 120);
  if (meta.failingNodes) {
    meta.failingNodes = meta.failingNodes.map((n) => ({
      ...n,
      name: redactText(n.name, 120) ?? n.name,
      lastMessage: redactText(n.lastMessage, 300),
    }));
  }
  if (meta.aiSummary) {
    meta.aiSummary = {
      title: redactText(meta.aiSummary.title, 140) ?? meta.aiSummary.title,
      details: meta.aiSummary.details.map((d) => redactText(d, 200) ?? d),
    };
  }
  return {
    ...msg,
    instance: { ...msg.instance, name: redactText(msg.instance.name, 120) ?? msg.instance.name },
    workflow: msg.workflow ? { ...msg.workflow, name: redactText(msg.workflow.name, 140) ?? msg.workflow.name } : null,
    title: redactText(msg.title, 180) ?? msg.title,
    body: redactText(msg.body, 500) ?? msg.body,
    metadata: meta,
  };
}

export function isInQuietHours(qh: QuietHours | null, severity: NotifySeverity, now = Date.now()): boolean {
  if (!qh?.enabled) return false;
  if (qh.allowCritical && severity === 'critical') return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: qh.tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now));
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const cur = hh * 60 + mm;
  const [sh, sm] = qh.start.split(':').map(Number);
  const [eh, em] = qh.end.split(':').map(Number);
  const start = sh! * 60 + sm!;
  const end = eh! * 60 + em!;
  if (start === end) return false;
  return start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

export function defaultSeverityForKind(kind: NotifyKind): NotifySeverity {
  switch (kind) {
    case 'alert_opened':
    case 'alert_escalated':
    case 'sync_error':
      return 'critical';
    case 'execution_failed':
    case 'health_poll_error':
    case 'workflow_deleted':
      return 'high';
    case 'alert_resolved':
    case 'execution_recovered':
    case 'sync_recovered':
    case 'health_poll_recovered':
    case 'initial_sync':
    case 'test':
      return 'info';
    default:
      return 'normal';
  }
}

export interface IngestResult {
  message: NotifyMessage;
  created: boolean;
  updated: boolean;
  shouldPush: boolean;
}

export function createStore(db: DatabaseSync) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pairing_codes (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      code_hash         TEXT NOT NULL UNIQUE,
      label             TEXT NOT NULL,
      allowed_instances TEXT,
      redaction_mode    TEXT NOT NULL DEFAULT 'lockscreen',
      attempts          INTEGER NOT NULL DEFAULT 0,
      expires_at        INTEGER NOT NULL,
      used_at           INTEGER,
      created_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,
      platform          TEXT NOT NULL DEFAULT 'android',
      token_hash        TEXT NOT NULL UNIQUE,
      token_hint        TEXT NOT NULL,
      allowed_instances TEXT,
      redaction_mode    TEXT NOT NULL DEFAULT 'lockscreen',
      push_type         TEXT NOT NULL DEFAULT 'none',
      push_endpoint     TEXT,
      language          TEXT NOT NULL DEFAULT 'de',
      quiet_hours       TEXT,
      created_at        INTEGER NOT NULL,
      last_seen_at      INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      seq               INTEGER PRIMARY KEY AUTOINCREMENT,
      updated_seq       INTEGER NOT NULL DEFAULT 0,
      event_uid         TEXT UNIQUE,
      group_key         TEXT,
      instance_id       INTEGER NOT NULL,
      instance_name     TEXT NOT NULL,
      instance_color    TEXT NOT NULL DEFAULT '#ea4b71',
      workflow_id       INTEGER,
      workflow_name     TEXT,
      version_id        INTEGER,
      version_number    INTEGER,
      alert_id          INTEGER,
      kind              TEXT NOT NULL,
      severity          TEXT NOT NULL,
      title             TEXT NOT NULL,
      body              TEXT NOT NULL,
      metadata          TEXT NOT NULL DEFAULT '{}',
      group_count       INTEGER NOT NULL DEFAULT 1,
      resolved_by_seq   INTEGER,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_instance_seq ON messages(instance_id, seq DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_updated_seq ON messages(updated_seq DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_key, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_wf_ver ON messages(workflow_id, version_id, kind);
    CREATE INDEX IF NOT EXISTS idx_messages_alert ON messages(alert_id, kind);

    CREATE TABLE IF NOT EXISTS device_rules (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id     INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      scope_type    TEXT NOT NULL,
      scope_id      INTEGER NOT NULL DEFAULT 0,
      enabled_kinds TEXT,
      muted_until   INTEGER,
      UNIQUE (device_id, scope_type, scope_id)
    );

    CREATE TABLE IF NOT EXISTS device_read_state (
      device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      instance_id INTEGER NOT NULL,
      read_seq    INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (device_id, instance_id)
    );
  `);

  const getSetting = (k: string) =>
    (db.prepare('SELECT value FROM settings WHERE key = ?').get(k) as { value: string } | undefined)?.value;
  const setSetting = (k: string, v: string) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

  function nextUpdateSeq(): number {
    const cur = Number(getSetting('update_seq') ?? '0');
    const maxMsg = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM messages').get() as { m: number }).m;
    const next = Math.max(cur, maxMsg) + 1;
    setSetting('update_seq', String(next));
    return next;
  }

  const allDevices = () => (db.prepare('SELECT * FROM devices ORDER BY id').all() as unknown as DeviceRow[]).map(toDeviceRecord);

  function allowedFor(device: DeviceRecord, instanceId: number): boolean {
    return device.instances === null || device.instances.includes(instanceId);
  }

  return {
    enabled(): boolean {
      return getSetting('enabled') === '1';
    },

    setEnabled(on: boolean) {
      setSetting('enabled', on ? '1' : '0');
    },

    retentionDays(): number {
      const n = Number(getSetting('retention_days') ?? '90');
      return Number.isFinite(n) && n >= 1 ? Math.min(365, Math.round(n)) : 90;
    },

    setRetentionDays(days: number) {
      if (!Number.isFinite(days)) throw new HttpError(400, 'errors.http.invalidNumber');
      setSetting('retention_days', String(Math.max(1, Math.min(365, Math.round(days)))));
    },

    defaultRedaction(): RedactionMode {
      const r = getSetting('default_redaction');
      return r && VALID_REDACTION.has(r) ? (r as RedactionMode) : 'lockscreen';
    },

    setDefaultRedaction(mode: unknown) {
      setSetting('default_redaction', parseRedaction(mode, 'lockscreen'));
    },

    state(): NotifyState {
      return {
        enabled: this.enabled(),
        retentionDays: this.retentionDays(),
        defaultRedaction: this.defaultRedaction(),
        devices: allDevices().map(publicDevice),
      };
    },

    allDevices,

    getDevice(id: number): DeviceRecord | null {
      const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as unknown as DeviceRow | undefined;
      return row ? toDeviceRecord(row) : null;
    },

    async createPairing(
      input: { label?: unknown; instances?: unknown; redactionMode?: unknown; serverUrl?: unknown },
      fallbackOrigin: string,
      now = Date.now(),
    ): Promise<NotifyPairingCreated> {
      const label = String(input.label ?? '').replace(/\s+/g, ' ').trim();
      if (!label) throw new HttpError(400, 'errors.notify.nameMissing');
      if (label.length > 60) throw new HttpError(400, 'errors.notify.nameTooLong');
      const instances = parseInstances(input.instances);
      const redactionMode = parseRedaction(input.redactionMode, this.defaultRedaction());
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number };
      if (n >= MAX_DEVICES) throw new HttpError(400, 'errors.notify.tooManyDevices', { max: MAX_DEVICES });

      // Abgelaufene Codes aufräumen
      db.prepare('DELETE FROM pairing_codes WHERE expires_at <= ? OR used_at IS NOT NULL').run(now - 60_000);

      const code = crypto.randomBytes(16).toString('base64url');
      const expiresAt = now + PAIR_TTL_MS;
      db.prepare(
        `INSERT INTO pairing_codes (code_hash, label, allowed_instances, redaction_mode, expires_at, created_at)
         VALUES (?,?,?,?,?,?)`,
      ).run(sha256(code), label, instances ? JSON.stringify(instances) : null, redactionMode, expiresAt, now);

      let origin = fallbackOrigin;
      if (typeof input.serverUrl === 'string' && input.serverUrl.trim()) {
        try {
          const parsed = new URL(input.serverUrl.trim());
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') origin = parsed.origin;
        } catch {}
      }
      const uri = `flowvault://pair?v=1&url=${encodeURIComponent(origin)}&code=${encodeURIComponent(code)}`;
      const qrDataUrl = await QRCode.toDataURL(uri, { margin: 2, width: 260, color: { dark: '#151a23', light: '#ffffff' } });
      return { code, uri, qrDataUrl, expiresAt, label, instances, redactionMode };
    },

    redeemPairing(
      input: { code?: unknown; deviceName?: unknown; platform?: unknown; language?: unknown },
      serverVersion: string,
      now = Date.now(),
    ): { response: NotifyPairedResponse; device: DeviceRecord } {
      const code = String(input.code ?? '').trim();
      if (!code || code.length > 128) throw new HttpError(401, 'errors.notify.pairingInvalid');

      const hash = sha256(code);
      const row = db.prepare('SELECT * FROM pairing_codes WHERE code_hash = ?').get(hash) as unknown as PairingRow | undefined;
      if (!row) {
        // Fehlversuche auf aktiven Codes mitzählen, damit ein Brute-Force offene QR-Codes ungültig macht
        db.prepare('UPDATE pairing_codes SET attempts = attempts + 1 WHERE used_at IS NULL AND expires_at > ?').run(now);
        db.prepare('DELETE FROM pairing_codes WHERE used_at IS NULL AND attempts >= ?').run(PAIR_MAX_ATTEMPTS);
        throw new HttpError(401, 'errors.notify.pairingInvalid');
      }
      if (row.used_at !== null || row.expires_at <= now || row.attempts >= PAIR_MAX_ATTEMPTS) {
        throw new HttpError(401, 'errors.notify.pairingExpired');
      }

      const { n } = db.prepare('SELECT COUNT(*) AS n FROM devices').get() as { n: number };
      if (n >= MAX_DEVICES) throw new HttpError(400, 'errors.notify.tooManyDevices', { max: MAX_DEVICES });

      const consumed = db
        .prepare('UPDATE pairing_codes SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?')
        .run(now, row.id, now);
      if (consumed.changes === 0) throw new HttpError(401, 'errors.notify.pairingExpired');

      const rawName = String(input.deviceName ?? '').replace(/\s+/g, ' ').trim();
      const name = (rawName || row.label).slice(0, 60);
      const platform = String(input.platform ?? 'android').slice(0, 20) || 'android';
      const language = String(input.language ?? 'de').slice(0, 10) || 'de';

      const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
      const hint = `${token.slice(0, TOKEN_PREFIX.length + 4)}…`;

      const ins = db
        .prepare(
          `INSERT INTO devices (name, platform, token_hash, token_hint, allowed_instances, redaction_mode, language, created_at, last_seen_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(name, platform, sha256(token), hint, row.allowed_instances, row.redaction_mode, language, now, now);

      const device = this.getDevice(Number(ins.lastInsertRowid))!;
      return {
        device,
        response: {
          deviceId: device.id,
          token,
          serverName: 'FlowVault',
          serverVersion,
          redactionMode: device.redactionMode,
          allowedInstances: device.instances,
        },
      };
    },

    authenticate(header: unknown, now = Date.now()): DeviceRecord | null {
      if (typeof header !== 'string') return null;
      const token = /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1];
      if (!token?.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
      const row = db.prepare('SELECT * FROM devices WHERE token_hash = ?').get(sha256(token)) as unknown as DeviceRow | undefined;
      if (!row) return null;
      if (!row.last_seen_at || now - row.last_seen_at > TOUCH_EVERY_MS) {
        db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, row.id);
        row.last_seen_at = now;
      }
      return toDeviceRecord(row);
    },

    revokeDevice(id: number): boolean {
      return db.prepare('DELETE FROM devices WHERE id = ?').run(id).changes > 0;
    },

    updateDevice(
      id: number,
      patch: { name?: unknown; language?: unknown; pushType?: unknown; pushEndpoint?: string | null; quietHours?: unknown },
    ): DeviceRecord {
      const current = this.getDevice(id);
      if (!current) throw new HttpError(404, 'errors.notify.deviceNotFound');
      let name = current.name;
      if (patch.name !== undefined) {
        name = String(patch.name).replace(/\s+/g, ' ').trim();
        if (!name) throw new HttpError(400, 'errors.notify.nameMissing');
        if (name.length > 60) throw new HttpError(400, 'errors.notify.nameTooLong');
      }
      const language = patch.language !== undefined ? String(patch.language).trim().slice(0, 10) || current.language : current.language;
      let pushType = current.pushType;
      if (patch.pushType !== undefined) {
        if (typeof patch.pushType !== 'string' || !VALID_PUSH_TYPE.has(patch.pushType)) {
          throw new HttpError(400, 'errors.notify.invalidPushType');
        }
        pushType = patch.pushType as PushType;
      }
      const pushEndpoint = patch.pushEndpoint !== undefined ? patch.pushEndpoint : current.pushEndpoint;
      const quietHours = patch.quietHours !== undefined ? parseQuietHours(patch.quietHours) : current.quietHours;

      db.prepare(
        `UPDATE devices SET name = ?, language = ?, push_type = ?, push_endpoint = ?, quiet_hours = ? WHERE id = ?`,
      ).run(name, language, pushType, pushType === 'unifiedpush' ? pushEndpoint : null, quietHours ? JSON.stringify(quietHours) : null, id);
      return this.getDevice(id)!;
    },

    ingest(payload: NotifyIngestPayload, now = Date.now()): IngestResult | null {
      // 1) Stilles KI-Update einer bestehenden Änderungs-Nachricht
      if (payload.type === 'ai_summary') {
        if (!payload.workflowId || !payload.versionId || !payload.aiSummary) return null;
        const row = db
          .prepare(
            `SELECT * FROM messages
              WHERE workflow_id = ? AND version_id = ? AND kind IN ('workflow_changed', 'workflow_created')
              ORDER BY seq DESC LIMIT 1`,
          )
          .get(payload.workflowId, payload.versionId) as unknown as MessageRow | undefined;
        if (!row) return null;
        const meta = (row.metadata ? JSON.parse(row.metadata) : {}) as NotifyMessageMetadata;
        meta.aiSummary = payload.aiSummary;
        const updatedSeq = nextUpdateSeq();
        db.prepare('UPDATE messages SET metadata = ?, updated_at = ?, updated_seq = ? WHERE seq = ?').run(
          JSON.stringify(meta),
          now,
          updatedSeq,
          row.seq,
        );
        const updated = db.prepare('SELECT * FROM messages WHERE seq = ?').get(row.seq) as unknown as MessageRow;
        return { message: toMessage(updated), created: false, updated: true, shouldPush: false };
      }

      const kind = payload.kind;
      if (!kind || !VALID_KINDS.has(kind)) throw new HttpError(400, 'errors.notify.invalidKind');
      const severity = payload.severity && VALID_SEVERITY.has(payload.severity) ? payload.severity : defaultSeverityForKind(kind);
      const createdAt = typeof payload.createdAt === 'number' && Number.isFinite(payload.createdAt) ? payload.createdAt : now;
      const title = String(payload.title ?? '').trim().slice(0, 200);
      const body = String(payload.body ?? '').trim().slice(0, 1000);
      if (!title) throw new HttpError(400, 'errors.notify.titleMissing');

      // 2) Idempotenz über eventUid
      if (payload.eventUid) {
        const existing = db.prepare('SELECT * FROM messages WHERE event_uid = ?').get(payload.eventUid) as unknown as MessageRow | undefined;
        if (existing) return { message: toMessage(existing), created: false, updated: false, shouldPush: false };
      }

      // 3) Burst-Coalescing (z. B. execution_failed innerhalb 10 Min. oder laufender Health-Alert)
      if (payload.groupKey) {
        const cutoff = kind === 'alert_opened' || kind === 'alert_escalated' ? 0 : now - COALESCE_WINDOW_MS;
        const existing = db
          .prepare(
            `SELECT * FROM messages
              WHERE group_key = ? AND kind = ? AND resolved_by_seq IS NULL AND updated_at >= ?
              ORDER BY seq DESC LIMIT 1`,
          )
          .get(payload.groupKey, kind, cutoff) as unknown as MessageRow | undefined;
        if (existing) {
          const nextCount = existing.group_count + 1;
          const updatedSeq = nextUpdateSeq();
          const mergedMeta = {
            ...(existing.metadata ? (JSON.parse(existing.metadata) as NotifyMessageMetadata) : {}),
            ...(payload.metadata ?? {}),
          };
          db.prepare(
            `UPDATE messages
                SET title = ?, body = ?, metadata = ?, group_count = ?, updated_at = ?, updated_seq = ?
              WHERE seq = ?`,
          ).run(title, body, JSON.stringify(mergedMeta), nextCount, now, updatedSeq, existing.seq);
          const updated = db.prepare('SELECT * FROM messages WHERE seq = ?').get(existing.seq) as unknown as MessageRow;
          const shouldPush = kind === 'alert_escalated' || (kind === 'execution_failed' && PUSH_MILESTONES.has(nextCount));
          return { message: toMessage(updated), created: false, updated: true, shouldPush };
        }
      }

      // 4) Neue Nachricht anlegen
      const updatedSeq = nextUpdateSeq();
      const ins = db
        .prepare(
          `INSERT INTO messages (
             updated_seq, event_uid, group_key, instance_id, instance_name, instance_color,
             workflow_id, workflow_name, version_id, version_number, alert_id,
             kind, severity, title, body, metadata, group_count, created_at, updated_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
        )
        .run(
          updatedSeq,
          payload.eventUid ?? null,
          payload.groupKey ?? null,
          payload.instanceId,
          payload.instanceName,
          payload.instanceColor ?? '#ea4b71',
          payload.workflowId ?? null,
          payload.workflowName ?? null,
          payload.versionId ?? null,
          payload.versionNumber ?? null,
          payload.alertId ?? null,
          kind,
          severity,
          title,
          body,
          JSON.stringify(payload.metadata ?? {}),
          createdAt,
          now,
        );
      const seq = Number(ins.lastInsertRowid);
      if (seq > updatedSeq) {
        db.prepare('UPDATE messages SET updated_seq = ? WHERE seq = ?').run(seq, seq);
        setSetting('update_seq', String(seq));
      }

      // 5) Bei alert_resolved frühere offene alert_opened-Nachrichten verknüpfen
      if (kind === 'alert_resolved' && payload.alertId) {
        db.prepare(
          `UPDATE messages SET resolved_by_seq = ?, updated_seq = ?, updated_at = ?
            WHERE alert_id = ? AND kind IN ('alert_opened', 'alert_escalated') AND resolved_by_seq IS NULL`,
        ).run(seq, nextUpdateSeq(), now, payload.alertId);
      }

      // 6) Aufbewahrung einhalten
      const keepSince = now - this.retentionDays() * 864e5;
      db.prepare('DELETE FROM messages WHERE created_at < ?').run(keepSince);

      const created = db.prepare('SELECT * FROM messages WHERE seq = ?').get(seq) as unknown as MessageRow;
      return { message: toMessage(created), created: true, updated: false, shouldPush: true };
    },

    latestSeq(): number {
      const a = Number(getSetting('update_seq') ?? '0');
      const b = (db.prepare('SELECT COALESCE(MAX(updated_seq), 0) AS m FROM messages').get() as { m: number }).m;
      return Math.max(a, b);
    },

    listMessages(
      device: DeviceRecord,
      q: {
        after?: number;
        before?: number;
        instance?: number;
        workflow?: number;
        category?: NotifyCategory;
        severity?: NotifySeverity;
        search?: string;
        limit?: number;
      },
    ): NotifyMessage[] {
      const where: string[] = [];
      const params: (string | number)[] = [];

      if (device.instances !== null) {
        if (!device.instances.length) return [];
        where.push(`instance_id IN (${device.instances.map(() => '?').join(',')})`);
        params.push(...device.instances);
      }
      if (q.instance !== undefined) {
        if (!allowedFor(device, q.instance)) return [];
        where.push('instance_id = ?');
        params.push(q.instance);
      }
      if (q.workflow !== undefined) {
        where.push('workflow_id = ?');
        params.push(q.workflow);
      }
      if (q.after !== undefined) {
        where.push('(seq > ? OR updated_seq > ?)');
        params.push(q.after, q.after);
      }
      if (q.before !== undefined) {
        where.push('seq < ?');
        params.push(q.before);
      }
      if (q.severity) {
        where.push('severity = ?');
        params.push(q.severity);
      }
      if (q.search) {
        const like = `%${q.search.slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`;
        where.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR workflow_name LIKE ? ESCAPE '\\')");
        params.push(like, like, like);
      }
      const limit = Math.max(1, Math.min(200, q.limit ?? 50));
      const order = q.after !== undefined ? 'ORDER BY updated_seq ASC, seq ASC' : 'ORDER BY seq DESC';
      const sql = `SELECT * FROM messages ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ${order} LIMIT ?`;
      const rows = db.prepare(sql).all(...params, limit * (q.category ? 3 : 1)) as unknown as MessageRow[];
      let msgs = rows.map(toMessage);
      if (q.category) msgs = msgs.filter((m) => categoryOfKind(m.kind) === q.category).slice(0, limit);
      return msgs.map((m) => redactMessage(m, device.redactionMode));
    },

    listRules(deviceId: number): NotifyRule[] {
      const rows = db.prepare('SELECT scope_type, scope_id, enabled_kinds, muted_until FROM device_rules WHERE device_id = ? ORDER BY scope_type, scope_id').all(deviceId) as unknown as RuleRow[];
      return rows.map((r) => ({
        scopeType: r.scope_type,
        scopeId: r.scope_id,
        enabledKinds: r.enabled_kinds ? (JSON.parse(r.enabled_kinds) as NotifyKind[]) : null,
        mutedUntil: r.muted_until,
      }));
    },

    upsertRule(
      device: DeviceRecord,
      input: { scopeType?: unknown; scopeId?: unknown; enabledKinds?: unknown; mutedUntil?: unknown },
    ): NotifyRule {
      const scopeType = input.scopeType;
      if (scopeType !== 'global' && scopeType !== 'instance' && scopeType !== 'workflow') {
        throw new HttpError(400, 'errors.notify.invalidRule');
      }
      const scopeId = scopeType === 'global' ? 0 : Number(input.scopeId);
      if (!Number.isSafeInteger(scopeId) || scopeId < 0 || (scopeType !== 'global' && scopeId === 0)) {
        throw new HttpError(400, 'errors.notify.invalidRule');
      }
      if (scopeType === 'instance' && !allowedFor(device, scopeId)) {
        throw new HttpError(403, 'errors.notify.instanceForbidden');
      }

      let enabledKinds: NotifyKind[] | null = null;
      if (input.enabledKinds !== null && input.enabledKinds !== undefined) {
        if (!Array.isArray(input.enabledKinds) || !input.enabledKinds.every((k) => typeof k === 'string' && VALID_KINDS.has(k))) {
          throw new HttpError(400, 'errors.notify.invalidKind');
        }
        enabledKinds = [...new Set(input.enabledKinds as NotifyKind[])];
      }

      let mutedUntil: number | null = null;
      if (input.mutedUntil !== null && input.mutedUntil !== undefined) {
        const n = Number(input.mutedUntil);
        if (!Number.isSafeInteger(n) || (n !== -1 && n < 0)) throw new HttpError(400, 'errors.notify.invalidRule');
        mutedUntil = n;
      }

      db.prepare(
        `INSERT INTO device_rules (device_id, scope_type, scope_id, enabled_kinds, muted_until)
         VALUES (?,?,?,?,?)
         ON CONFLICT(device_id, scope_type, scope_id) DO UPDATE SET
           enabled_kinds = excluded.enabled_kinds,
           muted_until = excluded.muted_until`,
      ).run(device.id, scopeType, scopeId, enabledKinds ? JSON.stringify(enabledKinds) : null, mutedUntil);

      return { scopeType, scopeId, enabledKinds, mutedUntil };
    },

    markRead(device: DeviceRecord, instanceId: number, readSeq: number, now = Date.now()) {
      if (!Number.isSafeInteger(instanceId) || instanceId < 0) throw new HttpError(400, 'errors.http.invalidId');
      if (!Number.isSafeInteger(readSeq) || readSeq < 0) throw new HttpError(400, 'errors.http.invalidNumber');
      if (instanceId > 0 && !allowedFor(device, instanceId)) throw new HttpError(403, 'errors.notify.instanceForbidden');
      db.prepare(
        `INSERT INTO device_read_state (device_id, instance_id, read_seq, updated_at)
         VALUES (?,?,?,?)
         ON CONFLICT(device_id, instance_id) DO UPDATE SET
           read_seq = MAX(device_read_state.read_seq, excluded.read_seq),
           updated_at = excluded.updated_at`,
      ).run(device.id, instanceId, readSeq, now);
    },

    shouldNotifyDevice(device: DeviceRecord, msg: NotifyMessage, now = Date.now()): boolean {
      if (!this.enabled()) return false;
      if (!allowedFor(device, msg.instance.id)) return false;
      if (msg.kind === 'test') return true;

      const rules = this.listRules(device.id);
      const find = (type: NotifyRule['scopeType'], id: number) => rules.find((r) => r.scopeType === type && r.scopeId === id);
      const chain = [
        msg.workflow ? find('workflow', msg.workflow.id) : undefined,
        find('instance', msg.instance.id),
        find('global', 0),
      ].filter((r): r is NotifyRule => !!r);

      for (const r of chain) {
        if (r.mutedUntil === -1 || (r.mutedUntil !== null && r.mutedUntil > now)) return false;
      }
      const kindRule = chain.find((r) => r.enabledKinds !== null);
      if (kindRule && !kindRule.enabledKinds!.includes(msg.kind)) return false;

      if (isInQuietHours(device.quietHours, msg.severity, now)) return false;
      return true;
    },

    bootstrap(
      device: DeviceRecord,
      coreInstances: CoreInstanceMeta[],
      openAlerts: { instanceId: number }[],
      serverVersion: string,
    ): NotifyBootstrap {
      const rules = this.listRules(device.id);
      const readRows = db
        .prepare('SELECT instance_id, read_seq FROM device_read_state WHERE device_id = ?')
        .all(device.id) as { instance_id: number; read_seq: number }[];
      const readByInst = new Map(readRows.map((r) => [r.instance_id, r.read_seq]));
      const globalRead = readByInst.get(0) ?? 0;

      const allowedCore = coreInstances.filter((i) => allowedFor(device, i.id));
      const alertCount = new Map<number, number>();
      for (const a of openAlerts) {
        if (allowedFor(device, a.instanceId)) alertCount.set(a.instanceId, (alertCount.get(a.instanceId) ?? 0) + 1);
      }

      const channels: NotifyChannel[] = allowedCore.map((inst) => {
        const readSeq = Math.max(globalRead, readByInst.get(inst.id) ?? 0);
        const lastRow = db
          .prepare('SELECT * FROM messages WHERE instance_id = ? ORDER BY seq DESC LIMIT 1')
          .get(inst.id) as unknown as MessageRow | undefined;
        const { n: unreadCount } = db
          .prepare('SELECT COUNT(*) AS n FROM messages WHERE instance_id = ? AND seq > ?')
          .get(inst.id, readSeq) as { n: number };
        const rule = rules.find((r) => r.scopeType === 'instance' && r.scopeId === inst.id);
        return {
          instanceId: inst.id,
          name: device.redactionMode === 'full' ? (redactText(inst.name, 120) ?? inst.name) : inst.name,
          color: inst.color || '#ea4b71',
          enabled: !!inst.enabled,
          lastSyncOk: inst.last_sync_ok === null ? null : !!inst.last_sync_ok,
          openAlerts: alertCount.get(inst.id) ?? 0,
          unreadCount,
          readSeq,
          mutedUntil: rule?.mutedUntil ?? null,
          lastMessage: lastRow ? redactMessage(toMessage(lastRow), device.redactionMode) : null,
        };
      });

      // Sortiere wie ein Messenger: Kanäle mit letzter Nachricht zuerst (neueste oben), dann alphabetisch
      channels.sort((a, b) => (b.lastMessage?.updatedAt ?? 0) - (a.lastMessage?.updatedAt ?? 0) || a.name.localeCompare(b.name));

      const openAlertsTotal = [...alertCount.values()].reduce((s, n) => s + n, 0);
      return {
        serverName: 'FlowVault',
        serverVersion,
        device: publicDevice(device),
        latestSeq: this.latestSeq(),
        openAlertsTotal,
        channels,
        rules,
      };
    },
  };
}

export type NotifyStore = ReturnType<typeof createStore>;
