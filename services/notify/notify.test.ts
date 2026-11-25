/**
 * Tests für den Notification-Dienst (services/notify):
 * Pairing-Lebenszyklus, Token-Auth & Widerruf, Instanz-Scope, Burst-Coalescing,
 * stilles KI-Update, Redaction (Kanarienwerte), Ruhezeiten, Alert-Dismiss, SSE-Stream & UnifiedPush-SSRF.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app.ts';
import { createSseHub } from './hub.ts';
import { createPushSender, validatePushEndpoint } from './push.ts';
import { createStore, isInQuietHours } from './store.ts';
import type { CoreClient } from './core.ts';
import type { NotifyBootstrap, NotifyMessage, NotifyPairedResponse, NotifyPairingCreated } from '../../shared/notify.ts';

const SERVICE_TOKEN = 'core-to-notify-test-token';
const dismissedAlerts: number[] = [];
const pushLog: { endpoint: string; seq: number }[] = [];

const fakeCore: CoreClient = {
  async instances() {
    return [
      { id: 1, name: 'Produktion https://n8n.example.com/?api_key=CAN1secret', color: '#ea4b71', enabled: 1, sync_interval: 15, last_sync_at: Date.now(), last_sync_ok: 1, last_sync_error: null },
      { id: 2, name: 'Staging', color: '#4cc38a', enabled: 1, sync_interval: 15, last_sync_at: Date.now(), last_sync_ok: 1, last_sync_error: null },
    ];
  },
  async openAlerts() {
    return [
      {
        id: 77,
        workflowId: 10,
        workflowName: 'Daily KPI',
        instanceId: 1,
        instanceName: 'Produktion',
        versionId: 5,
        versionNumber: 2,
        rate: 0.45,
        total: 20,
        failed: 9,
        baselineRate: 0,
        baselineTotal: 20,
        rollbackVersionId: 4,
        rollbackNumber: 1,
        failingNodes: [],
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 88,
        workflowId: 20,
        workflowName: 'Staging Job',
        instanceId: 2,
        instanceName: 'Staging',
        versionId: 8,
        versionNumber: 3,
        rate: 0.5,
        total: 10,
        failed: 5,
        baselineRate: 0,
        baselineTotal: 10,
        rollbackVersionId: 7,
        rollbackNumber: 2,
        failingNodes: [],
        status: 'open',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
  },
  async dismissAlert(alertId: number) {
    dismissedAlerts.push(alertId);
  },
};

const store = createStore(new DatabaseSync(':memory:'));
const hub = createSseHub(60_000);
let server: Server;
let base: string;

before(async () => {
  const { app } = createApp({
    store,
    core: fakeCore,
    serviceToken: () => SERVICE_TOKEN,
    version: '0.3.12-test',
    hub,
    push: {
      async sendWakeup(endpoint, seq) {
        pushLog.push({ endpoint, seq });
        return true;
      },
    },
    lookup: async (host) => {
      if (host === 'push.example.com') return [{ address: '93.184.216.34' }];
      if (host === 'lan.local') return [{ address: '192.168.1.50' }];
      if (host === 'meta.evil') return [{ address: '169.254.169.254' }];
      return [{ address: '93.184.216.34' }];
    },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  hub.closeAll();
  await new Promise<void>((r) => server.close(() => r()));
});

const admin = (p: string, init: RequestInit = {}) =>
  fetch(`${base}/v1/admin${p}`, {
    ...init,
    headers: {
      'X-Internal-Token': SERVICE_TOKEN,
      'X-FlowVault-Origin': 'https://fv.example.com',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

const mobile = (p: string, token?: string, init: RequestInit = {}) =>
  fetch(`${base}/mobile/v1${p}`, {
    ...init,
    headers: {
      'X-Internal-Token': SERVICE_TOKEN,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

const ingest = (body: unknown) =>
  fetch(`${base}/v1/ingest`, {
    method: 'POST',
    headers: { 'X-Internal-Token': SERVICE_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('pairing lifecycle: disabled by default, one-time QR code, token hashed, revocation immediate', async () => {
  const created = (await (await admin('/pair', { method: 'POST', body: JSON.stringify({ label: 'Pixel 9' }) })).json()) as NotifyPairingCreated;
  assert.ok(created.uri.startsWith('flowvault://pair?v=1&url=https%3A%2F%2Ffv.example.com&code='));
  assert.ok(created.qrDataUrl.startsWith('data:image/png;base64,'));

  // Standardmäßig aus → 404
  assert.equal((await mobile('/pair', undefined, { method: 'POST', body: JSON.stringify({ code: created.code }) })).status, 404);

  // Aktivieren
  assert.equal((await admin('', { method: 'PUT', body: JSON.stringify({ enabled: true }) })).status, 200);

  // Einmalig einlösen
  const pairRes = await mobile('/pair', undefined, { method: 'POST', body: JSON.stringify({ code: created.code, deviceName: 'Mein Pixel' }) });
  assert.equal(pairRes.status, 201);
  const paired = (await pairRes.json()) as NotifyPairedResponse;
  assert.match(paired.token, /^fv_app_[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(store.state()).includes(paired.token), 'only hash stored');

  // Zweite Nutzung desselben Codes schlägt fehl
  assert.equal((await mobile('/pair', undefined, { method: 'POST', body: JSON.stringify({ code: created.code }) })).status, 401);

  // Authentifizierter Zugriff funktioniert
  assert.equal((await mobile('/bootstrap', paired.token)).status, 200);
  assert.equal((await mobile('/bootstrap', 'fv_app_wrong')).status, 401);

  // Sofortiger Widerruf
  assert.equal((await admin(`/devices/${paired.deviceId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await mobile('/bootstrap', paired.token)).status, 401);
});

test('5 failed pairing guesses invalidate pending codes', async () => {
  const created = (await (await admin('/pair', { method: 'POST', body: JSON.stringify({ label: 'TestPhone' }) })).json()) as NotifyPairingCreated;
  for (let i = 0; i < 5; i++) {
    assert.equal((await mobile('/pair', undefined, { method: 'POST', body: JSON.stringify({ code: `wrong-${i}` }) })).status, 401);
  }
  assert.equal((await mobile('/pair', undefined, { method: 'POST', body: JSON.stringify({ code: created.code }) })).status, 401);
});

test('burst coalescing, silent AI update, alert resolution, instance scoping, redaction & alert dismiss', async () => {
  // Gerät 1: nur Instanz 1 mit voller Schwärzung
  const p1 = (await (await admin('/pair', {
    method: 'POST',
    body: JSON.stringify({ label: 'ProdPhone', instances: [1], redactionMode: 'full' }),
  })).json()) as NotifyPairingCreated;
  const dev1 = (await (await mobile('/pair', undefined, { method: 'POST', body: JSON.stringify({ code: p1.code }) })).json()) as NotifyPairedResponse;

  // UnifiedPush konfigurieren
  assert.equal(
    (await mobile('/device', dev1.token, {
      method: 'PUT',
      body: JSON.stringify({ pushType: 'unifiedpush', pushEndpoint: 'https://push.example.com/topic123' }),
    })).status,
    200,
  );
  pushLog.length = 0;

  // 1) 12 identische Fehlläufe in einem Burst → 1 Nachricht mit groupCount=12, Push nur bei #1 und #10
  for (let i = 1; i <= 12; i++) {
    await ingest({
      eventUid: `exec-burst-${i}`,
      groupKey: 'exec:1:wfA:Stripe:401',
      instanceId: 1,
      instanceName: 'Produktion https://n8n.example.com/?api_key=CAN1secret',
      workflowId: 10,
      workflowName: 'Daily KPI',
      kind: 'execution_failed',
      severity: 'high',
      title: 'Fehllauf: Daily KPI',
      body: 'Stripe: Invalid API key: CAN2secret for admin@example.com',
      metadata: { errorNode: 'Stripe', errorMessage: 'Invalid API key: CAN2secret for admin@example.com' },
    });
  }
  const list1 = (await (await mobile('/messages', dev1.token)).json()) as { items: NotifyMessage[] };
  assert.equal(list1.items.length, 1);
  assert.equal(list1.items[0]!.groupCount, 12);
  assert.ok(!JSON.stringify(list1.items[0]).includes('CAN1secret'), 'instance secret redacted');
  assert.ok(!JSON.stringify(list1.items[0]).includes('CAN2secret'), 'error secret redacted');
  assert.ok(!JSON.stringify(list1.items[0]).includes('admin@example.com'), 'email redacted');
  assert.equal(pushLog.length, 2, 'zero-payload wakeup only on 1st and 10th occurrence');

  // 2) Änderung auf Instanz 2 bleibt für dev1 unsichtbar
  await ingest({
    eventUid: 'wf-staging-1',
    instanceId: 2,
    instanceName: 'Staging',
    workflowId: 20,
    workflowName: 'Staging Job',
    kind: 'workflow_changed',
    title: 'Staging Job · v3',
    body: '+1 Node',
  });
  const boot1 = (await (await mobile('/bootstrap', dev1.token)).json()) as NotifyBootstrap;
  assert.deepEqual(boot1.channels.map((c) => c.instanceId), [1]);
  assert.equal(boot1.channels[0]!.unreadCount, 1);

  // 3) Workflow-Änderung + stilles KI-Update (kein zweiter Push!)
  pushLog.length = 0;
  await ingest({
    eventUid: 'wf-prod-v14',
    instanceId: 1,
    instanceName: 'Produktion',
    workflowId: 10,
    workflowName: 'Daily KPI',
    versionId: 50,
    versionNumber: 14,
    kind: 'workflow_changed',
    title: 'Daily KPI · v14',
    body: '+1 Node (Slack)',
  });
  assert.equal(pushLog.length, 1);
  await ingest({
    type: 'ai_summary',
    instanceId: 1,
    instanceName: 'Produktion',
    workflowId: 10,
    versionId: 50,
    aiSummary: { title: 'Slack-Alert ergänzt', details: ['Informiert #ops bei Fehlern'] },
  });
  assert.equal(pushLog.length, 1, 'AI enrichment must not trigger a second push');
  const afterAi = (await (await mobile('/messages?instance=1', dev1.token)).json()) as { items: NotifyMessage[] };
  const changedMsg = afterAi.items.find((m) => m.version?.id === 50)!;
  assert.equal(changedMsg.metadata.aiSummary?.title, 'Slack-Alert ergänzt');

  // 4) Alert öffnen & später auflösen → verknüpft resolvedBySeq
  const openedRes = (await (await ingest({
    groupKey: 'alert:77',
    instanceId: 1,
    instanceName: 'Produktion',
    workflowId: 10,
    workflowName: 'Daily KPI',
    alertId: 77,
    kind: 'alert_opened',
    severity: 'critical',
    title: 'Fehlerquote gestiegen: Daily KPI',
    body: '45 % Fehlerquote',
  })).json()) as { seq: number };
  const resolvedRes = (await (await ingest({
    instanceId: 1,
    instanceName: 'Produktion',
    workflowId: 10,
    workflowName: 'Daily KPI',
    alertId: 77,
    kind: 'alert_resolved',
    severity: 'info',
    title: 'Entwarnung: Daily KPI',
    body: 'Wieder stabil',
  })).json()) as { seq: number };
  const allProd = (await (await mobile('/messages?instance=1', dev1.token)).json()) as { items: NotifyMessage[] };
  assert.equal(allProd.items.find((m) => m.seq === openedRes.seq)?.resolvedBySeq, resolvedRes.seq);

  // 5) Alert dismiss: erlaubt für Instanz 1 (alert 77), verboten für Instanz 2 (alert 88)
  dismissedAlerts.length = 0;
  assert.equal((await mobile('/alerts/77/dismiss', dev1.token, { method: 'POST' })).status, 200);
  assert.deepEqual(dismissedAlerts, [77]);
  assert.equal((await mobile('/alerts/88/dismiss', dev1.token, { method: 'POST' })).status, 403);

  // 6) Read-State aktualisiert unreadCount auf 0
  assert.equal((await mobile('/read', dev1.token, { method: 'POST', body: JSON.stringify({ instanceId: 1, readSeq: resolvedRes.seq }) })).status, 200);
  const bootAfterRead = (await (await mobile('/bootstrap', dev1.token)).json()) as NotifyBootstrap;
  assert.equal(bootAfterRead.channels[0]!.unreadCount, 0);
});

test('quiet hours allow critical overrides and block normal messages inside window', () => {
  const qh = { enabled: true, start: '22:00', end: '07:00', tz: 'UTC', allowCritical: true };
  const midnightUtc = Date.UTC(2026, 10, 25, 0, 30);
  const noonUtc = Date.UTC(2026, 10, 25, 12, 0);
  assert.equal(isInQuietHours(qh, 'normal', midnightUtc), true);
  assert.equal(isInQuietHours(qh, 'critical', midnightUtc), false);
  assert.equal(isInQuietHours({ ...qh, allowCritical: false }, 'critical', midnightUtc), true);
  assert.equal(isInQuietHours(qh, 'normal', noonUtc), false);
});

test('UnifiedPush SSRF protection blocks metadata, loopback, private IPs by default, and redirects', async () => {
  const lookup = async (h: string) => {
    if (h === 'meta.evil') return [{ address: '169.254.169.254' }];
    if (h === 'lan.local') return [{ address: '192.168.1.10' }];
    if (h === 'loop.evil') return [{ address: '127.0.0.1' }];
    return [{ address: '93.184.216.34' }];
  };
  await assert.rejects(() => validatePushEndpoint('http://push.example.com/a', { allowPrivate: false, allowlist: new Set() }, lookup));
  await assert.rejects(() => validatePushEndpoint('https://meta.evil/a', { allowPrivate: false, allowlist: new Set() }, lookup));
  await assert.rejects(() => validatePushEndpoint('https://loop.evil/a', { allowPrivate: true, allowlist: new Set() }, lookup));
  await assert.rejects(() => validatePushEndpoint('https://lan.local/a', { allowPrivate: false, allowlist: new Set() }, lookup));
  // Opt-in erlaubt lokales ntfy im LAN
  assert.equal(
    await validatePushEndpoint('http://lan.local/topic', { allowPrivate: true, allowlist: new Set() }, lookup),
    'http://lan.local/topic',
  );
  // Zero-Payload & Redirect-Ablehnung
  const sentBodies: string[] = [];
  const sender = createPushSender(
    { allowPrivate: false, allowlist: new Set() },
    (async (_u, init) => {
      sentBodies.push(String(init?.body ?? ''));
      assert.equal(init?.redirect, 'manual');
      return new Response('', { status: 200 });
    }) as typeof fetch,
    lookup,
  );
  assert.equal(await sender.sendWakeup('https://push.example.com/topic', 99), true);
  assert.deepEqual(JSON.parse(sentBodies[0]!), { v: 1, t: 'wake', seq: 99 });
});
