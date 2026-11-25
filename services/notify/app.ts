/**
 * HTTP-Anwendung des Notification-Dienstes (services/notify).
 *
 * Routen:
 * - `/healthz`            – Container-Healthcheck ohne Token
 * - `/v1/admin/*`         – Verwaltung aus der FlowVault-Oberfläche (über Core nach Login)
 * - `/v1/ingest`          – Ereignis-Annahme aus Core & Health (nur mit NOTIFY_TOKEN)
 * - `/mobile/v1/*`        – Endpunkte für die Android-App (über Core, Gerätetoken `fv_app_…`)
 */
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { HttpError, requestT } from '../../shared/i18n/server.ts';
import { renderError } from '../../shared/i18n/index.ts';
import type { NotifyCategory, NotifyIngestPayload, NotifySeverity } from '../../shared/notify.ts';
import type { CoreClient } from './core.ts';
import { createSseHub, type SseHub } from './hub.ts';
import { createPushSender, pushPolicyFromEnv, validatePushEndpoint, type PushPolicy, type PushSender } from './push.ts';
import { publicDevice, redactMessage, type DeviceRecord, type NotifyStore } from './store.ts';

function sameSecret(given: unknown, expected: string) {
  if (typeof given !== 'string' || !expected) return false;
  const h = (s: string) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

function intOpt(v: unknown): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new HttpError(400, 'errors.http.invalidNumber');
  return n;
}

