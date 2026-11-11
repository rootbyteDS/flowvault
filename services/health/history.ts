import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { ExecutionDay, ExecutionHistory, HealthSettings } from '../../shared/executions.ts';
import { HttpError } from '../../shared/i18n/server.ts';

const DAY = 864e5;

export function executionHistory(db: DatabaseSync, settings: HealthSettings, instanceId?: number, now = Date.now()): ExecutionHistory {
  // Enforce retention at read time, even if collection has been switched off.
  const cutoff = now - settings.retentionDays * DAY;
  const where = `started_at >= ? AND started_at <= ? AND status IN ('success', 'error', 'crashed', 'canceled')
    ${settings.includeManual ? '' : "AND mode != 'manual'"} ${instanceId === undefined ? '' : 'AND instance_id = ?'}`;
  const params = instanceId === undefined ? [cutoff, now] : [cutoff, now, instanceId];
  const days = db.prepare(`SELECT CAST(started_at / 86400000 AS INTEGER) AS day,
    SUM(status = 'success') AS success, SUM(status IN ('error', 'crashed')) AS failed,
    SUM(status = 'canceled') AS canceled FROM executions WHERE ${where} GROUP BY day ORDER BY day`).all(...params) as unknown as ExecutionDay[];
  const range = db.prepare(`SELECT MIN(started_at) AS availableFrom, MAX(started_at) AS availableTo
    FROM executions WHERE ${where}`).get(...params) as unknown as Pick<ExecutionHistory, 'availableFrom' | 'availableTo'>;
  const states = db.prepare(`SELECT instance_id, last_poll_at, last_success_at, ok, incomplete_until FROM poll_state
    ${instanceId === undefined ? '' : 'WHERE instance_id = ?'} ORDER BY instance_id`).all(...(instanceId === undefined ? [] : [instanceId])) as {
      instance_id: number; last_poll_at: number | null; last_success_at: number | null; ok: number | null; incomplete_until: number | null;
    }[];
  const { enabled, pollMinutes, lookbackDays, retentionDays, includeManual } = settings;
  return {
    days, ...range, settings: { enabled, pollMinutes, lookbackDays, retentionDays, includeManual },
    instances: states.map((s) => ({ instanceId: s.instance_id, lastPollAt: s.last_poll_at, lastSuccessAt: s.last_success_at,
      ok: s.ok === null ? null : !!s.ok, incomplete: s.incomplete_until !== null && s.incomplete_until >= cutoff })),
  };
}

export function createExecutionHistoryRouter(db: DatabaseSync, settings: () => HealthSettings) {
  const router = Router();
  router.get('/executions/history', (req, res) => {
    const raw = req.query.instance;
    let instanceId: number | undefined;
    if (raw !== undefined) {
      if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        throw new HttpError(400, 'errors.http.invalidId');
      }
      instanceId = Number(raw);
    }
    res.json(executionHistory(db, settings(), instanceId));
  });
  return router;
}
