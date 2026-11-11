/**
 * Holt regelmäßig neue Ausführungen jeder Instanz (über den Core) und legt sie ab.
 *
 * Pro Lauf zwei Durchgänge, jeweils neueste zuerst, bis bekanntes Gebiet erreicht ist:
 *  1. alle Ausführungen ohne Daten – Status, Zeit, Workflow (billig, 250 pro Seite)
 *  2. nur fehlgeschlagene mit Daten – daraus Node und Fehlermeldung (teurer, daher begrenzt)
 */
import { db, getSettings } from './db.ts';
import { core, type CoreInstance } from './core.ts';
import { evaluateInstance } from './evaluate.ts';
import type { SlimExecution } from '../../shared/executions.ts';
import { packError, renderMessage } from '../../shared/i18n/index.ts';
import { t } from '../../shared/i18n/server.ts';

const MAX_PAGES = 40; // höchstens 10.000 Ausführungen pro Durchgang
const MAX_ERROR_PAGES = 8; // höchstens 200 Fehler mit Details pro Durchgang
const ERROR_PAGE = 25;

const ts = (s: string | null) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : null;
};
const seqOf = (id: string) => (/^\d+$/.test(id) ? Number(id) : 0);

const upsert = db.prepare(`
  INSERT INTO executions (instance_id, id, seq, workflow_n8n_id, status, mode, started_at, stopped_at, workflow_version_id, error_node, error_message)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT (instance_id, id) DO UPDATE SET
    status = excluded.status,
    mode = excluded.mode,
    started_at = COALESCE(excluded.started_at, executions.started_at),
    stopped_at = COALESCE(excluded.stopped_at, executions.stopped_at),
    workflow_version_id = COALESCE(excluded.workflow_version_id, executions.workflow_version_id),
    error_node = COALESCE(excluded.error_node, executions.error_node),
    error_message = COALESCE(excluded.error_message, executions.error_message)
`);

function store(instanceId: number, e: SlimExecution) {
  upsert.run(
    instanceId, e.id, seqOf(e.id), e.workflowId, e.status, e.mode, ts(e.startedAt), ts(e.stoppedAt), e.workflowVersionId, e.errorNode, e.errorMessage,
  );
}

/** Ab welcher ID ist alles bekannt? Noch laufende Ausführungen werden erneut abgefragt, bis sie fertig sind. */
function knownUpTo(instanceId: number): number {
  const open = db
    .prepare(
      `SELECT MIN(seq) AS s FROM executions WHERE instance_id = ? AND status IN ('running','waiting','new','unknown') AND started_at > ?`,
    )
    .get(instanceId, Date.now() - 24 * 3600_000) as { s: number | null };
  if (open.s) return open.s - 1;
  const max = db.prepare('SELECT MAX(seq) AS s FROM executions WHERE instance_id = ?').get(instanceId) as { s: number | null };
  return max.s ?? 0;
}

async function scan(
  instanceId: number,
  opts: { stopSeq: number; cutoff: number; maxPages: number; limit: number; status?: string; includeData?: boolean },
) {
  let cursor: string | undefined;
  let pages = 0, stored = 0, maxSeq = 0;
  do {
    const page = await core.executions(instanceId, { cursor, limit: opts.limit, status: opts.status, includeData: opts.includeData });
    for (const e of page.data) {
      const seq = seqOf(e.id);
      if (seq && seq <= opts.stopSeq) return { stored, maxSeq, limited: false };
      const started = ts(e.startedAt);
      if (started !== null && started < opts.cutoff) return { stored, maxSeq, limited: false };
      store(instanceId, e);
      stored++;
      maxSeq = Math.max(maxSeq, seq);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor && ++pages < opts.maxPages);
  return { stored, maxSeq, limited: !!cursor };
}

const running = new Set<number>();

export async function pollInstance(inst: CoreInstance) {
  if (running.has(inst.id)) return;
  running.add(inst.id);
  const s = getSettings();
  const cutoff = Date.now() - s.lookbackDays * 864e5;
  db.prepare('INSERT INTO poll_state (instance_id, name) VALUES (?, ?) ON CONFLICT (instance_id) DO UPDATE SET name = excluded.name').run(
    inst.id, inst.name,
  );
  try {
    const all = await scan(inst.id, { stopSeq: knownUpTo(inst.id), cutoff, maxPages: MAX_PAGES, limit: 250 });
    // A gap may survive later successful polls (which start at newer IDs).
    // Keep the warning until the affected history has aged out of retention.
    const prior = db.prepare('SELECT last_success_at FROM poll_state WHERE instance_id = ?').get(inst.id) as { last_success_at: number | null };
    if (all.limited || (prior.last_success_at !== null && prior.last_success_at < cutoff)) {
      db.prepare('UPDATE poll_state SET incomplete_until = ? WHERE instance_id = ?').run(Date.now(), inst.id);
    }

    const state = db.prepare('SELECT error_seq FROM poll_state WHERE instance_id = ?').get(inst.id) as { error_seq: number };
    const errs = await scan(inst.id, {
      stopSeq: state.error_seq,
      cutoff,
      maxPages: MAX_ERROR_PAGES,
      limit: ERROR_PAGE,
      status: 'error',
      includeData: true,
    });
    if (errs.maxSeq > state.error_seq) db.prepare('UPDATE poll_state SET error_seq = ? WHERE instance_id = ?').run(errs.maxSeq, inst.id);

    db.prepare('DELETE FROM executions WHERE instance_id = ? AND started_at < ?').run(inst.id, Date.now() - s.retentionDays * 864e5);
    db.prepare('UPDATE poll_state SET last_poll_at = ?, last_success_at = ?, ok = 1, error = NULL WHERE instance_id = ?').run(Date.now(), Date.now(), inst.id);
    if (all.stored || errs.stored) await evaluateInstance(inst.id, inst.name);
  } catch (e) {
    const msg = packError(e);
    db.prepare('UPDATE poll_state SET last_poll_at = ?, incomplete_until = ?, ok = 0, error = ? WHERE instance_id = ?').run(Date.now(), Date.now(), msg, inst.id);
    console.warn(t('log.healthInstance', { id: inst.id, reason: renderMessage(msg, t) }));
  } finally {
    running.delete(inst.id);
  }
}

export async function pollAll(force = false) {
  const s = getSettings();
  if (!s.enabled && !force) return;
  const all = await core.instances();
  const instances = all.filter((i) => i.enabled);
  // Instanzen, die im Core gelöscht wurden, samt Daten vergessen
  const ids = new Set(all.map((i) => i.id));
  for (const { instance_id } of db.prepare('SELECT instance_id FROM poll_state').all() as { instance_id: number }[]) {
    if (!ids.has(instance_id)) {
      db.prepare('DELETE FROM executions WHERE instance_id = ?').run(instance_id);
      db.prepare('DELETE FROM poll_state WHERE instance_id = ?').run(instance_id);
      db.prepare('DELETE FROM alerts WHERE instance_id = ?').run(instance_id);
    }
  }
  const due = instances.filter((i) => {
    if (force) return true;
    const st = db.prepare('SELECT last_poll_at FROM poll_state WHERE instance_id = ?').get(i.id) as { last_poll_at: number | null } | undefined;
    return !st?.last_poll_at || st.last_poll_at + s.pollMinutes * 60_000 <= Date.now();
  });
  await Promise.allSettled(due.map(pollInstance));
}

export function startScheduler() {
  const tick = () => pollAll().catch((e) => console.warn(`[health] ${renderMessage(packError(e), t)}`));
  setTimeout(tick, 5_000);
  return setInterval(tick, 60_000);
}