export function createApp(opts: {
  store: NotifyStore;
  core: CoreClient;
  serviceToken: () => string;
  version: string;
  hub?: SseHub;
  push?: PushSender;
  pushPolicy?: PushPolicy;
  lookup?: (host: string) => Promise<{ address: string }[]>;
}) {
  const { store, core } = opts;
  const hub = opts.hub ?? createSseHub();
  const pushPolicy = opts.pushPolicy ?? pushPolicyFromEnv();
  const push = opts.push ?? createPushSender(pushPolicy, fetch, opts.lookup);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Alles außer /healthz erfordert NOTIFY_TOKEN vom Core
  app.use((req, res, next) => {
    if (sameSecret(req.headers['x-internal-token'], opts.serviceToken())) return next();
    res.status(401).json({ error: requestT(req)('errors.http.internalToken') });
  });

  function dispatchMessage(
    result: NonNullable<ReturnType<NotifyStore['ingest']>>,
    onlyDeviceId?: number,
  ) {
    const { message, created, updated, shouldPush } = result;
    if (!created && !updated) return;
    const eventName = created ? 'message' : 'message_updated';
    const devices = onlyDeviceId ? [store.getDevice(onlyDeviceId)].filter((d): d is DeviceRecord => !!d) : store.allDevices();

    for (const dev of devices) {
      if (dev.instances !== null && !dev.instances.includes(message.instance.id)) continue;
      const redacted = redactMessage(message, dev.redactionMode);
      // SSE-Stream bekommt auch stille Updates (z. B. Burst-Zähler, KI-Text)
      const deliveredSse = hub.sendToDevice(dev.id, eventName, redacted, redacted.updatedSeq);
      // UnifiedPush Zero-Payload-Wakeup nur wenn relevant und Push aktiv
      if (shouldPush && dev.pushType === 'unifiedpush' && dev.pushEndpoint && store.shouldNotifyDevice(dev, message)) {
        if (deliveredSse === 0 || message.kind === 'test') {
          void push.sendWakeup(dev.pushEndpoint, redacted.updatedSeq);
        }
      }
    }
  }

  // ───────────── Verwaltung (/v1/admin/*) ─────────────

  app.get('/v1/admin', (_req, res) => res.json(store.state()));

  app.put('/v1/admin', (req, res) => {
    const b = req.body ?? {};
    if (typeof b.enabled === 'boolean') store.setEnabled(b.enabled);
    if (b.retentionDays !== undefined) store.setRetentionDays(Number(b.retentionDays));
    if (b.defaultRedaction !== undefined) store.setDefaultRedaction(b.defaultRedaction);
    res.json(store.state());
  });

  app.post('/v1/admin/pair', async (req, res) => {
    const origin = String(req.headers['x-flowvault-origin'] ?? 'http://127.0.0.1:4000');
    const created = await store.createPairing(req.body ?? {}, origin);
    res.status(201).json(created);
  });

  app.delete('/v1/admin/devices/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || !store.revokeDevice(id)) throw new HttpError(404, 'errors.notify.deviceNotFound');
    hub.disconnectDevice(id);
    res.json({ ok: true });
  });

  app.post('/v1/admin/devices/:id/test', async (req, res) => {
    const id = Number(req.params.id);
    const dev = Number.isSafeInteger(id) ? store.getDevice(id) : null;
    if (!dev) throw new HttpError(404, 'errors.notify.deviceNotFound');
    const instances = await core.instances().catch(() => []);
    const first = instances.find((i) => dev.instances === null || dev.instances.includes(i.id)) ?? {
      id: 0,
      name: 'FlowVault',
      color: '#c2663f',
    };
    const tr = requestT(req);
    const ingested = store.ingest({
      instanceId: first.id,
      instanceName: first.name,
      instanceColor: first.color,
      kind: 'test',
      severity: 'info',
      title: tr('settings.notify.testTitle'),
      body: tr('settings.notify.testBody', { device: dev.name }),
      metadata: { webPath: '/settings' },
    });
    let pushSent = false;
    if (ingested) {
      dispatchMessage(ingested, dev.id);
      if (dev.pushType === 'unifiedpush' && dev.pushEndpoint) {
        pushSent = await push.sendWakeup(dev.pushEndpoint, ingested.message.updatedSeq);
      }
    }
    res.json({ ok: true, seq: ingested?.message.seq ?? null, pushSent });
  });

  // ───────────── Ereignis-Annahme (/v1/ingest) ─────────────

  app.post('/v1/ingest', (req, res) => {
    const payload = (req.body ?? {}) as NotifyIngestPayload;
    const result = store.ingest(payload);
    if (result) dispatchMessage(result);
    res.json({ ok: true, seq: result?.message.seq ?? null, updated: result?.updated ?? false });
  });

  // ───────────── Mobile API (/mobile/v1/*) ─────────────

  app.post('/mobile/v1/pair', (req, res) => {
    if (!store.enabled()) return void res.status(404).json({ error: requestT(req)('errors.notify.disabled') });
    const { response } = store.redeemPairing(req.body ?? {}, opts.version);
    res.status(201).json(response);
  });

  function requireDevice(req: Request, res: Response, next: NextFunction) {
    if (!store.enabled()) return void res.status(404).json({ error: requestT(req)('errors.notify.disabled') });
    const device = store.authenticate(req.headers.authorization);
    if (!device) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return void res.status(401).json({ error: requestT(req)('errors.notify.unauthorized') });
    }
    res.locals.device = device;
    next();
  }

  app.use('/mobile/v1', requireDevice);

  app.get('/mobile/v1/bootstrap', async (_req, res) => {
    const device = res.locals.device as DeviceRecord;
    const [instances, alerts] = await Promise.all([
      core.instances().catch(() => []),
      core.openAlerts().catch(() => []),
    ]);
    res.json(store.bootstrap(device, instances, alerts, opts.version));
  });

  app.get('/mobile/v1/messages', (req, res) => {
    const device = res.locals.device as DeviceRecord;
    const category = typeof req.query.category === 'string' && ['fails', 'changes', 'ops'].includes(req.query.category)
      ? (req.query.category as NotifyCategory)
      : undefined;
    const severity = typeof req.query.severity === 'string' && ['critical', 'high', 'normal', 'info'].includes(req.query.severity)
      ? (req.query.severity as NotifySeverity)
      : undefined;
    const items = store.listMessages(device, {
      after: intOpt(req.query.after),
      before: intOpt(req.query.before),
      instance: intOpt(req.query.instance),
      workflow: intOpt(req.query.workflow),
      category,
      severity,
      search: typeof req.query.q === 'string' ? req.query.q : undefined,
      limit: intOpt(req.query.limit),
    });
    res.json({ items, latestSeq: store.latestSeq() });
  });

  app.get('/mobile/v1/stream', (req, res) => {
    const device = res.locals.device as DeviceRecord;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const lastIdRaw = req.headers['last-event-id'] ?? req.query.after;
    const after = lastIdRaw !== undefined && /^\d+$/.test(String(lastIdRaw)) ? Number(lastIdRaw) : undefined;
    res.write(`event: ready\ndata: ${JSON.stringify({ latestSeq: store.latestSeq(), deviceId: device.id })}\n\n`);

    if (after !== undefined) {
      const missed = store.listMessages(device, { after, limit: 200 });
      for (const m of missed) {
        const ev = m.seq > after ? 'message' : 'message_updated';
        res.write(`id: ${m.updatedSeq}\nevent: ${ev}\ndata: ${JSON.stringify(m)}\n\n`);
      }
    }
    hub.subscribe(device.id, res);
  });

  app.post('/mobile/v1/read', (req, res) => {
    const device = res.locals.device as DeviceRecord;
    const instanceId = Number(req.body?.instanceId ?? 0);
    const readSeq = Number(req.body?.readSeq ?? store.latestSeq());
    store.markRead(device, instanceId, readSeq);
    hub.sendToDevice(device.id, 'read_sync', { instanceId, readSeq });
    res.json({ ok: true, instanceId, readSeq });
  });

  app.put('/mobile/v1/device', async (req, res) => {
    const device = res.locals.device as DeviceRecord;
    const b = req.body ?? {};
    let pushEndpoint: string | null | undefined = undefined;
    if (b.pushType === 'unifiedpush' || (b.pushType === undefined && device.pushType === 'unifiedpush' && b.pushEndpoint !== undefined)) {
      if (b.pushEndpoint === null || b.pushEndpoint === '') {
        pushEndpoint = null;
      } else if (typeof b.pushEndpoint === 'string') {
        pushEndpoint = await validatePushEndpoint(b.pushEndpoint, pushPolicy, opts.lookup);
      }
    } else if (b.pushType === 'none' || b.pushType === 'sse_bg') {
      pushEndpoint = null;
    }
    const updated = store.updateDevice(device.id, {
      name: b.name,
      language: b.language,
      pushType: b.pushType,
      pushEndpoint,
      quietHours: b.quietHours,
    });
    res.json(publicDevice(updated));
  });

  app.put('/mobile/v1/rules', (req, res) => {
    const device = res.locals.device as DeviceRecord;
    const rule = store.upsertRule(device, req.body ?? {});
    res.json(rule);
  });

  app.post('/mobile/v1/alerts/:alertId/dismiss', async (req, res) => {
    const device = res.locals.device as DeviceRecord;
    const alertId = Number(req.params.alertId);
    if (!Number.isSafeInteger(alertId) || alertId <= 0) throw new HttpError(400, 'errors.http.invalidId');
    // Prüfe Instanz-Geltungsbereich gegen offene Warnungen
    const open = await core.openAlerts();
    const target = open.find((a) => a.id === alertId);
    if (!target) throw new HttpError(404, 'errors.notify.alertNotFound');
    if (device.instances !== null && !device.instances.includes(target.instanceId)) {
      throw new HttpError(403, 'errors.notify.instanceForbidden');
    }
    await core.dismissAlert(alertId);
    res.json({ ok: true });
  });

  app.delete('/mobile/v1/device', (_req, res) => {
    const device = res.locals.device as DeviceRecord;
    store.revokeDevice(device.id);
    hub.disconnectDevice(device.id);
    res.json({ ok: true });
  });

  app.use((req, res) => {
    res.status(404).json({ error: requestT(req)('errors.http.unknownEndpoint') });
  });

  app.use((err: Error & { status?: number; type?: string }, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    const tr = requestT(req);
    res.status(status).json({ error: status >= 500 ? tr('errors.http.internal') : renderError(err, tr) });
  });

  return { app, hub };
}
